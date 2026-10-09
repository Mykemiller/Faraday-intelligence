-- UN-APPLIED — applied by Myke on merge
-- ===========================================================================
-- 20261009230000 — FDY-91: the Faraday end of the local-gov-watch push
-- ===========================================================================
--
-- Version 20261009230000, above every 14-digit file in this repo
-- (20261009220000, FDY-90) and above every applied version. FDY-90's file must
-- be applied FIRST: this one's $ordering$ block refuses otherwise, because the
-- whole eligibility test reads the crawl_metadata keys FDY-90 creates.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS ADDS
-- ---------------------------------------------------------------------------
--   * public.boundstone_push_ledger — one row per artifact, ever. The primary
--     key IS the idempotency guarantee.
--   * public.boundstone_push_due(p_limit int)    — READ-ONLY. What to push.
--   * public.boundstone_push_record(p jsonb)     — writes one ledger row.
--   * public.boundstone_push_measure()           — READ-ONLY. Operator view.
--
-- It creates no column on artifacts, writes nothing to artifacts, and deletes
-- nothing. `select count(*) from public.artifacts` cannot move.
--
-- ---------------------------------------------------------------------------
-- ⚠️ ELIGIBILITY, AND WHY IT IS ZERO ROWS TODAY
-- ---------------------------------------------------------------------------
-- A row is eligible when ALL of these hold (FDY-91 brief §B.2):
--     crawl_metadata->>'publisher_url' is not null
--     raw_content ~* 'data ?cent'
--     published_at >= 2026-07-01
--     artifact_id not in boundstone_push_ledger
--
-- Measured live on ycadmmngkdhvpcsrcuaq 2026-10-07/08, read-only:
--     local-watch artifacts (source_key like 'gsearch:loc-%')        54,211
--     ... matching 'data ?cent'                                      13,820
--     ... and published_at >= 2026-07-01  (the relevant window)       6,157
--     ... distinct Google News tokens in that window                  3,714
--     ... with crawl_metadata->>'publisher_url' not null                   0
--
-- ZERO. Not because the bridge is wrong but because FDY-90's resolver is
-- shipped UN-APPLIED and its lane ships disabled. `publisher_url` appears only
-- after Myke (a) applies 20261009220000 and (b) opens the gate:
--
--     update public.artifact_body_fetch_lanes
--        set fetch_enabled = true, aggregator_robots_ack = true
--      where lane = 'gnews_local';
--
-- That UPDATE is Myke's decision D5 (FDY-98 resolved as Option 1) and is NOT
-- performed by this migration, by the edge function, or by anything in this PR.
-- Until it runs, boundstone_push_due returns no rows and the function exits 0.
-- That is correct behaviour, not a defect: a NULL publisher_url means the only
-- URL Faraday holds for the article is the aggregator token, and decision D2
-- says an aggregator URL is never stored in Boundstone.
--
-- ---------------------------------------------------------------------------
-- ⚠️ WHAT THE LEDGER IS FOR, AND WHY `skipped` IS A ROW AND NOT AN ABSENCE
-- ---------------------------------------------------------------------------
-- 4,650 of the 6,157 relevant rows cannot be attributed to a state honestly
-- (measured 2026-10-08; see scripts/boundstone-local-push-dryrun.sql). Those
-- are skipped, and the skip is RECORDED with its reason rather than left as a
-- gap, for three reasons that each cost real time to learn:
--
--   1. Without a row, every hourly run re-reads, re-extracts and re-attributes
--      the same 4,650 artifacts forever. The ledger turns an O(corpus) sweep
--      into O(new rows).
--   2. "Why is this article not on boundstone.org?" is a question a human asks
--      about a specific URL. `select reason from boundstone_push_ledger where
--      artifact_id = …` answers it. An absence answers nothing.
--   3. The reason distribution IS the quality measurement. If
--      `no_honest_state` suddenly collapses, the attribution changed, and
--      boundstone_push_measure() is where that shows up.
--
-- A skip is therefore not final in principle — delete the row and the artifact
-- is re-offered — but nothing in this PR ever deletes one.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CANNOT DO
-- ---------------------------------------------------------------------------
-- * It cannot reach the Boundstone database. Nothing here knows that project
--   exists; the only wire is the edge function's two RPC calls (guardrail 4).
-- * It cannot store article text. boundstone_push_record reads named keys and
--   `response` is capped and asserted below to carry no body/extract key.
-- * It cannot change an artifact. No UPDATE, no DELETE, no trigger on
--   public.artifacts anywhere in this file.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Ordering guard — refuse rather than half-apply. Runs BEFORE `begin;` so a
--    refusal does not leave a hand-applying operator in an aborted transaction.
-- ---------------------------------------------------------------------------
do $ordering$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.artifacts') is null then
    v_missing := v_missing || 'public.artifacts does not exist — wrong database'::text;
  end if;
  if to_regclass('public.source_registry') is null then
    v_missing := v_missing || 'public.source_registry does not exist — wrong database'::text;
  end if;
  if to_regprocedure('public.gnews_resolve_measure()') is null then
    v_missing := v_missing ||
      ('public.gnews_resolve_measure() — apply 20261009220000_gnews_resolve_schedule.sql (FDY-90) '
       || 'first. This file reads the crawl_metadata keys that migration creates.')::text;
  end if;

  if cardinality(v_missing) > 0 then
    raise exception E'20261009230000 cannot apply — missing dependencies:\n  %',
      array_to_string(v_missing, E'\n  ');
  end if;
