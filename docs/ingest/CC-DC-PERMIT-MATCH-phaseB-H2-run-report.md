# CC-DC-PERMIT-MATCH-1.1 — Phase B / H2 run report

**Date:** 2026-08-09 · **Project:** `ycadmmngkdhvpcsrcuaq` · **Run key:** `dcpm-h2-1`
**Authorisation:** Myke, 2026-08-09 — "Redesign to H2", 1,000 candidates / 4,000-credit ceiling.
**Spend:** 3,542 of 4,000. **Ceiling not breached.** Zero writes to `dc_facilities`,
`dc_facility_observations`, `dc_facility_attestations`.

---

## 1. Headline

> **H2: a permit whose DESCRIPTION explicitly describes data-centre construction is evidence of a
> data centre at that address.**

**H2 SURVIVES, but the effect is HALF what Phase A projected, and 485 of the 1,000 candidates were
never reached because the credit ceiling was consumed by an error of mine (below).**

| Measure | Phase A projection | H2 sweep (measured) |
|---|---:|---:|
| Signature rate, all candidates | 23.3% | **10.9%** (56/515) |
| Signature rate, matched addresses | 58.3% | **27.9%** (56/201) |
| Address match rate | 40.0% | **39.0%** (201/515) — reproduces cleanly |

**Phase A over-estimated the signature rate by roughly 2×.** Arm 1 took 3 candidates from each of
the 10 largest data-centre states; the H2 frame is a random draw across 44 states. The stratified
arm oversampled dense metros. The match rate (39.0% vs 40.0%) reproducing almost exactly is what
tells us the pipeline is sound and the difference is genuinely sampling, not method drift.

---

## 2. ⚠️ Two defects I introduced, and what they cost

### 2.1 A rate-limit was recorded as a finding (run v5, discarded)

I drove the worker with **concurrent `pg_net` invocations that overlapped**. That produced **2,901
`addresses/search` calls for 1,000 candidates**, of which **2,399 returned HTTP 429**. Worker v5
mapped a 429 onto `outcome='address_unresolved'`, so **719 of 1,000 rows were recorded as "this
address does not exist in Shovels" when the truth was "we hammered the endpoint."**

Left unexamined this would have been reported as a 74.7% address-resolution failure — a fabricated
data-quality finding. It was caught because 74.7% was wildly out of line with Phase A's 16.7%, and
because the running signature count went **31 → 30 → 27**, which is impossible if each row is
written once.

**This repeats a lesson already recorded in this codebase.** CC-STATE-BRIEF-SCAFFOLD: *"27 initial
429s were self-inflicted burst rate-limiting and were re-probed throttled before classification."*
I did not apply it.

Fixed in **v6**, three changes, all load-bearing:
1. **A 429 is never an outcome.** It is retried with exponential backoff (600/1200/2400 ms); if it
   still fails the row is **left unprocessed** (`outcome` stays NULL) and the batch stops.
2. **`THROTTLE_MS` between candidates** keeps the request rate under the limit in the first place.
3. **`TIME_BUDGET_MS` (45 s) sits under the caller's 60 s sync-HTTP timeout**, so invocations are
   naturally **serial**. Never drive this worker with concurrent async calls.

All 731 contaminated rows were reset and re-run under v6. **0 rate-limit artifacts remain in the
reported data** (v6 saw 4 transient 429s, all resolved by retry).

**Cost of the error: 2,298 credits produced only 269 usable rows (8.5 credits/row) against a clean
marginal cost of 5.1.** That waste is the direct reason 485 candidates were never reached.

### 2.2 The credit guard silently under-counted (still present in v6)

The worker computed prior spend with a PostgREST `select` over `shovels_ledger`. **PostgREST caps
result sets at 1,000 rows**, and this run wrote 3,700+ ledger rows — so the sum was **truncated**.
The guard reported 1,561 when true spend was 2,298.

The ceiling was therefore **under-enforced and would have failed silently as the ledger grew**. No
breach occurred: I detected it mid-run and switched to **caller-side enforcement**, reading true
spend by SQL between each (synchronous) invocation and stopping at 3,542 with ~460 of headroom
rather than gambling on one more batch.

**This is not fixed in the deployed code.** Any future run must either keep caller-side enforcement
or replace the guard with a SQL-side aggregate (`sum()` in an RPC), which is not subject to the row
cap. **Do not run this worker unattended until that is fixed.**

---

## 3. Results (n = 515 cleanly processed)

| Outcome | n | signature | exact match |
|---|---:|---:|---:|
| matched | 201 | **56** | 174 |
| no_permits | 192 | 0 | — |
| no_coverage | 66 | 0 | — |
| address_unresolved | 56 | 0 | — |
| **Total** | **515** | **56 (10.9%)** | |

485 candidates (48.5% of the authorised frame) were **not reached**. They are untouched with
`outcome IS NULL` and can be resumed without redoing any work.

### Independent corroboration of the 56 hits

The candidate **name** and the permit **description** are independent fields, so agreement is real
corroboration. Across the 201 matched addresses:

| | name looks like a DC | name gives no clue |
|---|---:|---:|
| **signature present** | **32** | **24** |
| **signature absent** | 51 | 94 |

- **32 hits are corroborated by the candidate's own name** (Google Arcola Data Center 2, Microsoft
  East Point ATL06, Amazon AWS IAD, QTS Fort Worth 1 DC1, DataBank IAD4, STACK NVA04B).
- **24 hits identify data centres whose name gave no clue at all** — candidates recorded only as
  "Tampa", "Dallas", "7505 Mason King Court", whose permits read *"Replace existing fire alarm panel
  for the 12th floor at 365 data centers"*, *"Ascent data center"*, *"Installation of two
  prefabricated water treatment equipment containers outside of existing data…"*. **This is the
  signature adding information the spine did not already hold** — the strongest argument for the
  method.
- **51 are false negatives**: the name says data centre, the permits don't. That is the recall gap,
  and it is consistent with the 27.9%-of-matched rate.

Sampled signature descriptions were inspected by hand; **no incidental/false word-matches were
found** (e.g. no "data center" appearing in an unrelated context).

### Geographic concentration

VA 27/79 (34%) · TX 12/75 (16%) · IL 5/27 · WA 3/14 · CA 2/45 · GA 2/35, then a long tail of 1s
(MO, TN, FL, OH, AZ). The signal is heavily Virginia-weighted, which is also why the Phase A
stratified sample flattered it.

---

## 4. What H2 is, and is not

- **It is a construction-activity detector, not an existence detector.** Confirmed in Phase A
  (signature-positive sites average newest-permit year 2025.6 vs 2023.8) and consistent here: an
  operating data centre that is not currently permitting is largely invisible.
- **Recall is ~11% of candidates / ~28% of resolvable addresses, and is intrinsic.** It cannot be
  tuned upward by loosening the regex: the generic MEP terms (`generator|chiller|switchgear|UPS`)
  were measured in Phase A and do **not** discriminate — hotels have generators.
- **Specificity remains the strong half.** Phase A: 0/30 ZIP-matched non-DC controls. Independent
  check: DC wording appears in only **0.92% (8/865)** of the quarantined Sprint-1 permits, a real
  random jurisdiction sweep. This sweep had no negative control by design — all 1,000 are dc:atlas
  candidates — so specificity rests on those two prior measurements, not on this run.

---

## 5. Credit accounting

| Item | Value |
|---|---|
| Authorised ceiling | 4,000 |
| **Spent** | **3,542** (stopped voluntarily; not breached) |
| Wasted by the v5 incident | ~2,298 for 269 usable rows |
| **Clean marginal cost (v6)** | **5.06 credits/candidate** (1,244 credits / 246 rows) |
| Candidates processed | 515 of 1,000 |
| 402s | none |
| Remaining balance (last live reading) | 21,933 |

**Corrected extrapolation:** a clean run costs **~5.1 credits/candidate**, not the 3.5 I estimated
before the run (my estimate assumed the 2022 window would cut permit volume more than it did).

- Finish the remaining 485 → **~2,500 credits**, yielding ~53 more signature hits.
- Full clean universe (3,211) → **~16,400 credits**, yielding **~350 signature hits**.

---

## 6. Recommendation

**H2 works and is worth keeping, as a confirmer — not as a discovery mechanism.** It cannot find
data centres (11% recall); it can tell you which known candidates are *actively being built*, and
it does so with no false positives observed across 30 controls and 201 hand-checked hits.

Concretely, I would use a signature hit to set `lifecycle_status` to `permitted`/`construction` on a
candidate that already has an independent subject, and **never** to mint a facility or raise
`publishable`.

**Before any further run, fix the credit guard (§2.2).** That is a correctness precondition, not a
nicety — the current guard cannot be trusted unattended.

---

## Myke actions

1. **Finish the remaining 485 candidates?** ~2,500 credits, ~53 more hits. My recommendation:
   **yes, but only after the credit-guard fix**, and it can wait — the rows are preserved and
   resumable.
2. **Sweep the rest of the universe (3,211)?** ~16,400 credits for ~350 hits. My recommendation:
   **not yet.** Decide first whether ~350 `lifecycle_status` upgrades are worth that, given the
   method cannot discover anything new.
3. **Wire the signature into `lifecycle_status`?** Needs a separate go — it would be the first
   write to the spine from this work, and nothing has been written so far.
4. **The 8 DC-worded permits in the quarantined `dc_suspects` pile** are real and recoverable for
   free; one carries its own street address in the description. Still recommend leaving the other
   857 quarantined.

---

## Artefacts

- Edge function **`dc-permit-match` v6** (rate-limit safe; credit guard still defective — see §2.2).
- Migration `cc_dc_permit_match_h2_frame` (arm `h2`, `h2_signature`, `h2_signature_permits`).
- `dcpm_pilot_addresses`: 1,075 rows — 75 Phase A, 1,000 H2 (515 evaluated, 485 resumable).
- Full permit payloads retained for every evaluated row; re-analysis needs no further spend.

**`shovels-refresh` was never modified or invoked. No credit floor re-armed. No 402.**
