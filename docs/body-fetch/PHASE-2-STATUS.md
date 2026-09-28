# CC-ARTIFACT-BODY-FETCH — Phase 1 close-out + Phase 2 status (SEC EDGAR)

Run date 2026-09-27. Project `ycadmmngkdhvpcsrcuaq`. **Phase 2 is STOPPED at step 2a**
(3 consecutive SEC blocks). Zero SEC documents fetched, zero SEC embedding spend.

## Phase 1 — step 1c completed here

Phase 1 (PR #66, `PHASE-1-RUN-REPORT.md`) fetched the PUC/.gov slice but could not re-embed:
`OPENAI_API_KEY` is an edge-function secret. Myke approved running it (2026-09-27).

- New edge fn **`artifact-body-fetch`** (v2 / `_v1.1`, verify_jwt=false, fcron/service-key auth).
  `embed` mode chunks `raw_content + body_text` with the verbatim `enrich-pure.chunkText`
  (2,048 / 256, drop ≤50), embeds `text-embedding-3-small` in batches of 96, and replaces an
  artifact's chunks **atomically** (`artifact_body_replace_chunks`: delete + insert in one txn).
  Respects `artifact_should_chunk()`.
- **Result: 110 canonical artifacts, 646 chunks, 243,874 tokens (~$0.005)**, 0 failures; all
  1536-dim. (Phase 1 estimated 138 artifacts / ~430k tokens; the live canonical count is 110.)
- v1.0 hit the edge **CPU limit** (`WORKER_RESOURCE_LIMIT`) on its first call; v1.1 lazy-loads
  pdfjs, asks OpenAI for base64 embeddings (typed-array decode, no JSON float parsing), writes
  its run row at start, and takes `limit`/`lease_seconds` from the caller.
- Driver cron `artifact-body-embed-puc-gov` ran 21:50–21:59 UTC and is **unscheduled**; the
  puc_gov embed gate is closed again.

## Phase 2 — what was built (ready, gated off)

- `artifact_body_fetch_lanes` (config; edit rows, no redeploy) + `artifact_body_fetch_runs`
  (telemetry). Lane `sec`: `fetch_enabled=false`, form priority `{10-K, 8-K}` (Myke's scope
  decision: 10-K first), 250 ms between request starts (4 req/s), block ⇒ persisted backoff
  60s·2^(n-1), 3 consecutive blocks ⇒ lane disabled, >20% failure over the recent window ⇒
  lane disabled.
- EDGAR extraction (`body-pure.ts`, 14 tests): first `<DOCUMENT>` of full-submission .txt files,
  Inline XBRL header removal, noise-line strip, signature / exhibit-index tail cut for PRIMARY
  documents only — **exhibit documents are kept whole** (Myke's exhibits decision), 500k-char
  cap at a paragraph boundary with `body_meta.truncated` + `original_chars`.
- `artifacts.sec_form_type` backfilled from `crawl_metadata.form`: **10-K 9,845 · 8-K 18,024 ·
  null 5**. The SEC header's `CONFORMED SUBMISSION TYPE` overrides it when a fetch sees one.
- SEC is fetched through the **database** egress (`artifact_body_sec_http_get`, sec.gov-only),
  because `sec-archives-egress-probe` v2 proved SEC refuses the Supabase **edge** IP range.

## Phase 2 — step 2a probe: blocked three times, stopped

| # | UTC | request | response |
|---|---|---|---|
| 1 | 21:51 | `/os/webmaster-faq`, UA as extra header | 403 **Request Rate Threshold Exceeded** |
| 2 | 21:58 | a 10-K document, UA as extra header | 403 **Undeclared Automated Tool** |
| 3 | 22:00 | same 10-K, ONE UA via `CURLOPT_USERAGENT` | 403 **Undeclared Automated Tool** |

UA each time: `Faraday Intelligence LLC mykemiller@gmail.com`. Backoff respected (7 min, then
2.5 min). No Faraday SEC cron runs at that hour (they fire 03:45–08:20 UTC), so block #1 was not
our own traffic — the database egress IP is likely shared/flagged.

**Found between #2 and #3:** `fn_sec_edgar_fts_ingest` documents (verified live 2026-08-01) that
SEC accepts pgsql-http's **default** UA from this IP and 403s custom UAs — and that an
`http_header('User-Agent')` is sent *in addition to* the default, which SEC rejects as
undeclared. Request #3 fixed the duplicate header (migration 0088) and was still refused.

## Decision needed (Myke)

The brief forbids routing around a refusal, so each of these is a policy call, not a retry:

1. **Database egress with pgsql-http's default UA** — what the daily EDGAR jobs already use
   successfully. Contradicts the brief's "declared organisation + email" rule; SEC appears to
   accept it from this IP anyway.
2. **A GitHub-hosted runner** (the path Phase 1 used for PDFs) with the declared UA and the same
   pacing, writing bodies back via a service-role secret. Different egress, standard SEC
   compliance; needs the secret + a write path (the same gap that left Phase 1's 55 PDF rows
   unloaded).
3. **Stop** — leave the SEC slice at title + metadata.

Nothing further hits sec.gov until one is chosen. Re-enable with
`update artifact_body_fetch_lanes set fetch_enabled=true, consecutive_blocks=0, backoff_until=null,
disabled_reason=null where lane='sec'` plus a driver cron.

## Numbers for the 2d/2e decision (estimates — no bodies fetched)

- 10-K main documents typically extract to 150k–400k chars; with the 500k cap, **~9,845 10-Ks ≈
  2–3 B chars ≈ 0.5–0.75 B embedding tokens ≈ $10–15** at text-embedding-3-small pricing, and
  ~1–1.5 M new chunks (≈9–13 GB with the HNSW index, on a 22 GB database). Storage is the real
  cost, not tokens. Measure on the first ~200 fetched 10-Ks before approving 2e.

## p_min_content_length (Phase 1 §8)

Unchanged: the gate still reads raw `content_length`, so no threshold matters until it reads
`coalesce(body_char_count, content_length)`. Phase 1's 1,200 stands provisionally; SEC bodies
would sit orders of magnitude above it, so it should be re-derived once they exist.

## Rollback

`update artifacts set body_embedded_at=null, body_chunk_count=null where body_embedded_at is not null;`
restores nothing by itself — the old raw_content chunks were replaced. To restore them, re-queue
the 110 artifacts through `enrich-artifacts` or re-chunk `raw_content`. Lanes/runs tables and the
`artifact_body_*` functions are additive and can be dropped; `sec_form_type`/`body_meta` columns
are nullable additions.

---

## Update 2026-09-28 — default UA, 10-K fetch, 2d measurement

**Access (Myke: "Use the default").** `artifact_body_sec_http_get` sends pgsql-http's default
User-Agent (0090). Probe 2a: 10/10 HTTP 200. Since then: **0 SEC blocks** across ~9.9k requests.

**Driver.** 100-doc invocations were killed by the edge worker limit (546) after ~35 docs each —
retuned to 15 docs / 20 s (0094). v1.2 charges the attempt before the fetch so a killed doc cannot
wedge the queue.

**Stop (17:16 UTC):** the >20% failure-rate guard fired — 22.9% over 105 attempts, **all HTTP 404**.
The 10-K queue reached 2001-era rows whose URLs are legacy per-document paths
(`/Archives/edgar/data/<cik>/<accession>/0001.txt`) that EDGAR no longer serves. 162 rows carry that
shape (12 failed, 104 pending 10-K, 46 pending 8-K); everything else is unaffected. Lane disabled,
awaiting Myke.

### 2d — 10-K depth (9,522 of 9,845 fetched ok)

| | before (raw_content) | after (body_text) |
|---|---|---|
| median chars | 147 | **293,900** |
| p90 chars | — | **476,068** |
| rows ≥ 800 chars | 4 | **9,492** |
| distinct companies (CIK) ≥ 800 | 4 | **2,290** |

Size guard fired on **752** (7.9%); **974** "10-K" rows are exhibits (kept whole). 5 `empty` rows are
PDFs (the DB `http` path cannot carry binary). Bodies added ~1.2 GB to `artifacts` (TOAST-compressed).

### 2e estimate — NOT started

Qualifying rows: **9,499**, **2.71 B chars** → ≈ **1.52 M chunks** (2,048 / 256 overlap),
≈ **650–680 M tokens** ≈ **$13–14** (text-embedding-3-small). **Storage ≈ +23 GB** at the existing
`artifact_chunks` footprint (~15 KB/chunk incl. HNSW) — the database is 23 GB today. Wall time ≈ 10 h
at edge limits. Options for Myke in the report.
