-- CC-INGEST-STALLED-LANES-1.0 — error-mode watches for the state-incentive lane
--
-- WHY: the 2026-08-09 08:30 cron run — the first natural run under v1.2 — walked
-- all 12 fetchable sources (vs the same 3 every week for the previous month), but
-- `ny_esd_dei` aborted at offset 32,000 on an upstream Socrata 500 from
-- data.ny.gov ("internal-error", tag 3bda69b3). The chain then advanced to the
-- next source, which is the right default (one sick source must not block the
-- other 11) — but it left that source walked to only 32,000 of 65,237 rows.
--
-- Nothing paged. `0042` registered this lane with POLL-mode watches only, and
-- poll asks "when did we last ATTEMPT this source?" — the answer was 7 hours ago,
-- so every watch read clean while a source sat half-walked. That is exactly the
-- "polled shallowly" blind spot called out in the run report.
--
-- These 12 rows close it. `errors` on automation_health_log is NULL on the
-- success path and `{"message": "..."}` on the catch path in
-- ingest-state-incentives, so the latest-row-carries-an-error test is exact, and
-- the alert prints the upstream message verbatim rather than a generic "stale".
--
-- ⚠️ BREACH DURATION IS INTENTIONAL. A source that errors stays breached until
-- its next successful run — up to a week, because the cron is weekly. That is
-- correct: the source really is half-walked for that whole period. Do not
-- "de-noise" this by time-boxing it; the condition is unresolved, not stale news.
--
-- ⚠️ ca_calcompetes is deliberately absent here for the same reason it is absent
-- from the poll seeds: it is push-only (not in mappers.ts LIVE_SOURCES), so it
-- never writes a row to this crawler's health log at all.

insert into public.ingest_staleness_watch
  (watch_key, label, check_mode, src_table, freshness_column,
   filter_column, filter_json_key, filter_value,
   error_column, expected_cadence, owner_cron, registry_source_key, notes)
select
  'state_incentives:' || k || ':error',
  'State incentives — ' || k || ' — last run status',
  'error', 'automation_health_log', 'run_started_at',
  'notes', 'source_key', k,
  'errors', 'weekly', 'ingest-state-incentives-weekly', k,
  'Catches a source that runs on time and fails loudly but silently — e.g. the '
  || 'upstream data.ny.gov 500 that half-walked ny_esd_dei on 2026-08-09. Poll '
  || 'mode cannot see this: the attempt WAS recent, it just did not finish.'
from unnest(array[
  'ny_esd_dei','ny_ida_projects','ct_decd_business_assistance','md_commerce_finance_tracker',
  'or_ez_parta_2025','or_ez_parta_2024','or_energy_incentive_program','de_eeif_grants',
  'ok_quality_jobs','wi_wedc_ared','ia_ieda_awards','dc_tif_areas'
]) as k
on conflict (watch_key) do nothing;

-- Rollback:
--   delete from public.ingest_staleness_watch
--    where watch_key like 'state_incentives:%:error';
