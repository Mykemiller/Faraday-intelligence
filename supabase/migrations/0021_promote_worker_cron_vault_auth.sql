-- CC-FAR-OPS-RESTORE-1.0 · Fix 1 — jurisdiction editorial cron auth repair
--
-- Root cause: pg_cron jobid 18 (jurisdiction-promote-worker, */5) and jobid 19
-- (jurisdiction-demote-sweeper, daily 09:00 UTC) built their Authorization
-- header from current_setting('app.service_role_key', true) — an unset GUC that
-- resolves to NULL, producing a bare 'Bearer ' header. Both functions therefore
-- returned 401 on every scheduled invocation, starving jw_editorial_events
-- (0 rows: promote-worker never processed a pending promote event).
--
-- Fix: repoint both jobs onto the working project pattern already used by the
-- other ~30 cron jobs — public.cron_http_post(url, body, '<vault_secret>',
-- timeout_ms) — which reads the bearer token from vault.decrypted_secrets
-- (SECURITY DEFINER) instead of a non-existent GUC. Secret: cron_caller_token
-- (the fcron house token), matching enrich-artifacts / faraday-crawl / watchdog.
--
-- Paired change (deployed separately, same PR): jurisdiction-promote-worker and
-- jurisdiction-demote-sweeper now also accept cron_caller_token (sha256 match,
-- enrich-artifacts pattern) in addition to the service-role key. Without that,
-- these two functions accepted ONLY the service-role key and would keep 401-ing
-- on the house token this migration sends.
--
-- alter_job preserves jobid (18/19), jobname, and schedule; only command changes.

select cron.alter_job(
  18,
  command => $cmd$
  SELECT public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/jurisdiction-promote-worker', '{}'::jsonb, 'cron_caller_token', 120000);
$cmd$
);

select cron.alter_job(
  19,
  command => $cmd$
  SELECT public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/jurisdiction-demote-sweeper', '{}'::jsonb, 'cron_caller_token', 120000);
$cmd$
);
