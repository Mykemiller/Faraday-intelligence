-- CC-ARTIFACT-BODY-FETCH-1.0 — lanes, claim/lease, SEC fetch RPC, atomic re-chunk.
-- Builds on 20260927202742 cc_artifact_body_fetch_columns (body_* columns).
--
-- Additive only. raw_content, signal_envelope, ifs_subdomains and enrich_* are
-- never written by anything here. body_* writes fire no side effects: the only
-- BEFORE UPDATE trigger on artifacts that is not column-scoped
-- (trg_artifacts_fill_ifs_domains) was measured a no-op on every in-scope row
-- (0 rows with empty ifs_domains + a populated signal_envelope.idf_domains).
--
-- Why SEC goes through the database: sec-archives-egress-probe v2 established
-- that SEC refuses the Supabase EDGE egress IP range regardless of headers,
-- while the database's http extension reaches data.sec.gov. So the edge worker
-- owns throttling / backoff / extraction, and fetches each SEC document through
-- artifact_body_sec_http_get() — one request per call, no sleeping, no HTTP in
-- any pg_cron-driven SQL loop (the jobid-227 failure class).

-- ---------------------------------------------------------------- columns
alter table public.artifacts
  add column if not exists body_meta        jsonb,
  add column if not exists body_embedded_at timestamptz,
  add column if not exists body_chunk_count integer,
  add column if not exists sec_form_type    text;

comment on column public.artifacts.body_meta is
  'Fetch/extract provenance for body_text: http status, content type, extractor version, truncated flag + original length, EDGAR conformed/document type, exhibit flag, tail cut.';
comment on column public.artifacts.body_embedded_at is
  'When artifact_chunks were rebuilt from body_text (null = chunks still come from raw_content).';
comment on column public.artifacts.body_chunk_count is
  'Chunks written from body_text at body_embedded_at.';
comment on column public.artifacts.sec_form_type is
  'SEC form of the filing this document belongs to. Backfilled from crawl_metadata.form (EDGAR full-text search root form); the SEC header CONFORMED SUBMISSION TYPE is recorded in body_meta when a fetch sees it.';

-- Backfill: the form was always captured, just in crawl_metadata, not signal_envelope.
update public.artifacts
   set sec_form_type = crawl_metadata->>'form'
 where source_type::text = 'sec_filing'
   and sec_form_type is null
   and crawl_metadata ? 'form';

