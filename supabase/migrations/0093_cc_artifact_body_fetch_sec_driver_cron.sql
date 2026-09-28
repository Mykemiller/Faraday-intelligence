-- CC-ARTIFACT-BODY-FETCH-1.0 Phase 2 2c driver: 100 documents per invocation every 2 minutes
-- (~0.5 s/doc measured on the 25-doc step → avg <1 req/s, peak ~2 req/s; SEC ceiling 10, brief ≤5).
-- Lane order 10-K then 8-K. The lane auto-stops on 3 consecutive blocks or >20% failures; once
-- the queue drains each tick is a no-op. The sec EMBED gate stays closed (2d measurement first).
select cron.schedule('artifact-body-fetch-sec', '*/2 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
      '{"mode":"fetch","lane":"sec","limit":100,"lease_seconds":150}'::jsonb, 'cron_caller_token', 150000)$$);
