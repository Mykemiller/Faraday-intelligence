# CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — Wave 2 run report

_2026-07-26. Wave 2 = the "bulk file (download + parse)" wave: TN / MN / TX / DC._

## Outcome: 1 of 4 ingested (DC); 3 documented-pending with hard blockers

Wave 2's premise (four downloadable bulk files) only partly survived live probing.
Every source was probed server-side (Postgres `pg_net`; binary `.xlsx` via a
throwaway SheetJS edge probe). The honest result:

| State | Source | Probe finding | Disposition |
|---|---|---|---|
| **DC** | Business_Incentives ArcGIS MapServer **layer 26** (TIF areas) | ✅ live JSON API; `NAME`, `INITIAL_AUTHORIZATION` ("$50.0 million" — **dollar figure is in the layer, no OCFO scrape needed**), `TYPE`, `YEAR_AUTHORIZED`, `MATURITY_YEAR`, `DC_CODE` | **INGESTED** — 13 TIF areas, all 13 resolved to the DC jurisdiction → INC-01..05 |
| **TN** | OpenECD FastTrack `.xlsx` | href valid (`OpenECD_Contracted_7-15-2026.xlsx`), but the **tn.gov `/content/dam` CDN resets the TLS connection** from the Supabase edge runtime (`os error 104` at Connect — IP/fingerprint block, headers don't help) | **PENDING** — parser ready; needs a reachable mirror / fetch proxy |
| **TX** | Comptroller Ch.313/403 | the only `.xlsx` on the Ch.313 page is a generic **report index** (Table of Contents), not recipient data; real Ch.313 data is per-agreement | **PENDING** — reclassified to Wave-3/4 scrape (no clean bulk file) |
| **MN** | DEED Business Subsidy / MBAF Excel | DEED site is **JS-rendered**; every candidate report path soft-404s → direct `.xlsx` URL not machine-discoverable | **PENDING** — needs the direct MBAF export link |

Rationale for pending (not built): TN/MN/TX real field names could not be read
(fetch blocked / URL unknown), so writing their adapters would have meant guessing
column names — the exact fabrication risk the ticket forbids. The SheetJS bulk
parser itself is **proven working** in the edge runtime (it parsed the TX index
workbook cleanly), so these are reachability/URL blocks, not capability gaps.

## What shipped

- **DC adapter** `mapDcTif` (mappers.ts), reusing the existing `arcgis` fetch path
  (no new protocol code). New helper **`parseUsdScaled`** turns "$50.0 million" →
  50000000 (rounds to kill float noise, e.g. $534.8M → 534800000 not …999.99994).
- **DC live** in `LIVE_SOURCES` (arcgis, layer 26). TN/MN/TX added to
  `PENDING_SOURCES` with the exact blockers above (stale duplicate `tn_openecd`
  pending removed).
- **Registry** migration `0035_cc_state_incentive_dc_registry.sql` (applied):
  `dc_tif_areas` row, confidence_cap SRC.
- **Tests** `test/incentive-mappers.test.mjs` — `parseUsdScaled` + `mapDcTif`
  against the real probed row (Verizon Center). `npm test` green (59/59).

## Production run (project ycadmmngkdhvpcsrcuaq)

- Deployed fn **v13** (DC) → **v14** (parseUsdScaled rounding).
- Seed (`{states:["DC"]}` via the weekly invoker): **13 rows, all 13 resolved →
  1 jurisdiction (District of Columbia)**. Spot-check: Nationals Park $534.8M
  (2003–2036), The Wharf $198M TIF, Convention Center Hotel $187M TIF, The Yards
  $90M PILOT.
- Idempotency: re-run → 0 new. (After the rounding fix the 13 float-valued rows
  were deleted and re-seeded clean; `max(award)` = 534800000.)
- No new security-advisor findings (data-only + one registry row; no DDL).
- The one-off `state-incentive-xlsx-probe` edge fn was retired to an inert 410
  stub (MCP has no delete-function op; safe to delete from the dashboard).

## Net coverage after Wave 2

State-incentive live sources: **9 states** (NY, CT, MD, OR, DE, OK, WI, IA, **DC**).
DC adds 13 TIF disclosures and the DC jurisdiction to INC-01..05.

## To unblock the Wave-2 pendings

- **TN**: a reachable mirror of `OpenECD_Contracted_*.xlsx`, or a fetch proxy the
  edge runtime can use for tn.gov. Then TN is a fast add (probe → adapter).
- **MN**: the direct MBAF/Business-Subsidy `.xlsx` export URL (from a browser).
- **TX**: a per-agreement scrape (Wave-3/4), or a confirmed bulk agreement file if
  one is published elsewhere.
