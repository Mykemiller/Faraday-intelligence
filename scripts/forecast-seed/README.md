# Forecast Layer — schema + Priority-Ingest seed

Builds and seeds the Faraday **forecast layer**: three tables + one view that make
vintage-over-vintage forecast revisions queryable with real, cited data.

- **Supabase project:** `ycadmmngkdhvpcsrcuaq`
- **Schema migration:** `create_forecast_source_layer` (applied via Supabase `apply_migration` — the only DDL write path)
- **Objects:** `forecast_sources`, `forecast_vintages`, `forecast_observations`, view `forecast_revisions`

## Files (run in order)

| # | File | Purpose | Writes |
|---|------|---------|--------|
| 00 | `00_mirror_forecast_sources.sql` | Mirror all 34 Airtable Forecast Source Registry records (base `appxfti7VuoHYUeu6` / table `tbl5f2ZnRGBtRwor0`) into `forecast_sources`. `source_id` = stable kebab-case slug. | upsert on `source_id` |
| 01 | `01_seed_pjm.sql` | PJM Long-Term Load Forecast — vintages 2022–2025; Dominion (DOM) zone data-center load @2037. | see idempotency |
| 02 | `02_seed_texas_swp.sql` | Texas State Water Plan — 2022 + Draft 2027; capital cost, needs, supply. | see idempotency |
| 03 | `03_seed_eia_aeo.sql` | EIA Annual Energy Outlook — AEO2023 + AEO2025; total & commercial/server electricity. | see idempotency |
| 04 | `04_seed_wri_aqueduct.sql` | WRI Aqueduct 4.0 future-annual — 8 primary DC-market basins × 3 scenarios × 3 years (72 obs). | see idempotency |
| 05 | `05_validation.sql` | Read-only post-seed checks (row counts, both revision stories, soft-FK warning list, unit guard). | none |

## Idempotency (natural keys)

- **Vintages:** `insert … on conflict (source_id, vintage_label) do update …`
- **Observations:** `delete from forecast_observations where source_id = <this source> and method='manual'` then insert.
  Re-running any file produces zero duplicates. No unique **constraint/index** is added — the approved DDL is applied verbatim; the soft FK on `attribute_code` is enforced as a **warning-level** check (query #5 in `05_validation.sql`), not a trigger.

## Jurisdiction mapping rule

`forecast_observations.jurisdiction_id` (→ `jurisdictions.id`, nullable) is set **only** where the source is
natively sub-national **and** a crosswalk already exists in the DB:

- **WRI Aqueduct** basins → jurisdictions via the existing `jurisdiction_water_stress` crosswalk (Aqueduct `pfaf_id`). All 72 obs are mapped.
- **PJM** DOM *zone* spans many VA jurisdictions with no 1:1 map → `jurisdiction_id` NULL (scope = iso-zone).
- **Texas SWP** (state) and **EIA AEO** (national) → `jurisdiction_id` NULL (scope = state / national).

No crosswalks were invented.

## Provenance

Every observation's `notes` cites the source page / table / dataset field. Zero fabricated numbers —
values that could not be located were omitted and logged (see PR description). WRI values come from
`Aqueduct40_future_annual_y2023m07d05.csv` (fields `{scen}{yr}_ws_x_s/_x_c/_x_l`).

## Canonical revision stories (query #2 and #3)

- **PJM Dominion-zone DC load @2037:** 5,700 MW (2022) → 20,000 MW (2025) = **+14,300 MW**.
- **Texas SWP total capital:** $80B (2022) → $174B (Draft 2027) = **+$94B**.

## Execution

DDL via Supabase `apply_migration`; data files executed against the project (MCP `execute_sql` / `psql`).
Branch + PR only — no direct production deploys.
