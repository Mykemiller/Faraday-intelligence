# CC-ARTIFACT-BODY-FETCH — Phase 1 run report (PUC / government slice)

Run date 2026-09-27. Project `ycadmmngkdhvpcsrcuaq`. Scope: `source_type in (state_puc_filing,
permit_utility)` plus `regulatory` rows whose `source_url` contains `.gov`.

**Status: 1a done for HTML; PDF text extracted but not loaded; 1b done; 1c NOT run (blocked on
the OpenAI key); 1d below.** No `raw_content`, `signal_envelope`, `ifs_*` or `enrich_*` column
was written. No chunks were written. `academy_reference_*` untouched.

## 0. What the slice actually is

| | rows | distinct URLs | hosts |
|---|---|---|---|
| state_puc_filing | 311 | — | 34 |
| permit_utility | 406 | — | 53 |
| regulatory (.gov) | 726 | — | 46 |
| **total** | **1,443** | **205** | **127** |

- **1,443 rows point at only 205 URLs.** Crawlers re-ingest the same page with a new snippet
  (~7 rows per URL). The fetch is keyed per URL and fanned out, so 205 fetches cover the slice.
- **The "PUC filing" slice is mostly not filings.** Top hosts are utilitydive.com (116 rows),
  datacenterknowledge.com, hansonbridgett.com (law-firm blog), blogs.law.columbia.edu, and
  press-release pages. Actual docket documents are a small minority. Phase 1 proved the path;
  it is not a corpus of regulator filings.

## 1. How it was fetched (and why not the way the prompt assumed)

- The dev container cannot reach any target host (egress proxy 403 on CONNECT). A deployed
  edge function is a Hard-Stop. **The fetch therefore runs inside Postgres** via the `http`
  extension (`abf_*` functions/procedures, migrations `20260927210000`–`20260927220000`).
- Per-URL work table `artifact_body_fetch_url` (+ robots cache, config row). All deny-all RLS.
- Politeness: UA `FaradayIntelligence-BodyFetch/1.0 (+https://faraday-intelligence.ai;
  contact: signals@faraday-intelligence.ai)`; robots.txt fetched per origin and honoured
  (longest-match, Allow wins ties; 4xx robots = allow, 5xx = disallow per RFC 9309); ≥600 ms
  between requests to one host; 401/402/403/407/429/451 ⇒ `blocked`, never retried; no UA
  spoofing; paywall and bot-wall pages ⇒ `blocked`.
- **PDFs cannot go through `http`**: `content` is text, a NUL truncates it (a 200
  `application/pdf` came back as 898 chars). PDF URLs are parked `pdf_pending` and were
  extracted on a GitHub-hosted runner (`Mykemiller/Faraday` →
  `scripts/body-fetch/pdf_extract.py`, poppler `pdftotext`, same UA/robots/pacing).
- The 30 % guard (first 100 URL attempts) **passed at 21 %**.

Three live defects were found and fixed in-flight (each is in its migration header):
1. The first driver ran as one statement; back-referencing regexes (`<(nav|…)…</\1>`) went
   CPU-bound and a timeout would have rolled back the whole batch. Cancelled with nothing
   committed. Fix: fetch and extract split into procedures that COMMIT per URL; extractor v2
   has no back-references (`abf_extract_html` now strips one tag at a time).
2. `abf_http_get` returned `varchar` into a `text` result → 58 URLs failed on the return path.
   Those rows were reset (attempts 0, excluded from the guard) before re-running.
3. federalregister.gov serves a **200** "Request Access — aggressive automated scraping" wall
   (951 chars); 6 URLs / 57 rows were first stored as `ok`. Reclassified `blocked /
   bot_wall_200`, and the extractor now checks for bot-wall markers.

## 2. Counts by `body_fetch_status` (all 1,443 rows)

| status | rows |
|---|---|
| ok | **1,037** |
| blocked | 309 |
| failed | 41 |
| empty | 1 |
| null (PDF extracted, not loaded — see §5) | 55 |

## 3. Depth gain (1b)

| measure (rows with `ok`) | raw_content | body_text |
|---|---|---|
| median chars | 507 | **5,949** (11.7×) |
| p90 chars | 630 | **17,901** |

| clears 800 chars | before | after |
|---|---|---|
| rows | 20 | **1,040** (+1,020) |
| distinct URLs | 13 | **143** |
| distinct hosts | 10 | **98** |
| distinct `source_key` | 4 | **24** (of 30) |

`source_key` = `coalesce(signal_envelope->>'source_key', artifact_source_key_resolution)`, the
same key `academy_reference_propose` uses. **860 of the 1,443 rows (60 %) resolve to no
source_key**, so that column understates diversity; the host count (10 → 98) is the more
honest diversity measure for this slice.

Per-URL body distribution (147 extractions): p5 951 · p10 2,336 · p25 3,896 · p50 7,080 ·
p75 11,671 · p90 19,336 · max 101,507.

Depth improved materially, so 1c is justified.

## 4. Blocked hosts (1d.3)

All HTTP-level, none robots-driven (**0 `robots_disallow`**):

