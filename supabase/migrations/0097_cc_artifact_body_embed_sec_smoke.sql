-- CC-ARTIFACT-BODY-FETCH Phase 2 step 2e — embed smoke test for the SEC lane
-- (Myke 2026-09-28: "Everything"). Opens the sec embed gate and fires ONE invocation of
-- 2 docs to measure per-10-K cost/time against the edge limits before a driver is scheduled.
update public.artifact_body_fetch_lanes set embed_enabled = true, embed_lease_until = null, updated_at = now() where lane = 'sec';

select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
  '{"mode":"embed","lane":"sec","limit":2,"lease_seconds":120}'::jsonb, 'cron_caller_token', 150000);
