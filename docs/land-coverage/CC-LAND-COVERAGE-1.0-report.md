# CC-LAND-COVERAGE-1.0 — Delivery Report

**Target:** Supabase `ycadmmngkdhvpcsrcuaq`
**Date:** 2026-07-24
**Scope:** Land-tenure *coverage* signal + federal anchor registry scaffold.
**Not in scope (held):** any JPAS scoring change, any RSC attribute registration, any parcel-level tenure model.

---

## A. What shipped

Four named migrations (`apply_migration`; mirrored to `supabase/migrations/0030–0033`).
No `execute_sql` DDL.

| # | Migration | Object | Rows |
|---|---|---|---|
| 0030 | `create_jurisdiction_land_coverage` | `public.jurisdiction_land_coverage` (table) | **0** (schema only — see §E) |
| 0031 | `create_federal_anchor_sites` | `public.federal_anchor_sites` (table) | — |
| 0032 | `seed_federal_anchor_sites` | seed | **26** |
| 0033 | `register_land_tenure_data_sources` | `public.jw_data_source_registry` | **+3** |

**`jurisdiction_land_coverage`** — modeled on `jurisdiction_water_stress`. PK `(jurisdiction_id, dataset_version)`, FK → `jurisdictions(id)`. Columns: `public_land_fraction`, `federal_fraction`, `state_fraction`, `tribal_fraction`, `land_area_sqmi`, `fee_only` (default true), `join_method`, `coverage` (default `covered`), `source_county_fips`, `source_key`, `dataset_vintage`, `hash`, `loaded_at`. Constraints: `public_land_fraction` ∈ [0,1]; component sum ≤ `public_land_fraction` + 0.001; per-component [0,1]; `join_method ∈ {padus_county_direct, inherited_county}`. Indexes on `source_county_fips`, `join_method`. **No `multiplier`/weight column** — unlike `jurisdiction_water_stress`, this table can never feed a score (§6.3).

**`federal_anchor_sites`** — PK `id uuid`; `site_key` unique (idempotent re-seed); factual `site_category`/`program`/`operator`; `state`/`state_fips`/`county_name`/`county_fips`; `jurisdiction_id` FK → `jurisdictions(id)`; `latitude`/`longitude`; `source_key`; `source_note`; `review_status` default `pending` (CHECK ∈ {pending, qualified, rejected, superseded}). Indexes on `state`, `jurisdiction_id`, `review_status`.

**RLS:** both tables `ENABLE ROW LEVEL SECURITY` with **no policies** (deny-all; service role bypasses) — matches `jurisdiction_water_stress` / `jw_data_source_registry` / the Live-Agent estate convention. Not anon-readable. Security advisor: the only lints on the two new tables are the intended `rls_enabled_no_policy` **INFO** — no new WARN/ERROR.

## B. Source path taken

- **D2 anchor roster — SHIPPED.** Public DOE/NNSA site rosters (`energy.gov/national-laboratories` + NNSA nuclear-security-enterprise sites). Mechanical facts only. Registered `doe:anchor-roster` (public domain, U.S. federal).
- **D1 tenure source — Path A identified, ingest BLOCKED (see §E).** The intended distribution is PAD-US **county-level Summary Statistics Tabular Data (CSV)** — a genuine Path A (pre-aggregated county summary; no PostGIS polygon ingest). It breaks down by **Manager Type** (Federal/State/Tribal/Local/Private) and by **Category** (Fee vs Easement vs Designation…), so fee can be isolated from easement and easements excluded from `public_land_fraction`. Vintage target PAD-US 4.x. Licence: public domain (USGS GAP). **It could not be downloaded from this environment** — the USGS/ScienceBase/data.doi.gov/ArcGIS hosts are all denied by the session egress policy (allowlist is GitHub-only), and no complete authoritative county-level mirror exists on GitHub. Registered as `usgs:padus` with `feed_status='pending-ingest'`.
- **D3 TRI backfill — SHIPPED.** `tri:facilities` registers the live-but-unregistered EPA TRI feed already in `tri_facility_history` (284,000 rows / 27,918 distinct FRS IDs, latest year 2025).

## C. Coverage results

**Not yet available — `jurisdiction_land_coverage` is 0 rows.** D1 population is blocked on the PAD-US ingest (§E). The `public_land_fraction` distribution (p50/p95/max), the top-10 counties, the national federal/state/tribal split, and the direct-vs-inherited-vs-null inheritance audit will be produced by the loader run once the CSV is available. **No partial/proxy fractions were written** — a tribal-only fraction (the one component computable in-DB, via `census_aiannh_geometries` × county geometry) would badly understate public land in western counties and mislead, so it was deliberately not loaded.

