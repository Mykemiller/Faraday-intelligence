-- CC-ARTIFACT-BODY-FETCH-1.0 Phase 2 step 2c smoke test (Myke 2026-09-28 "Use the default";
-- probe 2a with pgsql-http's default UA = 10/10 HTTP 200, 0 blocks, 14 KB–2.4 MB documents).
-- Re-enables the sec lane and fires ONE 5-document invocation. No cron yet.
update public.artifact_body_fetch_lanes
   set fetch_enabled = true, consecutive_blocks = 0, backoff_until = null,
       fetch_lease_until = null, disabled_reason = null, updated_at = now()
 where lane = 'sec';
select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
  '{"mode":"fetch","lane":"sec","limit":5,"lease_seconds":90}'::jsonb, 'cron_caller_token', 150000);
