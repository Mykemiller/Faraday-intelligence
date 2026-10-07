-- UN-APPLIED — applied by Myke on merge
--
-- FDY-90 · L3 — resolve Google News redirect URLs to publisher URLs and fetch
-- bodies for local-watch artifacts.
--
-- WHAT THIS ADDS (all additive; no existing object changes behaviour)
--   * artifact_body_fetch_lanes.aggregator_robots_ack  — a second, explicit gate
--     on the resolve step (see ROBOTS below). Defaults false.
--   * lane row 'gnews_local', fetch_enabled = false (every lane ships disabled).
--   * artifact_body_fetch_runs.mode now also accepts 'resolve'.
--   * gnews_resolve_claim / gnews_resolve_record  (token → publisher URL)
--   * gnews_body_claim / gnews_body_charge_attempt / gnews_body_record
--   * gnews_resolve_measure  (read-only)
--   * two pg_cron jobs, 20 minutes apart.
--
-- WHAT IT NEVER WRITES
--   artifacts.source_url, raw_content, signal_envelope, content_hash,
--   confidence_grade. The resolver touches six keys inside crawl_metadata;
--   the body fetcher touches body_* only. No row is deleted. No count changes.
--
-- MEASURED LIVE ON PRODUCTION 2026-10-07 (read-only SQL, ycadmmngkdhvpcsrcuaq):
--   local-watch artifacts (source_registry.source_key like 'gsearch:loc-%')  54,211
--   ... with raw_content ~* 'data ?cent'                                     13,820
--       (the FDY-90 brief said 13,802 — production is 13,820; production wins)
--   relevant subset (data-centre match AND published_at >= 2026-07-01)        6,157 rows
--   ... distinct Google News tokens in that subset                            3,714
--   ... restriction-keyword rows / tokens                            1,845 / 1,036
--   source_url on news.google.com                                   54,211 (100%)
--   body ever attempted                                                          0
--   tokens that are offline-decodable (legacy base64 URL protobuf)        0 of 54,211
-- Every token is the newer opaque 'AU_yqL…' form, so resolution needs the
-- network. A 50-token sample resolved 50/50 (100%) live, all via batchexecute.
--
-- ROBOTS — WHY THE RESOLVE STEP HAS A SECOND GATE
-- news.google.com/robots.txt, fetched 2026-10-07, is for User-agent: *
--   Disallow: /
--   Allow: /$  /?  /home$  /home?  /home/  /nwshp$  /topics/  /publications/
--          /stories/  /swg/  /about$  /about?  /about/
-- which does NOT allow /rss/articles/ or /_/DotsSplashUi/. A strict reading
-- disallows the resolve request. This migration therefore does NOT enable
-- resolution: aggregator_robots_ack defaults false and fetch_enabled defaults
-- false, and gnews-resolve returns immediately while either is false. Enabling
-- is one deliberate UPDATE by Myke (the exact statement is in the PR body).
-- The BODY fetch hits publisher hosts and honours their robots.txt
-- unconditionally in the edge worker, with no override of any kind.
--
-- THROUGHPUT (<= 1 request/second per host, sequential, one worker per lane)
--   resolve: <= 2 requests per token (1 GET of the interstitial + 1 POST to
--            batchexecute), >= 1000 ms between request STARTS ⇒ ~2.05 s/token.
--            limit 30 ⇒ ~62 s per invocation (budget 130 s). Every 20 min ⇒
--            90 tokens/hour ⇒ 3,714 distinct tokens in ~41 h.
--   fetch:   1 request per row, >= 1000 ms global floor and >= 1000 ms per
--            publisher host. limit 60 ⇒ ~60 s per invocation. Every 20 min ⇒
--            180 rows/hour ⇒ the resolved subset in ~34 h.
--   The two jobs are offset by 10 minutes and share the lane's single
--   fetch_lease_until, so they can never run concurrently and the 1 req/s
--   ceiling holds across both.
--
-- ROLLBACK
--   select cron.unschedule(jobid) from cron.job
--    where jobname in ('gnews-resolve-20min','gnews-body-fetch-20min');
--   drop function if exists public.gnews_resolve_claim(integer,integer),
--     public.gnews_resolve_record(text,jsonb), public.gnews_body_claim(integer,integer),
--     public.gnews_body_charge_attempt(uuid),
--     public.gnews_body_record(uuid,text,text,text,jsonb,boolean),
--     public.gnews_resolve_measure();
--   delete from public.artifact_body_fetch_lanes where lane = 'gnews_local';
--   alter table public.artifact_body_fetch_lanes drop column if exists aggregator_robots_ack;
--   -- and, to undo the data this lane wrote:
--   update public.artifacts set crawl_metadata = crawl_metadata
--            - 'publisher_url' - 'publisher_domain' - 'resolve_method'
--            - 'resolved_at' - 'resolve_attempts' - 'resolve_error',
--          body_text = null, body_char_count = null, body_fetch_status = null,
--          body_fetch_error = null, body_meta = null, body_attempts = 0,
--          body_fetched_at = null
--    where crawl_metadata ? 'resolve_method';

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- lane config

