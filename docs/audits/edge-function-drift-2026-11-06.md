# Edge-function drift audit — 2026-11-06 CT (FDY-97)

Project of record `ycadmmngkdhvpcsrcuaq` (the decoy `xgbpmlkanxewtfizloay` was not touched). Read-only: deployed bundles were read with `get_edge_function` / `list_edge_functions` and compared with `supabase/functions/<slug>/` on branch `fdy-97-edge-drift-guards` (base `main` @ `8263837`). Nothing was deployed and no migration was applied. Working copies of deployed code lived in `/tmp/deployed/`, outside the repo; 64-hex auth constants were masked on both sides before comparing.

**135 deployed functions** on 2026-11-06 22:3x CT (the 2026-11-05 count was 131; five functions were created since: `jw-brief-editions`, `predicts-optin`, `predicts-unsubscribe`, `predicts-optin-invite`, `faraday-predicts-generate-preview`, so one was presumably deleted in between — not investigated). **19 function directories** in the repo.

| Class | Count | Meaning |
|---|---:|---|
| IDENTICAL | 3 | Same file set and content after normalisation (CRLF, BOM, masked 64-hex). |
| DRIFT | 10 | Content or file set differs. Sub-classified: **6 LEFT BEHIND** (production code not in git), 1 repo-ahead, 3 cosmetic. |
| DEPLOYED-ONLY | 122 | Deployed, no `supabase/functions/<slug>/` in this repo at all. |
| REPO-ONLY | 6 | In the repo, not deployed. |
| **Total distinct slugs** | **141** | 135 deployed + 6 repo-only |

## How the drift happened

Every LEFT BEHIND function was changed in production through a path that leaves no commit: the Supabase MCP `deploy_edge_function` tool (or a dashboard edit) deploys the files handed to it, and nothing forces those files to be the ones on `main`. Several deployed bundles are visibly **compacted** (comments stripped, lines joined — `eia-retired-sync`, `shovels-permit-history`, `ingest-state-incentives-push`, `tri-facility-sync`), which is the signature of code re-typed into a tool call rather than deployed from a checkout. Version markers did not help: three of the six LEFT BEHIND functions carry the same marker on both sides or no marker at all, so only a **content** comparison catches them. The same mechanism produces the migration-ledger drift (§4): `apply_migration` records a ledger row and leaves no file.

## 1. `source-poller` — deployed v1.8 (Edge Function version 35) vs repo

Deployed version 35, updated 2026-09-05 22:39 CT, `source-poller_v1.8`. Repo: `source-poller_v1.9`, three extra files (`local-query.ts`, `poller-canonical.ts`, `poller-schedule.ts`).

| Deployed file | vs repo | Hunk | Class |
|---|---|---|---|
| `poller-pure.ts` | identical | — | — |
| `poller-json.ts` | identical | — | — |
| `poller-index.ts` | identical | — | — |
| `poller-relevance.ts` | differs | `CADENCE_MINUTES` moved to `poller-schedule.ts` and re-exported; `isDue()` now calls `cadenceMinutes()`. All six deployed values are identical in the new table; `biweekly`/`monthly` added by FDY-93. | repo-ahead |
| `index.ts` | differs | imports: `isDue` dropped, `local-query.ts` + `poller-schedule.ts` added | repo-ahead (FDY-88, FDY-89) |
| `index.ts` | differs | `CRAWLER_ID` v1.8 → v1.9 + explanatory NOTE | repo-ahead |
| `index.ts` | differs | `PRIORITY_CADENCES` + priority-pool concatenation removed; run lane uses `rpc('poller_select_due')` with `selectDueFair()` fallback; no post-filter `isDue`/`slice` | repo-ahead (FDY-89, intended) |
| `index.ts` | differs | `politeWait()` per-host 1 req/s inside `fetchWithTimeout` | repo-ahead (FDY-89) |
| `index.ts` | differs | `created_at` added to `SourceRow` / `SOURCE_COLS`; `toDueRow()` | repo-ahead (FDY-89) |
| `index.ts` | differs | `crawl_metadata.attribution` / `attribution_entity` / `attribution_rev: 1` for `local_gov` rows | repo-ahead (FDY-88, intended) |
| `index.ts` | differs | `selection` + `lanes` in the response and health-log notes | repo-ahead (FDY-89) |
| `index.ts` | differs | two explanatory comment passages shortened (verify-lane "unforgivable" sentence; run-lane 2026-09-06 measurement) | cosmetic |
| `index.ts` | same | `CRON_TOKEN_FALLBACK_SHA256` value matches (compared without printing) | — |

