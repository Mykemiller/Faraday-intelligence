-- CC-STALENESS-WATCH-HYGIENE-1.0 (FDY-16) G2 + G3 — staged 2026-11-06 18:50 CT, NOT executed.
-- Byte-identical to Mykemiller/Faraday docs/staged/fdy11_g3_companies_watches.sql (PR #49, merged):
-- FDY-11 re-derived these statements against today's schema; this copy is the CC's own deliverable record.
-- Apply ONE of the two files, once, via apply_migration, after Myke rules on D1/D2.

-- FDY-11 G3 — companies watches re-derived against today's schema (FDY-16 G2/G3)
-- Staged 2026-11-06 17:45 CT · project ycadmmngkdhvpcsrcuaq · NOT executed by this run.
-- Requires Myke's approval (FDY-16 D1/D2 ruling). Run as ONE transaction via apply_migration.
--
-- Schema measured 17:05 CT (information_schema.columns, public.ingest_staleness_watch):
--   watch_key, label, check_mode, src_schema, src_table, freshness_column, filter_column,
--   filter_json_key, filter_value, error_column, error_is_boolean_ok, expected_cadence,
--   grace_multiplier, enabled, registry_source_key, owner_cron, notes, created_at,
--   dormant_reason, dormant_since, dormant_review_by, dormant_class
--
-- Checker capability confirmed from the live definitions (17:20 CT):
--   * fn_ingest_staleness_check() evaluates ANY src_schema.src_table generically
--     (to_regclass + dynamic SQL), so automation_health_log is a valid source.
--     Poll/data: max(freshness_column) vs cadence×grace. Error: newest row only, one equality
--     filter (filter_column = filter_value), error_is_boolean_ok ⇒ "case when <col> then null
--     else 'run reported success=false' end". The deployed edge fn ingest-staleness-healthcheck
--     v13 only calls that RPC — no shape logic lives in TypeScript.
--   * fn_ingest_owner_cron_check(): every owner_cron below is an ACTIVE cron.job name
--     (297 companies-confidence-recompute-nightly, 299 companies-alias-miner-weekly,
--      294 companies-entity-binder-nightly), verified 17:05 CT.
--
-- Live state 17:05 CT: companies:spine breached (data stale 4d19h vs 2d) while
-- companies-confidence-recompute_v1.0 logged 30/30 successful nightly runs in 30d (max gap 1d);
-- companies:aliases breached (18d17h vs 14d) while companies-alias-generator_v1.0 logged 4/4
-- weekly runs (max gap 7d). Both are the FDY-16 false-positive class. companies:entity_links
-- reads clear today but its heartbeat had a 6-day gap in the last 30d that the data watch
-- cannot see (binder only writes when new links exist).
--
-- RECOMMENDED (taken): grace 2.5 on the daily spine watch (worst observed gap == the 2× threshold,
-- so 2× flaps). aliases stays 2.0 (weekly, gap 7d vs 14d threshold); entity_links stays 2.0
-- (daily — a 6-day heartbeat gap SHOULD breach; that is the point of the watch).

begin;

-- 0. Snapshot first (reversal key). Keep the table.
create schema if not exists archive;
create table archive.ingest_staleness_watch_20261106 as select * from public.ingest_staleness_watch;
do $$
declare a int; b int;
begin
  select count(*) into a from archive.ingest_staleness_watch_20261106;
  select count(*) into b from public.ingest_staleness_watch;
  if a <> b then raise exception 'fdy11 g3 snapshot: % archived vs % live', a, b; end if;
end $$;

-- 1. D1 — re-specify the three idempotent-job watches as run heartbeats (guarded, 1 row each)
do $$
declare n int;
begin
  update public.ingest_staleness_watch
     set check_mode = 'poll', src_schema = 'public', src_table = 'automation_health_log',
         filter_column = 'crawler_id', filter_json_key = null,
         filter_value = 'companies-confidence-recompute_v1.0',
         freshness_column = 'run_started_at', grace_multiplier = 2.5,
         notes = coalesce(notes,'') || ' | FDY-11/FDY-16 G2 2026-11-06: was data-mode on companies.updated_at (idempotent job → false positive); now run heartbeat on automation_health_log; grace 2.5 because the worst observed gap equals the 2x threshold.'
   where watch_key = 'companies:spine' and check_mode = 'data';
  get diagnostics n = row_count; if n <> 1 then raise exception 'companies:spine expected 1 row, got %', n; end if;

  update public.ingest_staleness_watch
     set check_mode = 'poll', src_schema = 'public', src_table = 'automation_health_log',
         filter_column = 'crawler_id', filter_json_key = null,
         filter_value = 'companies-alias-generator_v1.0',
         freshness_column = 'run_started_at',
         notes = coalesce(notes,'') || ' | FDY-11/FDY-16 G2 2026-11-06: was data-mode on company_aliases.created_at (aliases only grow with new companies → false positive); now run heartbeat on automation_health_log.'
   where watch_key = 'companies:aliases' and check_mode = 'data';
  get diagnostics n = row_count; if n <> 1 then raise exception 'companies:aliases expected 1 row, got %', n; end if;

  update public.ingest_staleness_watch
     set check_mode = 'poll', src_schema = 'public', src_table = 'automation_health_log',
         filter_column = 'crawler_id', filter_json_key = null,
         filter_value = 'companies-entity-binder_v1.0',
         freshness_column = 'run_started_at',
         notes = coalesce(notes,'') || ' | FDY-11/FDY-16 G2 2026-11-06: was data-mode on company_entity_links.bound_at (binder writes only when new links exist → latent false positive); now run heartbeat on automation_health_log.'
   where watch_key = 'companies:entity_links' and check_mode = 'data';
  get diagnostics n = row_count; if n <> 1 then raise exception 'companies:entity_links expected 1 row, got %', n; end if;
end $$;

-- 2. D1 — matching :error watches (newest heartbeat row must carry success=true)
insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_schema, src_table, freshness_column, filter_column, filter_value,
   error_column, error_is_boolean_ok, expected_cadence, grace_multiplier, enabled, owner_cron, notes)