alter table public.artifact_body_fetch_lanes
  add column if not exists aggregator_robots_ack boolean not null default false;

comment on column public.artifact_body_fetch_lanes.aggregator_robots_ack is
  'Explicit acknowledgement that this lane may request paths on an aggregator host whose robots.txt does not Allow them (news.google.com /rss/articles/ and /_/DotsSplashUi/). Defaults false; gnews-resolve mode=resolve is a no-op while false. Does not affect publisher-host robots.txt, which is always honoured.';

insert into public.artifact_body_fetch_lanes
  (lane, fetch_enabled, embed_enabled, user_agent, min_interval_ms,
   per_host_interval_ms, batch_limit, form_priority, aggregator_robots_ack)
values
  ('gnews_local', false, false,
   'Faraday/1.0 (+https://faraday-intelligence.ai; contact: signals@faraday-intelligence.ai)',
   1000, 1000, 60, null, false)
on conflict (lane) do nothing;

-- 'resolve' joins 'fetch' and 'embed' as a run mode.
alter table public.artifact_body_fetch_runs
  drop constraint if exists artifact_body_fetch_runs_mode_check;
alter table public.artifact_body_fetch_runs
  add constraint artifact_body_fetch_runs_mode_check
  check (mode in ('fetch', 'embed', 'resolve'));

-- ---------------------------------------------------------------- scope

-- LOCAL-WATCH MEMBERSHIP, AND WHY IT IS INLINED THREE TIMES
-- Membership is source_registry.source_key like 'gsearch:loc-%' joined on
-- crawl_metadata->>'feed_url'. The obvious spellings are both far too slow,
-- measured with EXPLAIN ANALYZE on production 2026-10-07:
--   EXISTS (...) correlated subquery            9,644 ms  (36.0M rows discarded
--                                                          by a nested-loop semi join)
--   JOIN to a MATERIALIZED CTE of feed_urls    11,697 ms  (38.7M rows discarded)
--   = ANY (array(select …))                       926 ms  ← used below
-- The planner underestimates the artifacts side by ~700x (54 vs 38,727 rows)
-- because none of the chained filters is indexable, so it keeps choosing a
-- nested loop. Collapsing the predicate to `= ANY (array(…))` turns the feed
-- list into a single InitPlan evaluated once per query and removes the join node
-- altogether. That is why this subquery is written out at each of the three call
-- sites instead of being wrapped in a helper function: the InitPlan is the
-- optimisation, and a function would reintroduce a per-row call.

