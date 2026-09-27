-- CC-ARTIFACT-BODY-FETCH Phase 1 — fetch machinery (government / utility-regulator slice)
--
-- Builds on CC-ARTIFACT-BODY-FETCH-1.0 (live migration 20260927202742, which added the
-- artifacts.body_* columns). This migration adds ONLY new objects; it writes nothing to
-- artifacts. The fan-out function below is the single write path into artifacts, and it
-- touches the body_* columns only.
--
-- Why in-database: the dev container's egress proxy rejects every target host (403 on
-- CONNECT), and a production edge-function deploy is a Hard-Stop. The Postgres `http`
-- extension reaches the open web, so HTML pages are fetched + extracted here.
-- It CANNOT carry PDFs: `http` returns `content` as text, which cannot hold a NUL byte,
-- so a PDF body truncates (measured: a 200 OK application/pdf came back as 898 chars).
-- PDF URLs are therefore parked as state 'pdf_pending' and extracted out-of-band; their
-- text is written back through abf_record_external().
--
-- Scope (Phase 1): source_type in (state_puc_filing, permit_utility), plus regulatory rows
-- whose source_url contains '.gov'. The 1,443 in-scope rows (2026-09-27) share only 205
-- distinct URLs, so fetching is keyed per URL and fanned out to every row that carries it.
--
-- Politeness: descriptive User-Agent with a contact address; robots.txt fetched per host
-- and honoured (RFC 9309: 4xx robots = allow, 5xx/unreachable = disallow); >= 600 ms
-- between requests to one host (< 2 req/s); 401/402/403/407/429/451 => 'blocked', never
-- retried or circumvented; no browser UA spoofing; paywall pages => 'blocked'.
--
-- Rollback: drop the objects below, then
--   update public.artifacts set body_text=null, body_fetch_status=null, body_fetch_error=null,
--          body_attempts=0, body_char_count=null, body_fetched_at=null
--   where source_url in (select source_url from public.artifact_body_fetch_url);

-- ---------------------------------------------------------------- config
create table if not exists public.artifact_body_fetch_config (
  id                    boolean primary key default true check (id),
  enabled               boolean not null default true,
  user_agent            text    not null,
  per_host_interval_ms  integer not null default 600 check (per_host_interval_ms >= 500),
  request_timeout_s     integer not null default 25,
  max_redirects         integer not null default 5,
  min_body_chars        integer not null default 200,
  guard_window          integer not null default 100,
  guard_max_fail_pct    numeric not null default 30,
  halt_reason           text,
  updated_at            timestamptz not null default now()
);