**Deployed-only (left behind) hunks in `source-poller`: none.** Every deployed line is present in the repo or deliberately superseded.

| Fix | Repo location | Pinned by |
|---|---|---|
| v1.4 canonical envelope keys (`title`, `summary`, `source`) | `index.ts` `pollOne()` → `signal_envelope` | `test/source-poller-deployed-lineage.test.mjs` › "v1.4 + v1.5: the envelope writes …" (new); `test/source-poller-schedule.test.mjs` › "the run lane uses the fair selector …" (`publisher_home` marker) |
| v1.5 publisher from item `<source>` | `poller-pure.ts` `extractItemSource()`, `parseFeed()`; `index.ts` envelope | `source-poller-deployed-lineage.test.mjs` › "v1.5: parseFeed carries …", "v1.5: extractItemSource …" (new — previously only a string marker) |
| v1.6 empty query-lane feed is valid | `index.ts` `verifyOne()` (`src.scope !== "query_feed") continue`) | `source-poller-schedule.test.mjs` › "the run lane uses the fair selector …" |
| v1.7 query lane probes canonical `feed_url` only + verify-lane transient guard | `index.ts` `verifyOne()` | `source-poller-schedule.test.mjs` (marker `src.scope === "query_feed" && src.feed_url`); `source-poller-deployed-lineage.test.mjs` › "v1.7 + v1.8 …" (new) |
| v1.8 run-lane 5-strike transient guard | `index.ts` `bumpFailure()`, `isTransientStatus()` | `source-poller-schedule.test.mjs` (markers); `source-poller-deployed-lineage.test.mjs` › "v1.7 + v1.8 …" (new) |

v1.6's *cadence-priority selection* is intentionally **not** in the repo (FDY-89 removes it; asserted absent by `source-poller-schedule.test.mjs`).

`node scripts/edge-drift-check.mjs source-poller --deployed-dir /tmp/deployed/source-poller` → `DRIFT`, marker `repo-ahead`, exit 1; with `--allow-repo-ahead` exit 0.

## 2. Functions present on both sides (13)

Sorted DRIFT first, LEFT BEHIND first within it. `updated_at` is the deployed timestamp.

