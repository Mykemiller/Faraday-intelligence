# FAR-418 §6 — classifier fixture corpus

**CC:** CC-BOUNDSTONE-INGEST-1.1 §6, §6.6, §6.7, §11, Appendix A.

## What is tested, and where

| Gate | Test file | Nature |
|---|---|---|
| Gate 0 lexical prefilter | `test/far418-classifier.test.mjs` | Pure. Deterministic. |
| Gate 1 contract validation | `test/far418-classifier.test.mjs` | Pure. **Deterministic** — see below. |
| Gate 2 retrieval planning | `test/far418-classifier.test.mjs` | Pure. Deterministic. |
| Dedupe / §4 replay | `test/far418-canonical.test.mjs` | Pure. Deterministic. |
| Tagging spine | `test/far418-tagging.test.mjs` | Pure. Deterministic. |
| §6.7 no-tuning grep | `test/far418-no-jurisdiction-tuning.test.mjs` | Source grep over the decision surface. |
| §5.1 no-IDF-dependency | `test/far418-no-idf-dependency.test.mjs` | Drives the real query builder with a recording stub. |

`npm test`: **90 passing, 0 failing.**

## The design decision that makes this testable without a model

§6.3's zero-fabrication rules are enforced **in code**, not requested in a prompt. Three of
the four are checked by `validateClassification()` against the document the model was
actually shown:

- **`extract` must be a verbatim span.** Substring match on whitespace-normalized text.
  A paraphrase is rejected and the candidate discarded. Tested with a plausible,
  well-written paraphrase — the failure mode that would otherwise reach a citation.
- **`effective_date` is dropped unless `effective_date_stated` is true.** Tested with a
  stated-false-but-populated response, and with `"180 days from adoption"`.
- **Unknown fields become null.** `""`, `"unknown"`, `"N/A"`, `"none"`, `"not stated"`,
  `"TBD"`, `"--"` all coerce to null rather than being kept as a string.
- **Closed vocabularies.** An invented `authority_level` or `instrument_type` fails the
  whole classification; a malformed `state_abbr` drops to null.

Because validation is deterministic, **precision on the contract rules is 100% by
construction and does not need sampling.** What a fixture corpus can *not* settle without
model calls is Gate 1's *judgement* — whether the model reaches the right
`authority_level` on a real document. That is measured below as coverage of the classes,
and honestly marked as unmeasured for accuracy.

## §6.6 instrument classes — coverage

| Class | Covered | How |
|---|---|---|
| Local land-use instrument | ✅ | Gate 0 + `retrievalPlan('LOCAL')` |
| State executive directive | ✅ | Gate 0 + `retrievalPlan('STATE')` → `gov:<st>`, `legis:<st>` |
| State legislative instrument | ✅ | `instrument_type: 'statute'` in the closed vocabulary |
| Commission order | ✅ | Full validation fixture (`ORDER NO. 2026-1147`) + `retrievalPlan('STATE_AGENCY')` |
| Grid-operator protocol revision | ✅ | `retrievalPlan('GRID_OPERATOR')` → notices then commission |
| Utility tariff restriction | ✅ | `retrievalPlan('UTILITY')` asserts the docket, **never** the press release |
| Trade-press coverage (dedupe) | ✅ | Three outlets → one `content_hash` |
| Growth / expansion announcement | ✅ | Negative: Gate 0 must not fire |
| Instrument already in `records` | ⚠️ | Hash collision proven; the `duplicate_of_record` flag against live records is **not** exercised — it needs the applied migration |
| Restriction lifted / rescinded | ✅ | `instrument_type: 'rescission'` in the vocabulary |

## State distribution — and why the fixtures name no state

§6.7 forbids any state name on the decision surface, and
`far418-no-jurisdiction-tuning.test.mjs` greps for all 50 plus every market operator and
fails on a hit. Naming states in the *fixtures* would be permitted (they are data, not
rules), but the classifier fixtures deliberately use the placeholder `ZZ`/`YY` instead,
for a specific reason:

> If a fixture passes only because it says "Texas", the test is measuring recognition of a
> word, not of an instrument. Every fixture here is written so that **swapping the
> jurisdiction changes nothing about whether it passes.**

The §6.6 vocabulary test makes this explicit: five documents, five different authority
levels, five different jurisdictions — all unnamed, all must pass Gate 0 on instrument
language alone.

**So the §11 criterion "≥3 states per instrument class" is met in the sense that matters
(jurisdiction-independence is proven) and NOT met literally (no real state's documents are
in the corpus).** That gap is real and is recorded here rather than papered over:

## What is NOT covered, plainly

1. **No real documents.** Appendix A.1 names artifact `fa3df064-f8b0-454d-b08c-61b9f69196bb`
   (currently `["D13"]`, must re-derive to `D3.2`) and an item-2 document with 20+ rows
   sharing one `source_url`. Replaying those requires either live artifact reads in CI or
   committed fixture files. Neither exists yet. The §4 replay test reproduces the *shape*
   of item 2 (five routes, one document) with synthetic URLs and proves the collapse; it
   does not replay the actual rows.
2. **Gate 1 accuracy is unmeasured.** No precision/recall figure is reported for the model
   call, because none was taken — that needs live classification runs against a labelled
   set, which needs deployment. Reporting a number here would be inventing one.
3. **≥5 local land-use fixtures** (§A.2) — not met. That class is 531 of 533 existing
   records and deserves the deepest regression set; it currently has one Gate 0 fixture.
4. **`duplicate_of_record`** against the live 533 rows — not exercised.

## Next step to close 1–4

Extend from the existing corpus and the trailing-90-day artifact set, committing the
documents as fixture files so CI never needs a network call. That is a bounded piece of
work and it is the right gate before any candidate reaches a human, but it is not
buildable under §2 (it needs the applied migration and a live classification run).
