-- CC-ARTIFACT-BODY-FETCH-1.0 — Phase 1 step 1c complete (2026-09-27 21:54 UTC):
-- 110 canonical artifacts re-chunked from body_text, 646 chunks, 243,874 embedding tokens.
-- Driver unscheduled, puc_gov embed gate closed.
select cron.unschedule('artifact-body-embed-puc-gov');
update public.artifact_body_fetch_lanes set embed_enabled = false, embed_lease_until = null, updated_at = now() where lane = 'puc_gov';
