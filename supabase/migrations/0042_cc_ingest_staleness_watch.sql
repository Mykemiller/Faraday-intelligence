-- CC-INGEST-STALLED-LANES-1.0 — generic ingest staleness / silence detector
--
-- WHY THIS EXISTS (D3: "silence is the real defect")
--   Four lanes reported `active` pg_cron jobs while writing nothing for 11–32
--   days and nothing alerted. pg_cron is NOT a health signal: every one of these
--   jobs calls public.cron_http_post(), which returns a pg_net request id the
--   instant the request is QUEUED. cron.job_run_details therefore records
--   status='succeeded' / "1 row" even when the edge function 401s, throws, or is
--   killed mid-run. net._http_response retains ~6h, so the real outcome is gone
--   by the time anyone looks.
--
-- WHY THREE CHECK MODES (and not just "when did the table last change?")
--   A destination-table timestamp conflates two opposite things:
--     * "nobody polled this source"          → defect
--     * "polled fine, upstream unchanged"    → correct, and normal for annual data
--   Checking only data freshness gets BOTH of the ticket's edge cases wrong:
--     - EIA-860 is annual. Its weekly cron ran clean on 2026-08-03 (28,103 seen /
--       0 new / 28,103 duped). Data-freshness alone pages every week forever (D4:
--       "do not 'fix' a healthy annual source").
--     - state_incentive_disclosures looks "recent" because 3 of 13 sources still
--       run; the 10 that stopped being polled on 2026-07-08 are invisible behind
--       the 3 that didn't. Data-freshness alone never fires.
--   So:
--     poll  — when did we last ATTEMPT this source? (per-source, from run logs)
--             This is the signal that catches all four stalled lanes.
--     data  — when did the destination last actually change? Use only where the
--             cadence genuinely guarantees change; never for annual sources.
--     error — does the most recent run row carry an error? Catches a lane that
--             runs on schedule and fails loudly but silently, e.g. NCSL's
--             moratorium half (`wayback CDX → 504`) and Shovels' 402.
--
-- WHY A DEDICATED WATCH TABLE rather than driving off a registry `cadence`
--   source_registry.cadence IS a normalised vocabulary (weekly/daily/hourly/
--   annual/quarterly/monthly/archival_refresh/event_driven/one_time) across all
--   10,783 rows — but that table is the source-poller corpus and does not carry
--   these four lanes. The lanes live in jw_data_source_registry, whose `cadence`
--   is free text: 57 distinct values over 100 rows, including prose such as
--   'irregular; page metadata shows last modified 2020-07-16 despite site being
--   actively maintained overall …'. That cannot drive a machine comparison.
--   This table is the normalised binding layer. Registering a new lane is one
--   INSERT; nothing here is per-lane code.
--
-- SAFETY: the check function builds dynamic SQL, so identifiers go through %I and
--   values through %L. There is deliberately NO free-form predicate column — a
--   filter is (column [, json key]) = value. RLS deny-all, service_role only.

-- ── cadence vocabulary ────────────────────────────────────────────────────────
create or replace function public.fn_ingest_cadence_interval(p_cadence text)
returns interval
language sql immutable
set search_path to 'public'
as $$
  select case p_cadence
    when 'hourly'     then interval '1 hour'
    when 'daily'      then interval '1 day'
    when 'weekly'     then interval '7 days'
    when 'biweekly'   then interval '14 days'
    when 'monthly'    then interval '31 days'
    when 'quarterly'  then interval '92 days'
    when 'semiannual' then interval '184 days'
    when 'annual'     then interval '366 days'
    -- event_driven / on_demand have no expected cadence: never breach on age.
    else null
  end;
$$;

comment on function public.fn_ingest_cadence_interval(text) is
  'CC-INGEST-STALLED-LANES-1.0 — normalised cadence → expected max age. NULL means "no cadence expectation", which the checker treats as never-stale.';

