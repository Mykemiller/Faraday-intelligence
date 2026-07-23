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