-- ---------------------------------------------------------------- lane membership
create or replace function public.artifact_body_lane(p_source_type text, p_source_url text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select case
    when p_source_type = 'sec_filing'
         and p_source_url ~* '^https?://(www\.)?sec\.gov/Archives/' then 'sec'
    when p_source_type not in ('sec_filing', 'web_news')
         and p_source_url !~* '^https?://([^/]*\.)?sec\.gov(/|$|:|\?)'
         and (p_source_type = 'state_puc_filing'
              or p_source_url ~* '^https?://[^/]*\.gov(/|$|:|\?)') then 'puc_gov'
    else null
  end
$$;

-- No new index: the claim adds an explicit, sargable source_type predicate so the
-- existing artifacts_body_fetch_pending (source_type, discovered_at desc) serves it.
-- (An expression index over source_type::text is impossible — enum_out is not immutable.)

-- ---------------------------------------------------------------- lane config (edit rows, no redeploy)
create table if not exists public.artifact_body_fetch_lanes (
  lane               text primary key,
  fetch_enabled      boolean not null default false,
  embed_enabled      boolean not null default false,
  user_agent         text not null,
  min_interval_ms    integer not null default 250 check (min_interval_ms >= 200),
  per_host_interval_ms integer not null default 1000,
  batch_limit        integer not null default 200,
  form_priority      text[],          -- SEC: fetch order; forms NOT listed are never claimed
  backoff_until      timestamptz,
  consecutive_blocks integer not null default 0,
  block_events       integer not null default 0,
  max_consecutive_blocks integer not null default 3,
  failure_rate_stop  numeric not null default 0.20,
  fetch_lease_until  timestamptz,
  embed_lease_until  timestamptz,
  disabled_reason    text,
  updated_at         timestamptz not null default now()
);
alter table public.artifact_body_fetch_lanes enable row level security;
create policy "service role only" on public.artifact_body_fetch_lanes
  for all to service_role using (true) with check (true);
revoke all on public.artifact_body_fetch_lanes from anon, authenticated;

insert into public.artifact_body_fetch_lanes
  (lane, fetch_enabled, embed_enabled, user_agent, min_interval_ms, per_host_interval_ms, batch_limit, form_priority)
values
  ('puc_gov', false, false, 'Faraday Intelligence LLC mykemiller@gmail.com', 250, 1000, 200, null),
  -- SEC: 250ms floor between request starts = 4 req/s max (policy ceiling 10, brief says <=5).
  ('sec',     false, false, 'Faraday Intelligence LLC mykemiller@gmail.com', 250, 250, 200, array['10-K','8-K'])
on conflict (lane) do nothing;

-- ---------------------------------------------------------------- run telemetry
create table if not exists public.artifact_body_fetch_runs (
  run_id        uuid primary key default gen_random_uuid(),
  lane          text not null,
  mode          text not null check (mode in ('fetch','embed')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  attempted     integer not null default 0,
  ok            integer not null default 0,
  failed        integer not null default 0,
  empty         integer not null default 0,
  blocked       integer not null default 0,
  skipped       integer not null default 0,
  truncated     integer not null default 0,
  embedded      integer not null default 0,
  chunks_written integer not null default 0,
  tokens_used   bigint  not null default 0,
  stop_reason   text,
  errors        jsonb not null default '[]'::jsonb
);
alter table public.artifact_body_fetch_runs enable row level security;
create policy "service role only" on public.artifact_body_fetch_runs
  for all to service_role using (true) with check (true);
revoke all on public.artifact_body_fetch_runs from anon, authenticated;

-- ---------------------------------------------------------------- claim (fetch)
-- Takes the lane's fetch lease (one worker per lane => the rate limit holds),
-- then returns up to p_limit pending rows. Returns nothing when the lane is
-- disabled, in backoff, or already leased.
create or replace function public.artifact_body_fetch_claim(p_lane text, p_limit integer, p_lease_seconds integer default 170)
returns table (artifact_id uuid, source_url text, raw_len integer, body_attempts integer, sec_form_type text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v_lane public.artifact_body_fetch_lanes;
begin
  update public.artifact_body_fetch_lanes l
     set fetch_lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where l.lane = p_lane
     and l.fetch_enabled
     and (l.backoff_until is null or l.backoff_until <= now())
     and (l.fetch_lease_until is null or l.fetch_lease_until <= now())
  returning * into v_lane;
  if not found then return; end if;

  return query
  select a.artifact_id, a.source_url, length(coalesce(a.raw_content, ''))::int, a.body_attempts, a.sec_form_type
    from public.artifacts a
   where public.artifact_body_lane(a.source_type::text, a.source_url) = p_lane
     and (case when p_lane = 'sec' then a.source_type = 'sec_filing'
               else a.source_type not in ('sec_filing', 'web_news') end)
     and a.body_text is null
     and (a.body_fetch_status is null or a.body_fetch_status = 'failed')
     and a.body_attempts < 3
     and (v_lane.form_priority is null or a.sec_form_type = any (v_lane.form_priority))
   order by array_position(v_lane.form_priority, a.sec_form_type) nulls last, a.discovered_at, a.artifact_id
   limit least(p_limit, v_lane.batch_limit);
end $$;

-- ---------------------------------------------------------------- release (fetch)
-- Records the invocation outcome on the lane. A block (403/429) bumps
-- consecutive_blocks and sets exponential backoff 60s * 2^(n-1); reaching
-- max_consecutive_blocks disables the lane (stop and report — never route
-- around a refusal). Any successful fetch resets the streak.
create or replace function public.artifact_body_fetch_release(p_lane text, p_blocked boolean, p_any_success boolean, p_block_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare v public.artifact_body_fetch_lanes;
begin
  update public.artifact_body_fetch_lanes l set
    consecutive_blocks = case when p_blocked then l.consecutive_blocks + 1
                              when p_any_success then 0 else l.consecutive_blocks end,
    block_events       = l.block_events + case when p_blocked then 1 else 0 end,
    backoff_until      = case when p_blocked then now() + make_interval(secs => 60 * power(2, l.consecutive_blocks)::int)
                              else l.backoff_until end,
    fetch_enabled      = case when p_blocked and l.consecutive_blocks + 1 >= l.max_consecutive_blocks then false
                              else l.fetch_enabled end,
    disabled_reason    = case when p_blocked and l.consecutive_blocks + 1 >= l.max_consecutive_blocks
                              then format('auto-stopped %s: %s consecutive blocks. Last: %s', now(), l.consecutive_blocks + 1, coalesce(p_block_detail, '?'))
                              else l.disabled_reason end,
    fetch_lease_until  = null,
    updated_at         = now()
  where l.lane = p_lane
  returning * into v;
  return to_jsonb(v) - 'user_agent';
end $$;

-- Disable a lane with a reason (failure-rate stop).
create or replace function public.artifact_body_lane_stop(p_lane text, p_reason text)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  update public.artifact_body_fetch_lanes
     set fetch_enabled = false, disabled_reason = p_reason, fetch_lease_until = null, updated_at = now()
   where lane = p_lane
$$;

-- ---------------------------------------------------------------- SEC fetch (database egress)
-- sec.gov URLs ONLY (anything else raises) — this is not a general fetch proxy.
-- One request per call; the caller owns pacing. User-Agent comes from the lane row.
create or replace function public.artifact_body_sec_http_get(p_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_ua   text;
  v_resp extensions.http_response;
  v_ct   text;
begin
  if p_url !~* '^https://(www\.|data\.)?sec\.gov/' then
    raise exception 'artifact_body_sec_http_get: sec.gov URLs only (got %)', left(p_url, 120);
  end if;
  select user_agent into v_ua from public.artifact_body_fetch_lanes where lane = 'sec';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');
  v_resp := extensions.http((
    'GET', p_url,
    array[extensions.http_header('User-Agent', v_ua),
          extensions.http_header('Accept', 'text/html,text/plain,application/xhtml+xml,*/*;q=0.5')],
    null, null)::extensions.http_request);
  select h.value into v_ct from unnest(v_resp.headers) h where lower(h.field) = 'content-type' limit 1;
  return jsonb_build_object(
    'status', v_resp.status,
    'content_type', coalesce(v_resp.content_type, v_ct),
    'bytes', octet_length(v_resp.content),
    'content', v_resp.content);
exception when others then
  return jsonb_build_object('status', null, 'error', left(sqlerrm, 300));
end $$;

-- ---------------------------------------------------------------- claim (embed)
create or replace function public.artifact_body_embed_claim(p_lane text, p_limit integer, p_lease_seconds integer default 170)
returns table (artifact_id uuid, raw_content text, body_text text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  update public.artifact_body_fetch_lanes l
     set embed_lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where l.lane = p_lane
     and l.embed_enabled
     and (l.embed_lease_until is null or l.embed_lease_until <= now());
  if not found then return; end if;

  return query
  select a.artifact_id, a.raw_content, a.body_text
    from public.artifacts a
   where public.artifact_body_lane(a.source_type::text, a.source_url) = p_lane
     and (case when p_lane = 'sec' then a.source_type = 'sec_filing'
               else a.source_type not in ('sec_filing', 'web_news') end)
     and a.body_fetch_status = 'ok'
     and a.body_embedded_at is null
     and a.body_char_count >= 2 * length(coalesce(a.raw_content, ''))
     and a.body_char_count >= length(coalesce(a.raw_content, '')) + 500
     and public.artifact_should_chunk(a.artifact_id)
   order by a.body_fetched_at, a.artifact_id
   limit p_limit;
end $$;

create or replace function public.artifact_body_embed_release(p_lane text)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
as $$
  update public.artifact_body_fetch_lanes set embed_lease_until = null, updated_at = now() where lane = p_lane
$$;

-- ---------------------------------------------------------------- atomic chunk replace
-- Delete-then-insert in ONE transaction: an artifact is never left chunkless.
-- p_chunks = [{"i":0,"text":"...","embedding":[...1536 floats...]}, ...]
create or replace function public.artifact_body_replace_chunks(p_artifact_id uuid, p_model text, p_chunks jsonb)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare v_n integer;
begin
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'artifact_body_replace_chunks: empty chunk set for %', p_artifact_id;
  end if;
  delete from public.artifact_chunks where artifact_id = p_artifact_id;
  insert into public.artifact_chunks (artifact_id, chunk_index, chunk_text, embedding, embedding_model)
  select p_artifact_id, (c->>'i')::int, c->>'text', (c->>'embedding')::vector, p_model
    from jsonb_array_elements(p_chunks) c;
  get diagnostics v_n = row_count;
  update public.artifacts
     set body_embedded_at = now(), body_chunk_count = v_n
   where artifact_id = p_artifact_id;
  return v_n;
end $$;

-- ---------------------------------------------------------------- measurement (read-only)
create or replace function public.artifact_body_fetch_measure(p_lane text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with s as (
    select a.artifact_id, a.body_fetch_status, a.body_char_count, a.body_meta, a.sec_form_type,
           a.body_embedded_at, a.body_chunk_count,
           length(coalesce(a.raw_content, '')) raw_len,
           coalesce(a.crawl_metadata->>'source_key', a.signal_envelope->>'source_key',
                    substring(a.source_url from '^https?://([^/]+)')) source_key
      from public.artifacts a
     where public.artifact_body_lane(a.source_type::text, a.source_url) = p_lane
       and (case when p_lane = 'sec' then a.source_type = 'sec_filing'
                 else a.source_type not in ('sec_filing', 'web_news') end)
  )
  select jsonb_build_object(
    'lane', p_lane,
    'total', count(*),
    'by_status', (select jsonb_object_agg(coalesce(body_fetch_status, 'pending'), n)
                    from (select body_fetch_status, count(*) n from s group by 1) x),
    'by_form_status', (select jsonb_object_agg(k, n) from (
                         select coalesce(sec_form_type, '-') || ':' || coalesce(body_fetch_status, 'pending') k, count(*) n
                           from s group by 1) x),
    'raw_len_median', percentile_cont(0.5) within group (order by raw_len)::int,
    'raw_len_p90',    percentile_cont(0.9) within group (order by raw_len)::int,
    'body_median', (percentile_cont(0.5) within group (order by body_char_count) filter (where body_fetch_status = 'ok'))::int,
    'body_p90', (percentile_cont(0.9) within group (order by body_char_count) filter (where body_fetch_status = 'ok'))::int,
    'raw_ge_800',     count(*) filter (where raw_len >= 800),
    'depth_ge_800',   count(*) filter (where greatest(raw_len, coalesce(body_char_count, 0)) >= 800),
    'source_keys_ge_800_before', count(distinct source_key) filter (where raw_len >= 800),
    'source_keys_ge_800_after',  count(distinct source_key) filter (where greatest(raw_len, coalesce(body_char_count, 0)) >= 800),
    'truncated',      count(*) filter (where (body_meta->>'truncated')::boolean),
    'qualifying_rechunk', count(*) filter (where body_fetch_status = 'ok'
                                             and body_char_count >= 2 * raw_len and body_char_count >= raw_len + 500),
    'qualifying_chars', coalesce(sum(body_char_count + raw_len) filter (where body_fetch_status = 'ok'
                                             and body_char_count >= 2 * raw_len and body_char_count >= raw_len + 500), 0),
    'embedded',       count(*) filter (where body_embedded_at is not null),
    'chunks_from_body', coalesce(sum(body_chunk_count) filter (where body_embedded_at is not null), 0)
  ) from s
$$;

-- ---------------------------------------------------------------- grants
revoke all on function public.artifact_body_fetch_claim(text, integer, integer)      from public, anon, authenticated;
revoke all on function public.artifact_body_fetch_release(text, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.artifact_body_lane_stop(text, text)                   from public, anon, authenticated;
revoke all on function public.artifact_body_sec_http_get(text)                      from public, anon, authenticated;
revoke all on function public.artifact_body_embed_claim(text, integer, integer)     from public, anon, authenticated;
revoke all on function public.artifact_body_embed_release(text)                     from public, anon, authenticated;
revoke all on function public.artifact_body_replace_chunks(uuid, text, jsonb)       from public, anon, authenticated;
revoke all on function public.artifact_body_fetch_measure(text)                     from public, anon, authenticated;
grant execute on function public.artifact_body_fetch_claim(text, integer, integer)      to service_role;
grant execute on function public.artifact_body_fetch_release(text, boolean, boolean, text) to service_role;
grant execute on function public.artifact_body_lane_stop(text, text)                   to service_role;
grant execute on function public.artifact_body_sec_http_get(text)                      to service_role;
grant execute on function public.artifact_body_embed_claim(text, integer, integer)     to service_role;
grant execute on function public.artifact_body_embed_release(text)                     to service_role;
grant execute on function public.artifact_body_replace_chunks(uuid, text, jsonb)       to service_role;
grant execute on function public.artifact_body_fetch_measure(text)                     to service_role, supabase_read_only_user;