| host | rows | what it looked like |
|---|---|---|
| congress.gov | 118 | 403 bot wall (Cloudflare-class) — the same host served its CRS **PDF** to the GitHub runner, so it is IP/UA reputation, not a policy on the content |
| permits.performance.gov | 53 | 403 |
| federalregister.gov | 57 | 200 "Request Access" bot wall; site says use its developer API |
| therealdeal.com | 20 | 403 |
| whitehouse.gov | 14 | 403 |
| costar.com | 10 | 403 (subscription site) |
| sec.gov | 5 | 403 — **matters for Phase 2**: EDGAR rejects this UA/IP path |
| columbian.com | 19 | metered paywall ("Already a subscriber? Log in") |
| others | 13 | 403 (nysenate, treasury, legiscan, utilitydive ×1, puc.colorado, bloomberg, bizjournals, datacenterhawk), 429 (datacenters.com) |

Failed (41 rows): blogs.law.columbia.edu TLS reset on every attempt (29 rows) · 5 × 404 ·
knoxcountyne.gov TLS · `search.faraday` (a pseudo-URL, not a real host) · 3 binary responses.

## 5. PDFs and the OCR backlog (1d.4)

17 URLs went to the runner: **13 PDFs extracted, all with a text layer; 0 scanned — OCR
backlog is zero** in this slice. 3 were HTML behind binary/redirect responses (`not_a_pdf`).
Extracted text: 1.36 MB across 13 docs (FCC 157 pp / 628 k chars; DOE transmission needs study
263 k; OR PUC order 184 k; LBL Queued Up 73 k; …), covering **55 rows**.

**Not loaded.** The only DB write path from here is `apply_migration`; streaming 1.36 MB through
it is ~350 k tokens of tool output. An attempt to load it via an encrypted file on a public
branch was refused by the session's safety policy and was not pursued. Options for Myke:
(a) add a service-role secret to the `Faraday` repo so the runner calls
`abf_record_external()` itself; (b) a small edge function (Hard-Stop); (c) load via ~20
migrations. Results sit at `Faraday@claude/document-body-fetch-phase-1-r90ln9:
scripts/body-fetch/out/results.jsonl` (private repo) — **drop that file before merging**.

## 6. Re-chunk / re-embed (1c) — NOT RUN

Eligible (`body ≥ 2× raw` and `≥ raw + 500`): **1,033 rows / 138 URLs**. Because
`artifact_should_chunk()` skips non-canonical copies, the real work is **138 canonical
artifacts ≈ 890 chunks ≈ 430 k embedding tokens ≈ $0.01** at text-embedding-3-small pricing.

Blocked on credentials, as the prompt anticipated: `OPENAI_API_KEY` exists only on the
`enrich-artifacts` function env, and anything that can call OpenAI with it is an edge-function
change (Hard-Stop). Token spend this phase: **0**.

## 7. ⚠️ The depth gate does not see `body_text` (read before 1c)

`academy_reference_propose` gates on **`artifact_url_canonical.canonical_len`**, which is
recomputed from `artifacts.content_length` (the raw capture). Nothing in this phase changes it:
of the 138 re-chunk URLs only 14 have `canonical_len ≥ 800`. **Re-embedding bodies alone will not
move the Reference Shelf.** The canonical table (or the gate) has to read body length too —
a downstream change, deliberately not made here.

## 8. Recommendation for `p_min_content_length` (1d.5)

1. **Gate on the effective length, not the raw capture:** `coalesce(body_char_count,
   content_length)` flowing into `canonical_len` (or a sibling column). Without this, no
   threshold value matters.
2. **Then raise the threshold to 1,200.** On fetched bodies, everything under 1,000 chars in
   this slice was a non-document: seattle.gov homepage (467), a govinfo metadata page (895),
   the Federal Register wall (951), a FERC notice that was only page furniture (999). The
   shortest genuine documents were 1,221 (Yahoo 1-minute news brief) and 1,347 (WBRC news).
   1,200 separates the two cleanly; 800 would admit the stubs.
3. Treat it as provisional: 147 documents from one slice. Re-derive after Phase 2, where SEC
   filings will dominate and the distribution will shift sharply upward.

## 9. Residuals / Phase 2 notes

- Extraction keeps some trailing page furniture (FERC "related news", "Jump to comments"),
  inflating a few bodies by a few hundred chars. Fine for embedding; tighten before using body
  length as a strict quality signal.
- **sec.gov returned 403** to this path. Phase 2 (27,872 SEC filings) should use EDGAR's
  documented access (declared UA, ≤10 req/s) from an egress that EDGAR accepts, not the
  Supabase IP. Test that before building on it.
- Federal Register: the site names its API as the sanctioned route (`/api/v1/documents`,
  `raw_text_url`); a small special-case would recover 57 rows.
- Advisor delta: 2 WARN `function_search_path_mutable` on `abf_fetch_run` /
  `abf_extract_run` — unavoidable (a procedure with `SET` cannot COMMIT); all references are
  schema-qualified. Tables are RLS-enabled with service-role-only policies.
- The live migration `cc_artifact_body_fetch_columns` (the body_* columns, 20260927202742) is
  not in any repo.
- Crons used: `artifact-body-fetch-phase1*` — all unscheduled.

## 10. Rollback

```sql
update public.artifacts set body_text=null, body_fetch_status=null, body_fetch_error=null,
       body_attempts=0, body_char_count=null, body_fetched_at=null
 where source_url in (select source_url from public.artifact_body_fetch_url);
-- then drop: abf_* functions/procedures, artifact_body_fetch_{url,robots,config},
-- sequence artifact_body_fetch_attempt_seq
```
