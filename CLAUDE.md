# CLAUDE.md — Faraday-intelligence (RETIRED static site / LIVE data plane)

As of 2026-06-19 this static site is **retired** (FAR-119). `faraday-intelligence.ai`
(+ `www`) was moved to the Next.js engine project **`v0-faraday-daily-challenge`**
(`v0-faraday-daily-challenge-n2u5`), which now serves the **entire** site —
homepage, all 8 storefronts, Daily Challenge, leaderboard, and the APIs ported
from here (Ask Faraday, waitlist/subscribe, lexicon).

- This project **no longer holds a production domain**. Do **not** build new
  surfaces here — the canonical site lives in `v0-faraday-daily-challenge` (see
  that repo's CLAUDE.md).
- Historical: this was a `vercel.json` v2 static site (`public/*.html`) that
  briefly proxied `/daily-challenge` to the engine (FAR-63); superseded by the
  full engine-as-site migration (FAR-119).

> **Still live here:** the Supabase data plane — `supabase/functions/*` (incl.
> `faraday-crawl` + `coverage-bridge.ts`, the roster-driven daily Automation-Registry
> crawler) and `supabase/migrations/*` (project `ycadmmngkdhvpcsrcuaq`). These are
> active and unrelated to the retired static site.

## Changelog

### 2026-08-?? — CC-BOUNDSTONE-INGEST-1.1 — Boundstone live ingest, candidate queue, curation + staleness mail (AUTO-nnn / FAR-418)
- **The wire from `artifacts` to Boundstone, which did not exist.** New `boundstone-candidates`
  edge function (cron `*/30`): Gate 0 lexical prefilter → Gate 1 strict-JSON classification →
  Gate 2 primary-source retrieval → proposes rows in `boundstone.candidates`. It **never** writes
  `boundstone.records`. Reads the engine, writes the Boundstone project; the two clients never mix.
- **Dedupe moved off `source_key` (§4).** `raw_hash` + `canonical_url` on `artifacts`, unique on
  `(crawler_id, raw_hash)`, skip-before-enrich. Measured: **52,126 of 334,029 rows (15.6%)** over
  90 days are excess. §0's diagnosis (hashing enrichment output) was wrong — `content_hash` was
  already computed at fetch; the defect is that `source_key` is *in* the key, so one press release
  through 20 query lanes makes 20 rows. 30,681 of 31,922 duplicate URL groups span multiple
  source_keys. `docs/far-418/dedupe-backfill-report.md`. **Nothing deleted.**
- **Tag inheritance ended (§5, Decision 2).** `trg_artifacts_fill_ifs_domains` retired: it copied a
  SOURCE's domains onto every item it emitted, which is how a statewide action filed under a
  local-community domain and why 98.3% of artifacts carry no subdomain. `enrich-artifacts` v22
  derives per-item tags against the live `faraday_subdomains` taxonomy (loaded per run, never
  hardcoded — FAR-177 stays always-human), derives domains from subdomains so the two columns
  cannot disagree, and emits an explicit `UNCLASSIFIED` instead of a silent empty array.
  Boundstone reads neither column, asserted by a test that drives the real query builder.
- **Source expansion to national completeness (§7).** +51 governors (**0 existed**), +26
  commissions to reach 51, +7 market-operator notices lanes (**0 existed**; the 3 existing `iso:*`
  rows are queue data products). All `registered`, none activated. **§7.4 IOUs blocked**: 145 real
  IOUs in `eia_utility_territories`, but 0 of 145 have a resolvable domain anywhere in the stack —
  reported rather than seeded with invented endpoints.
- **§7.5 FiscalNote:** licence stays `blocked` (correct). Found: the 4 silent lanes have **no
  automation attached**; and `fiscalnote-probe` writes 2,930 rows to the ledger while setting
  `last_artifact_at`, though **0 artifacts** carry a `fiscalnote:*` source_key — so that column now
  lies to every consumer that reads it as "put something in the corpus".
- **Repo drift found:** the checkout was behind production — `source-poller` v1.3 vs deployed
  **v1.4**, `enrich-artifacts` v2.1 vs deployed **v2.2**. Both rebased on the deployed source with
  the missing work restored verbatim; this branch is v1.5 / v2.3.
- Migrations `0030` (raw_hash/canonical/tag_provenance) and `0031` (source expansion, generated)
  are **UN-APPLIED**. Nothing deployed, no cron wired, no AUTO- id self-assigned. `npm test` 90/90.

### CC-SCOOP-SUBSTATION-COMMISSION-DATES-1.0 — 2026-07-23 (FAR-379 substation-vintage scoop)
- **New reference layer sourcing substation `commissioned_year`** from PUC dockets (FAR-353)
  + ISO/RTO transmission plans, resolved against the HIFLD `substations` spine (FAR-372).
  Migration `0017_far379_grid_buildout_projects.sql` (**applied**): `grid_buildout_projects`
  (land-rich, service-role RLS, content-hash idempotency), `far379_norm()` + functional index,
  additive audit cols on `substation_source_mentions`, `far379_resolve_and_grade()` (exact
  name + county gate, voltage tiebreaker; writes `commissioned_year` only on ≥0.90 **actual**-date
  matches), and 4 `jw_data_source_registry` rows.
- **Adapters** (source-poller conventions, pure module + Deno-style tests run under Node):
  `grid-buildout-sync` (ERCOT TPIT; MISO/PJM phase-2) and `puc-substation-extract`
  (D1-refined: `docket_title` pre-filter → PDF fetch). `npm test` green (43 tests).
- **I-gate reported + D1–D7 signed off before DDL.** Key findings: `puc_filings.raw_text` is a
  title-only index (→ D1 keys off `docket_title` + PDF fetch); only 23% of the 75,327 substations
  carry a real name (rest are HIFLD placeholders); PUC corpus is application-stage (0 gradable today).
- **Real end-to-end run:** 21 `grid_buildout_projects`, 41 mentions, **2 substations graded**
  (Cottonwood 2013, San Miguel 2024 → `substation_age_grade` A) with the projected/approved cohort
  correctly held as `resolved_no_grade`. **Zero JPAS/JPS/JDS writes.** Design + gates + rollback:
  `docs/far379-substation-commission/`. **Adapters un-deployed / not cron-wired** (deploy gates in docs).

### CC-DCHUB-INTEL-0.1 — 2026-07-22 (DC Hub facility intelligence layer — DRAFT)
- **New data-plane read-model for DC Hub facilities**, consumed by all storefronts.
  `dc_facilities` cache (content-addressed, RLS-on, CC-BY-4.0 attribution preserved)
  + `dc_facility_unmapped_operators`; anon read contract = `dc_facilities_public`
  view + RPCs `dc_facility_get` / `dc_facilities_for_company` / `dc_facilities_search`
  (keyset on `(total_power_mw desc, facility_id desc)`). Migration
  `0016_dc_hub_facility_intel.sql` (**DRAFT — un-applied**).
- **`dc-hub-sync` edge function** (source-poller conventions: fcron/service-role auth,
  content-hash skip-unchanged, `automation_health_log`; pure module in `sync-pure.ts`,
  tested in `test/dc-hub-sync.test.mjs`). Operator → `tracking_companies` by exact
  normalized-name match; misses logged, never guessed. **Un-deployed / not cron-wired.**
- **Deploy-gated** on: `DC_HUB_API_KEY` = Myke's DC Hub *account* key (the free key
  minted in-session was the wrong account, discarded); live validation of the DC Hub
  REST field shape (`normalizeFacility` is defensive but PROVISIONAL); an AUTO id +
  crawler in the Airtable Automation Registry. Design + gates: `docs/dc-hub-intelligence/`.

