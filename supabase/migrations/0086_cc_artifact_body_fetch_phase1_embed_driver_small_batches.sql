-- CC-ARTIFACT-BODY-FETCH-1.0 — artifact-body-fetch v1.0 hit the edge CPU limit
-- (WORKER_RESOURCE_LIMIT / "CPU Time exceeded") after 10 embeds. v1.1 is leaner
-- (lazy pdfjs, base64 embeddings); drive it in small batches with a short lease so a
-- killed worker only stalls the lane for 90s.
select cron.unschedule('artifact-body-embed-puc-gov');
select cron.schedule('artifact-body-embed-puc-gov', '*/2 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
      '{"mode":"embed","lane":"puc_gov","limit":12,"lease_seconds":90}'::jsonb, 'cron_caller_token', 150000)$$);
update public.artifact_body_fetch_lanes set embed_lease_until = null where lane = 'puc_gov';