| Slug | Class | Sub-class | Deployed version | Deployed `updated_at` | Deployed marker | Repo marker | Notes |
|---|---|---|---:|---|---|---|---|
| `eia-retired-sync` | DRIFT | **LEFT BEHIND** | 26 | 2026-07-23 16:24 CT | `eia-retired-sync_v0.5` | `eia-retired-sync_v0.4` | Prod is v0.5: xlsx live-fetch removed (edge OOM path), new `mode:"probe"` on api.eia.gov/v2, different header aliases. A deploy from git restores the OOM path. Marker catches it (deployed-ahead). |
| `faraday-daily-ops` | DRIFT | **LEFT BEHIND** | 32 | 2026-10-27 18:17 CT | `faraday-daily-ops_v1.0` | `faraday-daily-ops_v1.0` | STALE-LABEL-FIX (2026-10-27): STALE/WARN/healthy status split, new headline + subject. Marker not bumped, so only content diff catches it. |
| `ingest-staleness-healthcheck` | DRIFT | **LEFT BEHIND** | 13 | 2026-10-04 10:28 CT | `(none)` | `(none)` | FDY-16 D3 owner-cron check: `fn_ingest_owner_cron_check()` RPC, `owner_cron_findings` in responses, alerts on findings with no breaches, new `buildOwnerCronHtml()`. No marker on either side. |
| `jurisdiction-demote-sweeper` | DRIFT | **LEFT BEHIND** | 30 | 2026-10-24 17:30 CT | `jurisdiction-demote-sweeper_v30` | `(none)` | FDY-203: deployed-only file `sweeper-pure.ts`; prod soft-archives in Supabase, repo still PATCHes and hard-DELETEs Airtable records. |
| `jurisdiction-promote-worker` | DRIFT | **LEFT BEHIND** | 32 | 2026-10-24 10:36 CT | `jurisdiction-promote-worker_v32` | `(none)` | FDY-202: deployed-only file `promote-pure.ts`; prod writes Supabase only, repo still POSTs to Airtable. |
| `shovels-permit-history` | DRIFT | **LEFT BEHIND** | 25 | 2026-07-29 16:21 CT | `shovels-permit-history_v0.4` | `shovels-permit-history_v0.4` | CC-SHOVELS-LEDGER-1.0: `logShovelsCall()` writes a `shovels_ledger` row per Shovels call; probe records `/v2/usage`. Same marker both sides. |
| `source-poller` | DRIFT | repo-ahead | 35 | 2026-09-05 22:39 CT | `source-poller_v1.8` | `source-poller_v1.9` | FDY-88 + FDY-89 work not yet deployed; every deployed line is accounted for (see §1). Deploy gate: `--allow-repo-ahead` after FDY-89 migration. |
| `faraday-todo-daily` | DRIFT | cosmetic | 32 | 2026-07-24 11:31 CT | `faraday-todo-daily_v1.0` | `faraday-todo-daily_v1.0` | 10 comment rulers differ in length / a trailing U+FE0F. No code change. |
| `ingest-state-incentives-push` | DRIFT | cosmetic | 18 | 2026-07-28 11:09 CT | `ingest-state-incentives-push_v1` | `ingest-state-incentives-push_v1` | Deployed is a comment-stripped, line-joined copy; code equal (2 trailing commas). Repo is the fuller source. |
| `tri-facility-sync` | DRIFT | cosmetic | 24 | 2026-07-23 11:53 CT | `tri-facility-sync_v0.4` | `tri-facility-sync_v0.4` | Repo has longer header/inline comments; code equal. |
| `artifact-body-fetch` | IDENTICAL | — | 6 | 2026-10-05 12:49 CT | `artifact-body-fetch_v1.3` | `artifact-body-fetch_v1.3` | — |
| `enrich-artifacts` | IDENTICAL | — | 47 | 2026-09-27 17:15 CT | `AUTO-030_v2.5` | `AUTO-030_v2.5` | — |
| `ingest-state-incentives` | IDENTICAL | — | 32 | 2026-08-08 14:22 CT | `ingest-state-incentives_v1.2` | `ingest-state-incentives_v1.2` | — |

### Left-behind items — candidates for their own issues (NOT ported here, per D4)

- **`eia-retired-sync`** — Prod is v0.5: xlsx live-fetch removed (edge OOM path), new `mode:"probe"` on api.eia.gov/v2, different header aliases. A deploy from git restores the OOM path. Marker catches it (deployed-ahead). Until the deployed source is captured into git, **do not deploy `eia-retired-sync` from the repo**.
- **`faraday-daily-ops`** — STALE-LABEL-FIX (2026-10-27): STALE/WARN/healthy status split, new headline + subject. Marker not bumped, so only content diff catches it. Until the deployed source is captured into git, **do not deploy `faraday-daily-ops` from the repo**.
- **`ingest-staleness-healthcheck`** — FDY-16 D3 owner-cron check: `fn_ingest_owner_cron_check()` RPC, `owner_cron_findings` in responses, alerts on findings with no breaches, new `buildOwnerCronHtml()`. No marker on either side. Until the deployed source is captured into git, **do not deploy `ingest-staleness-healthcheck` from the repo**.
- **`jurisdiction-promote-worker`** — FDY-202: deployed-only file `promote-pure.ts`; prod writes Supabase only, repo still POSTs to Airtable. Until the deployed source is captured into git, **do not deploy `jurisdiction-promote-worker` from the repo**.
- **`jurisdiction-demote-sweeper`** — FDY-203: deployed-only file `sweeper-pure.ts`; prod soft-archives in Supabase, repo still PATCHes and hard-DELETEs Airtable records. Until the deployed source is captured into git, **do not deploy `jurisdiction-demote-sweeper` from the repo**.
- **`shovels-permit-history`** — CC-SHOVELS-LEDGER-1.0: `logShovelsCall()` writes a `shovels_ledger` row per Shovels call; probe records `/v2/usage`. Same marker both sides. Until the deployed source is captured into git, **do not deploy `shovels-permit-history` from the repo**.

### Secret hygiene finding

