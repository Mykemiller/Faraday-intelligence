# DC Inventory Entity Model — Sprint 1 run report

**Project:** Supabase `ycadmmngkdhvpcsrcuaq` · **Date:** 2026-08-08 · **Branch:** `claude/dc-inventory-entity-model-kxyd7b`

Replaces the flat, single-source `jw_facilities` table with a canonical entity + sourced-observation
model. One facility = one durable record. Every source claim = one dated, licensed, append-only
observation. Facility-Confidence Score (FCS) and publishability are **computed** from observations,
never stored as source-of-truth.

Sprint 1 is schema + backfill + scoring only. **No new source ingestion. No Shovels API calls.**

---

## 1. Migrations, in apply order

| # | Repo file | Prod version |
|---|---|---|
| 1 | `0044_dc_inventory_entity_model_core.sql` | `20260808211449` |
| 2 | `0045_dc_inventory_scoring_functions.sql` | `20260808211621` |
| 3 | `0046_dc_inventory_backfill_helpers.sql` | `20260808212112` |
| 4 | `0047_dc_inventory_backfill_lossless.sql` | `20260808212549` |
| 5 | `0048_dc_inventory_legacy_metadata_and_read_views.sql` | `20260808212846` |
| 6 | `0049_dc_inventory_jw_facilities_compat_view.sql` | `20260808213026` |
| 7 | `0050_dc_inventory_weekly_recompute_cron.sql` | `20260808213125` |
| 8 | `0051_dc_inventory_agreement_capacity_basis_fix.sql` | `20260808213228` |
| 9 | `0052_dc_inventory_compat_trigger_grant_hardening.sql` | applied 2026-08-08 |

Every migration went through `apply_migration` with a named migration; **no DDL via `execute_sql`**.
Rollback: `docs/dc-inventory/down.sql`.

> **Repo vs prod divergence, deliberate and the only one:** the prod version of migration 3 also
> carried a first-cut backfill body. Migration 4 supersedes it with a reset-and-rerun, so the repo
> file keeps only the two helper functions migration 4 still depends on. A fresh replay of
> `0044 → 0052` produces the identical end state.

---

## 2. Row counts

**Facilities minted: 1,418** (from 2,283 legacy rows). All `grain = 'site'` — no campus rollup in
this sprint.

| lifecycle_status | jds_layer | facilities |
|---|---|---|
| operational | L1 | 808 |
| construction | L2 | 304 |
| permitted | L3 | 203 |
| announced | L4 | 103 |

**Observations written: 26,669**, of which **4,325 are unresolved candidates** (`facility_id IS NULL`)
spanning **865 distinct lineages**.

| source_class | redistributable | observations | of which unresolved |
|---|---|---|---|
| operator_first_party | false | 10,178 | 0 |
| official_record | **true** | 6,920 | 6,920 |
| official_record | false | 4,181 | 0 |
| news | false | 2,660 | 0 |
| commercial_dataset | false | 1,652 | 0 |
| directory | false | 1,078 | 0 |

The only `redistributable = true` observations in the whole corpus are the Shovels permit rows —
`shovels:permits` is the one pre-existing registry row with `license_status = 'cleared'` — and every
one of them is an unresolved candidate attached to no facility. **Everything attached to a facility
today is non-redistributable**, which is why `publishable` is 0 (see §3).

`dc_facility_identifiers`: 1,418. `dc_facility_merges`: 0.

### Rule 3 — the generic-permit exclusion

**Exact match rule applied** (structural, not a name regex):

```sql
fn_dc_legacy_source_key(source_name) = 'shovels:permits'
AND lat IS NULL AND lng IS NULL
AND operator IS NULL AND developer IS NULL
AND coalesce(external_ids, '{}'::jsonb) = '{}'::jsonb
```

**Count affected: exactly 865** — the entire Shovels seed. These land as observations with
`facility_id = NULL` and mint **no** facility. No placeholder facilities were created to preserve
the headline number.

A name-based cross-check was run and is why the structural rule was chosen instead. A
generic-permit-language regex (`^(commercial development|new construction|new building|electrical|
tenant |construct|install|…)` plus `(permit|square feet|sq ft|scope of work|per plans)` plus
`length > 60`) matched **739 of 865**. The remaining **126** were read by hand — every one is also
permit work-description prose, not an identified subject: *"New warehouse"*, *"Full wiring"*,
*"J. Crew- signage"*, *"200 amp service"*, *"Data center"*, *"Aligned data centers"*, *"Temp power
service."* A lexical rule would have minted 126 junk facilities, so the structural test (which is
also what the source data actually supports: 0/865 carry coordinates, an operator, a developer or an
external id) is the rule of record.

**The headline inventory count falls from 2,283 to 1,418.** That is expected and approved.

---

## 3. FCS distribution and publishability

| Band | Range | Facilities |
|---|---|---|
| Identified | 0–19 | 190 |
| Suspect | 20–39 | 922 |
| Preliminary Confirmation | 40–59 | 306 |
| Confirmed | 60–84 | 0 |
| Validated | 85–100 | 0 |

Only three distinct scores occur, because every facility currently has **exactly one lineage**:

