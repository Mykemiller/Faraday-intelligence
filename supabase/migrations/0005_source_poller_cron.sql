-- 0005_source_poller_cron.sql — CC-SOURCE-SCALE-500 Wave 1 (AUTO-199, FAR-368)
-- pg_cron drivers for the source-poller edge function. FAR-344 compliant:
-- bearer secret resolved BY NAME from Vault via public.cron_http_post — never
-- paste a token into cron.job.command.
--
-- jobid 133: verification sweep — probes registered subsystem='poller' sources
--   for a live RSS/Atom/JSON feed, activates license-cleared ones. Self-draining
--   (rows leave 'registered' on success or after 3 failed probes → 'error');
--   empty invocations are no-ops. Can be unscheduled once the Wave-1 sweep is done.
-- jobid 134: hourly poll — fetches active feeds (conditional GET via ETag /
--   Last-Modified), writes artifacts (content_hash dedupe), refreshes the R1
--   countable flag (active + license cleared/attribution + artifact in 30d).
-- Applied to prod 2026-07-17.

select cron.schedule(
  'source-poller-verify',
  '*/15 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/source-poller', '{"mode":"verify","limit":40}'::jsonb, 'cron_caller_token', 150000)$$
);

select cron.schedule(
  'source-poller-run',
  '12 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/source-poller', '{"mode":"run","limit":80}'::jsonb, 'cron_caller_token', 150000)$$
);