`supabase/functions/ingest-staleness-healthcheck/index.ts` on `main` (and its deployed copy) carries the cron bearer token as a **plaintext literal**, where every other function carries only its SHA-256. It is not reproduced here. Recommend rotating that token and switching the function to the hash-compare pattern; that is a production change and is left to Myke.

## 3. REPO-ONLY (6)

Not deployed. A first deploy cannot roll anything back; `edge-drift-check` exits 0 for these.

- `boundstone-candidates`
- `boundstone-local-push`
- `dc-hub-sync`
- `gnews-resolve`
- `grid-buildout-sync`
- `puc-substation-extract`

## 4. DEPLOYED-ONLY (122)

Deployed with no directory in this repo. Their source is not in git at all, so a rebuild of the project from this repository would lose them. Their bundles were not fetched (the comparison is vacuous without a repo side). Some may live in another repository (e.g. the Next.js engine project); that was not checked. Sorted by deployed `updated_at`, newest first.

| Slug | Deployed version | Deployed `updated_at` |
|---|---:|---|
| `faraday-predicts-generate-preview` | 1 | 2026-11-06 18:36 CT |
| `predicts-optin-invite` | 1 | 2026-11-06 15:51 CT |
| `predicts-unsubscribe` | 1 | 2026-11-06 15:50 CT |
| `predicts-optin` | 1 | 2026-11-06 15:49 CT |
| `jw-brief-editions` | 1 | 2026-11-05 14:45 CT |
| `jw-briefing-generator` | 27 | 2026-11-05 14:11 CT |
| `harvest-sec-insiders` | 13 | 2026-11-05 11:43 CT |
| `faraday-predicts-digest` | 11 | 2026-10-30 05:36 CT |
| `shovels-refresh` | 35 | 2026-10-27 21:49 CT |
| `faraday-predicts-resolve` | 8 | 2026-10-27 21:43 CT |
| `dc-permit-match` | 19 | 2026-10-27 21:38 CT |
| `shovels-probe` | 26 | 2026-10-27 21:38 CT |
| `lbr-egress-probe` | 8 | 2026-10-27 21:38 CT |
| `key-diag` | 40 | 2026-10-27 21:38 CT |
| `academy-public` | 5 | 2026-10-17 21:25 CT |
| `predicts-public` | 2 | 2026-10-09 16:55 CT |
| `faraday-predicts-generate` | 15 | 2026-10-08 15:27 CT |
| `engine-prognostications` | 31 | 2026-10-08 11:54 CT |
| `ingest-ncsl-state-policy` | 29 | 2026-10-04 09:51 CT |
| `company-about-probe` | 1 | 2026-10-04 09:38 CT |
| `academy-ai` | 4 | 2026-10-03 22:38 CT |
| `faraday-crawl` | 33 | 2026-09-27 07:58 CT |
| `academy-narration-worker` | 9 | 2026-09-26 15:10 CT |
| `epoch-ai-sync` | 16 | 2026-09-09 23:06 CT |
| `resend-domain-admin` | 6 | 2026-09-09 22:48 CT |
| `daily-signal-digest` | 26 | 2026-09-08 05:01 CT |
| `calendar-refresh` | 10 | 2026-09-07 15:20 CT |
| `data365-com-ingest` | 31 | 2026-09-07 15:16 CT |
| `ingest-ferc-queue` | 28 | 2026-09-07 07:40 CT |
| `extract-wayback-grid-spreadsheets` | 6 | 2026-09-06 22:53 CT |
| `ferc-form1-probe` | 11 | 2026-09-06 22:50 CT |
| `ingest-ferc-form1-lines` | 6 | 2026-09-06 21:13 CT |
| `harvest-wayback-grid-plans` | 6 | 2026-09-06 13:32 CT |
| `ingest-ferc-form1` | 9 | 2026-09-06 13:01 CT |
| `ingest-eia-860-861` | 29 | 2026-09-05 11:33 CT |
| `rag-embed-worker` | 24 | 2026-09-02 19:25 CT |
| `rag-retrieve` | 24 | 2026-09-02 19:23 CT |
| `jurisdiction-scorer` | 33 | 2026-09-02 18:26 CT |
| `jw-score-states` | 28 | 2026-09-02 18:25 CT |
| `bulletin-incentive-digest` | 24 | 2026-09-02 18:24 CT |
| `legiscan-refresh` | 25 | 2026-09-02 16:43 CT |
| `dcaddr-census-probe` | 7 | 2026-09-01 06:34 CT |
| `dcaddr-census-cityfill` | 6 | 2026-09-01 06:09 CT |
| `engine-idf-entities` | 32 | 2026-08-29 20:25 CT |
| `wayback-enrich` | 18 | 2026-08-29 11:10 CT |
| `cc-company-website-verify` | 6 | 2026-08-28 15:21 CT |
| `sync-observability-mirror` | 6 | 2026-08-27 22:20 CT |
| `sec-archives-egress-probe` | 7 | 2026-08-27 20:03 CT |
| `lbr-xlsx-read` | 6 | 2026-08-25 07:15 CT |
| `lbr-rapids-ingest` | 11 | 2026-08-25 07:00 CT |
| `lbr-bls-ep-separations` | 6 | 2026-08-24 23:19 CT |
| `jurisdiction-watch-api` | 44 | 2026-08-24 10:15 CT |
| `ingest-padus` | 9 | 2026-08-23 20:39 CT |
| `complete-puzzle` | 42 | 2026-08-20 19:44 CT |
| `data365-env-diag` | 12 | 2026-08-17 10:17 CT |
| `opposition-signals-ingest` | 29 | 2026-08-17 00:27 CT |
| `ingest-puc-dockets` | 31 | 2026-08-16 18:09 CT |
| `ingest-miso-mtep` | 9 | 2026-08-16 10:46 CT |
| `ingest-pjm-rtep` | 8 | 2026-08-16 10:45 CT |
| `ingest-osm-substation-footprint` | 7 | 2026-08-16 10:10 CT |
| `ingest-bls-labor` | 37 | 2026-08-14 22:11 CT |
| `sample-class1-parcels` | 7 | 2026-08-14 10:50 CT |
| `regrid-usage-sync` | 9 | 2026-08-14 10:39 CT |
| `ingest-regrid-parcels` | 11 | 2026-08-14 08:11 CT |
| `parcel-regrid-coverage-probe` | 10 | 2026-08-14 08:09 CT |
| `match-candidates-to-regrid` | 10 | 2026-08-14 06:52 CT |
| `regrid-key-fingerprint` | 8 | 2026-08-14 06:47 CT |
| `regrid-usage-probe` | 8 | 2026-08-14 06:45 CT |
| `parcel-regrid-verify` | 9 | 2026-08-13 23:01 CT |
| `parcel-env-diag` | 13 | 2026-08-13 22:56 CT |
| `ingest-parcel-constraints` | 11 | 2026-08-13 22:13 CT |
| `ingest-site-inventory` | 12 | 2026-08-13 22:01 CT |
| `ingest-site-echo` | 10 | 2026-08-13 21:59 CT |
| `site-inventory-probe` | 11 | 2026-08-13 21:46 CT |
| `dchub-facility-sweep` | 12 | 2026-08-11 08:19 CT |
| `dchub-auth-probe` | 12 | 2026-08-11 08:17 CT |
| `eu-eed-probe` | 13 | 2026-08-09 16:20 CT |
| `resend-from-probe` | 15 | 2026-08-06 19:22 CT |
| `gnews-resolve-probe` | 17 | 2026-08-06 15:53 CT |
| `fiscalnote-probe` | 21 | 2026-08-06 08:48 CT |
| `ingest-moratorium-nation` | 25 | 2026-08-03 18:21 CT |
| `ingest-sec-cik-identity` | 19 | 2026-08-01 22:37 CT |
| `sec-edgar-fts` | 17 | 2026-08-01 07:03 CT |
| `get-leaderboard` | 33 | 2026-07-31 22:45 CT |
| `get-team-leaderboard` | 31 | 2026-07-31 22:44 CT |
| `policynote-volume` | 17 | 2026-07-31 08:52 CT |
| `policynote-probe` | 19 | 2026-07-31 07:03 CT |
| `far287-env-bridge` | 19 | 2026-07-30 11:38 CT |
| `register-with-magic-link` | 42 | 2026-07-28 11:56 CT |
| `engine-two-analyst` | 30 | 2026-07-28 11:54 CT |
| `com08-news-signal` | 27 | 2026-07-28 10:09 CT |
| `state-incentive-xlsx-probe` | 19 | 2026-07-26 16:27 CT |
| `com-classify-test` | 24 | 2026-07-23 11:29 CT |
| `faraday-crawl-canary` | 23 | 2026-07-21 08:35 CT |
| `shovels-env-diag` | 24 | 2026-07-19 20:04 CT |
| `operator-directory-harvest` | 23 | 2026-07-17 15:30 CT |
| `wtr-refresh-usgs` | 29 | 2026-07-16 06:31 CT |
| `intl-refresh-ixp` | 26 | 2026-07-15 15:17 CT |
| `intl-refresh-energy` | 27 | 2026-07-15 15:15 CT |
| `ingest-grid-boundaries` | 25 | 2026-07-13 16:10 CT |
| `puc-probe` | 24 | 2026-07-12 21:32 CT |
| `census-backfill` | 28 | 2026-07-12 08:33 CT |
| `ingest-fema-nri` | 28 | 2026-07-11 06:23 CT |
| `ingest-sdwis-baseline` | 36 | 2026-07-08 22:05 CT |
| `ext-global-ingest` | 24 | 2026-07-08 14:51 CT |
| `intl-probe` | 32 | 2026-07-08 13:13 CT |
| `sdwis-run-proxy` | 26 | 2026-07-08 12:42 CT |
| `pfi-snapshot-capture` | 25 | 2026-07-06 17:10 CT |
| `intl-refresh-jds` | 25 | 2026-07-06 12:25 CT |
| `intl-refresh-governance` | 25 | 2026-07-06 12:22 CT |
| `intl-refresh-incentives` | 24 | 2026-07-06 12:14 CT |
| `create-subscriber` | 27 | 2026-07-03 16:21 CT |
| `verify-magic-link` | 38 | 2026-07-03 16:21 CT |
| `verify-otp` | 27 | 2026-07-03 16:20 CT |
| `faraday-crawl-healthcheck` | 27 | 2026-06-26 18:46 CT |
| `send-otp` | 26 | 2026-06-25 07:40 CT |
| `ingest-email` | 30 | 2026-06-23 17:08 CT |
| `jurisdiction-registry-sync` | 30 | 2026-06-23 15:43 CT |
| `team-action` | 29 | 2026-06-22 06:04 CT |
| `faraday-watchdog` | 28 | 2026-06-21 23:03 CT |
| `beehiiv-check` | 32 | 2026-06-13 19:10 CT |
| `get-subscriber-state` | 36 | 2026-04-22 08:48 CT |

