-- CC-INGEST-STALLED-LANES-1.0 — cron wiring for ingest-staleness-healthcheck
--
-- ⚠️ APPLY ORDER: deploy the `ingest-staleness-healthcheck` edge function FIRST,
--    then apply this. A cron pointing at a function that does not exist yet will
--    fire, 404, and — because cron_http_post is pg_net and returns the moment the
--    request is queued — record status='succeeded' anyway. That is precisely the
--    silent-failure mode this whole ticket exists to remove.
--
-- SCHEDULE 09:00 UTC daily. Rationale for the slot:
--   07:00 faraday-crawl-daily · 08:00 faraday-crawl-healthcheck ·
--   08:30 ingest-state-incentives-weekly (Sun) / shovels-health-daily.
--   09:00 sits after the busiest ingest window, so a lane that ran this morning is
--   already reflected. Daily (not weekly) because the thresholds are multi-day:
--   checking daily just shortens time-to-detection, it does not add noise — the
--   function is a silent no-op when nothing is breached.
--
-- Auth: cron_http_post sends the vault `cron_caller_token` as a bearer token; the
-- function accepts that or the service-role key, and is verify_jwt=false. A
-- verify_jwt=true setting would 401 the cron at the gateway (the faraday-crawl v2
-- trap) — do not change it.

select cron.schedule(
  'ingest-staleness-healthcheck-daily',
  '0 9 * * *',
  $$
  SELECT public.cron_http_post(
    'https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/ingest-staleness-healthcheck',
    '{}'::jsonb,
    'cron_caller_token'
  );
  $$
);

-- Rollback:
--   select cron.unschedule('ingest-staleness-healthcheck-daily');
