-- CC-ARTIFACT-BODY-FETCH Phase 1 — two live fixes from the first fetch pass
--
-- 1. abf_http_get returned http_response.content_type / .content (varchar) into a
--    RETURNS TABLE of text => "structure of query does not match function result type".
--    58 URLs failed on that return path. Casts added.
-- 2. A TRANSPORT error fetching robots.txt (TLS reset, DNS) was cached and treated as
--    "unreachable => disallow". RFC 9309's disallow rule is for a server that answers 5xx;
--    a socket error is a retryable fetch failure. Now: transport error => URL 'failed'
--    (retried, max 3) and nothing is cached; 5xx => 'blocked' as before.
-- Reset: the rows failed by bug (1) and the two robots-transport rows go back to
-- 'pending' with attempts = 0 and attempt_seq cleared — they never produced a host
-- verdict, so they must not count toward the 30% guard or the 3-attempt cap.

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
      return query select null::int, null::text, null::text, u, left(sqlerrm, 200)::text;
      return;
    end;
    if r.status in (301, 302, 303, 307, 308) then
      select h.value into loc from unnest(r.headers) h where lower(h.field) = 'location' limit 1;
      if loc is null then
        return query select r.status::int, r.content_type::text, null::text, u, 'redirect_without_location'::text;
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
    return query select r.status::int, r.content_type::text, r.content::text, u, null::text;
    return;
  end loop;
  return query select null::int, null::text, null::text, u, 'too_many_redirects'::text;
end $$;
revoke all on function public.abf_http_get(text) from public, anon, authenticated;

-- abf_fetch_run: robots transport error => 'failed' (retryable), not cached. No SET clause (procedure COMMITs).
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
revoke all on procedure public.abf_fetch_run(integer, integer) from public, anon, authenticated;

-- robots: never cache a transport failure
delete from public.artifact_body_fetch_robots where http_status is null;

update public.artifact_body_fetch_url
   set state = 'pending', error = null, attempts = 0, attempt_seq = null, updated_at = now()
 where error like 'internal: structure of query%'
    or error = 'robots_unavailable_unreachable';