-- ── the binding table ─────────────────────────────────────────────────────────
create table if not exists public.ingest_staleness_watch (
  watch_key           text primary key,
  label               text        not null,
  check_mode          text        not null default 'poll'
                        check (check_mode in ('poll','data','error')),
  src_schema          text        not null default 'public',
  src_table           text        not null,
  freshness_column    text        not null,
  -- Equality filter. filter_json_key turns filter_column into a jsonb lookup,
  -- i.e. (filter_column::jsonb ->> filter_json_key) = filter_value. That is what
  -- lets us watch a single source inside automation_health_log, whose per-source
  -- identity lives in notes->>'source_key' rather than in a column of its own.
  filter_column       text,
  filter_json_key     text,
  filter_value        text,
  -- error mode only: the column carrying the failure. Non-null (or, for boolean
  -- columns, false) in the most recent row ⇒ breach.
  error_column        text,
  error_is_boolean_ok boolean     not null default false,
  expected_cadence    text        not null
                        check (expected_cadence in ('hourly','daily','weekly','biweekly',
                                                    'monthly','quarterly','semiannual',
                                                    'annual','event_driven')),
  -- Multiplied into the cadence to get the alert threshold. 1.5 on a weekly
  -- source ⇒ 10.5 days: one missed run is tolerated, two is not.
  grace_multiplier    numeric     not null default 1.5 check (grace_multiplier >= 1.0),
  enabled             boolean     not null default true,
  registry_source_key text,
  owner_cron          text,
  notes               text,
  created_at          timestamptz not null default now(),
  constraint ingest_staleness_watch_filter_ck check (
    (filter_column is null and filter_value is null and filter_json_key is null)
    or (filter_column is not null and filter_value is not null)
  ),
  constraint ingest_staleness_watch_error_ck check (
    check_mode <> 'error' or error_column is not null
  )
);

comment on table public.ingest_staleness_watch is
  'CC-INGEST-STALLED-LANES-1.0 — one row per watched ingest lane/source. Register a lane by INSERTing here; ingest-staleness-healthcheck needs no code change.';
comment on column public.ingest_staleness_watch.check_mode is
  'poll = last ATTEMPT too old (catches a lane that stopped being polled) · data = destination table too old (only where cadence guarantees change; never for annual sources) · error = most recent run row carries an error.';

alter table public.ingest_staleness_watch enable row level security;
-- Deny-all, no policies: service role bypasses RLS; nothing anon-facing.
revoke all on public.ingest_staleness_watch from public, anon, authenticated;
grant select, insert, update, delete on public.ingest_staleness_watch to service_role;

create index if not exists ingest_staleness_watch_enabled_idx
  on public.ingest_staleness_watch (enabled) where enabled;