end
$ordering$;

begin;

-- ---------------------------------------------------------------------------
-- 1. The ledger.
-- ---------------------------------------------------------------------------
create table if not exists public.boundstone_push_ledger (
  artifact_id   uuid primary key references public.artifacts(artifact_id) on delete cascade,
  pushed_at     timestamptz not null default now(),
  kind          text not null,
  reason        text,
  boundstone_id uuid,
  response      jsonb,
  constraint boundstone_push_ledger_kind_ck
    check (kind in ('press','candidate','both','skipped')),
  -- A skip without a reason is the thing this table exists to prevent.
  constraint boundstone_push_ledger_reason_ck
    check ((kind = 'skipped') = (reason is not null)),
  -- ⚠️ A press item that was actually created has an id. A skip never does.
  constraint boundstone_push_ledger_id_ck
    check (kind = 'skipped' or boundstone_id is not null or reason is not null)
);

comment on table public.boundstone_push_ledger is
  'FDY-91. One row per local-watch artifact ever considered for the Boundstone push lane. The '
  'PRIMARY KEY is the idempotency guarantee: an artifact in this table is never offered again, '
  'so re-running the hourly job cannot create a second press item. kind=''skipped'' rows are '
  'recorded WITH a reason rather than omitted, so "why is this article not on boundstone.org?" '
  'is answerable for a specific artifact_id and so the hourly sweep stays O(new rows). Carries '
  'no article text: `response` is the RPC''s own small JSON reply, never a body or an extract.';

