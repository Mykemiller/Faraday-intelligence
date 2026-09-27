-- CC-ARTIFACT-BODY-FETCH Phase 1 — split fetch from extract (live hotfix after the first run)
--
-- What happened: the first cron batch ran abf_fetch_batch() as ONE statement. It went
-- CPU-bound (>80 s, no wait event) inside extraction — the regexes used back-references
-- (`<(nav|...)...</\1>`), which force Postgres's backtracking matcher, plus {0,250}
-- bounded repeats that compile into very large automata — and a single statement means
-- one slow page rolls back every URL in the batch. The job was cancelled; nothing had
-- committed and no artifacts row was touched.
--
-- Fix:
--  1. Fetch and extract are separate. abf_fetch_run() is a PROCEDURE that COMMITs after
--     every URL and stores the raw page in artifact_body_fetch_url.raw_html (state 'fetched').
--  2. abf_extract_html v2: no back-references, no large bounded repeats; boilerplate tags
--     removed one tag at a time; cookie-banner lines filtered line-by-line; input capped.
--  3. abf_extract_run() is a PROCEDURE: one URL per transaction, then abf_apply().

alter table public.artifact_body_fetch_url add column if not exists raw_html text;
alter table public.artifact_body_fetch_url drop constraint if exists artifact_body_fetch_url_state_check;
alter table public.artifact_body_fetch_url add constraint artifact_body_fetch_url_state_check
  check (state in ('pending','fetched','ok','failed','blocked','empty','pdf_pending','skipped'));
alter table public.artifact_body_fetch_url add column if not exists extract_ms integer;

