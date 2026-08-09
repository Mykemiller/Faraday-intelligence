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

### CC-INGEST-STALLED-LANES-1.0 — 2026-08-08 (four silent ingest lanes root-caused + a generic staleness alert)
- **⚠️ pg_cron `status='succeeded'` PROVES NOTHING for any job using `cron_http_post()`.**
  That helper ends in `net.http_post()` and returns a pg_net request id the moment the
  request is **queued**, so `cron.job_run_details` reads *succeeded* / "1 row" even when the
  edge function 401s, throws, or is killed mid-run. All 8 investigated jobids showed a clean
  green history across an 11–32 day stall. The real outcome is in `net._http_response`, which
  retains **~6h** (edge logs ~24h) — so post-hoc it is always gone. **Never diagnose one of
  these lanes from cron history.**
- **State incentives (jobid 35) — the isolate is TERMINATED mid-loop, which is not an
  exception**, so the per-source try/catch never fires, no error row is written, and the
  chain hop is never dispatched. Every weekly run since 2026-07-12 got through **exactly 3 of
  12 fetchable sources / 18,204 records, byte-identical** (07-12, 07-19, 08-02) with **zero**
  error rows. Source #4 (MD) was verified reachable and fast (200 in 0.64s) — not a hang.
  Result: 10 sources unpolled for a month and **no source ever read past offset 0** (8,000 of
  ny_esd_dei's 65,237 rows). Fixed in **v1.2**: chain cursor is now `(source_index, offset)` —
  **one source per hop**, so work per invocation is bounded and constant instead of scaling
  with the registry. The hop also authenticated with `SUPABASE_ANON_KEY` and swallowed every
  outcome via `.catch(()=>{})` (fetch only rejects on transport errors, so a 401 hop vanished);
  it now uses the service-role key, checks status, and logs `chain_hop_failed`.
- **⚠️ A row-count delta is NOT data loss here.** `ny_esd_dei` holds 65,197 vs 65,237
  upstream, but a full 9-window re-walk inserted **0 new rows** — those 40 are duplicates
  *within the feed* that collapse under the content hash (md_commerce 7,300→7,246,
  ok_quality 4,324→4,217 behave identically). The exposure was **latent**: real bug, would
  have lost the next genuine change, but had cost nothing yet.
- **EIA 860/861 (jobid 40) is CORRECT — do not "fix" it (D4).** It ran 08-03 (28,103 seen /
  **0 new** / 28,103 duped); 07-27 was the real annual ingest (28,103 new, 31,202 attrs). A
  weekly cron over an annual source correctly writes nothing. Registered **poll-only** in the
  watch table — a data-freshness watch here is a permanent false positive.
- **International (24–27) is mostly correctly quiet** (annual sources, `mrv=1`, all-skipped
  upserts = idempotency). The real defect: WDI+WGI runs sat `status='running'`/`finished_at
  NULL` since 08-02 (isolate died reaching neither the success nor the catch path), and
  because `ingestWdi` is awaited first, **Ember + RSF-PFI never started**. Reaped to `error`.
  Note `intl_run_start` has **no concurrency guard**, so stuck rows never blocked the next run.
- **Shovels: jobid 137 has NEVER run** (created after 07-15 → first fire 08-15; it missed
  nothing). jobid 136 fired 08-01 and failed loudly — **HTTP 422, `state` is no longer a
  `/v2/permits/search` param (now `geo_id`)**, fixed out-of-band 08-03. Also: the biweekly
  cron writes **`shovels_permit_snapshots`** (fresh 08-03), NOT `shovels_permit_history`
  (07-23), which is fed by the separate `shovels-permit-history` fn and **has no cron at all**.
- **⚠️ CORRECTED 2026-08-08 (Myke: "Shovels is a paid plan and a paid api"). The 402 is NOT
  "go buy a plan" — the plan exists; the DEPLOYED KEY does not carry it.** Shovels' own body
  says *"Trial credit limit reached"* and **`/v2/usage` (the account endpoint) 402s too**, so
  the credential in the `SHOVELS_API_KEY` secret is presenting as **trial-tier**. Fix =
  **rotate the Supabase secret to the paid account's key**, then re-run; no code change (the
  422 fix already shipped 08-03). Same class as the documented DC Hub trap — a free key minted
  on the wrong account. Do not tell anyone to purchase a subscription.
