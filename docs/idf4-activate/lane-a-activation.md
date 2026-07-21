# CC-IDF4-ACTIVATE-1.0 — Lane A activation (build + test evidence)
Run date: 2026-07-21 · Branch `claude/idf4-activate-coverage-dgeuf2` · Supabase `ycadmmngkdhvpcsrcuaq`

## What this PR does
Rosters the **26 `[crawler]` D#.# whitespace sub-domain routines** (AUTO-138, 139, 141-157,
159-163, 167, 172) into the shared `faraday-crawl` edge function via a new `LANE_A_ACTIVATION`
array, and wires it into `AUTOMATIONS`. Each target passed a **real bounded (cap-4) healthy-run
test** before its Airtable Registry Status was flipped Designed -> Active (2026-07-21).

> **Deploy note (the one remaining mechanical step):** the live daily fleet begins crawling these
> 26 sub-domains at the next **07:00 UTC `faraday-crawl-daily` cron after this PR is merged and
> `faraday-crawl` is redeployed**. Test evidence below was produced by an isolated
> `faraday-crawl-canary` harness (identical artifact + health-log contract, `PER_AUTO_CAP=4`), so
> the merge -> redeploy is low-risk. Per repo governance ("never flip Status before the dry run
> succeeds") the dry run is the canary run recorded in `automation_health_log`.

## AUTO-138 — root cause + bound (Lane 0, fix-first)
The registry-Designed **AUTO-138 (D7.2 Immersion Cooling `[crawler]`)** was reported as a runaway
(~1.14M new/14d). **Root cause: an `auto_id` mislabel, not an immersion-cooling runaway.** Every
`automation_health_log` row tagged `auto_id='AUTO-138'` was written by `ingest-sdwis-baseline`
(SDWIS drinking-water bulk backfill) and `ingest-bls-labor` (crawler_id
`ingest-sdwis-baseline_v1.1..1.4` / `ingest-bls-labor_v1.0/1.1`; notes `"sdwis baseline: … mode=
bulk_rest … next_offset=done"`). That bulk backfill **already completed and stopped** (last run
2026-07-09/-11, `next_offset=done`). The real D7.2 immersion crawler had **never run** (0 artifacts
tagged D7.2). **Bound applied:** rostered at `PER_AUTO_CAP=4`; first test run produced exactly
**4 found / 4 new** with 4 real D7.2 article artifacts. **Myke follow-up:** relabel the SDWIS/BLS
ingest health rows off `auto_id='AUTO-138'` (separate function change, out of this wave).

## Test evidence (live `automation_health_log`, 2026-07-21 ~13:35-13:40 UTC)
All 26: `success=true`, `artifacts_found = artifacts_new = 4` (bounded at cap), crawler_id
`AUTO-0NN_v1.0`, notes `"faraday-crawl v1.1 batched (CC-IDF4-ACTIVATE canary)"`; 26/26 sub-domains
have artifacts tagged their `D#.#` (`ifs_domains`); net._http_response 200.

138 D7.2, 139 D7.3, 141 D9.1, 142 D9.2, 143 D9.3, 144 D9.4, 145 D1.1, 146 D1.2, 147 D1.3,
148 D1.6, 149 D2.1, 150 D2.2, 151 D2.3, 152 D2.4, 153 D2.9, 154 D10.1, 155 D10.2, 156 D10.3,
157 D10.5, 159 D4.5, 160 D6.3, 161 D11.1, 162 D11.2, 163 D11.6, 167 D14.7, 172 D8.3 — all 4/4.

## Change 1 — `supabase/functions/faraday-crawl/coverage-bridge.ts`
Insert `LANE_A_ACTIVATION` (26 AutoDefs) immediately before `export function mergeApproved`. Full
block is in the branch build artifact `docs/idf4-activate/coverage-bridge.LANE_A.ts`.

## Change 2 — `supabase/functions/faraday-crawl/index.ts`
```diff
- import { TIER1_ACTIVATION, TIER2_ACTIVATION, D3_SUBDOMAIN_ACTIVATION, mergeApproved } from "./coverage-bridge.ts";
+ import { TIER1_ACTIVATION, TIER2_ACTIVATION, D3_SUBDOMAIN_ACTIVATION, LANE_A_ACTIVATION, mergeApproved } from "./coverage-bridge.ts";

  const AUTOMATIONS: AutoDef[] = mergeApproved(
    mergeApproved(
-     mergeApproved(BASE_AUTOMATIONS, TIER1_ACTIVATION),
-     TIER2_ACTIVATION,
+     mergeApproved(
+       mergeApproved(BASE_AUTOMATIONS, TIER1_ACTIVATION),
+       TIER2_ACTIVATION,
+     ),
+     D3_SUBDOMAIN_ACTIVATION,
    ),
-   D3_SUBDOMAIN_ACTIVATION,
+   LANE_A_ACTIVATION,
  );
```
A backward-compatible `POST {"only":["AUTO-NNN",...]}` scope filter was also added to the handler
for bounded testing (no body / empty body preserves the full-fleet cron behaviour).

## Holds (unchanged this run)
- **Lane B (build, not crawler-roster)** — primary_source 140 (D7.4), 158 (D4.6); cowork 169 (D8.4),
  170 (D8.5), 171 (D14.1); claude_routine 173 (D5.3), 174 (D5.4), 175 (D18.3). **168 (D8.2, Approved)**
  = dry-run only. Need bespoke scheduled-routine builds, not the faraday-crawl roster.
- **Lane C gated** — 129/130/131/132/133 (JW gates; 130 -> JPS weight-lock + FAR-29, escalate),
  186 (Cleanview ToS), 198 (`source_type` enum DDL + FCC/license).
- **Lane D facility ingest** — 185 (ATLAS 18,110 rows), 187 (Epoch top-100) -> jw_facilities.
- **Lane E out-of-wave** — 053,054,055,056,057,058,128,179.
- **Ambiguous (confirm scope)** — 051,052,059,120: pre-scaffold Domain-level crawlers, not D#.#.

## Coverage delta
Sub-domains with a dedicated Active crawler (D#.# artifact tags, 14d): **65 -> 91** (of 116).
AUTO-060->119 verified Active (13/13 healthy runs, last 2026-07-21 07:00 UTC) — corrects the stale
"AUTO-060->119 dormant/Designed" claim in the Notion Coverage Matrix.
