# CC-RSC-STRANDED-INDUSTRIAL-1.0 — Apply + deploy validation results (2026-07-23)

All three landing migrations applied and all three pollers deployed ACTIVE to
`ycadmmngkdhvpcsrcuaq`. Live pulls invoked server-side via `cron_http_post`
(`cron_caller_token`, whose SHA-256 matches the pollers' fallback). Sessions can't
reach the source hosts directly, so `pg_net` from Postgres is the invoke path.

| Poller | Status | Evidence |
|---|---|---|
| **shovels-permit-history** | ✅ **VALIDATED** | Harris County (48201) → geo_id `60WvITp61BU` via `/counties/search`; crawled `/permits/search`; **3,000 rows landed**, `lag_days` computed. Hit the record cap newest-first (recent months); full window on an uncapped run. |
| **tri-facility-sync** | ✅ **VALIDATED** | RY2023 stream → **6,000+ rows landed**; **100% county FIPS**, coords on 87%, **~10% flagged `fac_closed_ind=1`** (closed facilities — the core signal). |
| **eia-retired-sync** | ⚠️ **BLOCKED (env)** | Auth/egress/URL-resolution all work; the 860M workbook is **~13.2 MB** and SheetJS OOMs the edge worker (`WORKER_RESOURCE_LIMIT`) even parsing only the Retired sheet. Normalization logic passed offline unit tests. |

## Contract facts discovered live (were PROVISIONAL, now confirmed)
- **Shovels**: county geo_id is an opaque token, resolved via `GET /counties/search?q=<name>` (fuzzy → match on name+state). Permit search: `GET /permits/search?geo_id=&property_type=&tag=&permit_from=&permit_to=&size=`, cursor pagination via `next_cursor`. Building area field is `property_building_area`.
- **TRI**: `tri_facility` has `state_county_fips_code` (5-digit), `epa_registry_id` (FRS spine), `pref_latitude/longitude`, and **`fac_closed_ind`** — but **no NAICS** (lives on `tri_reporting_form`; industry classification is a downstream enrichment).
- County name↔FIPS resolves via `jurisdictions` (level='county'); `ref_counties` does not exist.

## EIA remaining work (pick one)
1. Parse the 860M xlsx in a higher-memory runtime (Node/Vercel fn or GitHub Action) → POST rows to `{mode:"run","rows":[...]}` in chunks (the seed path is validated).
2. Pre-convert xlsx→CSV once and have the poller fetch CSV (no full-zip inflate).
3. Raise the edge function memory allotment if the plan allows.

## Health logging
`automation_health_log` real columns are `success` / `artifacts_found` / `errors` /
`notes` (+ `run_started_at`/`run_completed_at`) — the pollers were corrected to match.
