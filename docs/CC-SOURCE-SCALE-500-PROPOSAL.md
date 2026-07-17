# CC-SOURCE-SCALE-500-1.0 — Source Expansion Strategy: Census, Counting Standard, Gap Map, Roadmap & Architecture

**Engagement:** Investigation + proposal only. Zero production writes. All current-state numbers below are from live queries run 2026-07-17 against Supabase `ycadmmngkdhvpcsrcuaq` and Airtable base `appxfti7VuoHYUeu6` (SQL/queries in Appendix A).
**Status:** DRAFT — awaiting Myke decisions (§8).

---

## 1. Current defensible count

### 1.1 Raw registered rows (the origin of "142")

| System | Table | Rows (live) | Notes |
|---|---|---:|---|
| JW data-source registry | `jw_data_source_registry` | **72** | Named external sources, derived lanes, gated sources, stubs |
| Municipal agenda portals | `jurisdiction_agenda_sources` | **21** | 11 `active`, 9 `error`, 1 `not_implemented` |
| State PUC portals | `puc_sources` | **25** | 2 `live` (TX, VA), 20 `registered_pending`, 3 `blocked` (WAF: OH/WI/MN) |
| Global stats series config | `ext_source_series` | **24** | 20 enabled / 4 disabled, across 9 upstream source families |
| **Sum** | | **142** | ← this is where the marketing number comes from |

### 1.2 Deduplication (R1 applied)

The 142 is a row count, not a source count. Adjustments, each verified against live rows:

**Subtract (−33): rows that are not distinct named sources**

| Adjustment | Δ | Reason |
|---|---:|---|
| `ext_source_series` (24 rows) | −24 | Series-level *config* rows. All 9 upstream families (wb:wdi, eurostat:regional, ilo:ilostat, ilo:normlex, ituc:gri, fao:aquastat, wri:aqueduct40, oecd:regional, cred:emdat) already have rows in `jw_data_source_registry`. |
| `agenda:legistar` umbrella row | −1 | Duplicates the 21 per-portal `jurisdiction_agenda_sources` rows. |
| `puc:dockets` umbrella row | −1 | Duplicates the 25 per-portal `puc_sources` rows. |
| `wb:wdi` ≡ `intl:worldbank-wdi` | −1 | Same upstream API (World Bank WDI), two consuming pipelines. One source. |
| `moratorium-nation:inventory` + `:opposition` | −1 | Two JPAS lanes over one dataset (mjbommar/moratorium-data-2026). One source. |
| `wri:aqueduct40` + `wri:aqueduct40-basins` | −1 | Two files of one Aqueduct 4.0 release. One source. |
| Derived/internal rows: `ferc:queue-rollup`, `jw:cousub-rollup`, `ncsl:inherit`, `ncsl:data-center-moratorium` | −4 | Faraday-derived transforms/inheritance lanes, not external sources (R1 categorical exclusion). |

→ **Deduplicated named sources in the four Supabase tables: 109.**

**Add (+34): live named sources the four tables miss**

| Addition | Δ | Evidence |
|---|---:|---|
| Socrata state-incentive feeds (live) | +8 | 8 distinct `source_key`s in `state_incentive_disclosures` (ny_esd_dei, ny_ida_projects, ct_decd, md_commerce, or_ez_parta_2024, or_ez_parta_2025, or_eip, de_eeif); weekly cron ran 2026-07-12 |
| Socrata state-incentive roster (registered-pending) | +24 | 29-state roster in `ingest-state-incentives` mappers config; 24 states probed, not yet live-seedable |
| CourtListener RECAP (opposition dockets) | +1 | `opposition-docket_v1.0` / AUTO-183, last run 2026-07-13 |
| `shovels:permits` | +1 | 1,246 `jpas_attributes` rows, last write 2026-07-15 — **active but unregistered** (registry has only `shovels:telecom`). Registry gap. |

→ **Registered named sources across all systems ≈ 143.**

> **The "142 registered sources" claim survives — but by coincidence.** 33 duplicate/derived/config rows in the four-table sum are almost exactly offset by 34 named sources those tables don't hold. The number is right; the derivation was wrong. The proposed `source_registry` + census view (§5) makes the number auditable instead of coincidental.

### 1.3 Active in trailing 30 days (the number that survives buyer scrutiny)

Applying R1's activity clause (status active AND ≥1 artifact/run/write evidence in trailing 30 days; per-source evidence in Appendix B):

