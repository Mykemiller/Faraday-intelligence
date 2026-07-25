# ISpyaDC — Phase 0: 500-Site Historical Calibration Corpus (FAR-405)

Tier‑1 calibration corpus only. **No live monitoring, no Tier‑2/SpyMeSat, no
writes to `jw_facilities` / `jpas_attributes` / JDS.** All artifacts here are
additive/derived (see rollback).

Status: **investigation gates cleared; blocked on USGS M2M credentials** (see
`m2m-credentials-runbook.md`).

## Locked decisions (Myke, 2026‑07‑25)
- Corpus size: **500 sites**, fixed.
- Tier structure: Tier 1 = Landsat only; Tier 2 = SpyMeSat only; Ambassador drone
  out of scope.
- **Site vintage range: 2015–2025** (Myke overrode the original 2013–2019 /
  2025–2026 framing).
- **8 major ecoregions** for the stratification scheme (D2).
- Site mix (D1): **~60/40 favoring complete‑cycle sites** — recommendation
  accepted.
- Control‑parcel method (D3): **nearest‑neighbor** — recommendation accepted
  (rule below).
- Outcome-log schema (D4): **`ispyadc_calibration_log`** — name accepted; column
  schema proposed in `ispyadc_calibration_log.draft.sql`, **pending Myke sign‑off
  before `apply_migration`**.
- Credential storage (D5): **Supabase Edge‑Function secrets** (`USGS_ERS_USERNAME`,
  `USGS_M2M_TOKEN`) — not Vercel env.

## Investigation gate report (I1–I5, run 2026‑07‑25, all read‑only)

**I1 — Supabase connectivity + `jw_facilities` schema.** Connected to
`ycadmmngkdhvpcsrcuaq`. Confirmed columns: `lat`, `lng`, `capacity_mw`,
`operational_date`, `announced_date`, `status`, `geo_precision`, `external_ids`
(jsonb). **`construction_start_date` exists but is 0‑populated** — we cannot date
the *start* of a build internally, only `operational_date` (end) and
`announced_date`.

**I2 — existing `ispyadc_*` objects.** None. `information_schema.tables ILIKE
'ispyadc%'` returned empty. Clear to create (after D4 sign‑off).

**I3 — credential convention.** Edge functions read secrets via
`Deno.env.get("X_API_KEY")` (`SHOVELS_API_KEY`, `DC_HUB_API_KEY`,
`AIRTABLE_API_KEY`, …). No USGS/M2M/ERS secret exists yet → **first blocking
task**. Resolves D5 to the Supabase-secret placement.

**I4 — corpus feasibility (internal `jw_facilities`).** Read‑only counts:

| metric | value |
| --- | ---: |
| geolocated facilities (lat+lng) | 1,418 |
| with `operational_date` | 808 |
| **complete‑cycle positives, op. 2015–2020, geolocated** | **338** |
| **current‑phase positives, op. 2023–2025, geolocated** | **117** |
| with `construction_start_date` (geo) | **0** |
| with `announced_date` (geo) | 610 |
| status: permitted / operational / construction / acquisition | 951 / 808 / 421 / 103 |

Verdict: **PASS.** A 60/40 positive split (say ~250 positives → ~150
complete‑cycle / ~100 current‑phase) is covered by internal supply alone (338 /
117 available), with DC Hub (paid tier confirmed this session) and the 610
announced rows as supplement. **Two caveats carried into design:**
1. **Every `jw_facilities` row is `geo_precision = 'estimated'`** — geocoded
   centroids, not parcel‑verified. A 30 m Landsat AOI on an estimated centroid can
   miss the real footprint. → AOIs must be **buffered** (proposed ≥ 500 m radius)
   and/or parcel‑verified for the positives before calibration; recorded per‑site
   in the log.
2. **No internal build‑start date** → the labeled transition *window* for
   complete‑cycle sites is bounded by `announced_date` (start) and
   `operational_date` (end); current‑phase transition start comes from
   announced/permitted dates. Documented as a label‑quality field.

**I5 — land‑cover/ecoregion source.** No existing **vegetation** classification
in the codebase. The existing `jurisdiction_land_coverage` layer is **PAD‑US
public‑land tenure (ownership), not vegetation** — unsuitable for NDVI seasonal
baselining. D2's 8 strata therefore introduce a new source. **Recommendation:
EPA Level III Ecoregions** (85 CONUS regions → collapse to 8 DC‑relevant
super‑strata) as the primary stratifier, with **NLCD** land‑cover class as a
secondary within‑stratum split if a stratum is too heterogeneous. Registered as a
new `jw_data_source_registry` row when ingested (following the D3 pattern).

## Control‑parcel rule (D3, nearest‑neighbor)
For each positive site, select the nearest undeveloped parcel that:
1. lies within a bounded radius (proposed 5–25 km) of the positive,
2. shares the positive's **ecoregion stratum** (so seasonal phenology matches),
3. is **not** in `jw_facilities` at ANY status (operational/construction/
   permitted/**announced**/acquisition) — the announced/permitted filter is what
   prevents picking a parcel that *will* be developed and poisoning the "non‑event"
   label,
4. shows no NDVI step-change in the archive (a secondary, self‑consistent screen
   applied during the run).
Controls are labeled non‑events; 1:1 with positives unless a positive has no
qualifying neighbor (logged, not forced).

## Open sign-off items before any writes/external calls
1. **D4 schema** — review `ispyadc_calibration_log.draft.sql`, approve or amend,
   then it's applied via `apply_migration` (never `execute_sql`).
2. **M2M credentials** — runbook in `m2m-credentials-runbook.md`.
3. **GEE vs. M2M fork** — optional; see the runbook's last section. Only the
   pixel-fetch layer differs.

## Rollback
All Phase‑0 artifacts (thresholds, seasonal models, `ispyadc_*` tables) are
additive/derived. No existing table is modified; no JPAS/JPS/JDS write path is
touched. New tables drop cleanly with zero downstream dependency. If I4 supply had
failed the power test we'd halt rather than build an under‑powered corpus — it
passed, so we proceed on credentials.