values
  ('companies:spine:error', 'Companies pillar — confidence recompute — last run status', 'error', 'public',
   'automation_health_log', 'run_started_at', 'crawler_id', 'companies-confidence-recompute_v1.0',
   'success', true, 'daily', 2, true, 'companies-confidence-recompute-nightly',
   'FDY-11/FDY-16 G2 2026-11-06: error watch paired with the companies:spine heartbeat.'),
  ('companies:aliases:error', 'Companies pillar — alias generation — last run status', 'error', 'public',
   'automation_health_log', 'run_started_at', 'crawler_id', 'companies-alias-generator_v1.0',
   'success', true, 'weekly', 2, true, 'companies-alias-miner-weekly',
   'FDY-11/FDY-16 G2 2026-11-06: error watch paired with the companies:aliases heartbeat.'),
  ('companies:entity_links:error', 'Companies pillar — entity binding — last run status', 'error', 'public',
   'automation_health_log', 'run_started_at', 'crawler_id', 'companies-entity-binder_v1.0',
   'success', true, 'daily', 2, true, 'companies-entity-binder-nightly',
   'FDY-11/FDY-16 G2 2026-11-06: error watch paired with the companies:entity_links heartbeat.')
on conflict (watch_key) do nothing;
do $$
declare n int;
begin
  select count(*) into n from public.ingest_staleness_watch
   where watch_key in ('companies:spine:error','companies:aliases:error','companies:entity_links:error');
  if n <> 3 then raise exception 'fdy11 g3: expected 3 error watches, found %', n; end if;
end $$;

-- 3. D2 — intake watch: genuinely stalled intake still surfaces, labelled as intake, not crawler failure.
--    companies.created_at last insert 2026-09-07 (intake is pack-driven); monthly × 1.5 = 46 days,
--    so this watch WILL read breached on first evaluation — that is a true statement about intake.
insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_schema, src_table, freshness_column,
   expected_cadence, grace_multiplier, enabled, owner_cron, notes)
values
  ('companies:intake', 'Companies pillar — new-company intake (pack-driven, not a crawler)', 'data', 'public',
   'companies', 'created_at', 'monthly', 1.5, true, null,
   'FDY-11/FDY-16 G3 2026-11-06 (D2): intake watch. No owner_cron by design — intake is pack-driven; a breach here means no new company has been added in 46 days, not that a crawler died.')
on conflict (watch_key) do nothing;
do $$
declare n int;
begin
  select count(*) into n from public.ingest_staleness_watch where watch_key = 'companies:intake';
  if n <> 1 then raise exception 'fdy11 g3: intake watch missing'; end if;
end $$;

-- Verification
select watch_key, check_mode, src_table, filter_value, freshness_column, expected_cadence, grace_multiplier, owner_cron
  from public.ingest_staleness_watch where watch_key like 'companies:%' order by 1;
select watch_key, breached, detail from public.fn_ingest_staleness_check() where watch_key like 'companies:%' order by 1;
-- expect: companies:spine / companies:aliases / companies:entity_links and the three :error rows NOT breached;
--         companies:intake breached (last insert 2026-09-07) — intended.
select count(*) as owner_cron_findings_expect_zero from public.fn_ingest_owner_cron_check();

commit;

-- REVERSAL
-- begin;
-- delete from public.ingest_staleness_watch
--  where watch_key in ('companies:spine:error','companies:aliases:error','companies:entity_links:error','companies:intake');
-- update public.ingest_staleness_watch w
--    set check_mode = s.check_mode, src_schema = s.src_schema, src_table = s.src_table,
--        filter_column = s.filter_column, filter_json_key = s.filter_json_key, filter_value = s.filter_value,
--        freshness_column = s.freshness_column, grace_multiplier = s.grace_multiplier, notes = s.notes
--   from archive.ingest_staleness_watch_20261106 s
--  where s.watch_key = w.watch_key and w.watch_key in ('companies:spine','companies:aliases','companies:entity_links');  -- 3 rows
-- commit;
