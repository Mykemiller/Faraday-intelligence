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

### CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — 2026-07-28 (FAR-341 Wave 3: CA CalCompetes, first headless-scrape adapter)
- **First adapter on the Wave-3 headless-scraper harness (#47) validated end-to-end.**
  `scrapers/state-incentives/adapters/ca-calcompetes.mjs` extracts the CA California
  Competes Tax Credit **Grant Awardee List** (JS-rendered Ninja Tables widget on
  business.ca.gov, unfetchable by the edge runtime). Runs in GitHub Actions (real
  Chromium + open egress), driven via the GitHub MCP tools.
- **Sources the data endpoint, not the pager.** FooTable client-paginates (only ~10
  rows in the DOM), so DOM+next-click scraping was lossy (truncated at 23 for the wrong
  reason). The adapter now calls Ninja Tables' own `admin-ajax.php` `get-all-data`
  endpoint **from inside the page context** (same-origin fetch, page cookies) → the
  whole dataset in one request. Column keys are author-set slugs matched by pattern.
  New `--mode probe` enumerates every widget's true row count + downloadable files.
- **23 rows is the COMPLETE published set, not a truncation** (`probe`: one widget
  `73522`, count 23 — the recent 2022–2023 awardee rounds). The full historical CCTC
  awardee DB (thousands since 2014) is **not** on data.ca.gov (CKAN `q=calcompetes` → 0,
  probed server-side) → a separate bulk/FOIA source (Wave 4). Credit-amount column
  (`amountoftaxcredit`) now maps to `award_value_usd` (Tynergy $15M, Infinera $14M);
  `county_name` left **null** (city-level/multi-city) → rows land but write no INC-*
  until a city→county resolver (documented like OK, not fabricated).
- **Confidence INF/0.60** (registry `ca_calcompetes`, migration 0037, source_level
  `primary`) — first-party but headless-captured, never SRC. **SEEDED to prod
  2026-07-28** after #48 merged: `mode=push` (GH Actions run 30388361841) →
  `found=23 new=23 duped=0 registered_cap=INF`; DB confirms 23 rows, all 23 with
  `award_value_usd` ($333.2M total), **0 with a county → 0 INC-\* written** (no
  fabrication, resolve `jurisdictions_written=0`). Idempotent (content-hash). Workflow
  defaults the public `SUPABASE_FUNCTIONS_URL`; fn is verify_jwt=false w/ unset secret,
  so `push` needed no hand-set secret. A city→county resolver (shared w/ OK) would let
  these write INC-\*; the full historical CCTC DB is a Wave-4 bulk/FOIA source. Report:
  `docs/ingest/CC-INGEST-STATE-INCENTIVE-ALL-WAVES-wave3-ca-calcompetes-run-report.md`.

### CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — 2026-07-26 (FAR-341: per-source confidence tiering)
- **`fn_state_incentives_resolve_and_score` no longer hardcodes SRC/0.85/primary.** Migration
  `0036` (**APPLIED to prod 2026-07-28, Myke-approved via #44 merge**) reads each
  disclosure's confidence from its `jw_data_source_registry` row: `confidence_cap`
  VRF→0.95 / SRC→0.85 / INF→0.60 / EST→0.40 (unregistered→0.40, conservative), plus a new
  `source_level` column (primary|aggregator, GJF/Upjohn precedence). Per jurisdiction the INC-*
  attributes take the **highest-confidence contributor** and stay `primary` if any contributor
  is. **Prerequisite for Waves 3–4** (scraped/PDF/INF/EST) so scraped HTML never scores as SRC.
- **Zero regression, proven read-only:** all 12 live sources are SRC/primary → the new fn yields
  SRC/0.85/primary for all **244** scored jurisdictions, identical to current `jpas_attributes`
  (244=244, same tuple). Behavior only diverges once a non-SRC source is ingested.
  Design: `docs/ingest/CC-INGEST-STATE-INCENTIVE-confidence-tiering.md`.

### CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — 2026-07-26 (FAR-341 Wave 2: DC + pendings)
- **Wave 2 (bulk-file wave: TN/MN/TX/DC) → 1 of 4 ingested (DC).** All probed live
  server-side (`pg_net` + a throwaway SheetJS edge probe). **DC** = Business_Incentives
  ArcGIS MapServer **layer 26** (TIF areas) — reuses the existing `arcgis` path; dollar
  figure is carried in-layer (`INITIAL_AUTHORIZATION`, e.g. "$50.0 million") so **no OCFO
  scrape needed → SRC**. New helper `parseUsdScaled` ("$50.0 million"→50000000, rounded).
  Seeded **13 TIF areas, all 13 resolved → the DC jurisdiction** (INC-01..05: Nationals Park
  $534.8M, The Wharf $198M, etc.). Idempotent (0 new on re-run).
- **TN/MN/TX pending with hard blockers (documented, NOT guessed):** TN OpenECD FastTrack
  `.xlsx` href is valid but the tn.gov `/content/dam` CDN **TLS-resets** the Supabase edge
  runtime (os error 104 at Connect); MN DEED site is JS-rendered so the MBAF `.xlsx` URL is
  not machine-discoverable; TX Ch.313 page's only `.xlsx` is a generic report INDEX (recipient
  data is per-agreement → Wave-3/4). SheetJS bulk parser proven working — these are
  reachability/URL blocks, not capability gaps.
- fn **v13→v14** deployed; migration `0035` (DC registry row) applied; probe fn retired to a
  410 stub. Tests 59/59. Live coverage now **9 states** (…+DC). Run report:
  `docs/ingest/CC-INGEST-STATE-INCENTIVE-ALL-WAVES-wave2-run-report.md`.

### CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — 2026-07-26 (FAR-341 Wave 1 + VCS baseline)
- **Vendored the live `ingest-state-incentives` edge fn into VCS** (`supabase/functions/
  ingest-state-incentives/{index.ts,mappers.ts}`) — it had been running only as deployed
  v10 (CC-INGEST-STATE-INCENTIVE-API-1.1, AUTO-178, 8 live Socrata feeds NY/CT/MD/OR/DE)
  and was in no repo. Baseline commit = deployed source verbatim.
- **Wave 1 (API drop-in): +3 live per-recipient sources** verified 2026-07-26 (server-side
  `pg_net`, since container egress is policy-blocked): `ok_quality_jobs` (CKAN, 4,324 rows),
  `wi_wedc_ared` (ArcGIS FeatureServer, 4,867 — county+awardAmount → full INC-01..05),
  `ia_ieda_awards` (Iowa Data Hub JSON, county+city). Fetcher generalized to a `kind`-dispatch
  (`socrata|ckan|arcgis|idh_json`) over the unchanged Socrata client / chain-paging /
  content-hash upsert / resolve-and-score contract. **All SRC** (primary disclosures).
  OK carries city/zip only → county ABS, documented (no INC write until a city→county resolver;
  not fabricated).
- **Registry backfill** `0034_cc_state_incentive_source_registry.sql` (**un-applied**, apply at
  promotion): first `jw_data_source_registry` rows for ALL state-incentive feeds (8 existing + 3
  new + HI registered-not-ingested). Closes "no source without a registry row."
- Tests `test/incentive-mappers.test.mjs` (real captured rows); `npm test` green (57/57).
- **DEPLOYED + SEEDED 2026-07-26 (Myke-approved post-merge):** fn v11→v12 (edge fn
  `ingest-state-incentives`), migration `0034` applied. Backfill via the existing weekly
  invoker (`cron_http_post` jobid 35): **WI 4,866 rows → 72 counties INC-01..05, IA 135 →
  48 counties, OK 4,217 (0 resolved — city/zip-only gap, documented)**. Idempotency re-run
  = 0 new / 0 newly-resolved. Advisor: no new ERROR/WARN (my tables carry only the intended
  `rls_enabled_no_policy` INFO deny-all posture). **AUTO-178 collision resolved:** dedicated
  **AUTO-204** ("State Incentive Disclosure Ingest") created in the Registry and the fn's
  `AUTO_ID` repointed to it (v12) off the Faraday Crawl Health-Check collision.
- **Waves 2–4 scoped, not built** (docs/ingest/): ~40 states of bulk/scrape/PDF-FOIA need
  server-side iteration + a per-source confidence input on `fn_state_incentives_resolve_and_score`
  (currently hardcodes SRC/0.85). GA documented as suppressed-by-law (aggregate-only).

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