- **⚠️ Shovels credit accounting is FICTION — do not trust `credits_remaining_last`.**
  **0 of 184 `shovels_ledger` rows** have API-sourced `credit_headers`/`credits_remaining`
  (`credits_source='unavailable'` on 111 of them); the only two rows carrying a balance are
  `imported_run_aggregate`, hand-entered 07-07. So the `9194` in the run rows is a locally
  derived number with no connection to the real entitlement — which is exactly why it read
  "healthy" while the API refused everything. **`shovels_config.credit_floor=2500` therefore
  guards on a number that cannot detect exhaustion.** The 402 began at 23:51:41.973, **200 ms
  after a 200**, following 122 successful calls — the allotment simply ran out mid-run.
- **NCSL half-lane:** the 08-06 monthly run succeeded for `subsidies` and failed for
  `moratorium` with `wayback CDX → 504`, recorded faithfully in `ncsl_ingest_runs.error` —
  and read by nothing.
- **New generic alert:** `ingest_staleness_watch` + `fn_ingest_staleness_check()` (migration
  `0042`) + `ingest-staleness-healthcheck` edge fn + daily 09:00 UTC cron (`0043`).
  Registering a lane is **one INSERT**, no per-lane code. **Three check modes are
  load-bearing** — `poll` (last *attempt*), `data` (destination changed), `error` (latest run
  carries an error). Data-freshness alone gets BOTH edge cases wrong: it pages weekly on EIA
  and never fires on state incentives (whose table looks fresh because 3 of 12 sources still
  run). **Live test: 24 watches → 14 breached / 10 clean, all correct**, run in
  `BEGIN … ROLLBACK` (nothing committed).
- **⚠️ The ticket's "use `source_registry.cadence`" premise is half-wrong.** That column IS
  normalised across all 10,783 rows — but it is the **source-poller** corpus and does not
  carry these lanes. They live in `jw_data_source_registry`, whose `cadence` is **free text:
  57 distinct values over 100 rows**, incl. prose like *"irregular; page metadata shows last
  modified 2020-07-16…"*. Unusable for machine comparison; `ingest_staleness_watch` is the
  normalised binding layer.
- **FIRST NATURAL CRON RUN UNDER v1.2 — 2026-08-09 08:30 UTC — CONFIRMS THE FIX.**
  **All 12 fetchable sources walked** (vs the same 3 every week for the prior month), 20
  health rows, deep paging restored (`ny_ida_projects` 0→32,000 to completion = **34,348
  records, exactly its upstream count**), whole registry in **~1m42s**, **0
  `chain_hop_failed`**, **0 new disclosure rows** (120,510 unchanged — genuinely in sync;
  live probe has 5 of 6 sources matching held counts exactly). INC re-stamped 08:32:31,
  still 1,220 rows / 244 jurisdictions.
- **⚠️ A source can now be half-walked, and POLL mode cannot see it.** That same run,
  `ny_esd_dei` aborted at offset 32,000 on an **upstream data.ny.gov 500**
  (`internal-error`, tag `3bda69b3`) → walked 32,000 of 65,237. The chain correctly
  advanced to the next source (one sick source must not block the other 11), and it
  self-heals next Sunday from offset 0 — but **nothing paged**, because `0042` registered
  this lane POLL-only and poll asks "when did we last *attempt*?" (7h ago → clean).
  Migration **`0053` adds 12 `error`-mode watches** for the lane (**applied to prod
  2026-08-09**; 23 → **35 watches**, 14 error-mode). Verified live: the alert now reports
  **2 breaches** (`ncsl:error` + `state_incentives:ny_esd_dei:error`) and prints the
  upstream 500 verbatim. **Breach duration is intentional** — an errored source stays
  breached until its next successful weekly run, because it really is half-walked for that
  whole period; do not time-box it.
