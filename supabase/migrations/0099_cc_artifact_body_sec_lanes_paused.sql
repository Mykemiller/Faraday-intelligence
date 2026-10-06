-- CC-ARTIFACT-BODY-FETCH Phase 2 — SEC lanes paused (2026-10-06 ~02:50 UTC).
--
-- APPLIED MANUALLY by Myke in the Supabase SQL editor (the MCP apply_migration path timed
-- out on every call from 02:21 UTC). This file records that change; it is idempotent so a
-- later `db push` is a no-op against prod.
--
-- Why:
--   * Fetch: backlog complete. 10-K 9,723 ok / 117 skipped / 5 empty; 8-K 17,975 ok /
--     47 skipped / 2 empty; 0 pending, 0 failed, 0 SEC blocks since the resume (0095).
--   * Embed: paused. Per-invocation run time climbed 8 s (18:00) → 35 s (01:00) → 52 s (02:00)
--     → 113 s (02:50) as artifact_chunks (and its HNSW index) outgrew memory; inserts were
--     waiting on IO DataFileRead, loading the shared production DB. 3,206 SEC artifacts
--     embedded (≈570k chunks, ≈238M tokens) before the pause. Resuming is a decision for
--     Myke (bigger compute / drop-load-rebuild the index / stop here).
update public.artifact_body_fetch_lanes
   set fetch_enabled = false,
       embed_enabled = false,
       disabled_reason = 'paused 2026-10-06: fetch done; embed IO-bound, awaiting decision',
       fetch_lease_until = null,
       updated_at = now()
 where lane = 'sec'
   and (fetch_enabled or embed_enabled);

select cron.unschedule(jobid) from cron.job
 where jobname in ('artifact-body-fetch-sec', 'artifact-body-embed-sec');