### CC-IDF4-ACTIVATE-1.0 — 2026-07-21 (Lane A sub-domain crawler activation)
- **26 `[crawler]` D#.# sub-domain routines activated** (AUTO-138,139,141–157,159–163,167,172):
  rostered into `faraday-crawl` via a new `LANE_A_ACTIVATION` array in `coverage-bridge.ts`;
  each passed a bounded (cap-4) healthy-run test (`automation_health_log`, 26/26 success, 4/4
  found, D#.#-tagged artifacts) before its Airtable Registry Status flipped Designed→Active.
  See `docs/idf4-activate/`. Live-fleet crawl of these 26 begins at the next 07:00 UTC
  `faraday-crawl-daily` cron **after this PR merges + `faraday-crawl` redeploys**.
- **AUTO-138 root-caused:** the ~1.14M-new "runaway" attributed to D7.2 Immersion Cooling was an
  `auto_id` mislabel by `ingest-sdwis-baseline` / `ingest-bls-labor` (bulk backfill, already
  complete/stopped), **not** the immersion crawler. Follow-up: relabel those ingesters' health
  rows off `auto_id='AUTO-138'`.
- **Verified:** AUTO-060→119 dedicated sub-domain crawlers are genuinely Active (13/13 healthy,
  last 2026-07-21 07:00 UTC) — corrects the stale "AUTO-060→119 dormant" claim in the IDF 4.0
  Coverage Matrix.
- **Held:** Lane B (140,158,169,170,171,173,174,175; 168 dry-run-only), Lane C gates
  (129–133, 186, 198), Lane D (185,187), Lane E (053–058,128,179), ambiguous (051,052,059,120).