-- The opaque /rss/articles/<token> id. Rows sharing a token share an article, so
-- one resolution fans out to all of them (6,157 rows → 3,714 resolutions).
create or replace function public.gnews_token(p_source_url text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select nullif(split_part(split_part(p_source_url, '/rss/articles/', 2), '?', 1), '')
$$;

-- NO NEW INDEX, deliberately. A partial index on
--   (published_at desc, artifact_id) where source_url like 'https://news.google.com/rss/articles/%'
-- would narrow the claim's bitmap scan from 213,606 rows to 54,211. It is NOT
-- created here because artifacts is 574,162 rows / 1.302 GB of heap (measured
-- 2026-10-07) and the LIKE predicate is not itself indexable, so the build needs
-- a full heap scan while holding a ShareLock that blocks every poller INSERT —
-- and CREATE INDEX CONCURRENTLY cannot run inside a migration's transaction.
-- The claim already completes in 926 ms on the existing idx_artifacts_published_at,
-- against a 20-minute schedule, so the index buys margin we do not need. If it is
-- ever wanted, run it by hand, outside this migration and outside a transaction:
--   create index concurrently artifacts_gnews_pending
--     on public.artifacts (published_at desc, artifact_id)
--     where source_url like 'https://news.google.com/rss/articles/%';

-- ---------------------------------------------------------------- resolve claim

-- Takes the lane's single fetch lease (one worker per lane ⇒ the rate limit
-- holds across both modes), then returns up to p_limit DISTINCT tokens.
-- Returns nothing while fetch_enabled is false, aggregator_robots_ack is false,
-- the lane is in backoff, or the lane is already leased.
create or replace function public.gnews_resolve_claim(p_limit integer, p_lease_seconds integer default 170)
returns table (
  artifact_id uuid,
  source_url text,
  crawl_metadata jsonb,
  resolve_attempts integer
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_lane public.artifact_body_fetch_lanes;
begin
  update public.artifact_body_fetch_lanes l
     set fetch_lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where l.lane = 'gnews_local'
     and l.fetch_enabled
     and l.aggregator_robots_ack
     and (l.backoff_until is null or l.backoff_until <= now())
     and (l.fetch_lease_until is null or l.fetch_lease_until <= now())
  returning * into v_lane;
  if not found then return; end if;

  -- Two stages on purpose. DISTINCT ON forces its own expression to lead the
  -- ORDER BY, so the inner query can only rank rows WITHIN a token; the priority
  -- ordering across tokens (restriction keywords first, FDY-90 item 3) has to be
  -- applied outside it, and the LIMIT with it.
  return query
  select d.artifact_id, d.source_url, d.crawl_metadata, d.resolve_attempts
    from (
      select distinct on (public.gnews_token(a.source_url))
             a.artifact_id,
             a.source_url,
             a.crawl_metadata,
             coalesce((a.crawl_metadata->>'resolve_attempts')::int, 0) as resolve_attempts,
             (a.raw_content ~* '(moratori|ban|pause|ordinance|rezon|zoning)') as restriction,
             a.published_at
        from public.artifacts a
       where a.source_url like 'https://news.google.com/rss/articles/%'
         and a.published_at >= date '2026-07-01'
         and a.raw_content ~* 'data ?cent'
         and a.crawl_metadata->>'publisher_url' is null
         and coalesce((a.crawl_metadata->>'resolve_attempts')::int, 0) < 3
         and a.crawl_metadata->>'feed_url' = any (array(
               select distinct sr.feed_url from public.source_registry sr
                where sr.source_key like 'gsearch:loc-%' and sr.feed_url is not null))
       order by public.gnews_token(a.source_url),
                (a.raw_content ~* '(moratori|ban|pause|ordinance|rezon|zoning)') desc,
                a.published_at desc,
                a.artifact_id
    ) d
   order by d.restriction desc, d.published_at desc, d.artifact_id
   limit least(p_limit, v_lane.batch_limit);
end $$;

-- Writes the six resolver keys into crawl_metadata and FANS OUT to every row
-- carrying the same token. jsonb `||` is a key-wise merge, so pre-existing keys
-- (mode, feed_url, fetched_at, …) survive untouched and source_url is never
-- referenced on the SET side.
create or replace function public.gnews_resolve_record(p_source_url text, p_delta jsonb)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_token text := public.gnews_token(p_source_url);
  v_n integer;
  v_bad text;
begin
  if v_token is null then
    raise exception 'gnews_resolve_record: no token in %', left(coalesce(p_source_url, '<null>'), 120);
  end if;
  if jsonb_typeof(p_delta) <> 'object' then
    raise exception 'gnews_resolve_record: delta must be a json object';
  end if;
  -- Only the six resolver keys may be written through this path.
  select string_agg(k, ',') into v_bad
    from jsonb_object_keys(p_delta) k
   where k not in ('publisher_url','publisher_domain','resolve_method',
                   'resolved_at','resolve_attempts','resolve_error');
  if v_bad is not null then
    raise exception 'gnews_resolve_record: disallowed key(s) %', v_bad;
  end if;
  -- An aggregator URL is never recorded as a publisher URL (decision D2).
  if p_delta ? 'publisher_url'
     and (p_delta->>'publisher_url') ~* '^https?://([^/]*\.)?(news\.)?google\.' then
    raise exception 'gnews_resolve_record: refusing to store an aggregator URL as publisher_url';
  end if;

  update public.artifacts a
     set crawl_metadata = coalesce(a.crawl_metadata, '{}'::jsonb) || p_delta
   where a.source_url like 'https://news.google.com/rss/articles/%'
     and public.gnews_token(a.source_url) = v_token;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- body claim

-- Resolved rows only. The URL fetched is crawl_metadata->>'publisher_url';
-- source_url (the aggregator redirect) is never fetched for a body.
create or replace function public.gnews_body_claim(p_limit integer, p_lease_seconds integer default 170)
returns table (
  artifact_id uuid,
  publisher_url text,
  publisher_domain text,
  body_attempts integer
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_lane public.artifact_body_fetch_lanes;
begin
  update public.artifact_body_fetch_lanes l
     set fetch_lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where l.lane = 'gnews_local'
     and l.fetch_enabled
     and (l.backoff_until is null or l.backoff_until <= now())
     and (l.fetch_lease_until is null or l.fetch_lease_until <= now())
  returning * into v_lane;
  if not found then return; end if;

  return query
  select a.artifact_id,
         a.crawl_metadata->>'publisher_url',
         a.crawl_metadata->>'publisher_domain',
         a.body_attempts
    from public.artifacts a
   where a.source_url like 'https://news.google.com/rss/articles/%'
     and a.crawl_metadata->>'publisher_url' is not null
     and a.published_at >= date '2026-07-01'
     and a.body_text is null
     and (a.body_fetch_status is null or a.body_fetch_status = 'failed')
     and a.body_attempts < 3
     and a.crawl_metadata->>'feed_url' = any (array(
           select distinct sr.feed_url from public.source_registry sr
            where sr.source_key like 'gsearch:loc-%' and sr.feed_url is not null))
   order by (a.raw_content ~* '(moratori|ban|pause|ordinance|rezon|zoning)') desc,
            a.published_at desc,
            a.artifact_id
   limit least(p_limit, v_lane.batch_limit);
end $$;

-- Charge the attempt BEFORE the request, so a worker killed mid-document drops
-- out of the queue after 3 attempts instead of being re-claimed first forever.
create or replace function public.gnews_body_charge_attempt(p_artifact_id uuid)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  update public.artifacts
     set body_attempts = least(body_attempts + 1, 3)
   where artifact_id = p_artifact_id
$$;

-- The single write path into body_*. p_exhaust burns the retry budget outright
-- (HTTP 404/410: a dead link is permanent, not a failure to retry).
create or replace function public.gnews_body_record(
  p_artifact_id uuid,
  p_status      text,
  p_body_text   text    default null,
  p_error       text    default null,
  p_meta        jsonb   default null,
  p_exhaust     boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if p_status not in ('ok','failed','blocked','skipped','empty') then
    raise exception 'gnews_body_record: bad status %', p_status;
  end if;
  if p_status = 'ok' and coalesce(length(p_body_text), 0) = 0 then
    raise exception 'gnews_body_record: status ok requires body_text';
  end if;
  update public.artifacts
     set body_fetch_status = p_status,
         body_fetched_at   = now(),
         body_fetch_error  = p_error,
         body_meta         = p_meta,
         body_attempts     = case when p_exhaust then 3
                                  else least(greatest(body_attempts, 1), 3) end,
         body_text         = case when p_status = 'ok' then p_body_text else body_text end,
         body_char_count   = case when p_status = 'ok' then length(p_body_text) else body_char_count end
   where artifact_id = p_artifact_id;
end $$;

-- ---------------------------------------------------------------- measurement

create or replace function public.gnews_resolve_measure()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with s as (
    select a.artifact_id,
           public.gnews_token(a.source_url) token,
           a.crawl_metadata->>'publisher_url'    publisher_url,
           a.crawl_metadata->>'publisher_domain' publisher_domain,
           a.crawl_metadata->>'resolve_method'   resolve_method,
           a.crawl_metadata->>'resolve_error'    resolve_error,
           coalesce((a.crawl_metadata->>'resolve_attempts')::int, 0) resolve_attempts,
           a.body_fetch_status,
           a.body_char_count,
           (a.raw_content ~* '(moratori|ban|pause|ordinance|rezon|zoning)') restriction
      from public.artifacts a
     where a.source_url like 'https://news.google.com/rss/articles/%'
       and a.published_at >= date '2026-07-01'
       and a.raw_content ~* 'data ?cent'
       and a.crawl_metadata->>'feed_url' = any (array(
           select distinct sr.feed_url from public.source_registry sr
            where sr.source_key like 'gsearch:loc-%' and sr.feed_url is not null))
  )
  select jsonb_build_object(
    'lane', 'gnews_local',
    'rows', count(*),
    'distinct_tokens', count(distinct token),
    'restriction_rows', count(*) filter (where restriction),
    'resolved', count(*) filter (where publisher_url is not null),
    'resolved_tokens', count(distinct token) filter (where publisher_url is not null),
    'unresolved_exhausted', count(*) filter (where publisher_url is null and resolve_attempts >= 3),
    'pending_resolve', count(*) filter (where publisher_url is null and resolve_attempts < 3),
    'aggregator_urls_stored_as_publisher',
        count(*) filter (where publisher_url ~* '^https?://([^/]*\.)?(news\.)?google\.'),
    'by_resolve_method', (select jsonb_object_agg(coalesce(resolve_method,'unresolved'), n)
                            from (select resolve_method, count(*) n from s group by 1) x),
    'top_publisher_domains', (select jsonb_object_agg(publisher_domain, n)
                                from (select publisher_domain, count(*) n from s
                                       where publisher_domain is not null
                                       group by 1 order by 2 desc limit 20) x),
    'by_body_status', (select jsonb_object_agg(coalesce(body_fetch_status,'pending'), n)
                         from (select body_fetch_status, count(*) n from s
                                where publisher_url is not null group by 1) x),
    'body_median_chars', (percentile_cont(0.5) within group (order by body_char_count)
                            filter (where body_fetch_status = 'ok'))::int
  ) from s
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.gnews_token(text)                                        from public, anon, authenticated;
revoke all on function public.gnews_resolve_claim(integer, integer)                    from public, anon, authenticated;
revoke all on function public.gnews_resolve_record(text, jsonb)                        from public, anon, authenticated;
revoke all on function public.gnews_body_claim(integer, integer)                       from public, anon, authenticated;
revoke all on function public.gnews_body_charge_attempt(uuid)                           from public, anon, authenticated;
revoke all on function public.gnews_body_record(uuid, text, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.gnews_resolve_measure()                                  from public, anon, authenticated;

grant execute on function public.gnews_token(text)                                        to service_role;
grant execute on function public.gnews_resolve_claim(integer, integer)                    to service_role;
grant execute on function public.gnews_resolve_record(text, jsonb)                        to service_role;
grant execute on function public.gnews_body_claim(integer, integer)                       to service_role;
grant execute on function public.gnews_body_charge_attempt(uuid)                           to service_role;
grant execute on function public.gnews_body_record(uuid, text, text, text, jsonb, boolean) to service_role;
grant execute on function public.gnews_resolve_measure()                                  to service_role, supabase_read_only_user;

-- ---------------------------------------------------------------- schedule

-- Both jobs are no-ops until Myke enables the lane (see ROBOTS above), so it is
-- safe for them to exist from the moment this migration is applied.
select cron.unschedule(jobid) from cron.job where jobname in ('gnews-resolve-20min', 'gnews-body-fetch-20min');

-- Resolve: :00, :20, :40 — 30 tokens per run (<= 2 requests each, >= 1 s apart).
select cron.schedule('gnews-resolve-20min', '0,20,40 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/gnews-resolve',
      '{"mode":"resolve","limit":30,"lease_seconds":120}'::jsonb, 'cron_caller_token', 150000)$$);

-- Body fetch: :10, :30, :50 — offset 10 minutes so the two modes never contend
-- for the lane's single lease, keeping the combined rate <= 1 req/s.
select cron.schedule('gnews-body-fetch-20min', '10,30,50 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/gnews-resolve',
      '{"mode":"fetch","limit":60,"lease_seconds":120}'::jsonb, 'cron_caller_token', 150000)$$);
