-- CC-ARTIFACT-BODY-FETCH-1.0 Phase 2 2c — driver retune.
-- The 100-doc invocations (0093) were each killed by the edge worker limit (HTTP 546) after
-- ~35 documents: extraction CPU on multi-MB EDGAR HTML accumulates per request. 304 docs landed
-- ok regardless, and every doc caught mid-run was fetched fine on retry (v1.2 charges the attempt
-- first), so no single document is poisonous — the batch was simply too big.
-- New cadence: 15 docs per invocation every 20 seconds (≤45 docs/min, <1 req/s), 60 s lease.
select cron.unschedule('artifact-body-fetch-sec');
update public.artifact_body_fetch_lanes set fetch_lease_until = null where lane = 'sec';
update public.artifact_body_fetch_runs
   set stop_reason = 'worker_killed_546', finished_at = coalesce(finished_at, started_at)
 where lane = 'sec' and stop_reason = 'running' and started_at < now() - interval '3 minutes';
select cron.schedule('artifact-body-fetch-sec', '20 seconds',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
      '{"mode":"fetch","lane":"sec","limit":15,"lease_seconds":60}'::jsonb, 'cron_caller_token', 150000)$$);