insert into public.artifact_body_fetch_config (user_agent)
values ('FaradayIntelligence-BodyFetch/1.0 (+https://faraday-intelligence.ai; contact: signals@faraday-intelligence.ai)')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- per-host robots cache
create table if not exists public.artifact_body_fetch_robots (
  origin       text primary key,          -- scheme://host
  http_status  integer,
  robots_txt   text,
  fetch_error  text,
  fetched_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- per-URL work table
create sequence if not exists public.artifact_body_fetch_attempt_seq;

create table if not exists public.artifact_body_fetch_url (
  source_url      text primary key,
  host            text not null,
  phase           text not null default 'phase1',
  artifact_rows   integer not null,
  state           text not null default 'pending'
                  check (state in ('pending','ok','failed','blocked','empty','pdf_pending','skipped')),
  http_status     integer,
  content_type    text,
  final_url       text,
  body_text       text,
  body_char_count integer,
  extractor       text,
  error           text,
  attempts        integer not null default 0,
  attempt_seq     bigint,
  fetched_at      timestamptz,
  updated_at      timestamptz not null default now(),
  applied_at      timestamptz,
  check (state <> 'ok' or (body_text is not null and body_char_count > 0))
);

alter table public.artifact_body_fetch_config enable row level security;
alter table public.artifact_body_fetch_robots enable row level security;
alter table public.artifact_body_fetch_url    enable row level security;
create policy "service role only" on public.artifact_body_fetch_config for all to service_role using (true) with check (true);
create policy "service role only" on public.artifact_body_fetch_robots for all to service_role using (true) with check (true);
create policy "service role only" on public.artifact_body_fetch_url    for all to service_role using (true) with check (true);
revoke all on public.artifact_body_fetch_config, public.artifact_body_fetch_robots,
              public.artifact_body_fetch_url from anon, authenticated;
revoke all on sequence public.artifact_body_fetch_attempt_seq from anon, authenticated;

-- ---------------------------------------------------------------- scope predicate
create or replace function public.abf_in_phase1_scope(p_source_type text, p_source_url text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_source_type in ('state_puc_filing','permit_utility')
      or (p_source_type = 'regulatory' and p_source_url ilike '%.gov%')
$$;

-- ---------------------------------------------------------------- HTML -> document text
-- Postgres ARE gotcha: the FIRST quantifier fixes greediness for the whole pattern, so
-- every pattern that spans content leads with a non-greedy quantifier.
create or replace function public.abf_html_fragment_to_text(p_html text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  t text := p_html;
  m text;
begin
  if t is null then return null; end if;
  t := regexp_replace(t, '</?(p|div|br|li|h[1-6]|tr|td|th|section|article|blockquote|pre|table|ul|ol|dd|dt|dl|figcaption|caption|hr)\M[^>]*>', E'\n', 'gi');
  t := regexp_replace(t, '<[^>]*>', ' ', 'g');
  -- numeric entities
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
  -- whitespace
  t := replace(t, E'\r', '');
  t := regexp_replace(t, '[ \t ​]+', ' ', 'g');
  t := regexp_replace(t, ' *\n *', E'\n', 'g');
  -- cookie / consent banner lines
  t := regexp_replace(t, '(^|\n)[^\n]{0,250}?(we use cookies|accept (all )?cookies|cookie (policy|settings|preferences))[^\n]{0,250}(?=\n|$)', '\1', 'gi');
  t := regexp_replace(t, '\n{3,}', E'\n\n', 'g');
  return btrim(t, E' \n\t');
end $$;

create or replace function public.abf_extract_html(p_html text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  h text := p_html;
  region text;
  best text;
  cand text;
begin
  if h is null then return null; end if;
  -- non-content blocks
  h := regexp_replace(h, '<!--.*?-->', ' ', 'g');
  h := regexp_replace(h, '<(script|style|noscript|svg|template|iframe|head|object)\M[^>]*?>.*?</\1\s*>', ' ', 'gi');
  -- page furniture
  h := regexp_replace(h, '<(nav|footer|aside|form|button|select|header|menu|dialog)\M[^>]*?>.*?</\1\s*>', ' ', 'gi');

  -- prefer <main>, then the longest <article>, then <body>
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

-- ---------------------------------------------------------------- robots.txt evaluation
create or replace function public.abf_robots_pattern_rx(p_pat text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare p text := p_pat; anchored boolean := false;
begin
  if right(p, 1) = '$' then anchored := true; p := left(p, -1); end if;
  p := regexp_replace(p, '([.+?^${}()|\[\]\\])', '\\\1', 'g');
  p := replace(p, '*', '.*');
  return '^' || p || case when anchored then '$' else '' end;
end $$;

-- true = allowed. Longest match wins, Allow wins ties; a group naming our token beats '*'.
create or replace function public.abf_robots_allowed(p_robots text, p_path text, p_token text)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ln text; k text; v text;
  agents text[] := '{}';
  prev_was_agent boolean := false;
  spec jsonb := '[]'; star jsonb := '[]'; rules jsonb;
  has_spec boolean := false;
  r jsonb; best_len int := -1; best_allow boolean := true; plen int;
  a text;
begin
  if p_robots is null or btrim(p_robots) = '' then return true; end if;
  foreach ln in array regexp_split_to_array(p_robots, E'\r?\n') loop
    ln := btrim(regexp_replace(ln, '#.*$', ''));
    if ln = '' or position(':' in ln) = 0 then continue; end if;
    k := lower(btrim(split_part(ln, ':', 1)));
    v := btrim(substr(ln, position(':' in ln) + 1));
    if k = 'user-agent' then
      if not prev_was_agent then agents := '{}'; end if;
      agents := agents || lower(v);
      prev_was_agent := true;
    elsif k in ('allow','disallow') then
      prev_was_agent := false;
      if v = '' then continue; end if;          -- empty Disallow = allow all
      foreach a in array agents loop
        if a = '*' then
          star := star || jsonb_build_array(jsonb_build_object('allow', k = 'allow', 'pat', v));
        elsif position(a in lower(p_token)) > 0 then
          spec := spec || jsonb_build_array(jsonb_build_object('allow', k = 'allow', 'pat', v));
          has_spec := true;
        end if;
      end loop;
    else
      prev_was_agent := false;
    end if;
  end loop;
  rules := case when has_spec then spec else star end;
  for r in select * from jsonb_array_elements(rules) loop
    if p_path ~ public.abf_robots_pattern_rx(r->>'pat') then
      plen := length(r->>'pat');
      if plen > best_len or (plen = best_len and (r->>'allow')::boolean) then
        best_len := plen; best_allow := (r->>'allow')::boolean;
      end if;
    end if;
  end loop;
  return best_allow;
end $$;

-- ---------------------------------------------------------------- polite GET with manual redirects
create or replace function public.abf_http_get(p_url text)
returns table (status integer, content_type text, content text, final_url text, err text)
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare
  cfg public.artifact_body_fetch_config;
  u text := p_url;
  r extensions.http_response;
  loc text;
  i int;
begin
  select * into cfg from public.artifact_body_fetch_config;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', cfg.request_timeout_s::text);
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '10');
  for i in 0 .. cfg.max_redirects loop
    begin
      r := extensions.http((
        'GET', u,
        array[extensions.http_header('User-Agent', cfg.user_agent),
              extensions.http_header('Accept', 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5')],
        null, null)::extensions.http_request);
    exception when others then
      return query select null::int, null::text, null::text, u, left(sqlerrm, 200);
      return;
    end;
    if r.status in (301, 302, 303, 307, 308) then
      select h.value into loc from unnest(r.headers) h where lower(h.field) = 'location' limit 1;
      if loc is null then
        return query select r.status, r.content_type, null::text, u, 'redirect_without_location'::text;
        return;
      end if;
      u := case
             when loc ~* '^https?://' then loc
             when left(loc, 2) = '//' then split_part(u, ':', 1) || ':' || loc
             when left(loc, 1) = '/' then substring(u from '^(https?://[^/]+)') || loc
             else regexp_replace(u, '[^/]*$', '') || loc
           end;
      continue;
    end if;
    return query select r.status, r.content_type, r.content, u, null::text;
    return;
  end loop;
  return query select null::int, null::text, null::text, u, 'too_many_redirects'::text;
end $$;

-- ---------------------------------------------------------------- seed the URL work list
create or replace function public.abf_seed_phase1()
returns jsonb language plpgsql volatile set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.artifact_body_fetch_url (source_url, host, artifact_rows, state)
  select a.source_url,
         lower(substring(a.source_url from '^https?://([^/:]+)')),
         count(*),
         case when a.source_url ~* '^https?://' then 'pending' else 'skipped' end
  from public.artifacts a
  where public.abf_in_phase1_scope(a.source_type::text, a.source_url)
    and a.body_text is null
    and a.body_fetch_status is distinct from 'skipped'
    and a.body_attempts < 3
    and a.source_url is not null
  group by a.source_url
  on conflict (source_url) do update set artifact_rows = excluded.artifact_rows;
  get diagnostics n = row_count;
  return jsonb_build_object('urls_upserted', n);
end $$;

-- ---------------------------------------------------------------- fan URL results out to artifacts
-- The ONLY write into artifacts. Writes body_* columns only. Idempotent (re-applies only URLs
-- whose result changed since the last apply). PDFs still 'pdf_pending' are not applied.
create or replace function public.abf_apply()
returns jsonb language plpgsql volatile set search_path = public, pg_temp as $$
declare n int; guard int;
begin
  -- trg_artifacts_fill_ifs_domains fires on every UPDATE and would backfill ifs_domains on a
  -- row whose ifs_domains is empty but whose envelope carries idf_domains. Refuse if any
  -- such row is in the write set, so this pass can never change an ifs_* column.
  select count(*) into guard
  from public.artifacts a
  join public.artifact_body_fetch_url u on u.source_url = a.source_url
  where public.abf_in_phase1_scope(a.source_type::text, a.source_url)
    and u.state in ('ok','failed','blocked','empty')
    and (u.applied_at is null or u.updated_at > u.applied_at)
    and (a.ifs_domains is null or cardinality(a.ifs_domains) = 0)
    and jsonb_typeof(a.signal_envelope -> 'idf_domains') = 'array'
    and jsonb_array_length(a.signal_envelope -> 'idf_domains') > 0;
  if guard > 0 then
    raise exception 'abf_apply: % rows would have ifs_domains backfilled by trigger; refusing', guard;
  end if;

  update public.artifacts a
     set body_text        = case when u.state = 'ok' then u.body_text end,
         body_char_count  = case when u.state = 'ok' then u.body_char_count end,
         body_fetched_at  = case when u.state = 'ok' then u.fetched_at end,
         body_fetch_status = u.state,
         body_fetch_error = u.error,
         body_attempts    = u.attempts
    from public.artifact_body_fetch_url u
   where a.source_url = u.source_url
     and public.abf_in_phase1_scope(a.source_type::text, a.source_url)
     and u.state in ('ok','failed','blocked','empty')
     and (u.applied_at is null or u.updated_at > u.applied_at);
  get diagnostics n = row_count;

  update public.artifact_body_fetch_url
     set applied_at = now()
   where state in ('ok','failed','blocked','empty')
     and (applied_at is null or updated_at > applied_at);
  return jsonb_build_object('artifact_rows_written', n);
end $$;

-- ---------------------------------------------------------------- record text extracted out-of-band (PDFs)
create or replace function public.abf_record_external(
  p_source_url text, p_state text, p_body text, p_error text, p_http_status integer,
  p_content_type text, p_extractor text)
returns void language plpgsql volatile set search_path = public, pg_temp as $$
begin
  if p_state not in ('ok','failed','blocked','empty') then
    raise exception 'abf_record_external: bad state %', p_state;
  end if;
  update public.artifact_body_fetch_url
     set state = p_state,
         body_text = case when p_state = 'ok' then p_body end,
         body_char_count = case when p_state = 'ok' then length(p_body) end,
         error = p_error, http_status = coalesce(p_http_status, http_status),
         content_type = coalesce(p_content_type, content_type), extractor = p_extractor,
         attempts = attempts + 1,
         attempt_seq = coalesce(attempt_seq, nextval('public.artifact_body_fetch_attempt_seq')),
         fetched_at = case when p_state = 'ok' then now() else fetched_at end,
         updated_at = now()
   where source_url = p_source_url;
  if not found then raise exception 'abf_record_external: unknown url %', p_source_url; end if;
end $$;

-- ---------------------------------------------------------------- batch driver
create or replace function public.abf_fetch_batch(p_max_urls integer default 40, p_budget_ms integer default 45000)
returns jsonb language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare
  cfg public.artifact_body_fetch_config;
  t0 timestamptz := clock_timestamp();
  u record;
  last_hit jsonb := '{}';
  cooled text[] := '{}';
  v_origin text; path text; wait_ms numeric;
  rob public.artifact_body_fetch_robots;
  allowed boolean;
  g record;
  body text;
  st text; er text;
  n int := 0;
  first_n int; first_bad int;
  applied jsonb;
begin
  select * into cfg from public.artifact_body_fetch_config;
  if not cfg.enabled or cfg.halt_reason is not null then
    return jsonb_build_object('halted', true, 'reason', coalesce(cfg.halt_reason, 'disabled'));
  end if;

  for u in
    select w.* from (
      select f.*, row_number() over (partition by f.host order by f.source_url) rn
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
      path := coalesce(substring(u.source_url from '^https?://[^/]+(/.*)$'), '/');

      -- pacing for this host
      if last_hit ? u.host then
        wait_ms := cfg.per_host_interval_ms
                   - extract(epoch from clock_timestamp() - (last_hit->>u.host)::timestamptz) * 1000;
        if wait_ms > 0 then perform pg_sleep(wait_ms / 1000.0); end if;
      end if;

      -- robots.txt (cached per origin)
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
        perform pg_sleep(cfg.per_host_interval_ms / 1000.0);
      end if;

      if rob.http_status is null or rob.http_status >= 500 then
        st := 'blocked'; er := 'robots_unavailable_' || coalesce(rob.http_status::text, 'unreachable');
        allowed := false;
      elsif rob.http_status = 200 then
        allowed := public.abf_robots_allowed(rob.robots_txt, path, 'faradayintelligence-bodyfetch');
        if not allowed then st := 'blocked'; er := 'robots_disallow'; end if;
      else
        allowed := true;   -- 4xx robots.txt => no restrictions (RFC 9309 §2.3.1.3)
      end if;

      if allowed then
        select * into g from public.abf_http_get(u.source_url);
        last_hit := last_hit || jsonb_build_object(u.host, clock_timestamp());
        body := null; st := null; er := null;
        if g.err is not null then
          st := 'failed'; er := left(g.err, 200);
        elsif g.status in (401, 402, 403, 407, 429, 451) then
          st := 'blocked'; er := 'http_' || g.status;
          if g.status = 429 then cooled := cooled || u.host; end if;   -- back off the host
        elsif g.status >= 400 or g.status < 200 then
          st := 'failed'; er := 'http_' || g.status;
        elsif g.content_type ilike '%pdf%' or g.final_url ~* '\.pdf($|[?#])' then
          st := 'pdf_pending'; er := null;
        else
          body := case when g.content_type ilike '%html%' or g.content_type is null
                            or g.content ~* '^\s*(<!doctype|<html)'
                       then public.abf_extract_html(g.content)
                       else btrim(g.content) end;
          if length(coalesce(body, '')) < 1500
             and g.content ~* '(subscribe (now )?to (continue|read|keep reading)|already a subscriber|sign in to (continue|read)|log in to (continue|read)|this (content|article) is (only )?(for|available to) (subscribers|members)|create a free account to continue)'
          then
            st := 'blocked'; er := 'paywall_or_login'; body := null;
          elsif length(coalesce(body, '')) < cfg.min_body_chars then
            st := 'empty'; er := 'no_extractable_text'; body := null;
          else
            st := 'ok';
          end if;
        end if;

        update public.artifact_body_fetch_url
           set state = st, http_status = g.status, content_type = g.content_type,
               final_url = g.final_url, body_text = body, body_char_count = length(body),
               extractor = case when st = 'ok' then 'pg_http+abf_extract_html_v1' end,
               error = er, attempts = attempts + 1,
               attempt_seq = coalesce(attempt_seq, nextval('public.artifact_body_fetch_attempt_seq')),
               fetched_at = case when st = 'ok' then now() else fetched_at end,
               updated_at = now()
         where source_url = u.source_url;
      else
        update public.artifact_body_fetch_url
           set state = st, error = er, attempts = attempts + 1,
               attempt_seq = coalesce(attempt_seq, nextval('public.artifact_body_fetch_attempt_seq')),
               updated_at = now()
         where source_url = u.source_url;
      end if;
      n := n + 1;
    exception when others then
      update public.artifact_body_fetch_url
         set state = 'failed', error = left('internal: ' || sqlerrm, 200), attempts = attempts + 1,
             attempt_seq = coalesce(attempt_seq, nextval('public.artifact_body_fetch_attempt_seq')),
             updated_at = now()
       where source_url = u.source_url;
      n := n + 1;
    end;
  end loop;

  -- 30% guard over the first N attempted URLs, weighted by the artifact rows they carry
  select count(*), count(*) filter (where state in ('failed','blocked','empty'))
    into first_n, first_bad
  from (select state from public.artifact_body_fetch_url
        where attempt_seq is not null order by attempt_seq limit cfg.guard_window) x;
  if first_n >= cfg.guard_window and first_bad * 100.0 / first_n > cfg.guard_max_fail_pct then
    update public.artifact_body_fetch_config
       set halt_reason = format('guard: %s of first %s URL attempts not ok', first_bad, first_n),
           updated_at = now();
  end if;

  applied := public.abf_apply();
  return jsonb_build_object('processed', n, 'elapsed_ms',
           round(extract(epoch from clock_timestamp() - t0) * 1000), 'apply', applied,
           'guard', jsonb_build_object('window_attempted', first_n, 'not_ok', first_bad));
end $$;

revoke all on function public.abf_in_phase1_scope(text, text), public.abf_html_fragment_to_text(text),
  public.abf_extract_html(text), public.abf_robots_pattern_rx(text),
  public.abf_robots_allowed(text, text, text), public.abf_http_get(text), public.abf_seed_phase1(),
  public.abf_apply(), public.abf_record_external(text, text, text, text, integer, text, text),
  public.abf_fetch_batch(integer, integer)
  from public, anon, authenticated;
-- the read-only MCP role may test the pure extractors
grant execute on function public.abf_extract_html(text), public.abf_html_fragment_to_text(text),
  public.abf_robots_allowed(text, text, text), public.abf_robots_pattern_rx(text)
  to supabase_read_only_user;
