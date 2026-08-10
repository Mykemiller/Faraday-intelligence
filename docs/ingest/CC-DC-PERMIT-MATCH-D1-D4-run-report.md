# CC-DC-PERMIT-MATCH-1.1 — D1–D4 completion report

**Date:** 2026-08-09 · **Project:** `ycadmmngkdhvpcsrcuaq`
**Authorisation:** Myke, 2026-08-09 — D1 finish the frame · D2 sweep the full universe ·
D3 write the signature · D4 include the 8 quarantined permits.
**Spend:** 16,817 credits against agreed ceilings of 4,000 + 14,000 = 18,000. **No ceiling
breached. No 402.**

---

## 1. Outcome

All four items are complete. **The full clean universe was swept — it did not stop short.**

| | |
|---|---:|
| Candidates swept (whole clean universe) | **3,181** |
| Address matched | 1,267 (39.8%) |
| **H2 signature hits** | **335 (10.5% of all, 26.4% of matched)** |
| Distinct buildings behind those hits | **201** |
| Facilities now carrying the evidence | **196** (195 minted + 1 pre-existing) |
| Candidates linked to a facility | **335** |
| Observations written | **1,659** |
| `publishable` set | **0 — unchanged at 125 platform-wide** |
| Attestations written | **0 — unchanged at 125** |

### The signature rate is stable, which is the main evidence it is real

Three independent sample sizes, measured at different times, on different draws:

| Sample | Signature rate | Match rate |
|---|---:|---:|
| First 515 | 10.9% | 39.0% |
| ~2,390 | 11.9% | 42.0% |
| **Full 3,181** | **10.5%** | **39.8%** |

Phase A's stratified Arm 1 projected 23.3%. The true universe rate is **10.5% — Phase A
over-estimated by ~2.2×** because it drew 3 candidates from each of the 10 largest data-centre
states. The match rate reproducing across all four measurements (39.0 / 42.0 / 39.8 / Phase A's
40.0) is what shows the difference is sampling, not method drift.

---

## 2. What was written to the spine (D3)

Per building, not per candidate row (see §3):

- `dc_facilities`: `grain='site'`, `geo_precision='address'`, `lifecycle_status='permitted'`,
  `publishable=false`, `fdc_id` from `dc_mint_fdc_id()`, `subdivision_code` ISO-style (`US-VA`).
- `dc_facility_observations` (append-only): `existence` + `permit_type` per signature permit, plus
  one `address` and one `lifecycle_status` per building. All `shovels:permits` /
  `official_record` / `is_primary_source=true` / `redistributable=true` /
  `license_status_snap='cleared'` / `confidence_cap='INF'`.
- `dc_candidate_facilities`: `matched_facility_id`, `status='matched'`,
  `match_method='dcpm_h2_permit_signature'`, and `match_evidence` carrying the signature permits and
  the dedupe basis.

**`lifecycle_status='permitted'`, not `'construction'`** — a permit existing is exactly what the
evidence shows; inferring active construction overstates it.

**Nothing was published and nothing was attested.** A permit carries no operator, so
`dc_facility_is_attested()` cannot pass by construction.

### Verified before committing

The whole write was executed inside `BEGIN … ROLLBACK` first and every invariant checked on the
real rows it produced: `publishable`=0, no malformed `fdc_id`, no malformed `subdivision_code`, all
observations conforming, only sanctioned attribute names
(`address, existence, lifecycle_status, permit_type`), 0 attestations. Then re-verified after the
real run.

**One correction applied post-write:** 4 facilities had no resolved geometry yet would have claimed
`geo_precision='address'`. They were set to `'none'` — a facility with no point must not claim
address-level precision.

---

## 3. ⚠️ The duplicate-mint trap (caught before writing)

The first writer minted **one facility per candidate row**. That is wrong, because
**`dc_candidate_facilities` is not one row per facility.**

Among the signature hits, **335 candidate rows resolve to only 201 distinct buildings** — up to 9
rows on a single building, from campus / building / phase naming. The first writer would have
created **~134 duplicate facilities**, and because `dc_facility_observations` is append-only that is
expensive to unwind.

The shipped writer groups by the **Shovels-resolved `geo_id`** (the building the address actually
resolved to), falling back to `street|zip`. One facility per building; every candidate in the group
links to it. Worked example from the run: *SDC Ashburn – Building C* and *Intergate.Ashburn*
resolved to the same `geo_id` and correctly collapsed into one facility.

A further 6 groups attached to a facility minted moments earlier within 100 m — so 201 groups became
195 mints. That clustering is correct behaviour, not a bug.

### Dedupe must use the resolved coordinates, never the inventory's own

Measured on the same hits:

| Coordinate source | Hits with an existing facility within 250 m |
|---|---|
| `dc_candidate_facilities.latitude/longitude` | 5 of 12 |
| **Shovels-resolved** | **1 of 59** (0 within 100 m) |

The inventory's coordinates are imprecise enough to **manufacture false duplicates**. This is the
same class of failure as the published ZIP-centroid datasets rejected in Phase A (a Santa Clara ZIP
centroid landing in the Santa Cruz mountains). **Treat the candidate inventory's geography as
indicative, not authoritative.**

