# CC-DC-PERMIT-MATCH-1.1 — Phase A run report

**Date:** 2026-08-09 · **Project:** `ycadmmngkdhvpcsrcuaq` · **Run key:** `dcpm-phaseA-1`
**Status:** Phase A complete. **HARD STOP before Phase B.** Zero writes to `dc_facilities`
or `dc_facility_observations`.

---

## 1. Verdict on H1

> **H1: A building-permit match at a candidate facility's street address is evidence that a
> data center exists at that address.**

### **FALSIFIED.**

**Arm 1 (real DC candidates) matched 40.0% (12/30). Arm 3 (ZIP-matched non-data-centers)
matched 50.0% (15/30). The delta is −10.0 points — the wrong direction.**

Hotels, a Taco Bell, a Subway, dentists, a Kaiser Permanente clinic and a Chevrolet
dealership in the *same ZIP codes* matched building permits **more often** than actual data
center candidates did. A permit match carries no positive discriminative information about
whether a building is a data center.

This is not a sensitivity failure. **Arm 2 (known data centers) matched 73.3%**, so the
method resolves addresses and finds permits perfectly well. The failure is **specificity**:
permits are simply ubiquitous at US commercial addresses, exactly as the CC anticipated.

**However — a secondary finding is strongly positive and changes the recommendation.**
Permit *description text* discriminates where permit *existence* does not:

| Signal | Arm 1 (DC candidates) | Arm 3 (non-DC) | Delta |
|---|---|---|---|
| Permit **exists** | 40.0% | 50.0% | **−10.0** ❌ |
| Permit **describes a data center** | **23.3%** | **0.0%** | **+23.3** ✅ |

Among *matched* addresses only: 7/12 (58.3%) of Arm 1 vs **0/14 (0.0%)** of Arm 3 commercial
and 0/1 of warehouse. Fisher exact p ≈ **0.0012**.

---

## 2. Address-validity gate (A1)

Universe: `dc_candidate_facilities`, `source_key='dc:atlas'`, `country_code='US'` = **8,816**.

| Exclusion | Count |
|---|---:|
| No `street` field at all | 3,696 |
| (a) street has no leading house number | 1,210 |
| (b) zip is not a valid 5-digit ZIP | 647 |
| (c) street matches a prose prefix | **0** |
| (d) ZIP5 does not resolve to a state | 29 |
| (e) already carries `matched_facility_id` | 23 |
| **ADMITTED** | **3,211** |

Matches the CC's ~3,200 prediction (`ab_both` = 3,263 exactly as stated), so the gate is
behaving as designed.

**`source_key='sc:servercountry'` (1,048 US rows) is structurally excluded** — it carries zero
street addresses. It was not silently dropped; there is nothing to test.

### Two gate findings

1. **Rule (c) is redundant.** All 88 prose addresses ("within 2 mile from Interstate",
   "within Carlisle, PA") were *already* removed by rule (a), because prose does not begin
   with a house number. Rule (c) excluded 0 additional rows. Harmless, but it is not doing
   the work the CC assumed.
2. **Rule (a) has a false-positive mode.** A ZIP pasted into the street field passes it. A
   live example admitted into Arm 1:
   `"33132 Miami United States +1 (305) 731-2225"` (ColoHouse, Miami). It resolved to
   `address_unresolved`, so it cost one free call — but a stricter gate should require the
   token after the house number to be alphabetic.

### ZIP → state crosswalk

`subdivision_code` and `raw->>'state'` are **not** state codes and were never read as such.
`public.dcpm_zip_state_xwalk` (42,374 ZIPs) was built from **two independent public datasets**
(`scpike/us-state-county-zip`, `midwire/free_zipcode_data`): **99.92% agreement** over 31,905
shared ZIPs, 26 conflicts, all border ZIPs where midwire is correct (10004 = NY, 38041 = TN,
55954 = MN) — midwire is therefore preferred on conflict. Provenance is stored per row.

⚠️ **Both published ZIP *centroid* datasets are unusable** and are byte-identical to each
other: 95054 "Santa Clara" resolves into the Santa Cruz mountains, 98101 "Seattle" into the
Cascades. They were rejected for geography; Shovels' own (free) geocoder was used instead,
which returns correct coordinates.

---

## 3. Arm-by-arm outcomes