-- ── the checker ───────────────────────────────────────────────────────────────
create or replace function public.fn_ingest_staleness_check()
returns table (
  watch_key        text,
  label            text,
  check_mode       text,
  expected_cadence text,
  threshold        interval,
  last_event_at    timestamptz,
  age              interval,
  breached         boolean,
  detail           text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r        record;
  v_sql    text;
  v_last   timestamptz;
  v_err    text;
  v_thr    interval;
  v_where  text;
begin
  for r in
    select * from public.ingest_staleness_watch where enabled order by watch_key
  loop
    watch_key        := r.watch_key;
    label            := r.label;
    check_mode       := r.check_mode;
    expected_cadence := r.expected_cadence;
    threshold        := null;
    last_event_at    := null;
    age              := null;
    breached         := false;
    detail           := null;

    if to_regclass(format('%I.%I', r.src_schema, r.src_table)) is null then
      breached := true;
      detail   := format('source table %I.%I does not exist', r.src_schema, r.src_table);
      return next;
      continue;
    end if;

    -- Build the equality filter (plain column, or a jsonb key inside one).
    --
    -- The jsonb branch MUST be a CASE, not `col is json object and col::jsonb ...`.
    -- automation_health_log.notes is free text on 17,603 of its 17,823 rows (the
    -- crawler fleet writes prose there), so an unguarded ::jsonb cast raises
    -- 22P02 "invalid input syntax for type json" and takes the whole check down.
    -- AND does not guarantee left-to-right evaluation and the planner is free to
    -- hoist the cast above the guard; CASE is the only construct that guarantees
    -- the cast is never reached for a non-JSON row.
    v_where := '';
    if r.filter_column is not null then
      if r.filter_json_key is not null then
        v_where := format(
          ' where (case when %I is json object then %I::jsonb ->> %L end) = %L',
          r.filter_column, r.filter_column, r.filter_json_key, r.filter_value);
      else
        v_where := format(' where %I = %L', r.filter_column, r.filter_value);
      end if;
    end if;

    if r.check_mode = 'error' then
      -- Most recent row by freshness_column; breach if it carries a failure.
      v_sql := format(
        'select %I, %s from %I.%I%s order by %I desc nulls last limit 1',
        r.freshness_column,
        case when r.error_is_boolean_ok
             then format('case when %I then null else ''run reported success=false'' end', r.error_column)
             else format('nullif(btrim(coalesce(%I::text, '''')), '''')', r.error_column)
        end,
        r.src_schema, r.src_table, v_where, r.freshness_column);
      execute v_sql into last_event_at, v_err;

      if last_event_at is null then
        breached := true;
        detail   := 'no run rows found';
      -- '[]' / '{}' are how a CLEAN run records "no errors" in the jsonb error
      -- columns (jw_shovels_ingest_runs.errors is jsonb and is '[]' on success).
      -- Without this guard every healthy run reads as a breach.
      elsif v_err is not null and btrim(v_err) not in ('[]', '{}', 'null') then
        breached := true;
        age      := now() - last_event_at;
        detail   := 'latest run reported: ' || left(regexp_replace(v_err, '\s+', ' ', 'g'), 240);
      else
        age := now() - last_event_at;
      end if;
      return next;
      continue;
    end if;

    -- poll / data: how long since the last attempt (or last write)?
    v_sql := format('select max(%I) from %I.%I%s',
                    r.freshness_column, r.src_schema, r.src_table, v_where);
    execute v_sql into v_last;

    v_thr         := public.fn_ingest_cadence_interval(r.expected_cadence) * r.grace_multiplier;
    threshold     := v_thr;
    last_event_at := v_last;

    if v_last is null then
      breached := true;
      detail   := case r.check_mode
                    when 'poll' then 'never polled'
                    else 'destination has never been written'
                  end;
    else
      age := now() - v_last;
      if v_thr is not null and age > v_thr then
        breached := true;
        detail   := format('%s stale: last %s was %s ago (threshold %s)',
                           r.check_mode,
                           case r.check_mode when 'poll' then 'attempt' else 'write' end,
                           justify_interval(age), justify_interval(v_thr));
      end if;
    end if;

    return next;
  end loop;
end;
$$;

comment on function public.fn_ingest_staleness_check() is
  'CC-INGEST-STALLED-LANES-1.0 — evaluates every enabled ingest_staleness_watch row. Read-only. Returns one row per watch with breached + human-readable detail.';

revoke all on function public.fn_ingest_staleness_check() from public, anon, authenticated;
grant execute on function public.fn_ingest_staleness_check() to service_role;
revoke all on function public.fn_ingest_cadence_interval(text) from public, anon, authenticated;
grant execute on function public.fn_ingest_cadence_interval(text) to service_role;

-- ── seeds: the four stalled lanes + the NCSL sibling ──────────────────────────
-- POLL mode, per source, is what would have caught every one of these.

-- 1. State incentives (jobid 35, Sun 08:30). 13 live sources; per-source identity
--    lives in automation_health_log.notes->>'source_key'. Only 3 of these have
--    been polled since 2026-07-08 — the other 10 breach immediately.
insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_table, freshness_column,
   filter_column, filter_json_key, filter_value, expected_cadence, owner_cron, registry_source_key)
select
  'state_incentives:' || k,
  'State incentives — ' || k,
  'poll', 'automation_health_log', 'run_started_at',
  'notes', 'source_key', k, 'weekly', 'ingest-state-incentives-weekly', k
-- NOTE: ca_calcompetes is deliberately ABSENT. It is not in mappers.ts LIVE_SOURCES
-- (the edge runtime cannot fetch its JS-rendered Ninja Tables widget); it is
-- push-only, seeded by scrapers/state-incentives/adapters/ca-calcompetes.mjs via
-- GitHub Actions into ingest-state-incentives-push. Watching it in poll mode
-- against this cron reports 'never polled' forever — verified 2026-08-08, when a
-- re-ingest naming it produced no health row at all. The lane is 12 fetchable
-- sources + 1 push-only, not 13 fetchable.
from unnest(array[
  'ny_esd_dei','ny_ida_projects','ct_decd_business_assistance','md_commerce_finance_tracker',
  'or_ez_parta_2025','or_ez_parta_2024','or_energy_incentive_program','de_eeif_grants',
  'ok_quality_jobs','wi_wedc_ared','ia_ieda_awards','dc_tif_areas'
]) as k
on conflict (watch_key) do nothing;