- **0** (190) — news-only sources (DCD, DC Frontier, Bisnow). The news cap holds: 0 from terms (a)
  and (b), and nothing to agree with.
- **28** (922) — one non-news, non-official lineage: `a18 + d10`.
- **43** (306) — one official-record lineage: `a18 + b15 + d10`.

Term (e) contributes 0 everywhere because **every coordinate came in at `geo_precision = 'estimated'`**
per rule 4. Nothing was upgraded to `verified`; that is Sprint 3.

### `publishable = true` count: **0**

**Stated plainly: zero facilities are publishable, and that is the correct Sprint 1 outcome.** It
follows from two independent facts, either of which alone would produce it:

1. No facility has ≥3 distinct non-news lineages — the legacy table carried exactly one source per
   row, so the model correctly reports one lineage per facility.
2. All 213 newly-registered sources are `license_status = 'unreviewed'` → `redistributable = false`,
   and the publishability gate excludes them by design.

Publishability becomes reachable when multi-source ingestion lands (Sprint 2+) **and** the licence
review in §7 is done. Neither is a code change.

---

## 4. Sources with no `source_registry` row

**213 of 214** distinct `source_name` values had no registry row — by `name` or by slug, the match
rate against the existing 10,783-row registry was **zero**. Each was minted with `status='registered'`,
`license='unreviewed'`, `license_status='unreviewed'`, `countable=false`, under the `dcinv:` namespace.
No licence was guessed and no existing registry row was modified.

| source_class | distinct source names | legacy rows |
|---|---|---|
| operator_first_party | 36 | 727 |
| official_record | 171 | 306 |
| news | 3 | 190 |
| commercial_dataset | 1 | 118 |
| directory | 2 | 77 |
| **total** | **213** | **1,418** |

The 214th, `Shovels Permits (seed)`, resolved to the **pre-existing** `shovels:permits` row
(`license_status='cleared'`) — the only alias in the mapping, and it is inverted exactly in the
compatibility view.

Largest by row count: Equinix IR (97), Google IR (65), CyrusOne IR (58), Digital Realty IR (53),
DataBank IR (50), Meta IR (44), CBRE Research (118), DCD (93), DC Frontier (76), DC Map (62).
The remaining ~170 are county/city Planning, Assessor, Recorder, Register and CAD offices at 1–10
rows each.

**The STOP threshold was not breached**: 0% of observations failed to resolve a `source_key`
(threshold was >10%).

---

## 5. Unit tests

`test/dc-inventory/fcs-unit-tests.sql` — **6/6 PASS**, all fixtures rolled back (verified: 0 rows
left in `dc_facilities` matching `FDC-TEST%`, 0 `test:%` registry rows).

| # | Case | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | News-only facility (3 agreeing news lineages) | score ≤ 39 | **5 / Identified** | PASS |
| 2 | Single-source facility | 43 = a18+b15+c0+d10+e0 | **43 / Preliminary Confirmation** | PASS |
| 3 | Three sources, one official record | 80, publishable **true** | **80 / Confirmed / true** | PASS |
| 4 | Three sources, one licence-blocked | publishable **false** | **80 / Confirmed / false** | PASS |
| 5 | Capacity on **differing** bases | 70 (capacity not penalised) | **70** | PASS |
| 6 | Control: capacity conflict on the **same** basis | 62 (penalised) | **62** | PASS |

Cases 3 and 4 together are the point of the model: a facility can score **Confirmed (80)** on
internal evidence and still be **unpublishable**, because one of its three lineages is licence-blocked.

Case 5 caught a real defect. The first cut of term (c) put an attribute in the denominator whenever
any lineage asserted it, which silently penalised the differing-basis case the ticket says must not
be penalised. Fixed in migration `0051`: an attribute only enters the denominator when ≥2 lineages
make a **comparable** claim, where capacity comparability requires the **same** `capacity_basis`.
Case 6 is the control proving a genuine same-basis conflict is still penalised.

---

## 6. `jw_facilities` as a view — equivalence proof

`jw_facilities` (table) → renamed `jw_facilities_legacy_20260808`, **retained, not dropped**.
`jw_facilities` is now a view over the observation model.

**In-migration gate (would have rolled the migration back on any mismatch):**

- Column set and **ordinal order**: identical, **35 / 35**
- Row count: **2,283 view / 2,283 legacy**
- Value equality, both directions (`EXCEPT ALL` each way): **0 rows only in view, 0 only in table**

So the view is **cell-for-cell identical** to the legacy table. `jw_briefing_inputs()` was
re-executed against it afterwards and returns successfully.

### Why the view is value-exact rather than a projection of `dc_facility_current`

This is the one deliberate deviation from the ticket's letter, and it was made to satisfy the
ticket's own STOP condition.

`jw_facilities` is read by **`jw_briefing_inputs()`**, by the **live daily cron
`jw-state-jds-rollup`** (03:20 UTC, jobid 21), by **`jw-facility-health-check`** (05:00 UTC, jobid 17,
which keys on `created_at`), by `jw_brief_map_geojson` and by `inference_pass4/5`.