| Arm | n | matched | exact | fuzzy | no_permits | addr_unresolved | no_coverage | match % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **1 · test** (DC candidates) | 30 | 12 | 11 | 1 | 11 | 5 | 2 | **40.0%** |
| **2 · positive control** (known DCs) | 15 | 11 | 8 | 3 | 3 | 0 | 1 | **73.3%** |
| **3 · negative control** (non-DC) | 30 | 15 | 15 | 0 | 13 | 0 | 2 | **50.0%** |
| — 3a commercial | 25 | 14 | 14 | 0 | 9 | 0 | 2 | 56.0% |
| — 3b warehouse | 5 | 1 | 1 | 0 | 4 | 0 | 0 | 20.0% |
| **All** | 75 | 38 | 34 | 4 | 27 | 5 | 5 | 50.7% |

Headline precision uses **exact** matches only: Arm 1 **36.7%** vs Arm 3 **50.0%** — delta
**−13.3 points**, still the wrong direction.

### ⚠️ Arm 2 was substituted, and the CC's recipe is unbuildable

The CC specified joining `dc_facilities` (publishable) → `dc_facility_observations`
`attribute='address'`. **All 125 publishable facilities carry only CITY-level address
observations** ("Ashburn", "Wilmington") — **zero** street addresses exist on any publishable
facility. Arm 2 was instead drawn from `dc_candidate_facilities` already resolved to a spine
facility (`status='matched'`, `matched_facility_id` not null): **12 of 15 point at
publishable/attested facilities**, 3 at spine-matched-only ones. These are confirmed data
centers, which is what a positive control requires.

### Arm 3 construction (the deciding arm)

Decoys came from **OpenStreetMap via Overpass** — a source completely independent of permit
data, so selection cannot be biased by the outcome being measured. The selection rule was
declared mechanically **before** results were inspected: per Arm-1 ZIP, POIs carrying
`addr:housenumber` + `addr:street` + matching `addr:postcode`, in categories
{hotel, medical, retail, non-IT office, services}, ordered by OSM id.

**The CC's prohibited method (street-number offsets on the same street) was not used.**

Contamination screening, all three checks recorded per decoy in `decoy_verification`:
- DC-name/tag regex screen → 28 of 2,038 pool rows flagged and excluded (`office=it`,
  `telecommunication`, operator names).
- Address vs `dc_candidate_facilities` in the same ZIP → **0 hits**.
- Name vs `dc_facilities.primary_name` → **0 hits**.
- Category evidence per row (OSM tag + recognisable non-DC brand).

Sample: Washington Square Hotel, Hampton Inn Albany, Chick-fil-A, Royal Dental, Taco Bell,
Hoskins Chevrolet, Kaiser Permanente Puyallup, The Westin Seattle, LAX Marriott.

The 5 warehouses are national distribution/logistics operations — Chewy Fulfillment Center
and Macy's Distribution (both in **85338, an Arm-1 ZIP**), Darigold Warehouse (**98168, an
Arm-1 ZIP**), Walmart Distribution Center, Dayton Freight.

**Internal consistency check that validates the coverage logic:** ZIPs 23970 (VA) and 43609
(OH) returned `no_coverage` in *both* the test arm and the negative-control arm — coverage is
a property of the jurisdiction, not the building, which is exactly what should happen.

---

## 4. Discrimination

**Permit existence does not distinguish a data center from a random commercial building.**

- Arm 1 − Arm 3 = 40.0% − 50.0% = **−10.0 points**.
- Two-proportion z ≈ −0.78, p ≈ 0.44 — indistinguishable from no effect.
- The CC's own bar ("under ~20 points ⇒ INCONCLUSIVE, not supported") is not met, and the sign
  is negative. Reported as **FALSIFIED** rather than inconclusive because the positive control
  fired at 73.3%, which rules out the "we simply failed to find permits" explanation.
- Warehouses matched only 20.0% (n=5, too small to carry weight on its own, but it does not
  rescue H1).

**Permit description text does discriminate** — the one genuinely useful result:

| | Arm 1 | Arm 2 | Arm 3 commercial | Arm 3 warehouse |
|---|---:|---:|---:|---:|
| Matched addresses | 12 | 11 | 14 | 1 |
| With explicit DC description | **7 (58.3%)** | 1 (9.1%) | **0 (0.0%)** | 0 (0.0%) |
| Over full arm (n=30/15/25/5) | **23.3%** | 6.7% | 0.0% | 0.0% |

