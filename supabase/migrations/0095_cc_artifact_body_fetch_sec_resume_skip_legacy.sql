-- CC-ARTIFACT-BODY-FETCH Phase 2 — resume the SEC lane (Myke 2026-09-28: "Resume the fetch").
--
-- The lane auto-stopped at 22.9% failures. Root cause: 162 legacy 2001-era EDGAR
-- per-document paths (/edgar/data/<cik>/<NNNN>.txt) that SEC no longer serves — HTTP 404.
-- A dead link is not a fetch failure, so:
--   1. failure_window_since scopes the failure-rate stop to runs after a resume
--      (edge fn v1.3 reads it), so the pre-fix 404 runs no longer count;
--   2. the 162 legacy rows are marked 'skipped' (attempts capped at 3 — never retried);
--   3. the lane is re-enabled with a fresh window; the 20 s cron (0094) resumes.
-- Edge fn v1.3 also records any future 404/410 as skipped ("gone"), not failed.
-- Touches body_* columns only; raw_content / signal_envelope / enrich_* untouched.

alter table public.artifact_body_fetch_lanes
  add column if not exists failure_window_since timestamptz;

update public.artifacts
   set body_fetch_status = 'skipped',
       body_attempts     = 3,
       body_fetch_error  = 'gone: legacy EDGAR per-document path (HTTP 404)'
 where source_type = 'sec_filing'
   and source_url ~ '/[0-9]{4}\.txt$'
   and body_text is null
   and (body_fetch_status is null or body_fetch_status = 'failed');

update public.artifact_body_fetch_lanes
   set failure_window_since = now(),
       fetch_enabled        = true,
       disabled_reason      = null,
       consecutive_blocks   = 0,
       fetch_lease_until    = null,
       updated_at           = now()
 where lane = 'sec';