-- ---------------------------------------------------------------- extractor v2
create or replace function public.abf_html_fragment_to_text(p_html text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  t text := p_html;
  m text;
  ln text;
  keep text[] := '{}';
begin
  if t is null then return null; end if;
  t := regexp_replace(t, '</?(p|div|br|li|h[1-6]|tr|td|th|section|article|blockquote|pre|table|ul|ol|dd|dt|dl|figcaption|caption|hr)\M[^>]*>', E'\n', 'gi');
  t := regexp_replace(t, '<[^>]*>', ' ', 'g');
  for m in select distinct x[1] from regexp_matches(t, '&#([0-9]{1,7});', 'g') x loop
    begin t := replace(t, '&#' || m || ';', chr(m::int)); exception when others then null; end;
  end loop;
  for m in select distinct x[1] from regexp_matches(t, '&#[xX]([0-9a-fA-F]{1,6});', 'g') x loop
    begin
      t := replace(replace(t, '&#x' || m || ';', chr(('x' || lpad(m, 8, '0'))::bit(32)::int)),
                   '&#X' || m || ';', chr(('x' || lpad(m, 8, '0'))::bit(32)::int));
    exception when others then null; end;
  end loop;
  t := replace(t, '&nbsp;', ' ');   t := replace(t, '&quot;', '"');  t := replace(t, '&apos;', '''');
  t := replace(t, '&rsquo;', '’');  t := replace(t, '&lsquo;', '‘'); t := replace(t, '&rdquo;', '”');
  t := replace(t, '&ldquo;', '“');  t := replace(t, '&ndash;', '–'); t := replace(t, '&mdash;', '—');
  t := replace(t, '&hellip;', '…'); t := replace(t, '&copy;', '©');  t := replace(t, '&reg;', '®');
  t := replace(t, '&trade;', '™');  t := replace(t, '&sect;', '§');  t := replace(t, '&middot;', '·');
  t := replace(t, '&lt;', '<');     t := replace(t, '&gt;', '>');    t := replace(t, '&amp;', '&');
  t := replace(t, E'\r', '');
  t := regexp_replace(t, '[ \t ​]+', ' ', 'g');
  -- line pass: trim, drop cookie/consent lines
  foreach ln in array string_to_array(t, E'\n') loop
    ln := btrim(ln);
    if length(ln) < 400 and ln ~* '(we use cookies|accept (all )?cookies|cookie (policy|settings|preferences))' then
      continue;
    end if;
    keep := keep || ln;
  end loop;
  t := array_to_string(keep, E'\n');
  t := regexp_replace(t, '\n{3,}', E'\n\n', 'g');
  return btrim(t, E' \n\t');
end $$;

create or replace function public.abf_strip_element(p_html text, p_tag text)
returns text language sql immutable set search_path = public, pg_temp as $$
  -- one tag, no back-reference; tag name is caller-supplied from a fixed list
  select regexp_replace(p_html, '<' || p_tag || '\M[^>]*?>.*?</' || p_tag || '\s*>', ' ', 'gi')
$$;

create or replace function public.abf_extract_html(p_html text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  h text := left(p_html, 3000000);
  tg text;
  region text;
  best text;
  cand text;
begin
  if h is null then return null; end if;
  h := regexp_replace(h, '<!--.*?-->', ' ', 'g');
  foreach tg in array array['script','style','noscript','svg','template','iframe','head','object',
                            'nav','footer','aside','form','button','select','header','menu','dialog'] loop
    if position('<' || tg in lower(h)) > 0 then
      h := public.abf_strip_element(h, tg);
    end if;
  end loop;

  region := substring(h from '(?i)<main\M[^>]*?>(.*?)</main\s*>');
  if region is not null then
    best := public.abf_html_fragment_to_text(region);
    if length(coalesce(best, '')) >= 400 then return best; end if;
  end if;

  for cand in select x[1] from regexp_matches(h, '<article\M[^>]*?>(.*?)</article\s*>', 'gi') x loop
    cand := public.abf_html_fragment_to_text(cand);
    if length(coalesce(cand, '')) > length(coalesce(best, '')) then best := cand; end if;
  end loop;
  if length(coalesce(best, '')) >= 400 then return best; end if;

  region := coalesce(substring(h from '(?i)<body\M[^>]*?>(.*)$'), h);
  return public.abf_html_fragment_to_text(region);
end $$;

-- ---------------------------------------------------------------- fetch (no extraction), commit per URL
-- NOTE: no SET clause on these procedures — a procedure with SET cannot COMMIT
-- ("invalid transaction termination", hit live). Every reference is schema-qualified instead.
create or replace procedure public.abf_fetch_run(p_max_urls integer default 60, p_budget_ms integer default 50000)
language plpgsql as $$
declare
  cfg public.artifact_body_fetch_config;
  t0 timestamptz := clock_timestamp();
  u record;
  last_hit jsonb := '{}';
  cooled text[] := '{}';
  v_origin text; v_path text; wait_ms numeric;
  rob public.artifact_body_fetch_robots;
  allowed boolean;
  g record;
  st text; er text;
  first_n int; first_bad int;
begin
  select * into cfg from public.artifact_body_fetch_config;
  if not cfg.enabled or cfg.halt_reason is not null then
    raise notice 'abf_fetch_run halted: %', coalesce(cfg.halt_reason, 'disabled');
    return;
  end if;

  for u in
    select w.source_url, w.host from (
      select f.source_url, f.host, row_number() over (partition by f.host order by f.source_url) rn
      from public.artifact_body_fetch_url f
      where (f.state = 'pending' or (f.state = 'failed' and f.attempts < 3))
    ) w
    order by w.rn, w.host
    limit p_max_urls
  loop
    exit when extract(epoch from clock_timestamp() - t0) * 1000 > p_budget_ms;
    continue when u.host = any(cooled);
    begin
      v_origin := substring(u.source_url from '^(https?://[^/]+)');
      v_path := coalesce(substring(u.source_url from '^https?://[^/]+(/.*)$'), '/');

      if last_hit ? u.host then
        wait_ms := cfg.per_host_interval_ms
                   - extract(epoch from clock_timestamp() - (last_hit->>u.host)::timestamptz) * 1000;
        if wait_ms > 0 then perform pg_catalog.pg_sleep(wait_ms / 1000.0); end if;
      end if;

      select r0.* into rob from public.artifact_body_fetch_robots r0 where r0.origin = v_origin;
      if not found then
        select * into g from public.abf_http_get(v_origin || '/robots.txt');
        last_hit := last_hit || jsonb_build_object(u.host, clock_timestamp());
        insert into public.artifact_body_fetch_robots (origin, http_status, robots_txt, fetch_error)
        values (v_origin, g.status, case when g.status = 200 then g.content end, g.err)
        on conflict (origin) do update
          set http_status = excluded.http_status, robots_txt = excluded.robots_txt,
              fetch_error = excluded.fetch_error, fetched_at = now()
        returning * into rob;
        perform pg_catalog.pg_sleep(cfg.per_host_interval_ms / 1000.0);
      end if;

      st := null; er := null;
      if rob.http_status is null then
        -- transport error (TLS/DNS): retryable, and never cached as a robots verdict
        st := 'failed'; er := left('robots_fetch_error: ' || coalesce(rob.fetch_error, '?'), 200);
        allowed := false;
        delete from public.artifact_body_fetch_robots r1 where r1.origin = v_origin;
      elsif rob.http_status >= 500 then
        st := 'blocked'; er := 'robots_unavailable_' || rob.http_status;
        allowed := false;
      elsif rob.http_status = 200 then
        allowed := public.abf_robots_allowed(rob.robots_txt, v_path, 'faradayintelligence-bodyfetch');
        if not allowed then st := 'blocked'; er := 'robots_disallow'; end if;
      else
        allowed := true;   -- 4xx robots.txt => no restrictions (RFC 9309)
      end if;

      if allowed then
        select * into g from public.abf_http_get(u.source_url);
        last_hit := last_hit || jsonb_build_object(u.host, clock_timestamp());
        if g.err is not null then
          st := 'failed'; er := left(g.err, 200);
        elsif g.status in (401, 402, 403, 407, 429, 451) then
          st := 'blocked'; er := 'http_' || g.status;
          if g.status = 429 then cooled := cooled || u.host; end if;
        elsif g.status >= 400 or g.status < 200 then
          st := 'failed'; er := 'http_' || g.status;
        elsif g.content_type ilike '%pdf%' or g.final_url ~* '\.pdf($|[?#])' then
          st := 'pdf_pending';
        elsif coalesce(g.content, '') = '' then
          st := 'empty'; er := 'empty_response';
        else
          st := 'fetched';
        end if;
        update public.artifact_body_fetch_url
           set state = st, http_status = g.status, content_type = g.content_type, final_url = g.final_url,
               raw_html = case when st = 'fetched' then g.content end,
               error = er, attempts = attempts + 1,
               attempt_seq = coalesce(attempt_seq, nextval('public.artifact_body_fetch_attempt_seq')),
               updated_at = now()
         where source_url = u.source_url;
      else
        update public.artifact_body_fetch_url
           set state = st, error = er, attempts = attempts + 1,
               attempt_seq = coalesce(attempt_seq, nextval('public.artifact_body_fetch_attempt_seq')),
               updated_at = now()
         where source_url = u.source_url;
      end if;
    exception when others then
      update public.artifact_body_fetch_url
         set state = 'failed', error = left('internal: ' || sqlerrm, 200), attempts = attempts + 1,
             attempt_seq = coalesce(attempt_seq, nextval('public.artifact_body_fetch_attempt_seq')),
             updated_at = now()
       where source_url = u.source_url;
    end;
    commit;
  end loop;

  -- 30% guard over the first N attempted URLs (fetch-level: failed/blocked/empty count as not ok)
  select count(*), count(*) filter (where state in ('failed','blocked','empty'))
    into first_n, first_bad
  from (select state from public.artifact_body_fetch_url
        where attempt_seq is not null order by attempt_seq limit cfg.guard_window) x;
  if first_n >= cfg.guard_window and first_bad * 100.0 / first_n > cfg.guard_max_fail_pct then
    update public.artifact_body_fetch_config
       set halt_reason = format('guard: %s of first %s URL attempts not ok', first_bad, first_n),
           updated_at = now();
  end if;
  commit;
end $$;

-- ---------------------------------------------------------------- extract, one URL per transaction
create or replace procedure public.abf_extract_run(p_max_urls integer default 500, p_budget_ms integer default 50000)
language plpgsql as $$
declare
  cfg public.artifact_body_fetch_config;
  t0 timestamptz := clock_timestamp();
  t1 timestamptz;
  u record;
  body text; st text; er text;
begin
  select * into cfg from public.artifact_body_fetch_config;
  for u in select source_url from public.artifact_body_fetch_url
           where state = 'fetched' order by length(raw_html) limit p_max_urls loop
    exit when extract(epoch from clock_timestamp() - t0) * 1000 > p_budget_ms;
    t1 := clock_timestamp();
    begin
      select case when f.content_type ilike '%html%' or f.content_type is null
                       or f.raw_html ~* '^\s*(<!doctype|<html)'
                  then public.abf_extract_html(f.raw_html) else btrim(f.raw_html) end,
             case when f.raw_html ~* '(subscribe (now )?to (continue|read|keep reading)|already a subscriber|sign in to (continue|read)|log in to (continue|read)|this (content|article) is (only )?(for|available to) (subscribers|members)|create a free account to continue)'
                  then 'paywall_marker' end
        into body, er
      from public.artifact_body_fetch_url f where f.source_url = u.source_url;
      if er = 'paywall_marker' and length(coalesce(body, '')) < 1500 then
        st := 'blocked'; er := 'paywall_or_login'; body := null;
      elsif length(coalesce(body, '')) < cfg.min_body_chars then
        st := 'empty'; er := 'no_extractable_text'; body := null;
      else
        st := 'ok'; er := null;
      end if;
    exception when others then
      st := 'failed'; er := left('extract: ' || sqlerrm, 200); body := null;
    end;
    update public.artifact_body_fetch_url
       set state = st, error = er, body_text = body, body_char_count = length(body),
           extractor = case when st = 'ok' then 'pg_http+abf_extract_html_v2' end,
           fetched_at = case when st = 'ok' then now() else fetched_at end,
           extract_ms = round(extract(epoch from clock_timestamp() - t1) * 1000),
           updated_at = now()
     where source_url = u.source_url;
    commit;
  end loop;
  perform public.abf_apply();
  commit;
end $$;

drop function if exists public.abf_fetch_batch(integer, integer);

revoke all on function public.abf_strip_element(text, text) from public, anon, authenticated;
grant execute on function public.abf_strip_element(text, text), public.abf_extract_html(text),
  public.abf_html_fragment_to_text(text) to supabase_read_only_user;
revoke all on procedure public.abf_fetch_run(integer, integer), public.abf_extract_run(integer, integer)
  from public, anon, authenticated;
