-- CC-ARTIFACT-BODY-FETCH-1.0 Phase 2 2c: one 25-document invocation on artifact-body-fetch
-- v1.2 (attempt charged before fetch) to size edge CPU headroom before scheduling.
select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
  '{"mode":"fetch","lane":"sec","limit":25,"lease_seconds":150}'::jsonb, 'cron_caller_token', 150000);
