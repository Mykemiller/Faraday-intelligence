# CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — Run report (Wave 1)

_2026-07-26. Companion to the investigation gate findings
(`CC-INGEST-STATE-INCENTIVE-ALL-WAVES-investigation.md`)._

## What shipped in this PR

1. **Vendored the live function into VCS.** `ingest-state-incentives`
   (`index.ts` + `mappers.ts`) was running only as deployed Supabase edge fn v10
   and was in no repo. Committed verbatim as the baseline, then extended.
2. **Wave-1 multi-protocol fetch.** `index.ts` gained a `kind`-dispatched fetcher
   (`fetchPage`/`fetchWindow`) over the existing Socrata client:
   - **CKAN** `datastore_search` (offset/limit)
   - **ArcGIS** hosted FeatureServer `query` (keyset via `orderByFields`,
     `exceededTransferLimit`-aware paging — needed because layer maxRecordCount
     (2000) can differ from our window size)
   - **idh_json** (Iowa Data Hub `rows.json`, offset/limit)
   The Socrata path, chain/paging contract, content-hash upsert, per-source
   `automation_health_log`, and the `fn_state_incentives_resolve_and_score` call
   are all unchanged.
3. **3 new live per-recipient sources** (`mappers.ts`), field-mapped from REAL
   probed responses (not guessed):

   | source_key | state | protocol | rows @ probe | county? | INC-resolves? |
   |---|---|---|---:|---|---|
   | `ok_quality_jobs` | OK | CKAN | 4,324 | ✗ (city/zip only) | not until city→county resolver |
   | `wi_wedc_ared` | WI | ArcGIS | 4,867 | ✓ | ✓ full INC-01..05 |
   | `ia_ieda_awards` | IA | idh JSON | (paged) | ✓ | ✓ full INC-01..05 |

4. **Registry backfill migration** `0034_cc_state_incentive_source_registry.sql`
   (un-applied; apply at promotion): registers all 8 pre-existing live Socrata
   feeds + the 3 Wave-1 sources + HI (registered-not-ingested) in
   `jw_data_source_registry`. Closes the gap that **zero** state-incentive sources
   were registered. All `confidence_cap = SRC` (primary per-recipient disclosures).
5. **Tests** `test/incentive-mappers.test.mjs` — 10 cases over the 3 new adapters
   + date helpers + config invariants, asserted against the real captured rows.
   `npm test` green (**57/57**).

## Verification performed (this session)

- **Endpoint liveness**: confirmed server-side via Postgres `pg_net`
  (`extensions.http_get`) — the container's own egress is blocked by the network
  policy, so probes ran inside the Supabase project. OK/WI/IA all HTTP 200 with
  per-recipient rows; field names in the adapters are copied from those responses.
- **Mapping correctness**: unit-tested against the real first-page rows
  (award amounts, county, dates, incentive_type, record ids).
- **Type safety**: `mappers.ts` imported+run under Node `--experimental-strip-types`.

## Verification DEFERRED to the deploy gate (needs prod authorization)

These write to the production data plane / outward-facing systems and were **not**
done unprompted:

- **Deploy** the extended `ingest-state-incentives` + **seed** OK/WI/IA (a bounded
  `{states:["WI"],pages:1}` smoke pull, then chain) into
  `state_incentive_disclosures`.
- **Idempotency re-run** (re-pull → 0 new by content_hash) — the existing engine
  already dedupes on `content_hash`; new sources reuse the identical path.
- **`get_advisors`** security/RLS check post-seed (no schema change expected — the
  table + RLS already exist; migration only inserts registry rows).
- **Apply** migration `0034`.

## AUTO-ID (per FAR-339 reservation lesson)

Checked the Airtable Automation Registry (`appxfti7VuoHYUeu6/tbl1ef6FgxUc3Uevg`)
before hardcoding:
- `AUTO-178` in the registry = **"Faraday Crawl Health-Check"** (Active). The
  state-incentive ingest **borrows AUTO-178** for telemetry continuity — a real,
  pre-existing collision (documented in the fn header since v1.1).
- Registry max is **AUTO-203**; **next free = AUTO-204**.
- **Recommendation (Myke-gated, NOT done here — Airtable is outward-facing):**
  reserve **AUTO-204** "State Incentive Disclosure Ingest" and repoint the fn's
  `AUTO_ID` off AUTO-178. Wave 1 needs no *new* automation — it rides the existing
  function — so nothing was created in Airtable this session.

## Scope note — Waves 2–4 (deliberately NOT mass-authored)

Waves 2–4 (~40 states of bulk-Excel, HTML-portal scrapes, and PDF/OCR/FOIA) were
scoped, not built, because:
- The container cannot reach the sources to iterate against live responses (egress
  policy), so scrapers/PDF parsers can't be validated here — shipping them untested
  risks the fabricated/over-confident data the task's own rules forbid.
- Waves 3–4 need a **confidence-tiering change**: `fn_state_incentives_resolve_and_score`
  currently hardcodes `SRC`/0.85 for every resolved row. INF/EST for scraped or
  estimated data requires a per-source confidence input on the RPC — a schema/RPC
  change that should land on its own gate, not be smuggled in with Wave 1.
- **GA** is documented as suppressed-by-law (recipient names not public; aggregate
  county-threshold PDFs only) in the source registry notes — no recipient-level
  capture will ever be attempted.

Recommended sequencing for the next passes is in the investigation doc's §5 table.
Each subsequent wave should be its own PR with server-side iteration against the
live source.
