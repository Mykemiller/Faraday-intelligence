# source-poller — Wave 1 runbook (CC-SOURCE-SCALE-500, AUTO-199, FAR-368)

Registry-driven RSS/Atom feed verifier + poller for the ~300 Wave-1 candidate
sources seeded into `source_registry` (`subsystem='poller'`) from
`docs/CC-SOURCE-FEED-CANDIDATES.md`.

## Pieces

| Piece | Where |
| --- | --- |
| Edge fn `source-poller` v1 | `supabase/functions/source-poller/` (verify_jwt=false; fcron house-token SHA-256 auth or service-role key) |
| Pure logic + tests | `poller-pure.ts` · `test/source-poller.test.mjs` (`npm test`) |
| Seed generator | `scripts/seed-source-registry-wave1.mjs` (parses the candidates doc; `--compact` emits one `jsonb_to_recordset` INSERT) |
| Migrations (applied to prod 2026-07-17) | `supabase/migrations/0001`–`0005` (DDL, Phase-0 backfill, type/history columns, Wave-1 seed, crons) |
| Crons | jobid **133** `source-poller-verify` (`*/15 * * * *`) · jobid **134** `source-poller-run` (`12 * * * *` hourly). Both via `cron_http_post` + Vault `cron_caller_token` (FAR-344 — never paste a token). |

## Modes (POST JSON; invoke via `cron_http_post` from SQL — the functions
gateway and news hosts are dev-container-blocked)

- `{"mode":"status"}` — poller-source counts by status + countable count. No writes.
- `{"mode":"verify","limit":40}` — takes `status='registered'` rows oldest-first,
  probes up to 8 candidate URLs each (registered `feed_url` first, then common
  suffix probes, then HTML `rel=alternate` autodiscovery). A candidate wins only
  if it parses as RSS/Atom with ≥1 item (or valid JSON). On success: `feed_url`
  set, `fetch_config.verified_at`, and **status→`active` only when
  `license_status ∈ (cleared, attribution_required)`** — gated/restrictive-tos
  rows are verified but stay `registered` (never activated, never countable).
  3 failed verify passes → `status='error'` (revivable by resetting status +
  `fetch_config.verify_fail_count`).
- `{"mode":"run","limit":80}` — polls `active` rows oldest-fetch-first with
  conditional GET (ETag/Last-Modified stored on the row; 304 = healthy no-op).
  Items → `artifacts` (crawler `source-poller_v1.0`, auto `AUTO-199`,
  `source_type='web_news'`, `enrich_status='pending'` → the existing enrichment
  pipeline picks them up). Dedupe = `content_hash` = sha256(source_key|link),
  upsert ignoreDuplicates. 5 consecutive poll failures → `status='error'`.
  Ends by refreshing the R1 `countable` flag both directions:
  countable ⇔ active ∧ license cleared/attribution ∧ artifact in trailing 30 d.
- `source_key` in the body scopes verify/run to one source (debugging).

Every verify/run invocation logs one `automation_health_log` row
(`auto_id='AUTO-199'`).

## Wall-budget + resume

Each invocation self-limits to ~95 s and processes what fits; ordering
(`updated_at` asc for verify, `last_fetch_at` asc-nulls-first for run) makes
repeated invocations resume where the last left off. The 15-min verify cron
drains the initial 297-row sweep in a few hours and is a no-op once the
`registered` pool is empty — unschedule jobid 133 after the sweep if desired.

## Boundaries

- Writes ONLY `source_registry` (its own `subsystem='poller'` rows),
  `artifacts`, `automation_health_log`. Zero JPAS/JPS/JDS/scoring writes.
- JSON feeds (CISA KEV, NVD, Google Cloud status, NWS alerts) are verified but
  not item-parsed — per-source adapters are Wave 2; `run` marks them
  `json (adapter pending)` and leaves them healthy.
- License posture is data (`license_status` on the row). Flipping a `gated` row
  requires a human legal read — do not activate in SQL without one.

## Quick checks

```sql
-- census
select * from v_source_census;
-- sweep progress
select status, count(*) from source_registry where subsystem='poller' group by 1;
-- recent runs
select run_started_at, notes, artifacts_found, artifacts_new, success
from automation_health_log where auto_id='AUTO-199'
order by run_started_at desc limit 10;
-- fire a batch manually
select cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/source-poller',
  '{"mode":"run","limit":80}'::jsonb, 'cron_caller_token', 150000);
select status_code, left(content,500) from net._http_response where id = <request_id>;
```

## Rollback

Unschedule jobids 133/134; delete `source_registry` rows where
`subsystem='poller'` (Wave-1 seed only — Phase-0 backfill rows have other
subsystems); delete `artifacts` where `crawler_id='source-poller_v1.0'`;
drop the edge function. No scoring impact.
