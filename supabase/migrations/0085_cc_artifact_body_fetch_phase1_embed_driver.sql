-- CC-ARTIFACT-BODY-FETCH-1.0 — Phase 1 step 1c (re-chunk + re-embed), approved by Myke 2026-09-27
-- ("Run phase 1 ... proceed"). Phase 1 (PR #66) fetched the PUC/.gov slice with its own abf_*
-- machinery but could not embed: OPENAI_API_KEY is an edge-function secret. This opens the
-- puc_gov EMBED gate only (the fetch gate stays off) and drives artifact-body-fetch
-- {mode:"embed"} every 3 minutes. The claim is a no-op once the lane drains; the job is
-- unscheduled by a follow-up migration.
update public.artifact_body_fetch_lanes set embed_enabled = true, updated_at = now() where lane = 'puc_gov';

select cron.schedule('artifact-body-embed-puc-gov', '*/3 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
      '{"mode":"embed","lane":"puc_gov","limit":150}'::jsonb, 'cron_caller_token', 150000)$$);

select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
  '{"mode":"embed","lane":"puc_gov","limit":150}'::jsonb, 'cron_caller_token', 150000);
