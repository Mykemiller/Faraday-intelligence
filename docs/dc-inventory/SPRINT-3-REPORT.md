# CC-DC-SPRINT3 — Official-Record Lane / Publishability

**Session: 2026-08-09.** Migrations `0053`–`0056`, all **applied to prod** (`ycadmmngkdhvpcsrcuaq`).
Supersedes the JW Facilities inventory as the canonical DC facility model.

## Headline

```
validated_data_centers        0        (publishable — correct, see below)
canonical_facilities      1,359
unvalidated_candidates   19,117        (18,074 ATLAS + 1,043 Server Country)
suspected_data_centers   20,476
```

## Gate — three STOP conditions found, all surfaced

1. **Queued-merge backlog unreviewed** — 1,016 pairs, 0 reviewed.
2. **Every source feeding the inventory is `license_status='unreviewed'`** — 214 sources / 20,116
   observations, so `redistributable` was false everywhere.
3. **ISO queue sources unreviewed** (`iso:pjm-queue`, `iso:miso-queue`, `iso:ercot-gis`).

## Findings that changed the sprint

**Scoring was merge-blind.** `dc_compute_publishable`/`_confidence` counted
`o.facility_id = p_facility_id`, ignoring `superseded_by`. Merges never re-point observations
(that is what makes them reversible), so **816 observations / 59 lineages were stranded**.
Depth-2 facilities: **4 by raw facility_id → 54 through the resolver**.

**Lineage ≠ independence.** Of those 54: 41 were one source counted twice; 8 more were two
source_keys belonging to the *same county government*; only **5** had two genuinely independent
publishers. 63 counties are registered with 2 record systems, so a source_key rule would let one
institution supply 2 of the 3 required "independent" sources.

**No official record is auditable.** All **4,181** `official_record` observations carry
`source_document_ref = 'jwf:<uuid>'` — a pointer to our own legacy table. **Zero** external
locators; zero `source_url`. 918 of them are our own row-write bookkeeping
(`legacy_created_at`) carrying `source_class='official_record'` and `is_primary_source=true`.
Per the brief's own rule ("an official record with no locator is not an official record"), all
4,181 fail. The only external locators in the whole corpus were Epoch AI's 367 rows.

**Class-by-topic is systemic.** Three independent instances: `official_record` assigned from
source_key naming; `artifacts.source_type='permit_utility'` on 215 trade-press articles (1 is
`.gov`); `source_type='regulatory'` on law-firm blogs.

**Licence snapshots are frozen.** `trg_dc_observations_append_only` freezes `redistributable`
and `license_status_snap`, so a licence review could never affect an ingested row. Licence is now
resolved from `source_registry` **at read time**.

**FAR-263 was already fixed.** The 422 was a request-contract error (`state` → `geo_id`), fixed
out-of-band 2026-08-03. The lane is now blocked on **HTTP 402 trial credit limit** — billing, not
code. **Credits spent this session: ZERO.**

## What shipped

- `dc_publish_rules` (configurable independence axis) · `dc_source_traits` ·
  `dc_source_publisher()` · `dc_licence_is_citable()`
- `dc_facility_evidence` rewritten — merge-aware, publisher-independent, corroboration/citation
  split, read-time licence
- `dc_compute_publishable` / `dc_compute_facility_confidence` — merge-aware + split +
  **authoritative self-attestation** (`dc_facility_attestations`, `dc_facility_is_attested()`):
  an operator's own SEC filing satisfies publishable alone and sets **FCS 100**, attribute-scoped
  so it never confers `geo_precision`
- `dc_candidate_facilities` + `dc_inventory_counts` (Validated / Suspected)
- Sources: **Server Country** registered CC BY 4.0 `cleared`; **Epoch AI** → `cleared`;
  **ATLAS** `gated` → `attribution_required` (relicensed by its author; re-verified live)

## Data landed

| Source | Loaded | Matched | Observations | Locator |
|---|---|---|---|---|
| ATLAS | 18,103 | 29 | 110 | real |
| Server Country | 1,048 | 5 | 20 | real |

130 observations with genuine external locators — the first besides Epoch AI. Server Country's
`itLoadMW`/`powerCapacityMW` are the first capacity values written with a **declared basis**
(`it_load` / `announced_total`).

## ATLAS coordinates — do not use as locations

The field is `city_coords` and it is city-centre: **6,147 US coordinate rows carry only 1,925
distinct values** (3.2 facilities per point); Chicago is the canonical `[41.8781, -87.6298]`.
The "6,100 exact GPS coordinates" figure — repeated in our own July registry note — is wrong.
Loaded as `geo_precision='municipality'` with the basis recorded. **The real asset is 5,120 US
street addresses**, which are a better Shovels `/addresses/search?q=` ping key than a coordinate.
The author's own warning is load-bearing: precision varies, "a portion fall back to state or
country centroids… not verified ground truth."

## Tests

`test/dc-inventory/sprint3-publishability-tests.sql` — **5/5 PASS**, rolled back:
three lineages from one publisher → not publishable · three publishers + citable official record
→ publishable · only official record non-citable → **not** publishable · attestation alone →
publishable · attestation → FCS 100.

## Next steps

1. **Review the 1,016-pair merge queue** — now on the critical path: merges are the lineage-growth
   mechanism. High-degree clusters are the AWS-IAD **campus** case (`parent_facility_id`), not merges.
2. **Shovels + DC Hub access** (Myke, in progress) → then the permit ping: address → `geo_id` →
   permits → permit number + `address.latlng`. Closes the official-record term **and** geo_precision.
3. **SEC body-fetch** to populate `dc_facility_attestations` — 27,606 artifacts hold CIK +
   accession + URL but only 52 have a body. Free, unmetered, public domain. Fastest path to
   Validated > 0.
4. **Retire the 918 legacy-bookkeeping rows** from `official_record` (needs retract-and-reinsert;
   the append-only trigger blocks an UPDATE).
5. **ATLAS attribution decision** — visible-or-nothing on any subscriber surface.
6. **17,992-facility minting question** — held deliberately; candidates are counted, not minted.

## Boundaries honoured

Zero Shovels credits · no gated/blocked source ingested · `jw_briefing_inputs` untouched
(no FAR-377 re-fingerprint) · nothing exposed to `anon` (all new tables RLS-on, anon/authenticated
revoked) · no scoring weight or band threshold relaxed — the only threshold change was a
**tightening** (lineage → publisher independence) · no fabricated coordinates.
