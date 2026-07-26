# CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — Investigation Gate findings

_Investigation completed 2026-07-26. Report BEFORE any build, per task gate._

## TL;DR

The NY-and-friends Socrata framework the task tells us to extend **already exists,
is deployed, and is the exact architecture the task recommends** (one multi-state
edge function + per-state adapter modules). The single biggest surprise: **that
live code is not in version control** — it exists only as the deployed Supabase
edge function `ingest-state-incentives` (v10). Two more gaps: **no
`jw_data_source_registry` rows exist for _any_ state-incentive source** (even the 8
live ones), and **endpoint liveness cannot be verified from this container** (the
network policy 403s every external data portal at the gateway; only the deployed
edge functions have open egress).

## 1. What already exists (live, project `ycadmmngkdhvpcsrcuaq`)

### Edge function `ingest-state-incentives` (v10, `verify_jwt=false`) — AUTO-178
- Header tag: `CC-INGEST-STATE-INCENTIVE-API-1.0/1.1`. Config-driven Socrata
  registry (`mappers.ts`): `LIVE_SOURCES` (8) + `PENDING_SOURCES` (24).
- Contract: windowed paging `{offset, pages}`; `{chain:true}` self-invokes until
  exhausted; content-hash idempotent upsert into `state_incentive_disclosures`
  (`onConflict: content_hash, ignoreDuplicates`); calls
  `fn_state_incentives_resolve_and_score(state)` once per touched state; one
  `automation_health_log` row per source per window.
- Auth: `verify_jwt=false` + optional `STATE_INCENTIVE_INGEST_SECRET` compared to
  `body.secret` (FAR-340 — confirmed wired in the function; applies cleanly to any
  new state added to the same function).
- Socrata app token: `DATA_NY_APP_TOKEN` sent as `X-App-Token` on every Socrata
  request (works cross-domain — covers CT/MD/OR too).

### Live source data (`state_incentive_disclosures`, 111,256 rows)
| state | source_key | rows | last upd |
|---|---|---:|---|
| NY | ny_esd_dei | 65,197 | 2026-07-07 |
| NY | ny_ida_projects | 34,348 | 2026-07-08 |
| MD | md_commerce_finance_tracker | 7,246 | 2026-07-08 |
| CT | ct_decd_business_assistance | 2,204 | 2026-07-08 |
| OR | or_energy_incentive_program | 1,034 | 2026-07-08 |
| DE | de_eeif_grants | 806 | 2026-07-08 |
| OR | or_ez_parta_2024 | 266 | 2026-07-08 |
| OR | or_ez_parta_2025 | 155 | 2026-07-08 |

So **5 states are already live**, not just NY: NY, CT, MD, OR, DE. (CT/OR/MD are
Wave-1 states in the task — already done. DE is a Wave-4 state — already done via
Socrata.) 89,449 rows county-resolved; 21,807 unresolved (no county match).

### Resolve/score RPC `fn_state_incentives_resolve_and_score(p_state_abbr text)`
- Resolves `county_name` → `jurisdictions` (active, level=county, matching state),
  then aggregates **INC-01..05** into `jpas_attributes`:
  - INC-01 present + disclosure_count · INC-02 incentive types · INC-03 award $
    (total/max) · INC-04 term years/start/end · INC-05 programs + statutes.
- **Confidence is hardcoded in the RPC**: every county-resolved disclosure writes
  `confidence_tier='SRC', confidence_multiplier=0.85, source='state_disclosure',
  source_level='primary'`. There is **no per-source confidence input** today.
  ⇒ Waves 3–4 (which require INF/EST for scraped/estimated data, per the task's
  "do not claim SRC for scraped HTML") **cannot be honored without changing this
  RPC** to take a per-source/per-record confidence. Design decision required.
- County resolution only fires where `jurisdictions` has county rows for the state
  AND the source carries a `county_name`. Sources without county → land in the
  landing table but write no JPAS attribute until resolution logic is extended.

## 2. Gaps found (must be closed regardless of scope)

1. **Not version-controlled.** `ingest-state-incentives/{index.ts,mappers.ts}` is
   absent from all three repos and from git history (only the CC-SOURCE-SCALE-500
   proposal doc exists on this branch). Reconstructing the deployed source into
   `Faraday-intelligence/supabase/functions/ingest-state-incentives/` is
   prerequisite groundwork before extending it.
2. **No registry rows.** `jw_data_source_registry` has zero rows for any
   state-incentive source. The task requires "no source ships without a registry
   row" — this applies to the 8 live sources too (backfill needed).
3. **AUTO-178 collision** (documented in the function header): AUTO-178 is shared
   with `faraday-crawl-healthcheck`. Task's cross-cutting requirement says to
   reserve a fresh AUTO-ID via the Airtable Registry before hardcoding — needs a
   registry check + grant.

## 3. Endpoint verification — BLOCKED from this container

The environment network policy denies CONNECT to external data portals at the
proxy gateway (verified: `services2.arcgis.com`, `data.ok.gov`,
`opendata.hawaii.gov`, `idh-be.iowa.gov`, `data.ct.gov` all 403). WebFetch is
routed the same way (403). **Only server-side Supabase edge functions can reach
these hosts** — which is how the 8 live Socrata sources fetch. Consequently:
- Investigation-gate step 1 ("re-confirm all endpoints live") and every wave's
  smoke test require **deploying a probe/ingest function and running it
  server-side** — i.e. a production action against `ycadmmngkdhvpcsrcuaq`.

## 4. Architecture decision (gate item #4) — RECOMMENDATION

**Keep the single multi-state edge function + per-state adapter modules.** It is
already exactly this. Wave 1 = add fetch-helper branches (ArcGIS FeatureServer,
CKAN `datastore_search`) alongside the existing Socrata client in `index.ts`, and
add per-state adapters + `LIVE_SOURCES` entries in `mappers.ts`. No new function
per state. Discrete functions would fragment telemetry (AUTO-178), the secret
gate, the chain/paging contract, and the resolve/score call — all of which the
shared function centralizes.

## 5. Scope reality for Waves 1–4

| Wave | States | Fetch shape | Buildability from here |
|---|---|---|---|
| 1 API drop-in | IA, WI, HI, OK (CT/OR/MD already live) | Socrata / ArcGIS / CKAN / CSV | Code buildable now; **verification needs prod deploy** |
| 2 Bulk file | TN, MN, TX, DC | Excel/CSV download + ArcGIS | Parser buildable; files can't be fetched from container |
| 3 Tier-B scrape | AL, CA, PA, MO, IL, NJ, MI, IN, KY, ID, NM, MT, CO, WA | HTML/portal scrape | Per-portal, can't iterate against live HTML from here; INF cap needs RPC change |
| 4 Tier-C PDF/FOIA | OH, LA, NV, SD, FL, MA, SC, WV, MS, AR, ME, AK, WY, ND, NC, NE, RI, VT, DE✓, NH, GA, VA, AZ | PDF/OCR/records-request | Largest + lowest yield; GA recipient names legally suppressed (aggregate-only); several FOIA-only (no automatable source) |

Waves 3–4 are ~35 states of bespoke scrapers/PDF-OCR that (a) can't be validated
against live responses from this container and (b) would, if shipped untested,
risk exactly the fabricated/over-confident data the task's cross-cutting rules
forbid. They should be scoped and built incrementally with server-side iteration,
not mass-authored blind.