| Group | Active | Detail |
|---|---:|---|
| JW registry externals with 30-day evidence | 42 | BLS ×2, Census ×6, EIA ×2, Eurostat, GeoNames, ILOSTAT, manual loads (NORMLEX/ITUC/AQUASTAT) ×3, intl:* ×7, ISO queues ×3, IXPDB, Moratorium Nation, NCSL ×2, FEMA NRI, SDWIS, USGS, Treasury OZ, FCC ×2, NTIA BEAD, Wikipedia IXP, HIFLD ×2, Aqueduct, Shovels permits |
| Municipal agenda portals (`active` status) | 11 | 8 Legistar + 3 custom; the 9 `error` portals were attempted in-window but fail R1's active clause |
| PUC portals live | 2 | TX (PUCT Interchange), VA (SCC Breeze) |
| Socrata incentive feeds | 8 | Weekly Sunday ingest |
| CourtListener | 1 | Weekly docket search |
| **Total active, R1-countable** | **64** | |

**Registered-but-inactive ≈ 79**, decomposed: license-gated 8 (dc:atlas, dc:cleanview, dc:epoch-ai, fiberlocator, peeringdb, zayo:mapbook, telegeography, cred:emdat) · Tier-3 NSO stubs 5 · disabled 1 (oecd:regional) · registered-no-loader 7 (census:gov-finance, census:gov-units, bls:oews, openet:gee-ensemble, shovels:telecom, telecomramblings ×2) · agenda error/unimplemented 10 · PUC pending/blocked 23 · Socrata pending 24.

### 1.4 What the ~125 "active crawl automations" actually are

Airtable Automation Registry (`tbl1ef6FgxUc3Uevg`, 187 rows): **130 Active, 51 Designed, 5 Testing, 1 blank.** `automation_health_log` shows ~117 distinct crawler families with runs in the trailing 30 days. Of those:

- **~92 are AUTO-001…119 / 164–177 topical monitors** — Anthropic web_search-driven "Signal Crawl / Monitor" automations. Under R1 these are **automations, not sources** (search queries don't count). They are real production capacity, but they are the reason "142 sources" and "125 automations" must never be conflated on a subscriber surface.
- ~10 are non-crawl internal automations (scorers, PFI, briefing generator, todo digest, IDF bridge extractors).
- The rest are the registry-driven ingests already counted per-source in §1.3.

**RSS Feeds table (`tbltshNRn6xozusMs`): 514 rows — zero countable sources.** 339 rows are Google Alerts query-feed URLs (R1-excluded search queries; 217 distinct), 175 rows have no URL at all; `Pipeline Status` = "Not Connected" on 503/514 and `Last Ingested` is empty on **every** row. However, it is a curated **entity roster** (~300 companies/organizations) that directly accelerates Wave 1: most of those entities have a real newsroom/blog RSS feed that *does* count.

### 1.5 STOP-condition assessment

No stop. The registered count (~143) is **not** materially below 142 after cross-registry dedup — the duplicates (−33) are offset by unregistered live sources (+34). The large registered-vs-active delta (143 → 64) is the disclosure DONE-WHEN #1 explicitly asked for, not a duplicate-driven collapse. **But it is the headline risk:** until Wave 1 lands, the only R1-honest subscriber phrasings use "registered" or a "60+ in production" formulation (§8f).

---

## 2. Counting standard (R1/R2 confirmed with amendments)

### 2.1 R1 — confirmed, with five amendments

**One source = one named feed, portal, API endpoint, or publication with its own URL, cadence, and confidence cap.** Search queries, keyword configs, Google Alerts, and automations do not count. A source counts toward the marketed number only when `status = active` and it produced ≥1 artifact or successful health-log/run-table row in the trailing 30 days.

Amendments (all derived from real collisions found in the census):

- **A1 — one publication, one source.** Multiple files/feeds of one release (Aqueduct indicators + basin polygons) collapse to one source.
- **A2 — one upstream, one source.** The same upstream API consumed by two pipelines (WDI via ext-global-ingest and via JPS-Lite) counts once.
- **A3 — derived lanes never count.** Rollups, inheritance lanes, negative-space derivations (`ncsl:inherit`, `ferc:queue-rollup`, etc.) are transforms of already-counted sources.
- **A4 — portal-grain for government sources.** Each distinct commission/portal/legislature counts as one source even when reached through an aggregator; the aggregator is an access method. This is what makes 21 agenda portals = 21 sources and, in Wave 2, 50 state legislatures = 50 sources accessed via LegiScan. **Myke decision 8a-ii:** the conservative alternative (LegiScan = 1 source) costs 49 sources. Recommended: portal-grain, because the underlying publisher is the named, citable entity — this is also how puc_sources already counts.
- **A5 — errors don't count as activity.** A source with only failed attempts in the window is `registered`, not `active` (the 9 error agenda portals).

### 2.2 Cadence tiers

`hourly` · `daily` · `weekly` · `event-driven` (webhook/release-triggered) · `archival-refresh` (monthly+; annual statistical releases, frozen archives). Every source carries exactly one tier in the registry; the census view exposes the mix.

### 2.3 Confidence caps per source class (consistent with existing convention)

| Class | Cap | Examples |
|---|---|---|
| Primary government/statistical feeds & filings | SRC (0.85) | Federal Register, EDGAR, PUC dockets, ISO queues, BLS/Census/EIA |
| Named trade/vendor publications (editorial) | SRC for the *fact of publication*; content claims INF | DCD, vendor newsrooms, hyperscaler blogs |
| Community/directory-maintained | INF (0.60) | IXPDB, Wikipedia lists, PeeringDB (if cleared) |
| Aggregated/derived/proxy | EST (0.30) | country proxies, rollups (not countable anyway per A3) |

### 2.4 R2 — cadence mix target, amended

R4's wave composition supports **≥60% daily-or-better easily (~75% projected — RSS/API polling makes daily the default)**. The **50-hourly** target is the stretch: the natural hourly tier (status pages ~10–15, ISO market/notice feeds ~8, ENTSO-E/AEMO ~4, CISA/NVD 2–3, EDGAR intraday 1, NWS CAP 1, GDELT 1) lands ~30 firm. Recommended amendment: **hourly ≥30 committed / 50 stretch**; marketing copy keys on "500 sources, 300+ scanned daily" which is safe under either.

---

## 3. Gap map by IDF Domain

Live registries: **23 Domains (D1–D23, all Active)** in `tbltFtmWgBYPuRLSc`. ⚠️ **Stale premise in the engagement brief:** the Sub-Domain registry `tbla7rtRY9AaeoWhu` holds **61 rows (55 Active, 6 Candidate), not 116.** The gap map below is at Domain grain.

Active countable sources mapped to primary Domain (a source may serve several; mapped to its primary):

| Domain | Active sources today | Assessment | Top Wave-1/2 candidates (URL · cadence · access · license) |
|---|---:|---|---|
| D3 Grid & Regulatory | 12 | **Strong** | FERC eLibrary (elibrary.ferc.gov · daily · RSS/API · pub-domain); CAISO/NYISO/ISO-NE/SPP queues (iso sites · weekly · CSV/API · public-cite); ISO market notices (hourly · RSS/API · public) |
| D19 Tax & Incentives | 10 | Medium | 24 pending state portals (mostly PDF-only → V2 Textract); Good Jobs First Subsidy Tracker (goodjobsfirst.org · monthly · bulk · **license read needed**) |
| D14 Real Estate & Site Sel. | 10 | Medium | **Epoch AI data centers CSV (epoch.ai · monthly · CSV · CC-BY — already cleared, just needs the Vercel run)**; county assessor feeds (W3+) |
| D13/D18 Community & Opposition | 13 | Medium-strong (US) | Agenda expansion 21→60 portals (Legistar API · daily · API · public record); state court dockets via CourtListener expansion (free API) |
| D15 Sovereign AI & Geopolitics | 7 | Medium (country-grain only) | Federal Register API (federalregister.gov/api · daily/hourly · API · pub-domain); EUR-Lex/OJ feeds (eur-lex.europa.eu · daily · RSS · EU-open); BIS entity-list updates (via FedReg) |
| D12 Networking | 5 (+3 gated) | Medium | RIR delegation stats (ftp.ripe.net etc. · daily · bulk · open); submarine cable trade feeds; PeeringDB pending D3 legal read |
| D7 Cooling & Water | 4 | Water strong, cooling thin | Vendor newsrooms (Vertiv, CoolIT, LiquidStack, Submer · daily · RSS · publication-fact) |
| D17 Workforce | 5 | Medium | BLS JOLTS (bls.gov · monthly · API · pub-domain); activate bls:oews (registered) |
| D11 Sustainability | 1 | Thin | EPA eGRID/FLIGHT (epa.gov · annual/monthly · bulk/API · pub-domain); EU CSRD registers (W3) |
| D10 Construction | 1 | Thin | Census construction spending (census.gov · monthly · API · pub-domain); AGC/ABC releases (RSS) |
| D1 Chips & Density | 0 | **Thin** | arXiv cs.AR/cs.DC/cs.NI/eess.SY (arxiv.org · daily · Atom API · open, 1 req/3s); Tom's Hardware RSS; IEEE Spectrum RSS (editorial · publication-fact) |
| D2 Power Architecture | 0 | **Thin** | Vendor newsrooms: Vertiv, Eaton, Schneider, ABB, Bloom, GE Vernova (daily · RSS) |
| D4 M&A & Capital | 0 | **Thin** | SEC EDGAR full-text search API (efts.sec.gov · hourly-capable · API · pub-domain, 10 req/s cap); EDGAR 8-K/13F RSS (sec.gov · intraday · RSS) |
| D5 Hyperscaler Activity | 0 | **Thin** | AWS/Azure/GCP/Meta/Oracle/OpenAI engineering+news blogs (~10–15 feeds · daily · RSS · publication-fact) |
| D6 New Entrants | 0 | **Thin** | Neocloud/operator newsrooms from Tracking Companies roster (~50 feeds · daily · RSS); Crunchbase → W4 licensed |
| D8 People & Signals | 0 | Thin (LinkedIn ToS-blocked — excluded from count) | Exec-signal-watch (AUTO-179, designed) is an automation, not a source; press-release feeds carry the countable signal |
| D9 Orchestration | 0 | Thin | GitHub releases Atom feeds for infra repos (github.com/{org}/{repo}/releases.atom · event-driven · free) |
| D16 Cyber & Physical Security | 0 | **Thin** | CISA advisories + KEV (cisa.gov · hourly-capable · RSS/JSON · pub-domain); NVD API (nvd.nist.gov · hourly · API · pub-domain) |
| D20 Facility IT/OT | 0 | Thin | Vendor blogs (Schneider EcoStruxure, Honeywell, JCI · RSS) |
| D21 Insurance & Risk | 0 | **Thin** | Insurer/broker newsrooms (Marsh, Aon, Munich Re · RSS); NAIC bulletins; Lloyd's reports (**license read**) |
| D22 Media & Analyst | 0 connected | **Thinnest vs value** | DCD, Data Center Knowledge, Bisnow, Data Center Frontier, Utility Dive, Capacity, W.Media, Lightwave, analyst press rooms (~25 feeds · daily · RSS · publication-fact) |
| D23 Outage & Emergency | 0 | **Thin** | Hyperscaler status pages/JSON (status.aws.amazon.com etc. · **hourly** · JSON/RSS · public); NWS CAP alerts (api.weather.gov · hourly · API · pub-domain); poweroutage.us → W4 paid |

Candidate-level detail (URL, exact feed path, cadence, access, license posture, Domain mapping) for the full Wave-1 list belongs to the Wave-1 build gate; every feed listed above is flagged `unreviewed` until its ToS is read at build time, and **nothing enters the countable census on assumed permission** (license_status gate in the DDL, §5).

---

## 4. Phased roadmap (R4 validated, targets restated against the honest baseline)

R4's wave *shapes* are validated; its *targets* were computed off the 142 baseline. Restated against **64 active / 143 registered**, targets are for **active countable sources**:

### Wave 1 — low friction (+~130 → ≈195 active; ≈300 registered)

RSS/Atom + free federal APIs via the new registry-driven poller (§5). Composition: trade media & analyst newsrooms ~25 · hyperscaler/neocloud blogs & newsrooms ~15 · vendor newsrooms off the Tracking-Companies roster ~50 · status pages ~10 (hourly) · arXiv category feeds 4 · Federal Register API 1 · EDGAR FTS + 8-K feeds 2 · CISA ×2 + NVD 1 · NWS CAP 1 · GitHub release feeds ~10 · repair the 9 error agenda portals · activate already-cleared registered sources: Epoch AI (CC-BY), bls:oews, census:gov-finance/gov-units ≈ +13.
**Mechanism:** `source_registry` + one `source-poller` edge fn (hash-dedupe → triage → enrich). **Licensing:** publication-fact model for editorial feeds; every feed gets a pull-time ToS check recorded in `license_status`.
**Cost delta:** ≈ +$95/mo LLM (math §6). **Schema:** migration for `source_registry` (+ deny-all RLS); no changes to existing tables.

### Wave 2 — regulatory depth (+~105 → ≈300 active)

23 remaining PUC portals (20 pending + 3 WAF-blocked via Vercel egress — the CC-INGEST-PUC pattern already proved per-state adapters) · 50 state legislatures via LegiScan API (portal-grain per A4; LegiScan free tier 30k queries/mo covers daily pulls; **Myke 8a-ii**) · municipal agendas 21→60 (+39; Legistar-first, facility-metro-seeded like Stream C) · remaining ISO/RTO queue + market/notice feeds ~8 (hourly tier).
**Cost delta:** ≈ +$70/mo (agenda/PUC/LegiScan items are low-volume but per-item enrichment is longer). **Schema:** none new (puc_sources/agenda tables stay; rows register in source_registry).

### Wave 3 — global theaters (+~90 → ≈390 active)

EU/UK: ENTSO-E Transparency API (hourly, free token), National Grid ESO, Ofgem, EirGrid, Bundesnetzagentur, RTE, Elia, TenneT, EUR-Lex (~15). APAC: AEMO (hourly), EMA SG, OCCTO, KPX, MIC JP (~10). LATAM/MENA: ONS BR, CENACE MX, DEWA, gulf regulators (~8). Theater trade media RSS (~30). National OGD incentive/energy portals (~20). Activate the 5 registered NSO stubs (StatCan, MOSPI, IBGE, e-Stat, ABS). Maps to D14/D15/D22 theater coverage.
**Cost delta:** ≈ +$70/mo. **Schema:** none; non-Latin content raises enrichment tokens ~20% (budgeted).

### Wave 4 — premium/licensed (+~50 → ≈440+ active; 500 registered)

FiberLocator (D2a: written redistribution rights required), TeleGeography paid, Cleanview API (~$14k/yr), analyst feeds (Synergy/Omdia/Dell'Oro), Data365, poweroutage.us, Crunchbase, Lightcast, EM-DAT (counsel check), PeeringDB (D3 legal read). **License fees are annual line items outside the R5 $500/mo ceiling — each is a separate Myke go/no-go.**
**Honest arithmetic on the 500:** waves land ≈440 active; the remainder comes from the vendor-newsroom long tail (the entity roster supports 300+ candidate feeds; Wave 1 takes only the top ~50) plus attrition backfill. **500 registered is comfortably achievable; 500 *active* requires the long tail and ongoing health enforcement** — recommend the marketed claim be "500 sources / 300+ scanned daily" with `active ≥ 300 daily-tier` as the hard gate (§8f).

---

## 5. Architecture recommendation (R3 validated, with one refinement)

### 5.1 Verdict

**Registry-driven poller: validated.** Per-automation crawl does not scale to 500 — each AUTO monitor costs an edge-fn invocation plus a full Claude web_search session per topic per day (~10–40k tokens), gives no per-source health, and makes the census unauditable. The 92 existing AUTO monitors cost roughly as much per day as the entire 500-source poller would (they are *synthesis* capacity, worth keeping — but not the scaling path).

**Refinement to R3:** one unified `source_registry` table, **but not one monolithic fetcher.** The generic `source-poller` handles the long tail (RSS/Atom/JSON/status/simple APIs — ~80% of the 500). Specialized pipelines that already work (PUC adapters, ferc-queue, census, intl, SDWIS…) keep their fetchers and simply **register their sources** — the registry unifies identity, licensing, cadence, health, and the census; it does not force-fit heterogeneous parsers into one function. The AUTO-183–187 / 191–196 pattern (config rows + shared runner + health rows) is the reference, generalized.

### 5.2 Rate/cost model at hourly cadence (hourly tier ~50 sources)

- Fetch volume at full scale: 300 daily + 50×24 hourly + ~150 weekly/7 ≈ **1,520 HTTP fetches/day** (conditional GET via ETag/Last-Modified wherever supported). Batched ~50 sources/invocation ⇒ ~30–90 edge-fn invocations/day — noise for Supabase limits.
- Politeness: 1 request/source/hour max on the hourly tier = 1 req/host/hr for status pages — far under any published limit (EDGAR 10 req/s; Federal Register ~1k/hr; arXiv 1 req/3s; NVD 50 req/30s with key).
- Anthropic rate pressure: triage via **Batch API** (no rate coupling, 50% price); enrichment ~420 items/day spread across the day ≈ <1 req/min average.
- **Failure mode coverage:** Anthropic credit exhaustion fails enrichment uniformly — the poller **keeps fetching and hash-staging** items with `enrich_status=pending` (no data loss, catch-up drain), and the AUTO-178 zero-artifact health check extends to per-source grain via `last_artifact_at` (§5.3) plus a global "0 enrichments in 2h" alarm identical to today's.

### 5.3 Proposed DDL (NOT applied — Myke sign-off required)

```sql
-- Migration draft: 00XX_source_registry.sql  (deny-all RLS, service-role only — 0028 pattern)
create table source_registry (
  source_key            text primary key,          -- e.g. 'media:datacenterdynamics'
  name                  text not null,
  provider              text,
  url                   text not null,             -- human-facing home
  feed_url              text,                      -- machine endpoint actually polled
  access_method         text not null check (access_method in
                          ('rss','atom','json_api','html','bulk_file','webhook','manual')),
  cadence               text not null check (cadence in
                          ('hourly','daily','weekly','event_driven','archival_refresh','one_time')),
  confidence_cap        text not null check (confidence_cap in ('VRF','SRC','INF','EST')),
  license               text not null,
  license_status        text not null default 'unreviewed' check (license_status in
                          ('cleared','attribution_required','gated','blocked','unreviewed')),
  idf_domains           text[] not null default '{}',      -- ['D22','D5']
  scope                 text,
  countable             boolean not null default false,    -- R1 gate: license cleared + named-source test passed
  status                text not null default 'registered' check (status in
                          ('registered','active','error','paused','retired')),
  subsystem             text,                      -- 'jw'|'agenda'|'puc'|'ext'|'poller'|…
  legacy_ref            jsonb,                     -- {table, pk} pointer for migrated rows
  auto_id               text,                      -- health-log linkage
  fetcher               text not null default 'source-poller',
  fetch_config          jsonb not null default '{}',
  cursor                jsonb not null default '{}',
  etag                  text,
  last_modified         text,
  last_fetch_at         timestamptz,
  last_ok_at            timestamptz,
  last_artifact_at      timestamptz,               -- drives R1 activity + AUTO-178 per-source check
  consecutive_failures  int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- The auditable marketing number (replaces hand-added table sums):
create view v_source_census as
select
  count(*) filter (where countable)                                        as registered,
  count(*) filter (where countable and status = 'active'
                   and last_artifact_at > now() - interval '30 days')      as active_30d,
  count(*) filter (where countable and status = 'active'
                   and cadence in ('hourly','daily')
                   and last_artifact_at > now() - interval '30 days')      as daily_or_better_30d,
  count(*) filter (where countable and status = 'active' and cadence = 'hourly'
                   and last_artifact_at > now() - interval '30 days')      as hourly_30d
from source_registry;
```

Health logging: one `automation_health_log` row per poller batch (auto_id = the poller's granted AUTO id) with per-source counters in `notes`/artifacts tagged `source_key`; per-source freshness enforced from `last_artifact_at` by a daily health sweep that flips silent sources to `error` and digests them to Myke (AUTO-178 extension).

### 5.4 Migration path for the four existing tables

- **Phase 0 (with Wave 1):** create `source_registry`; backfill all four tables as `registered` rows with `legacy_ref` and correct `countable`/dedup flags. Zero behavior change; existing pipelines untouched.
- **Phase 1:** all new Wave-1+ sources live only in `source_registry`; `source-poller` reads it.
- **Phase 2:** the census/marketing surface reads `v_source_census` exclusively.
- **Phase 3 (per-subsystem, each its own gated pass):** `puc_sources` and `jurisdiction_agenda_sources` become registry-fed (their fetchers read config from `source_registry`; per-state cursor stays in `fetch_config`/`cursor`); `ext_source_series` remains as series-grain config with an FK to its registry row; `jw_data_source_registry` is retired last (it holds JW-specific semantics — confidence provenance — that migrate into the registry columns).

New pollers need AUTO ids: **propose AUTO-199 (source-poller), AUTO-200 (source-health-sweep), AUTO-201 (census-reporter)** — next-free after AUTO-198; Myke grants (8c).

---

## 6. Cost model (math shown; prices: Haiku 4.5 $1/$5 per MTok; Sonnet 5 $3/$15, intro $2/$10 to 2026-08-31; Batch API −50%)

**Volume estimate at full 500-source scale** (post hash-dedupe new items/day): trade media 25×16 ≈ 400 · vendor newsrooms 50×0.5 ≈ 25 · hyperscaler blogs ≈ 30 · status incidents ≈ 5 · arXiv 4 cats ≈ 150 · FedReg (filtered sections) ≈ 20 · EDGAR FTS (DC queries) ≈ 30 · CISA/NVD (filtered) ≈ 20 · GitHub releases ≈ 10 · agendas+PUC+LegiScan ≈ 100 · Wave-3 global ≈ 250. **≈ 1,050–1,200 items/day.**

| Stage | Items/day | Tokens/item (in+out) | Model | $/day | $/mo |
|---|---:|---|---|---:|---:|
| Triage (relevance/domain tag) | 1,200 | 700 + 80 | Haiku 4.5 via Batch | (0.84M×$1 + 0.096M×$5)×0.5 ≈ $0.66 | **$20** |
| Enrichment, standard (~85% of relevant 35%) | 357 | 2,500 + 500 | Haiku 4.5 | 0.89M×$1 + 0.18M×$5 ≈ $1.79 | **$54** |
| Enrichment, high-signal (~15%) | 63 | 3,000 + 700 | Sonnet 5 | 0.19M×$3 + 0.044M×$15 ≈ $1.23 | **$37** |
| Embeddings | 420 | — | (Voyage/Pinecone) | — | **~$8** |
| **Total incremental LLM+vector** | | | | | **≈ $120/mo** |

Sensitivity: all-Sonnet enrichment ≈ $270/mo; 2× volume ≈ $240/mo. Per-wave deltas: W1 ≈ $95 · W2 ≈ +$70 · W3 ≈ +$70 · W4 ≈ +$25 API-metered ⇒ **≈ $260/mo cumulative steady-state, worst-case ≈ $480/mo — inside the R5 $500/mo ceiling with thin worst-case headroom.** Non-token API costs in-ceiling: LegiScan free tier, CourtListener free, ENTSO-E free. **Outside the ceiling (annual licenses, each a separate go/no-go):** Cleanview ~$14k/yr, FiberLocator ≥$4.5k/yr (external-use terms unconfirmed), TeleGeography/analyst feeds TBD, Shovels telecom-tag credits usage-based.

---

## 7. Verification & re-runnability

The census is re-runnable from Appendix A; identical queries on 2026-07-17 produced the numbers above twice (row counts stable within the session). Expected deltas on re-run: `last_run`/30-day activity windows shift with the calendar; `jw_briefing`/sweep crons do not touch any censused table.

---

## 8. MYKE ACTIONS (go/no-go)

a. **Counting standard.**
   i. Approve R1 + amendments A1–A5 (§2.1).
   ii. Portal-grain vs aggregator-grain for LegiScan-accessed legislatures (A4): **recommended portal-grain (50 sources)**; conservative alternative = 1 source (−49).
   iii. Approve cadence-mix amendment: ≥60% daily-or-better committed; hourly ≥30 committed / 50 stretch (§2.4).
b. **Approve `source_registry` DDL** (§5.3) and the Phase 0–3 migration path (§5.4). Nothing is applied until approved.
c. **Grant AUTO-ID block** AUTO-199–201 for source-poller / health-sweep / census-reporter (proposed next-free; grant is yours).
d. **Approve the Wave 1 source list** (composition §4; itemized feed list produced at Wave-1 build gate with per-feed ToS check before `countable=true`).
e. **Cost ceiling:** confirm R5 $500/mo for metered spend; confirm that annual licenses (Cleanview/FiberLocator/TeleGeography/analyst) are separate line-item decisions.
f. **Subscriber-facing framing — pick one (copy is yours):**
   1. "**500+ registered intelligence sources — 300+ scanned daily.**" (usable from Wave 2–3; both clauses auditable from `v_source_census`)
   2. "**Monitoring 500 named sources across 23 infrastructure domains, 60% refreshed daily or faster.**"
   3. Dynamic: "**{registered} sources · {daily_or_better} scanned daily · every count auditable**" rendered live from `v_source_census` (strongest under institutional scrutiny).
   Interim (honest today): "**140+ registered sources, 60+ in active production**" — the 142 static claim should not appear next to the word "active" until Wave 1 lands.
g. **Flag:** IDF Sub-Domain registry holds 61 rows, not 116 (§3) — either the brief's figure or the registry needs reconciliation.
h. **Flag:** `shovels:permits` is active but unregistered in `jw_data_source_registry` — one-row registry fix (write, so not done in this engagement).

---

## Appendix A — Census queries (re-runnable, read-only)

```sql
-- A1. Raw counts
select 'jw_data_source_registry' t, count(*) from jw_data_source_registry
union all select 'jurisdiction_agenda_sources', count(*) from jurisdiction_agenda_sources
union all select 'puc_sources', count(*) from puc_sources
union all select 'ext_source_series', count(*) from ext_source_series;

-- A2. Registry rows (dedup + classification input)
select source_key, name, provider, cadence, confidence_cap, scope, license
from jw_data_source_registry order by source_key;

-- A3. Status breakdowns
select 'agenda' sys, platform k, scrape_status s, count(*),
       count(*) filter (where last_scraped_at > now() - interval '30 days') act
from jurisdiction_agenda_sources group by 1,2,3
union all
select 'puc', state_abbr, status, count(*),
       count(*) filter (where updated_at > now() - interval '30 days')
from puc_sources group by 1,2,3
union all
select 'ext', fetcher, case when enabled then 'enabled' else 'disabled' end, count(*), null
from ext_source_series group by 1,2,3;

-- A4. 30-day activity: crawler families
select crawler_id, max(auto_id), count(*) runs, sum(coalesce(artifacts_new,0)) new_items,
       count(*) filter (where success) ok, max(run_started_at)::date last_run
from automation_health_log
where run_started_at > now() - interval '30 days'
group by crawler_id order by crawler_id;

-- A5. 30-day activity: per-source run tables
select source_key, max(started_at)::date, count(*) filter (where started_at > now() - interval '30 days')
from intl_source_runs group by source_key;
select source, max(started_at)::date, count(*) filter (where started_at > now() - interval '30 days')
from ext_ingest_runs group by source;
select source_key, count(*), max(updated_at)::date from state_incentive_disclosures group by source_key;

-- A6. 30-day activity: attribute-write evidence for registry sources
select source, count(*), max(captured_at)::date from jpas_attributes
where source in ('fcc:broadband-map','fcc:bdc','wikipedia:ixp-list','shovels:permits','sdwis:echo',
                 'usgs:waterdata','ntia:bead','telegeography:free-maps','openet:gee-ensemble')
   or source like 'intl:%' or source like 'ixpdb%' or source like 'ncsl:%'
   or source like 'moratorium-nation:%'
group by source order by source;
```

Airtable (via MCP, read-only): Automation Registry `tbl1ef6FgxUc3Uevg` (fields: Auto ID, Status, Category, Source Type, Auto Name — 187 records); RSS Feeds `tbltshNRn6xozusMs` (514 records; Active, Pipeline Status, Feed URL, Last Ingested); IDF Domain Registry `tbltFtmWgBYPuRLSc` (23); IDF Sub-Domain Registry `tbla7rtRY9AaeoWhu` (61).

## Appendix B — Active-source evidence (trailing 30 days, as of 2026-07-17)

Registry externals (42): bls:laus, bls:qcew (ingest-bls-labor 07-11) · census:acs5, aiannh, pep, tiger, tiger-place-county, urban-rural (census-backfill 07-12) · eia:860, eia:861 (07-13) · eurostat:regional, geonames:spine, ilo:ilostat (ext_ingest_runs 07-08) · fao:aquastat, ilo:normlex, ituc:gri (manual loads 07-08 — flagged manual-cadence) · intl:ember, intl:jds-directories, intl:oecd-fdi-rri, intl:rsf-pfi, intl:worldbank-db2020, intl:worldbank-wdi, intl:worldbank-wgi (intl_source_runs ≤07-15, all success) · iso:ercot-gis, iso:miso-queue, iso:pjm-queue (ingest-ferc-queue 07-13) · ixpdb:federation (07-15) · moratorium-nation (07-15) · ncsl:dc-moratoriums, ncsl:subsidizing-servers (07-13) · fema:nri (07-11) · sdwis:echo (07-09) · usgs:waterdata (07-15, */20 sweep) · treasury:oz-designations (07-12) · fcc:bdc, fcc:broadband-map (38,692 rows each, 07-15) · ntia:bead (38,939 rows, 07-14) · wikipedia:ixp-list (07-14) · hifld:iso-boundaries, hifld:utility-territories (07-13) · wri:aqueduct40 incl. basins (0065 re-join 07-12) · shovels:permits (07-15).
Portals: 11 agenda `active` (last_scraped ≤30d) · PUC TX+VA (07-13) · 8 Socrata feeds (07-12 cron) · CourtListener (07-13).

## Appendix C — Notion changelog entry (DRAFTED — not published; target: Automation Library page 33489a0c-1680-8115-8f30-c269b182f06b)

> **2026-07-17 — CC-SOURCE-SCALE-500-1.0 (investigation, no production changes).** Source census run against Supabase + Airtable: 142 raw registered rows resolve to ≈143 deduplicated named sources (~109 in the four Supabase tables + ~34 in code-config/off-registry), of which **64 are active in the trailing 30 days** under the proposed counting standard. RSS Feeds table (514 rows) confirmed 100% unconnected Google-Alerts/blank rows — repurposed as Wave-1 entity roster. Proposal delivered: counting standard (R1+A1–A5), IDF-domain gap map (23 domains; sub-domain registry holds 61 rows, not 116), 4-wave roadmap to 500 registered / 300+ daily (≈$260/mo steady-state metered spend, ceiling $500), and `source_registry` unified-registry architecture with proposed DDL (not applied). AUTO-199–201 proposed (pending grant). Jira: FAR-xxx.