Real matched text: *"New 2-story industrial data center"*, *"Data center facility tenant
improvement: changes to the existing data halls"*, *"Install anchorage for 5 data center
server racks"*, *"Site development permit for avanti phase 3 - site plan for data center"*,
*"Conversion of existing drive up bank into a leasable data center with one data hall"*.

**Zero false positives across 15 matched non-DC addresses.**

⚠️ **The generic MEP signature must not be used.** Filtering on
`generator|chiller|switchgear|UPS|cooling tower` gives Arm 2 45.5%, Arm 1 25.0%, Arm 3
commercial 14.3% — hotels have generators and chillers. Only the explicit
`data cent|server room|colocation` wording separates the arms.

Arm 2's low 9.1% strict rate is a **sensitivity** limit, not a specificity problem: those are
established facilities whose recent permits are maintenance work (the one Equinix CH3 hit is a
generator/transformer job that never uses the words "data center").

---

## 5. Permit-quality distribution (Arm 1 matches)

| Arm | permits | median job_value | max job_value | permits ≥ $1M |
|---|---:|---:|---:|---:|
| 1 · test | 180 | 0 | $37,000,000,000 | 35 |
| 2 · positive | 131 | 0 | $263,033,000 | 35 |
| 3a · commercial | 156 | 0 | $3,121,820,000 | 40 |

- **`job_value` is unusable as a discriminator.** Median is **0** in every arm, and the maxima
  are not credible ($37B on one permit; $3.1B on a *commercial decoy*). Do not build a
  threshold on this field.
- **`total_building_area` / `building_area_sqft` are ABSENT** from every `/v2/permits/search`
  item — the field the CC asked to capture does not exist in this response. `min_total_building_area`
  (noted in the CC as historically dead) has no counterpart to read back.
- Much of what matched Arm 1 is incidental work, exactly as the CC predicted a "$4,000 re-roof"
  would be — which is why existence alone is uninformative.

---

## 6. Contract verification

Every parameter proven by a with/without pair against live responses. **Four of the CC's
stated contract assumptions were wrong.**

| Param / claim | Test | Result |
|---|---|---|
| `/v2/addresses/search` query param | `q=…` vs `address=…` | `q` **required**; `address` → 422 `{"loc":["query","q"],"msg":"Field required"}` |
| **`size` on addresses/search** | none / `size=2` / `limit=2` / `page_size=2` / `per_page=2` | **All five return an identical 11 records — page size is NOT controllable.** ⚠️ CC assumed `size=3` |
| **addresses/search billing** | remaining before/after 31 address records | 24808 → 24807, i.e. **only the 1 permit record billed — addresses/search is FREE.** ⚠️ CC budgeted it |
| **`permit_from`/`permit_to`** | geo_id alone vs geo_id + dates | 0 records vs 5 records — **dates are REQUIRED** ⚠️ not in the CC |
| `size` on permits/search | `size=1` vs `size=5`, same geo+dates | 1 vs 5 records — **filters correctly** |
| **`total_count=true`** | sent on permits/search | response `total_count: null` — **silently ignored** ⚠️ CC planned to rely on it |
| `geo_id` (address level) | `LlSrEXhrbkw` vs `LjXUVuyTfiI` vs bogus | 3 records (all at 21595 Smith Switch Rd) vs 0 vs 0 — **filters to the exact address** |
| `geo_id` (ZIP level) | `geo_id=20147` | returns permits — **raw ZIP5 is a valid geo_id**, used as the coverage probe |
| `/v2/jurisdictions/search` | `q=LOUDOUN` | exists; returns `{name, state, geo_id}` |

Two further live findings:
- **A bogus `geo_id` returns HTTP 200 with 0 records, not an error.** "Zero permits" therefore
  never proves the id was valid — the ZIP-level coverage probe is what makes the
  `no_permits` / `no_coverage` split honest.
- **`addresses/search` does NOT only return addresses with ≥1 permit** (contrary to the CC):
  geo_id `LjXUVuyTfiI` came from it and has 0 permits over 2015–2026.
- **`x-credits-remaining` is NON-MONOTONIC** — observed 24339, then **24402** on a later call.
  It cannot be used as a floor or ceiling signal. This independently supports the existing
  decision in `shovels_config` to leave `credit_floor` retired; **it was not re-armed.**

### Address normaliser — 10 worked examples

