# CC-IDF4-ACTIVATE-1.0 — Pre-change snapshot
Run date: 2026-07-21 · Branch `claude/idf4-activate-coverage-dgeuf2` · Project `ycadmmngkdhvpcsrcuaq`
Captured live BEFORE any mutation (Airtable Registry `tbl1ef6FgxUc3Uevg`, `automation_health_log`, Notion `38889a0c168081d583e8d02f1cc3b12a`).

## A. Non-Active Automation Registry targets (56 rows, live Airtable Status)
Designed (unless noted): 051,052,053,054,055(no status),056,057,058,059,120,128,
138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,
158,159,160,161,162,163,167,169,170,171,172,173,174,175,179,185,186,187,198.
Testing: 129,130,131,132,133.  Approved: 168.

## B. Lane classification
- Lane 0 fix-first: 138
- Lane A crawler build-ready (26): 138,139,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,159,160,161,162,163,167,172
- Lane B non-crawler build: 140,158 (primary_source), 169,170,171 (cowork), 173,174,175 (claude_routine); 168 dry-run only (Approved)
- Lane C gated HOLD: 129,130,131,132,133 (JW gates), 186 (Cleanview ToS), 198 (source_type enum + license)
- Lane D facility ingest: 185 (ATLAS), 187 (Epoch)
- Lane E out-of-wave: 053,054,055,056,057,058,128,179
- Ambiguous -> ask: 051,052,059,120

## C. AUTO-138 health-log tail (root cause = auto_id mislabel, NOT immersion runaway)
auto_id=AUTO-138 rows are written by ingest-sdwis-baseline (crawler_id ingest-sdwis-baseline_v1.1..1.4)
and ingest-bls-labor (ingest-bls-labor_v1.0/1.1). 14d totals under AUTO-138:
  ingest-sdwis-baseline_v1.4: runs=213 ok=121 sum_new=1,112,303 last=2026-07-09 (next_offset=done)
  ingest-sdwis-baseline_v1.2: runs=5 sum_new=22,604 ; _v1.3: runs=5 sum_new=9,696 ; _v1.1: 1 run 56
  ingest-bls-labor_v1.1: runs=3 sum_new=26 ; _v1.0: 2 runs 0 ok
Notes verbatim: "sdwis baseline: run=... mode=bulk_rest ... next_offset=done"; "ingest-bls-labor (qcew state=..)".
No AUTO-138_v1.0 (faraday-crawl) row exists; artifacts tagged D7.2 = 0. Backfill already stopped (last 2026-07-09/-11).

## D. Active dedicated sub-domain crawlers (AUTO-060->119) — VERIFIED LIVE
All 60 report crawler_id AUTO-0NN_v1.0, runs=13/ok=13, last run 2026-07-21 07:00:04 UTC,
notes "faraday-crawl v1.1 batched", ~40-52 found/14d, cap-respected (max_new_single=4).
=> Contradicts the Notion line "AUTO-060->119 dedicated set is dormant (Designed)".

## E. Coverage Matrix verdict tally (current, Notion, as of 2026-07-18)
Dedicated-Active 1 | Dedicated-Designed (dormant) 63 | Broad-only 21 | Whitespace 31 | Total 116.

## F. Source census (live)
faraday_subdomains 116/116 active. source_registry 10,733 rows / 7,675 active / 6,238 active-30d.
Domains D1-D23 with active sources: 23/23. Sourcing is not a blocker for any sub-domain crawler.