- **⚠️ Two gotchas baked into the checker — do not "simplify" them out.** (1)
  `automation_health_log.notes` is free text on **17,603 of 17,823** rows, so the jsonb filter
  must be `CASE WHEN col IS JSON OBJECT …`, never `col IS JSON OBJECT AND col::jsonb …` —
  `AND` does not guarantee evaluation order and the planner may hoist the cast, raising
  `22P02`. (2) `'[]'`/`'{}'` is how a **clean** run records "no errors" in a jsonb error
  column, so error mode must exempt them or every healthy run false-alarms.
- **⚠️ `ca_calcompetes` is push-only and is deliberately NOT watched** — it is not in
  `mappers.ts LIVE_SOURCES` (JS-rendered widget, unfetchable by the edge runtime); it is
  seeded by GitHub Actions into `ingest-state-incentives-push`. The lane is **12 fetchable +
  1 push-only**, not 13 fetchable.
- **⚠️ D2 was explicitly WAIVED by Myke.** `fn_state_incentives_resolve_and_score()` ends in
  an unconditional `INSERT INTO jpas_attributes … ON CONFLICT DO UPDATE SET captured_at =
  now()`, so *any* re-ingest writes scoring rows — D2 and Deliverable 4 cannot both hold.
  Re-ingest ran normally: **0 new disclosure rows** (120,510 → 120,510), jpas total unchanged
  (663,878), and **1,220 INC rows re-stamped `captured_at`** with no value or jurisdiction
  changes. Success criterion 5 is knowingly unmet to exactly that extent.
- **DEPLOYED to prod 2026-08-08** (Myke-approved after PR #53 merged — **merging deploys
  nothing here**; edge fns + migrations ship separately). Order was **function → `0042` →
  `0043`**: a cron pointing at a missing function 404s and still logs *succeeded*.
  `ingest-staleness-healthcheck` v1 · `0042` applied (23 watches) · `ingest-state-incentives`
  **v20→v21** (v1.2) · `0043` applied (cron `ingest-staleness-healthcheck-daily`, 09:00 UTC).
  Both fns keep `verify_jwt=false` (a `true` setting 401s the cron at the gateway).
- **Post-deploy proof:** the **cross-source hop works** — a 2-source chain run logged
  `ia_ieda_awards` 19:23:15 then `dc_tif_areas` **19:23:18 in a separate invocation**, both to
  `next_offset=null`, **0 `chain_hop_failed` rows** (under v1.1 the 2nd source was never
  reached). Alert `?dry=1` → 200, 23 watches / 4 breaches, `sent:false`. The 10
  state-incentive breaches **correctly cleared** after the re-ingest polled them;
  `eia:860:poll` stayed clean (D4). Prod data unchanged: 120,510 disclosures · 663,878 jpas ·
  1,220 INC · **0 stuck intl runs**.
- **Advisor delta = exactly 1 intended INFO** (`rls_enabled_no_policy` on
  `ingest_staleness_watch`). Neither new fn appears under `function_search_path_mutable` or
  the anon/authenticated `security_definer_function_executable` lints — `search_path` set and
  anon/authenticated revoked **BY NAME** (Supabase's `ALTER DEFAULT PRIVILEGES` grants
  EXECUTE at CREATE time, so `revoke … from public` alone is not enough).
- `npm test` 72/72. Report: `docs/ingest/CC-INGEST-STALLED-LANES-run-report.md`.