---

## 4. D4 — the 8 quarantined permits

Only **1 of the 8** carries a recoverable street address in its own description
(*"New construction data center at 21625 red rum dr. Ashburn, va 20147"*). That address **matches a
facility H2 had just minted**, so the permit was attached to it and its suspect rows marked
`promoted`. The other digit-bearing descriptions contain square footages and lot numbers, not
addresses.

The remaining **7 are confirmed data-centre evidence but are not address-anchorable.** They were
**not** minted: without a street address they cannot be deduped against the 196 facilities H2 just
created in the same metros, several of which are Loudoun/Ashburn. Minting them would have
manufactured exactly the duplicates §3 was built to avoid.

⚠️ **Enum gap flagged.** `dc_suspects.suspect_status` allows only
`unevaluated | promoted | rejected | duplicate`. None expresses *"confirmed real, but not
anchorable"*. Marking these `rejected` would be false. They were therefore left `unevaluated` with
the assessment recorded in `notes` + `evaluated_at`/`evaluated_by`. **A status value for this state
is worth adding** — it is a real disposition that will recur.

The other ~857 quarantined permits remain untouched.

---

## 5. Credits and safety

| Run | Ceiling | Spent |
|---|---:|---:|
| `dcpm-h2-1` (first 515, incl. the discarded v5 waste) | 4,000 | 3,542 |
| `dcpm-h2-2` (rest of universe) | 14,000 | 13,275 |
| **Total Phase B** | **18,000** | **16,817** |

Clean marginal cost ≈ **5.0 credits/candidate**. No 402s. `shovels-refresh` (Jurisdiction Watch)
untouched; it uses ~220 credits/month, so its lane is unaffected.

### Both earlier defects are fixed and verified

1. **429-as-a-finding** — fixed in worker v6/v7: a 429 is retried with backoff and, failing that,
   the row is left unprocessed. Across the full 3,181-candidate sweep, **0 rows record a 429**
   (versus 719 in the discarded run), and the honest unresolved rate settled at 10.3%.
2. **Truncated credit guard** — fixed in v7 via `dcpm_run_credits()`, a SQL-side aggregate that is
   not subject to PostgREST's 1,000-row cap and **fails closed**. Proof: it returns 3,542 where the
   old client-side sum saw 1,280, a 64% undercount.

Concurrency was made a property of the system rather than a hope: the cron tick carries a dispatch
guard (verified — a second tick returns `skipped: dispatch too recent`), and the worker's time
budget sits under the caller's HTTP timeout so invocations are serial. The cron unscheduled itself
on completion.

### Advisor delta

Exactly **+4 INFO `rls_enabled_no_policy`**, one per new table — the intended deny-all posture.
**Zero** new `function_search_path_mutable` and **zero** new anon/authenticated
`security_definer_function_executable` findings: every new function sets `search_path` and revokes
EXECUTE **by name** from `anon`/`authenticated` as well as `PUBLIC` (Supabase's
`ALTER DEFAULT PRIVILEGES` grants at CREATE time, so `revoke … from public` alone is insufficient).

---

## 6. What H2 is, restated for the record

- **A construction-activity detector, not an existence detector.** Signature-positive sites average
  a newest-permit year of 2025.6 versus 2023.8 for the rest. An operating data centre that is not
  currently permitting is invisible to it.
- **~10.5% recall is intrinsic** and must not be "improved" by loosening the regex. The generic MEP
  terms (`generator|chiller|switchgear|UPS`) were measured and do **not** discriminate — hotels have
  generators.
- **Specificity is the strong half**: 0/30 on ZIP-matched non-DC controls in Phase A, and a 0.92%
  (8/865) base rate in a random jurisdiction sweep.
- It is a **confirmer**, not a discovery mechanism. It cannot find data centres; it can tell you
  which known candidates are being built right now.

---

## Open items for Myke

1. **A `suspect_status` value for "confirmed but unanchorable"** (§4). Small schema change, real
   recurring state.
2. **The 7 unanchorable permits** need a city-level resolver to land — not a guess.
3. **196 facilities are now in the spine at `publishable=false`.** They are attestation-gated, and a
   permit can never satisfy that gate. If any are to become publishable, that needs an operator
   source, which is a separate piece of work.
4. **`dc-permit-match` remains an unauthenticated endpoint that can spend credits** (same posture as
   `shovels-probe`). You accepted this risk for validation; it should be gated or retired now the
   sweep is done.

---

## Artefacts

- Edge function **`dc-permit-match` v7** (rate-limit safe; SQL-side credit guard).
- Migrations: `cc_dc_permit_match_credit_guard_rpc`, `cc_dc_permit_match_h2_frame`,
  `cc_dc_permit_match_h2_sweep_cron`, `cc_dc_permit_match_h2_spine_writer`,
  `cc_dc_permit_match_h2_spine_writer_v2_grouped`.
- `dcpm_pilot_addresses` retains full permit payloads for all 3,256 evaluated rows — re-analysis
  needs no further spend.
- `dcpm_write_h2_facilities(p_dry_run)` is idempotent: re-running it writes nothing new.