| Input | Normalized | house_no | street_body |
|---|---|---|---|
| `2820 Northwestern Pkwy.` | `2820 northwestern pkwy` | 2820 | `northwestern pkwy` |
| `1525 Comstock Street` | `1525 comstock st` | 1525 | `comstock st` |
| `9650 Hornbaker Rd` | `9650 hornbaker rd` | 9650 | `hornbaker rd` |
| `1001 Texas St. 310` | `1001 texas st 310` | 1001 | `texas st 310` |
| `12101 - 12301 Tukwila International Blvd` | `12101 - 12301 tukwila international blvd` | 12101 | `- 12301 tukwila international blvd` |
| `6171 West Century Blvd` | `6171 w century blvd` | 6171 | `w century blvd` |
| `111 8th Avenue` | `111 8th ave` | 111 | `8th ave` |
| `1111 39th Avenue SE` | `1111 39th ave se` | 1111 | `39th ave se` |
| `16575 West Commerce Drive, Ste 200` | `16575 w commerce dr` | 16575 | `w commerce dr` |
| `226 North Fifth Street #4B` | `226 n fifth st` | 226 | `n fifth st` |

Suffixes and directionals are canonicalised; unit designators (`Ste 200`, `#4B`) are stripped.
**Two known weaknesses**, both visible above: an address *range* ("12101 - 12301") keeps the
range tail in the body and will not match exactly; and a bare trailing number ("Texas St. 310")
is not recognised as a unit. Both were left uncorrected rather than tuned mid-experiment.

---

## 7. Credit accounting

| Item | Value |
|---|---|
| Credits spent by this CC | **521** (of an 1,800 Phase-A ceiling) |
| Ceiling breached? | No. Never approached; `per_run_credit_cap` 2,000 never approached |
| 402s | **None** |
| Remaining (last live reading) | **24,402** |
| Cost per address | **6.9 credits** (520 / 75) |
| `addresses/search` (geocode) | **0 credits — free, measured** |

**Extrapolation to 1,000 candidates: ~6,900 credits**, range **≈5,000–9,000** (driven by the
match rate and by how many addresses saturate the `size=20` page cap). The point estimate is
under the CC's 8,000 escalation threshold, but **the top of the range exceeds it** — flagged
per the CC rather than presented as safely inside budget.

Cost is almost entirely controllable: existence alone needs `size=1` (~1,000–1,500 credits per
1,000 addresses), and the description signature would be captured at `size=5` (~2,500–3,500).
The pilot deliberately used `size=20` to observe the full permit-quality distribution.

### ⚠️ Ledger defect found and fixed

`shovels_ledger.credits_source` carries a CHECK allowing only six values. Function v2/v3 wrote
`'records_measured'`, which is not among them, so **every call lacking a credit header — all
free `addresses/search` calls and all zero-record `permits/search` calls — violated the
constraint and was silently swallowed** by the fail-soft ledger catch.

- **Credit totals are unaffected**: the unlogged calls are exactly the zero-cost ones.
- Fixed in **v4** (uses `'unavailable'`, and now logs the error instead of swallowing it).
  Verified: `addresses/search` rows now persist with `credits_consumed = 0`.
- `shovels-refresh` was **not touched** — the fix is entirely inside the new function, and no
  shared constraint was modified.

---

## 8. Comparison to the `dc_suspects` precedent

The 6,920 quarantined rows are **865 distinct permits × 8 attributes**, not 6,920 permits.