-- 2. International (jobids 24–27, Sun 02:00–05:00). intl_source_runs carries a
--    per-source row. NOTE these are 'weekly-check / annual-update' upstream: the
--    POLL must be weekly, but the DATA legitimately sits still for a year, which
--    is exactly why these are not registered in 'data' mode.
insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_table, freshness_column,
   filter_column, filter_value, expected_cadence, owner_cron, registry_source_key, notes)
select
  -- k already carries the 'intl:' prefix — do not add another.
  k, 'International — ' || k, 'poll', 'intl_source_runs', 'started_at',
  'source_key', k, 'weekly', 'intl-refresh-*-weekly', k,
  'Upstream is annual; weekly POLL is the health signal, not the data.'
from unnest(array[
  'intl:worldbank-wdi','intl:worldbank-wgi','intl:ember','intl:rsf-pfi',
  'intl:oecd-fdi-rri','intl:jds-directories'
]) as k
on conflict (watch_key) do nothing;

-- 3. Shovels permits (jobids 136/137, 1st & 15th). Both a poll check and an error
--    check: the lane's current blocker is a 402 credits_exhausted that it reports
--    faithfully in jw_shovels_ingest_runs.errors while writing nothing.
insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_table, freshness_column, expected_cadence,
   owner_cron, registry_source_key, error_column, notes)
values
  ('shovels:permits:poll', 'Shovels permits — poll', 'poll',
   'jw_shovels_ingest_runs', 'started_at', 'biweekly',
   'shovels-refresh-first/fifteenth', 'shovels:permits', null, null),
  ('shovels:permits:error', 'Shovels permits — last run status', 'error',
   'jw_shovels_ingest_runs', 'started_at', 'biweekly',
   'shovels-refresh-first/fifteenth', 'shovels:permits', 'errors',
   'Catches 402 credits_exhausted / 422 contract changes, which run on time and fail loudly but silently.')
on conflict (watch_key) do nothing;

-- 4. EIA 860/861 (jobid 40, Mon 02:00). POLL ONLY, deliberately.
--    D4: EIA-860 is genuinely annual. Its 2026-08-03 run was clean (28,103 seen,
--    0 new, 28,103 duped) and eia_generator_inventory correctly has not moved
--    since 2026-07-27. A 'data' watch here would be a permanent false positive.
insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_table, freshness_column,
   filter_column, filter_value, expected_cadence, owner_cron, registry_source_key, notes)
values
  ('eia:860:poll', 'EIA-860 generator inventory — poll', 'poll',
   'eia_ingest_runs', 'started_at', 'dataset', 'eia860', 'weekly',
   'ingest-eia-860-861-weekly', 'eia:860',
   'POLL ONLY BY DESIGN (D4). Annual source; zero new rows on a weekly poll is correct, not a defect.')
on conflict (watch_key) do nothing;

-- 5. NCSL (jobid 122, monthly on the 6th). One cron drives two halves that
--    succeed/fail independently; the run row records the failing half in `error`
--    while the other half writes normally. Poll-only would look healthy.
insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_table, freshness_column, expected_cadence,
   owner_cron, registry_source_key, error_column, notes)
values
  ('ncsl:poll', 'NCSL state policy — poll', 'poll',
   'ncsl_ingest_runs', 'started_at', 'monthly',
   'ingest-ncsl-state-policy-monthly', 'ncsl:subsidizing-servers', null, null),
  ('ncsl:error', 'NCSL state policy — last run status', 'error',
   'ncsl_ingest_runs', 'started_at', 'monthly',
   'ingest-ncsl-state-policy-monthly', 'ncsl:dc-moratoriums', 'error',
   'Half-lane failure: the 2026-08-06 run succeeded for subsidies and failed for moratorium (wayback CDX → 504).')
on conflict (watch_key) do nothing;