comment on column public.boundstone_push_ledger.kind is
  '''press'' — a press item was proposed. ''both'' — a press item AND, inside the same '
  'bs_press_propose call, a record candidate. ''candidate'' — reserved; the current lane cannot '
  'produce it, because a candidate is only ever opened alongside its press item. ''skipped'' — '
  'nothing was sent, and `reason` says what stopped it.';

comment on column public.boundstone_push_ledger.reason is
  'Why nothing was sent, from a closed vocabulary shared with the edge function: no_publisher_url, '
  'no_headline, no_honest_state, ambiguous_state_named, ambiguous_jurisdiction, aggregator_url, '
  'not_retrieved, rejected_by_boundstone, no_credential, disabled, duplicate_at_boundstone.';

create index if not exists boundstone_push_ledger_kind_idx
  on public.boundstone_push_ledger (kind, pushed_at desc);
create index if not exists boundstone_push_ledger_reason_idx
  on public.boundstone_push_ledger (reason) where reason is not null;

alter table public.boundstone_push_ledger enable row level security;
revoke all on table public.boundstone_push_ledger from anon, authenticated;
-- No policy is created, so RLS denies everything to anon/authenticated. The
-- edge function reaches it as service_role, which bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- 2. public.boundstone_push_due(p_limit int) — READ-ONLY.
-- ---------------------------------------------------------------------------
-- Oldest first (brief §B.2), batch default 100. It returns the HEADLINE SOURCE
-- (raw_content's first line and the publisher name) rather than raw_content
-- itself: the edge function needs those two strings and must never be handed
-- the article body, because a body it holds is a body it could forward.
--
-- ⚠️ `stable`, not `volatile`, and no FOR UPDATE / no lease. The ledger's
-- primary key makes a double-push impossible on the only thing that matters —
-- a second concurrent worker racing the same artifact loses the insert in
-- boundstone_push_record and its push is reported as a duplicate by
-- bs_press_propose, which is idempotent on (url, state_abbr). Two independent
-- idempotency keys is why this needs no lock.
create or replace function public.boundstone_push_due(p_limit int default 100)
returns table (
  artifact_id      uuid,
  published_at     timestamptz,
  publisher_url    text,
  publisher_domain text,
  rss_line1        text,
  rss_publisher    text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.artifact_id,
         a.published_at,
         a.crawl_metadata->>'publisher_url'    as publisher_url,
         a.crawl_metadata->>'publisher_domain' as publisher_domain,
         btrim(split_part(a.raw_content, E'\n', 1)) as rss_line1,
         -- everything after the LAST '&nbsp;&nbsp;' — headline-pure.ts's own
         -- rule, so the SQL and the TypeScript cannot disagree about which
         -- substring is the publisher.
         btrim(reverse(split_part(reverse(a.raw_content), reverse('&nbsp;&nbsp;'), 1))) as rss_publisher
    from public.artifacts a
    join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
   where s.source_key like 'gsearch:loc-%'
     and a.crawl_metadata->>'publisher_url' is not null
     and a.raw_content ~* 'data ?cent'
     and a.published_at >= timestamptz '2026-07-01 00:00:00+00'
     and not exists (
       select 1 from public.boundstone_push_ledger l where l.artifact_id = a.artifact_id
     )
   order by a.published_at asc, a.artifact_id asc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

comment on function public.boundstone_push_due(int) is
  'FDY-91. READ-ONLY. The local-watch artifacts the Boundstone push lane should consider next, '
  'oldest first: publisher_url resolved by FDY-90, raw_content matching ''data ?cent'', '
  'published_at >= 2026-07-01, and not already in boundstone_push_ledger. Returns the RSS first '
  'line and publisher name, NEVER raw_content — the caller cannot forward a body it was never '
  'given. Returns 0 rows until FDY-90 is applied and its gate opened.';

revoke all on function public.boundstone_push_due(int) from public, anon, authenticated;
grant execute on function public.boundstone_push_due(int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. public.boundstone_push_record(p jsonb) — the only writer.
-- ---------------------------------------------------------------------------
-- Reads named keys only, in the pattern of Boundstone's own propose functions.
-- A caller cannot set pushed_at and cannot smuggle a column in by adding a key.
create or replace function public.boundstone_push_record(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_artifact uuid;
  v_kind     text := nullif(btrim(coalesce(p->>'kind', '')), '');
  v_reason   text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_bs_id    uuid;
  v_response jsonb := coalesce(p->'response', 'null'::jsonb);
  v_inserted boolean;
begin
  if nullif(btrim(coalesce(p->>'artifact_id', '')), '') is null then
    raise exception 'boundstone_push_record: artifact_id is required.';
  end if;
  begin
    v_artifact := (p->>'artifact_id')::uuid;
  exception when others then
    raise exception 'boundstone_push_record: artifact_id % is not a uuid.', p->>'artifact_id';
  end;

  if v_kind is null then
    raise exception 'boundstone_push_record: kind is required.';
  end if;

  if nullif(btrim(coalesce(p->>'boundstone_id', '')), '') is not null then
    begin
      v_bs_id := (p->>'boundstone_id')::uuid;
    exception when others then
      raise exception 'boundstone_push_record: boundstone_id % is not a uuid.', p->>'boundstone_id';
    end;
  end if;

  -- ⚠️ GUARDRAIL 7, ENFORCED ON THE WAY IN RATHER THAN HOPED FOR. `response` is
  -- the RPC's small JSON reply. If a caller ever tries to park an extract, a
  -- body, a summary or a score in it, this raises instead of storing it — and
  -- it raises on the KEY, so a future refactor cannot sneak one past a length
  -- check.
  if v_response is not null and jsonb_typeof(v_response) = 'object' then
    if exists (
      select 1 from jsonb_object_keys(v_response) k
       where lower(k) = any (array['body','raw_content','extract','excerpt','summary',
                                   'snippet','abstract','text','content','sentiment',
                                   'relevance','score','signal_score','rank'])
    ) then
      raise exception 'boundstone_push_record: response carries an article-text or scoring key. '
                      'A press item is a headline, a URL and a date (guardrail 7).';
    end if;
  end if;
  if length(coalesce(v_response::text, '')) > 4000 then
    raise exception 'boundstone_push_record: response is % bytes. The RPC reply is small; '
                    'anything this size is article text.', length(v_response::text);
  end if;

  insert into public.boundstone_push_ledger (artifact_id, kind, reason, boundstone_id, response)
  values (v_artifact, v_kind, v_reason, v_bs_id, nullif(v_response, 'null'::jsonb))
  on conflict (artifact_id) do nothing;

  v_inserted := found;

  -- A lost race is reported, not raised: the winner's row is the truth and the
  -- loser's push was absorbed as a duplicate on the Boundstone side.
  return jsonb_build_object('artifact_id', v_artifact, 'recorded', v_inserted,
                            'status', case when v_inserted then 'inserted' else 'already_ledgered' end);
end;
$$;

comment on function public.boundstone_push_record(jsonb) is
  'FDY-91. The only writer to public.boundstone_push_ledger. Reads named keys only — a caller '
  'cannot set pushed_at. RAISES if `response` carries an article-text or scoring key, or exceeds '
  '4,000 bytes, which is guardrail 7 enforced at the boundary rather than trusted. A second call '
  'for the same artifact_id is a reported no-op, never an error and never a second row.';

revoke all on function public.boundstone_push_record(jsonb) from public, anon, authenticated;
grant execute on function public.boundstone_push_record(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. public.boundstone_push_measure() — READ-ONLY operator view.
-- ---------------------------------------------------------------------------
create or replace function public.boundstone_push_measure()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'measured_at', now(),
    'local_watch_artifacts', (
      select count(*) from public.artifacts a
        join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
       where s.source_key like 'gsearch:loc-%'),
    'relevant_window', (
      select count(*) from public.artifacts a
        join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
       where s.source_key like 'gsearch:loc-%'
         and a.raw_content ~* 'data ?cent'
         and a.published_at >= timestamptz '2026-07-01 00:00:00+00'),
    'resolved_in_window', (
      select count(*) from public.artifacts a
        join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
       where s.source_key like 'gsearch:loc-%'
         and a.raw_content ~* 'data ?cent'
         and a.published_at >= timestamptz '2026-07-01 00:00:00+00'
         and a.crawl_metadata->>'publisher_url' is not null),
    'ledgered', (select count(*) from public.boundstone_push_ledger),
    'due_now', (select count(*) from public.boundstone_push_due(500)),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (
        select kind, count(*) n from public.boundstone_push_ledger group by 1) k), '{}'::jsonb),
    'by_reason', coalesce((select jsonb_object_agg(reason, n) from (
        select reason, count(*) n from public.boundstone_push_ledger
         where reason is not null group by 1) r), '{}'::jsonb),
    -- FDY-90's own assertion, surfaced here so one call answers "is the pipe
    -- clean?". It must stay 0: an aggregator URL stored as a publisher URL is
    -- the one failure that would put news.google.com in front of Boundstone.
    'aggregator_urls_stored_as_publisher',
      (select (public.gnews_resolve_measure())->'aggregator_urls_stored_as_publisher')
  );
$$;

comment on function public.boundstone_push_measure() is
  'FDY-91. READ-ONLY. Corpus, resolver progress and ledger state for the Boundstone push lane, '
  'plus FDY-90''s aggregator_urls_stored_as_publisher, which must always be 0.';

revoke all on function public.boundstone_push_measure() from public, anon, authenticated;
grant execute on function public.boundstone_push_measure() to service_role;

commit;

-- ===========================================================================
-- Gates. Throwaway rows, then proof that nothing survived and nothing moved.
-- ===========================================================================
do $gate$
declare
  v_artifacts_before bigint;
  v_ledger_before    bigint;
  v_probe            uuid;
  v_n                bigint;
  v_r                jsonb;
  v_t                text;
begin
  select count(*) into v_artifacts_before from public.artifacts;
  select count(*) into v_ledger_before    from public.boundstone_push_ledger;

  -- G1 — boundstone_push_due is read-only in the strongest available sense:
  -- Postgres itself refuses a write inside a `stable` function.
  if (select provolatile from pg_proc where oid = 'public.boundstone_push_due(int)'::regprocedure) <> 's' then
    raise exception 'G1 FAILED: boundstone_push_due is not STABLE, so it could write.';
  end if;
  if (select provolatile from pg_proc where oid = 'public.boundstone_push_measure()'::regprocedure) <> 's' then
    raise exception 'G1 FAILED: boundstone_push_measure is not STABLE.';
  end if;

  -- G2 — it returns zero rows today, and the gate SAYS SO rather than assuming
  -- it. If this ever starts returning rows at apply time, the resolver ran
  -- before this migration and the operator should know.
  select count(*) into v_n from public.boundstone_push_due(500);
  raise notice '20261009230000: boundstone_push_due returns % rows at apply time '
               '(expected 0 until FDY-90 is applied and its gate opened).', v_n;

  -- G3 — the ledger's own guarantees, on a real artifact borrowed read-only.
  select a.artifact_id into v_probe
    from public.artifacts a
    join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
   where s.source_key like 'gsearch:loc-%'
   order by a.artifact_id
   limit 1;

  if v_probe is null then
    raise notice 'G3 SKIPPED: no local-watch artifact exists to probe against.';
  else
    v_r := public.boundstone_push_record(jsonb_build_object(
      'artifact_id', v_probe, 'kind', 'skipped', 'reason', 'no_honest_state'));
    if v_r->>'status' <> 'inserted' then
      raise exception 'G3 FAILED: first record returned %', v_r;
    end if;

    -- The idempotency guarantee, which is the entire reason for the PK.
    v_r := public.boundstone_push_record(jsonb_build_object(
      'artifact_id', v_probe, 'kind', 'press', 'boundstone_id', gen_random_uuid()));
    if v_r->>'status' <> 'already_ledgered' then
      raise exception 'G3 FAILED: a second record for one artifact returned %', v_r;
    end if;
    select count(*) into v_n from public.boundstone_push_ledger where artifact_id = v_probe;
    if v_n <> 1 then
      raise exception 'G3 FAILED: % ledger rows for one artifact.', v_n;
    end if;
    -- …and it did NOT overwrite the first verdict.
    select kind into v_t from public.boundstone_push_ledger where artifact_id = v_probe;
    if v_t <> 'skipped' then
      raise exception 'G3 FAILED: a second call rewrote kind to %.', v_t;
    end if;

    -- A ledgered artifact is never offered again.
    if exists (select 1 from public.boundstone_push_due(500) d where d.artifact_id = v_probe) then
      raise exception 'G3 FAILED: a ledgered artifact is still due.';
    end if;

    -- G4 — GUARDRAIL 7. Article text cannot enter the ledger, by key or by size.
    begin
      perform public.boundstone_push_record(jsonb_build_object(
        'artifact_id', gen_random_uuid(), 'kind', 'press',
        'response', jsonb_build_object('id', gen_random_uuid(), 'extract', 'the article said')));
      raise exception 'G4 FAILED: an extract was accepted into the ledger.';
    exception when sqlstate 'P0001' then
      if position('article-text' in sqlerrm) = 0 then raise; end if;
    end;
    begin
      perform public.boundstone_push_record(jsonb_build_object(
        'artifact_id', gen_random_uuid(), 'kind', 'press',
        'response', jsonb_build_object('id', 'x', 'note', repeat('a', 4100))));
      raise exception 'G4 FAILED: a 4 kB response was accepted into the ledger.';
    exception when sqlstate 'P0001' then
      if position('article text' in sqlerrm) = 0 then raise; end if;
    end;

    -- A skip with no reason is refused by the CHECK, not by convention.
    begin
      perform public.boundstone_push_record(jsonb_build_object(
        'artifact_id', gen_random_uuid(), 'kind', 'skipped'));
      raise exception 'G4 FAILED: a reasonless skip was stored.';
    exception when sqlstate '23514' then null;  -- expected
    end;

    delete from public.boundstone_push_ledger where artifact_id = v_probe;
  end if;

  -- G5 — the surface. anon and authenticated reach none of the three functions
  -- and cannot read the ledger.
  foreach v_t in array array['boundstone_push_due(int)','boundstone_push_record(jsonb)',
                             'boundstone_push_measure()'] loop
    if has_function_privilege('anon', 'public.' || v_t, 'EXECUTE') then
      raise exception 'G5 FAILED: anon can execute public.%', v_t;
    end if;
    if has_function_privilege('authenticated', 'public.' || v_t, 'EXECUTE') then
      raise exception 'G5 FAILED: authenticated can execute public.%', v_t;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.boundstone_push_ledger', 'SELECT')
     or has_table_privilege('authenticated', 'public.boundstone_push_ledger', 'SELECT') then
    raise exception 'G5 FAILED: the ledger is readable by anon or authenticated.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.boundstone_push_ledger'::regclass) then
    raise exception 'G5 FAILED: RLS is not enabled on the ledger.';
  end if;

  -- G6 — nothing touched the corpus, and no residue survived.
  select count(*) into v_n from public.artifacts;
  if v_n <> v_artifacts_before then
    raise exception 'G6 FAILED: artifacts moved (% -> %).', v_artifacts_before, v_n;
  end if;
  select count(*) into v_n from public.boundstone_push_ledger;
  if v_n <> v_ledger_before then
    raise exception 'G6 FAILED: % ledger rows before, % after.', v_ledger_before, v_n;
  end if;

  raise notice '20261009230000 gates passed: due is read-only and empty, the ledger is idempotent, '
               'article text cannot enter it, anon reaches nothing, artifacts unchanged, no residue.';
end
$gate$;

-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   drop function if exists public.boundstone_push_measure();
--   drop function if exists public.boundstone_push_record(jsonb);
--   drop function if exists public.boundstone_push_due(int);
--   drop table if exists public.boundstone_push_ledger;
--
-- ⚠️ Dropping the ledger makes every artifact it recorded eligible again. Read
-- `select kind, count(*) from public.boundstone_push_ledger group by 1` first:
-- if `press` or `both` is non-zero, the next run will re-propose those items.
-- Boundstone absorbs them as duplicates on (url, state_abbr), so nothing is
-- double-published — but the re-push is real work and the ledger is the cheaper
-- thing to keep.