Inspecting them shows why the earlier pass failed: their `address` attribute holds a **city
name** — `"BATON ROUGE"`, `"PORTLAND"`, `"DALLAS"`, `"AUSTIN"` — and their `existence` values
are raw permit descriptions like *"Install solar electric system on to existing roof"* and
*"Eplan: commercial expedited review - new construction of parking garage."* They were pulled
by **jurisdiction sweep with a square-footage filter** (`notes` = "FAR-263 L3 candidate ·
10120 sqft"), never anchored to any address. With only a city, there was no subject to attach
them to — hence `sprint1_unattached_no_facility_subject`.

**Address-anchoring solves that structural problem completely.** Every permit retrieved here is
bound to a specific candidate row via an address-level `geo_id`; there are no unattached
observations, and Phase B would have a facility subject for every match.

**But it does not rescue the approach**, and the two failures are different:
- Sprint 1 failed because permits **could not be attached** to a subject.
- Phase A shows that even when they **are** correctly attached, a permit match is **not
  probative** — the same match fires on a Taco Bell.

So address-anchoring fixes attachment and leaves the evidential problem untouched. The prior
865 permits should not be revived on the strength of address-anchoring alone.

---

## 9. Recommendation

### **REDESIGN** — do not proceed with Phase B as specified; do not abandon the source.

Phase B as written would mint facilities from permit matches. On this evidence that would
mint them at roughly the rate it would mint hotels, and **~50% of what it wrote would be
wrong** — a precision far below anything the spine should accept.

What the pilot did establish is worth keeping:

1. **The retrieval mechanism works.** Address resolution is accurate, free, and returns clean
   coordinates; `geo_id` filters to the exact building; coverage is separable from absence.
2. **The discriminating signal is permit DESCRIPTION TEXT, not permit existence** — 23.3% vs
   0.0% over full arms, 58.3% vs 0.0% among matched, zero false positives, p ≈ 0.0012.
3. **Cost is far lower than budgeted**, because geocoding is free.

A redesigned Phase B should test **H2: a permit whose description explicitly describes data
center construction is evidence of a data center at that address** — with recall as the open
question, since only 23.3% of true candidates produced such a permit (so ~75% of real data
centers would be missed). That is a *low-recall, high-precision* confirmer: usable to
**upgrade lifecycle_status to `permitted`/`construction` on candidates that already have an
independent subject**, and not usable as a discovery mechanism on its own.

Before any such run, the recall limit above should be measured on a larger positive control
than 15 — Arm 2's 6.7% strict rate suggests the text signature may fire mainly on *recent
construction*, not on operating facilities.

---

## Myke actions

1. **Go / no-go on Phase B.** My recommendation is **no-go as specified** (it would mint
   ~50%-wrong facilities). If you want the redesigned H2 run instead: suggested ceiling
   **3,000 credits** for **1,000 candidates** at `size=5` — noting the clean universe is
   3,211, so 1,000 is a ~31% sample. Nothing will be called without your written go.
2. **May permit evidence ever raise `publishable`?** My recommendation: **no** — keep it
   attestation-gated. A permit supplies no operator, so `dc_facility_is_attested()` cannot be
   satisfied, and this pilot shows a permit match is not by itself evidence of a data center.
   Permit evidence is a good `lifecycle_status` input, not a publication input.
3. **The 6,920 quarantined `dc_suspects` rows (865 permits).** Recommendation: **leave
   quarantined and do not revive**. They are city-anchored, and the address-anchoring that
   would fix their attachment does not make them probative. A targeted re-pull of only those
   whose description carries an explicit data-center signature would be cheap and is the only
   revival I would support.
4. **The 986 no-leading-number + 88 prose addresses.** Recommendation: **not worth a repair
   pass for this purpose** — the method they would feed does not work. Reconsider if address
   repair serves another consumer. Worth a one-line gate fix regardless: require the token
   after the house number to be alphabetic, which removes the
   `"33132 Miami United States +1 (305)…"` class.
5. **New AUTO-ID in the Airtable Automation Registry?** Recommendation: **not yet** — there is
   no recurring automation to register while the approach is being redesigned. **I did not
   verify the next free ID** (that requires an Airtable read I did not perform, and the CC
   said not to assume it). If you want it registered, say so and I will look up the true next
   free ID rather than guessing.

---

## Artefacts

- Edge function **`dc-permit-match` v4** (`verify_jwt=false`, matching the existing
  `shovels-probe` pattern). **`shovels-refresh` was never modified or invoked.**
  ⚠️ *Follow-up:* like `shovels-probe`, this is an unauthenticated endpoint that can spend
  credits; it should be retired or gated once the question is closed.
- Migrations: `cc_dc_permit_match_scratch_tables`, `cc_dc_permit_match_decoy_pool`,
  `cc_dc_permit_match_warehouse_fetch`.
- Tables: `dcpm_zip_state_xwalk` (42,374), `dcpm_pilot_addresses` (75, full 4-way outcomes +
  raw permits), `dcpm_decoy_pool` (2,038 OSM POIs + verification).
- All 75 pilot rows retain their resolved address, `geo_id`, and permit payloads for re-analysis
  without further spend.

**No writes to `dc_facilities`, `dc_facility_observations`, or `dc_facility_attestations`.
No `publishable` flag set. No credit floor re-armed. No 402 encountered.**