## D. Invariant verification (§5)

| Check | Before | After | Match |
|---|---|---|---|
| `select count(*) from public.jpas_attribute_registry` | **66** | **66** | ✅ |
| `md5(string_agg(id … jpas_score … current_score …))` over `jurisdictions` | `addd57af49ebeef15ac3e9435ebfc3ec` | `addd57af49ebeef15ac3e9435ebfc3ec` | ✅ |

Additional: `jurisdictions` row/score counts unchanged (39,507 rows; 39,505 jpas_score; 20,130 current_score; 431 jds_score). Zero writes to any scoring column, breakdown, recompute function, or cron.

## E. Anomalies / STOP conditions hit

1. **§4 STOP — D1 tenure ingest blocked by egress policy.** The authoritative PAD-US hosts (usgs.gov, sciencebase.gov, data.doi.gov, services*.arcgis.com) and Census/DOI mirrors all return proxy 403 (org egress denial); WebFetch is bot-blocked on the gov portals; the reachable allowlist is GitHub-only, and no complete authoritative PAD-US county-summary mirror exists there. Per policy this was **not routed around**. D1 shipped as schema + registry entry (`feed_status='pending-ingest'`); population is deferred to a run with source access. This is the one place the deliverable is intentionally incomplete.
2. **`public_land_fraction > 0.95` list** — N/A (0 rows). Expected once loaded: several NV/UT/AK counties genuinely exceed this; they are correct, not errors.
3. **Multi-county anchor sites** — INL (5 counties), NETL (3 sites), Fermilab (DuPage+Kane), SRS/Hanford (multi-county) were pinned to a single primary county with the spread recorded in `source_note`; `jurisdiction_id` resolved to that primary county. All 26 rows resolved (0 unresolved). Coordinates left null for INL and NETL (multi-site); operator left null for the 4 EM cleanup sites (contractor churn) rather than assert stale names.

## F. Myke actions

1. **Anchor-site qualification pass** — **26 rows pending** (17 DOE national labs incl. SRNL; 4 NNSA production sites; 1 NNSA test site (NNSS); 4 DOE-EM cleanup sites). CC assigned no `anchor_type`/`security_tier`/suitability. **Recommendation:** review and set editorial qualification; flip `review_status` off `pending` as you qualify each.
2. **RSC tier-weight confirmation** — populated tier weights sum to **93.0**; RSC is the unpopulated remainder. **Recommendation:** confirm whether the reserved RSC weight is **7.0** (completing 93.0 → 100.0). Inferred from the weight sum, asserted nowhere in the schema. This prompt registered **no** RSC attribute and left the registry count at 66.
3. **Source licensing** — all three registered sources are U.S.-federal public domain; no licensing blocker. **Recommendation:** none required.
4. **D1 ingest unblock (go/no-go on population)** — **Recommendation:** pick one: (a) whitelist `usgs.gov` + `www.sciencebase.gov` in the session egress policy so a follow-up run can `curl` the PAD-US county Summary Statistics CSV; **or** (b) drop the CSV into the `Faraday-intelligence` repo (GitHub is reachable) for a follow-up run to load. Then run the loader (fips_type=county direct + `containing_county_fips` inheritance). After that, go/no-go on `CC-LAND-CONDITION-1.0`.

## G. What I did NOT do (§6 boundaries — each held)

- **6.1** No RSC attribute registered. `jpas_attribute_registry` = 66 before and after (checksum-verified). JPAS denominator untouched; no re-rank.
- **6.2** No scoring writes: `jpas_score`/`jpas_breakdown`/`jds_score`/`jds_breakdown`/`current_score`/`confidence_score`, recompute fns, crons — all untouched (jurisdictions checksum identical).
- **6.3** `public_land_fraction` is a coverage field only — no `multiplier`/weight column exists on the table; it cannot make any jurisdiction score worse.
- **6.4** No editorial qualification — every `federal_anchor_sites` row is `review_status='pending'`; no `anchor_type`/`security_tier`/suitability. `site_category`/`program` are the roster's own factual descriptors.
- **6.5** No DOD seed — DOE/NNSA only; MIRTA/mission-compatibility deferred.
- **6.6** No subscriber-facing surface — no API route, no storefront view, no Airtable mirror. RLS deny-all.
- **6.7** No parcel-level tenure model — no `ref_land_tenure`, no `land_parcel_jurisdiction_xref`, no FLPS.