## 5. Migration ledger

Read-only `select version, name from supabase_migrations.schema_migrations` (names only) on 2026-11-06 CT: **2,304 rows, 2,302 distinct names** (`velocity_3_0_ingest_rpc` applied twice), max version `20261107004136`. Matched **by name** against the 105 files in `supabase/migrations/`: **42 filed, 2,260 applied-but-unfiled**, 63 filed-but-not-applied (expected here — migrations ship un-applied for Myke, e.g. `poller_fair_scheduling`, `gnews_resolve_schedule`, `local_watch_county_complete`, `boundstone_backfill_due`). The 2,260 are frozen in `supabase/ledger-baseline.json` (shrink-only).

## 6. Guards added

- `CLAUDE.md` rule: edge functions deploy from git only; run `node scripts/edge-drift-check.mjs <slug>` before every deploy.
- `scripts/edge-drift-check.mjs` + `scripts/lib/edge-drift.mjs`: exit 0 identical, 1 drift or deployed marker above repo, 2 env/usage error; `--allow-repo-ahead` only when the repo marker is strictly higher and production holds no file the repo lacks. Tested by `test/edge-drift-check.test.mjs` (no network).
- `test/ledger-integrity.test.mjs` + `scripts/lib/ledger.mjs` + `supabase/ledger-{snapshot,baseline}.json`: fails on a new applied-but-unfiled name and on a baseline entry that became filed.
- `scripts/refresh-ledger-snapshot.mjs` + `.github/workflows/ledger-drift.yml`: daily, opt-in on the `FARADAY_LEDGER_RO_URL` secret; exits 0 with a notice when it is absent.

Note: Boundstone's `test/ledger-integrity.test.mjs` could not be read from this session (attaching `Mykemiller/boundstone` was refused), so the port follows its documented contract (FDY-60: every applied version matches a repo file) adapted to name-matching and a baseline, not its source text.

