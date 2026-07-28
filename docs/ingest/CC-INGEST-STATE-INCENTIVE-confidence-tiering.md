# State-incentive confidence tiering (per-source)

_2026-07-26. Migration `0036_cc_state_incentive_confidence_tiering.sql`._

## Why

`fn_state_incentives_resolve_and_score()` stamped **SRC / 0.85 / primary** on
every resolved disclosure's INC-01..05, hardcoded. That's right for Waves 1–2
(all first-party government APIs) but blocks Waves 3–4: scraped-HTML / PDF /
estimated sources must land at a **lower** confidence, or they'd masquerade as
primary disclosure. This is the prerequisite the earlier waves flagged.

## Model

Confidence is now read **per source** from the source's `jw_data_source_registry`
row, not hardcoded:

| registry `confidence_cap` | multiplier | meaning |
|---|---|---|
| `VRF` | 0.95 | independently verified |
| `SRC` | 0.85 | first-party primary disclosure (Waves 1–2) |
| `INF` | 0.60 | inferred from a structured scrape |
| `EST` | 0.40 | estimated / judgment-based extraction |
| _(unregistered)_ | 0.40 | conservative default — never over-claims |

New `jw_data_source_registry.source_level` column (`primary` | `aggregator`)
carries the Good Jobs First / Upjohn precedence.

**Aggregation across sources** (a county fed by more than one feed): the INC
attribute takes the **highest-confidence contributor's** tier/multiplier, and
`source_level = 'primary'` if *any* contributor is primary (an aggregator never
demotes a primary source). Values (award totals, types, programs) still aggregate
across all of the jurisdiction's disclosures as before.

## No regression (proven read-only before apply)

Every one of the 12 live sources is `SRC` / `primary`, so the new function yields
**SRC / 0.85 / primary** for all **244** currently-scored jurisdictions —
identical to the pre-change `jpas_attributes`. Confirmed by replaying the new
`conf → agg → scored` logic as a read-only SELECT and diffing against the live
INC rows (244 = 244, same tuple). Behavior only diverges once a non-SRC source is
ingested.

## Apply status

**APPLIED to prod 2026-07-28** (Myke-approved via #44 merge). Re-scored all 9
live states through the new fn: 1,220 INC attrs / 244 jurisdictions stayed
SRC/0.85/primary — byte-identical to pre-apply. New INF/EST sources now score
correctly. Both migration statements are re-run-safe. Rollback: restore the
prior all-SRC function body + drop the `source_level` column.

## How a Wave 3–4 source uses it

1. Register the source in `jw_data_source_registry` with the honest
   `confidence_cap` (`INF`/`EST`) and `source_level`.
2. Add its adapter + `LIVE_SOURCES` entry (or a bulk path) as usual.
3. On ingest + resolve, its jurisdictions' INC-* attributes are stamped at the
   registered tier automatically — no code change to the RPC per source.
