-- CC-ARTIFACT-BODY-FETCH Phase 2 — close-out (Myke 2026-10-06: "Stop here and create a weekly
-- cron job for new filings").
--
-- * Embedding STOPS at the 3,206 SEC artifacts already embedded; sec embed_enabled stays false
--   and no embed cron is scheduled. New filings get body_text (full-text readable), not chunks.
-- * sec_form_type was a one-time backfill in 0083, so every sec_filing row ingested since
--   2026-09-28 has it NULL and is invisible to the claim (form_priority = {10-K,8-K}).
--   A BEFORE INSERT/UPDATE trigger now stamps it from crawl_metadata->>'form' (same source as
--   the 0083 backfill); the 50 rows already missing it are backfilled here.
-- * Weekly driver: Mondays 06:00–06:58 UTC, every 2 minutes (30 invocations × 15 docs = 450
--   capacity vs ~50 new 10-K/8-K a week). Claims are no-ops once the week's queue is empty.
--   A fresh failure window so the pre-pause history can't trip the >20% stop.
set local lock_timeout = '5s';

create or replace function public.artifacts_stamp_sec_form_type()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  new.sec_form_type := new.crawl_metadata->>'form';
  return new;
end $$;

drop trigger if exists trg_artifacts_stamp_sec_form_type on public.artifacts;
create trigger trg_artifacts_stamp_sec_form_type
  before insert or update of crawl_metadata on public.artifacts
  for each row
  when (new.source_type::text = 'sec_filing' and new.sec_form_type is null and new.crawl_metadata ? 'form')
  execute function public.artifacts_stamp_sec_form_type();

update public.artifacts
   set sec_form_type = crawl_metadata->>'form'
 where source_type::text = 'sec_filing'
   and sec_form_type is null
   and crawl_metadata ? 'form';

update public.artifact_body_fetch_lanes
   set fetch_enabled = true,
       embed_enabled = false,
       disabled_reason = null,
       failure_window_since = now(),
       consecutive_blocks = 0,
       fetch_lease_until = null,
       updated_at = now()
 where lane = 'sec';

select cron.unschedule(jobid) from cron.job where jobname = 'artifact-body-fetch-sec-weekly';
select cron.schedule('artifact-body-fetch-sec-weekly', '*/2 6 * * 1',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
      '{"mode":"fetch","lane":"sec","limit":15,"lease_seconds":60}'::jsonb, 'cron_caller_token', 150000)$$);
