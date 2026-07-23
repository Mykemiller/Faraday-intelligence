# CC-RSC-STRANDED-INDUSTRIAL-1.0 — Ingestion runbook

Three source-poller Edge Functions + one landing migration for the RSC (Real
Estate / Site) stranded-industrial feasibility layer. **Built to convention;
NOT deployed / NOT cron-wired by this PR** — same posture as `grid-buildout-sync`
(FAR-379). Nothing here touches a JPAS/JPS/JDS object, scoring function, or tier
weight. RSC stays at 0 registered attributes, weight 0.

## Artifacts
- `supabase/migrations/0018_rsc_stranded_industrial_landing.sql` — landing tables
  `shovels_permit_history`, `eia_retired_generators`, `tri_facility_history`
  (RLS service-role, content-hash idempotent).
- `supabase/functions/shovels-permit-history/` — RSC-05 velocity, Tier-1 county crawl.
- `supabase/functions/eia-retired-sync/` — EIA-860M "Retired" tab (2002+).
- `supabase/functions/tri-facility-sync/` — TRI facility-year presence (2014→).

## Why not run in-session
The Claude session's egress policy denies `api.shovels.ai`, `www.eia.gov`, and
`data.epa.gov` (proxy `403 to CONNECT`). Edge Functions run on Supabase infra with
server-side egress, so they are the correct execution surface. Each function also
accepts an **inline seed** (`rows`/`permits` in the POST body) so it can be
validated with a small real sample **before** any live fetch — do that first.

## Deploy + run order
1. `supabase db push` (applies 0018).
2. Deploy: `supabase functions deploy <name> --project-ref ycadmmngkdhvpcsrcuaq --no-verify-jwt`.
3. **Validate each with a seed** (`{mode:"run", rows:[…one real record…]}`) → confirm
   the landing row shape before live pulls. Header maps in `pure.ts` are PROVISIONAL.
4. Free pulls (no key):
   - EIA: `{mode:"run"}` (set `EIA_860M_URL` to the current vintage first).
   - TRI: loop `{mode:"run", year:Y}` for Y in 2014..2025.
5. Paid pull (Shovels, ~$300 Tier 1): set `SHOVELS_API_KEY` as an Edge secret, then
   `{mode:"run", tier:1}`. `MAX_RECORDS_DEFAULT` (120k ≈ $600) is a hard budget cap;
   validate one county (`{mode:"run", county_fips:"…"}`) before fanning out.

## Cost / coverage anchors (verified 2026-07)
- Shovels $0.005/record; Tier-1 (~500 infra-relevant counties × 11.8/county-yr × 10yr)
  ≈ 59k records ≈ **$300**. EIA + TRI free.
- Join spine: `county_fips` → `jurisdictions.fips_code` (county) /
  `containing_county_fips` (cousub/place).

## Open gates before this can score anything
- RSC-05 remains **unweighted** (register definition only; ABS ~98%). No tier-weight
  change without Myke.
- EIA retired = retired **grid** plants (≥1 MW), not captive industrial gen.
- TRI closure is **inferred** (last-reporting-year gap); false positives from
  threshold drop / chemical delisting. Never an SRC closure claim.