`dc_facility_current` deliberately drops the 865 unresolved candidates and re-derives
`jurisdiction_id` at **county** tier per rule 6, whereas the legacy join sat at **metro** tier for all
1,418 identified rows (and place/county for the 865). Projecting it would have changed what all of
those consumers see — which is exactly the ~29-hour full re-fingerprint of ~39.5k jurisdictions the
ticket names as a STOP condition (FAR-377 precedent). It also would have changed the state JDS
rollup nightly.

To make the shim exact without contaminating the canonical model, three legacy values are carried as
their own clearly-labelled observations — `legacy_jurisdiction_id`, `legacy_created_at`,
`legacy_updated_at`. **`dc_facilities.jurisdiction_id` never reads them**; it is derived fresh by
county-level PostGIS spatial join, which resolved **1,418 / 1,418** coordinate rows.

Two further compatibility findings:

- **`jw_shovels_apply_jds_candidates()` INSERTs into `jw_facilities`.** A view is not insertable, so
  an `INSTEAD OF INSERT` trigger routes those writes into the observation model, applying the same
  rule 3 test (an unidentified permit still mints no facility). Without it that function would have
  started failing.
- **`jds_status` and `v_idf_d14_facilities`** bind to the table by OID and therefore followed the
  rename onto `jw_facilities_legacy_20260808`. Safe while nothing writes there; flagged for Sprint 2.

---

## 7. MYKE ACTIONS

Ordered by how much they block.

1. **Capacity basis for the 1,315 legacy `capacity_mw` values.** The legacy column records **no
   basis anywhere** — not a column, not the notes, not the registry. Writing
   `attribute='capacity'` would have required inventing one of `it_load` / `critical_it` /
   `gross_utility` / `contracted` / `announced_total`, which is exactly what the `capacity_basis`
   CHECK exists to prevent. The numbers are preserved verbatim under
   `attribute='capacity_unspecified_basis'`, excluded from scoring and from `dc_facility_public`.
   *Recommendation: rule them `announced_total` if the seed came from press/IR announcements — one
   UPDATE re-stamps them as real capacity claims. Do not let them reach a subscriber surface until
   then.*

2. **Licence review queue: 213 unregistered sources, all `unreviewed` → all non-redistributable.**
   This is currently the binding constraint on publishability, more than source count is.
   *Recommendation: review the 36 operator IR sources first (727 rows, the largest block and the
   easiest call — a company's own IR page about its own facility). The ~170 county Planning/Assessor
   offices are public records and likely clear as a batch.*

3. **Band thresholds — confirm.** Seeded exactly as specified (Identified 0–19, Suspect 20–39,
   Preliminary Confirmation 40–59, Confirmed 60–84, Validated 85–100) and read from the table, never
   hardcoded. Two things worth a look: the ladder puts **"Identified" below "Suspect"**, which reads
   backwards as a confidence ordering; and a **single official-record source scores 43 = Preliminary
   Confirmation**, which may be more credit than one source should earn.
   *Recommendation: confirm the label order is intentional; consider whether 1 lineage should cap
   below 40.*

4. **Subscriber-facing naming that surfaced.** Band labels are subscriber-facing, as is `fdc_id`
   (`FDC-YYYYMM-XXXXXX`, discovery **month** — day-grain would leak how thin coverage was on a given
   date). Both are as-specified; flagging that they are now baked into a durable, never-renumbered
   identifier. *Recommendation: confirm the `FDC-` prefix before any facility id is published.*

5. **The headline inventory count drops 2,283 → 1,418** wherever it is quoted externally. The 865
   Shovels permits are still in the corpus as unresolved candidates and can be resolved to subjects
   later; they are not lost. *Recommendation: none — this is the approved outcome, noted so nobody
   is surprised by a number moving.*

6. **`shovels:permits` classified as `official_record`.** A building permit is a primary official
   record, and the registry already marks that row `source_level='primary'` — but it arrives via a
   commercial API, so `commercial_dataset` is defensible. It costs nothing today (all 865 are
   unresolved), but it will matter the moment a permit resolves to a facility, because
   `official_record` is a hard requirement for publishability.
   *Recommendation: keep `official_record`; the underlying document is a municipal permit.*

---

## 8. Boundaries honoured

- No new source ingestion. No Shovels, DC Hub, Epoch AI or Cleanview calls of any kind.
- `jw_facilities` was **renamed, never dropped**; no legacy row was inserted, updated or deleted
  (gated in-migration on the count staying at 2,283).
- No existing `source_registry` licence or `license_status` value was modified.
- `dc_facility_ingest_runs` reused — **no second ingest-runs table** was created.
- **`jw_briefing_inputs` untouched**, and proven so by the cell-for-cell equivalence gate.
- Nothing published to any storefront surface.
- RLS enabled on all five tables **in the same migration that creates them**, authenticated-only
  policies, `anon` revoked — including behind `dc_facility_public` (subscriber access is gated
  separately under FAR-402). Verified live: `anon` SELECT privilege is `false` on all five.
- All five new functions set `search_path`; `anon`/`authenticated` revoked **by name** on every one
  that does not need to be reachable from a `security_invoker` view.