### CC-STATE-BRIEF-SCAFFOLD-1.0 — 2026-07-31 (State Brief Agent Network: schema + local news funnel)
- **8 tables + 3 views for section-level state-brief persistence** (migrations `0038`–`0041`,
  **all APPLIED to prod 2026-07-31**): `jw_brief_section_registry` (D6, 5 active sections
  summing to **exactly 1,000** base words per D1/D7 + CONNECTIVITY incubating behind FAR-360),
  `jw_brief_feed_bindings`, `jw_brief_editions`, `jw_brief_sections`, `jw_brief_auditor_shards`,
  `jw_brief_audits`, `jw_local_feed_sources`, `jw_source_candidates`. Ops views
  `v_jw_brief_dark_register` (D9) / `v_jw_brief_failed_sections` (D12) + runtime
  `v_jw_state_brief_current`. **All 8 gates passed before any DDL.**
- **⚠️ RLS + `security_invoker` were ADDED to the supplied DDL, deliberately.** The spec's DDL
  omitted RLS; all 26 pre-existing `jw_*` tables have it, and these tables hold *unpublished*
  brief copy — without it they are anon-readable via PostgREST. Views additionally carry
  `security_invoker = true`, since a view defaults to running as **owner** and would otherwise
  re-expose exactly the rows the RLS fences. Do not "simplify" either back out.
- **⚠️ `jw_probe_feed` / `jw_probe_robots` must never be granted to `anon`/`authenticated`.**
  They fetch an arbitrary caller-supplied URL as SECURITY DEFINER = an SSRF vector reachable
  through PostgREST. `REVOKE … FROM anon, authenticated` is **NOT sufficient** — both inherit
  the default **PUBLIC** grant, so `REVOKE … FROM PUBLIC` is required (this was caught as 4 new
  advisor WARNs and fixed). Final security advisor output is **byte-identical to baseline**.
- **Local news funnel: 645 candidates registered → 429 verified LIVE across all 52 jurisdictions**
  (16,080 items; avg **8.3**/state, floor **7**, 38 states ≥8, zero dark). Every URL was actually
  fetched server-side — container egress is policy-blocked (403 on CONNECT), so verification runs
  through the **`http` extension** (sync, needed for item counts; note it whitelists curlopts —
  `CURLOPT_FOLLOWLOCATION` is rejected, redirects are followed by hand).
- **Reusable URL-pattern scorecard:** Tegna `/feeds/syndication/rss/news` 100% · Hearst
  `/topstories-rss` 100% · Gray/Arc `/arc/outboundfeeds/rss/?outputType=xml` 85% · WordPress
  `/feed/` 84% · Grove+Scripps `/news.rss` 76% · **Gannett `rssfeeds.*` 0% (RSS retired
  network-wide)** · **bizjournals 0% (Cloudflare 403)**. **TownNews only emits RSS when `f=rss`
  is the TRAILING param.** 27 initial 429s were self-inflicted burst rate-limiting and were
  re-probed throttled before classification — 20 Lee Enterprises titles 429 persistently.
- **D13 honoured:** robots.txt parsed for every live feed — **7 disallowed → demoted to `blocked`**
  and excluded from ingestion; 4 unverifiable are flagged in `notes` (`robots_ok IS NULL` means
  *unknown*, never *allowed*). **Nextdoor = discovery + registration ONLY** —
  `developer.nextdoor.com` verified live and registered `requires_partnership`/`pending_review`;
  nothing login-walled was fetched.
- **NOT done (deliberate):** no ingest worker exists yet, so `com_news_raw_signals` is still at
  its 48/7d baseline — the funnel is registered and verified, not ingesting; a worker must gate on
  `status='live' AND robots_ok IS TRUE`. No brief generated. `tos_reviewed` is false everywhere.
- **I8 finding — the null-state gap is BIGGER than the ticket assumed: 402, not 84.**
  `opposition_event` is exactly 84/84 as stated, but `water_facts_delta` carries a second gap of
  318/1,724. Both feed load-bearing sections (POLITICS, RESOURCES) → both bound as `degraded`.
  Recorded, not repaired, per the task. Also: `jurisdictions.state_abbr` is `character(2)`, not
  `text` — blank-pads on read, so `trim()` it. Report: `docs/state-brief/CC-STATE-BRIEF-SCAFFOLD-run-report.md`.

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
