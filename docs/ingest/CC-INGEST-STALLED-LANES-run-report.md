# CC-INGEST-STALLED-LANES-1.0 — run report

**Date:** 2026-08-08 · **Project:** `ycadmmngkdhvpcsrcuaq` · **Branch:** `claude/ingest-stalled-lanes-lzlrwo`

Four ingest lanes reported `active` pg_cron jobs while writing nothing for 11–32 days,
and nothing alerted. All four are root-caused below with the gate output that proves it.

---

## The finding that explains all four lanes

**pg_cron's status column is not a health signal for any of these jobs.**

Every one of them calls `public.cron_http_post()`, which ends in `net.http_post()` and
returns a pg_net **request id the instant the request is queued**. So
`cron.job_run_details` records `status='succeeded'` / `return_message='1 row'` whether the
edge function succeeded, 401'd, threw, or was killed mid-run. All 8 jobids show a clean
green history across the entire stall.

The real HTTP outcome lives in `net._http_response`, which retains **~6 hours** (verified:
196 rows, oldest 2026-08-08 12:20). By the time anyone investigates, it is gone. Edge
function logs retain ~24h, so the 08-02 runs were also unrecoverable.

That is why every lane failed *silently* rather than *loudly*. The per-lane causes differ.

---

## Lane 1 — State incentives (jobid 35) · **DEFECT**

**Root cause: the isolate is terminated part-way through the source loop. Termination is
not an exception, so no `catch` runs, no error row is written, and the chain hop is never
dispatched.**

Evidence — the cutoff is byte-identical every week, which rules out a network fault:

| run date | live sources | error rows | records | max offset reached |
|---|---|---|---|---|
| 2026-07-07 | — | — | 76,474 | **65,000** |
| 2026-07-08 | — | — | 46,113 | **32,000** |
| 2026-07-12 | 3 | 0 | 18,204 | **0** |
| 2026-07-19 | 3 | 0 | 18,204 | **0** |
| 2026-07-26 | 12 | 0 | 28,691 | 0 *(manual narrow backfill)* |
| 2026-08-02 | 3 | 0 | 18,204 | **0** |

The three sources reached are always `ny_esd_dei`, `ny_ida_projects`,
`ct_decd_business_assistance`. The 4th in `LIVE_SOURCES` order is
`md_commerce_finance_tracker` — **verified reachable and fast (HTTP 200 in 0.64s)**, so
this is not an upstream hang. Every source body is individually try/caught, so a throw
would have produced an error row; zero error rows means the isolate died.

Two consequences, unnoticed for a month:
1. **10 of the 12 fetchable sources were never polled after 2026-07-08.**
2. **No source was ever read past offset 0** — on `ny_esd_dei`, the first 8,000 rows of a
   65,237-row feed.

### ⚠️ The exposure was latent, not realised — do not read a count delta as data loss

`ny_esd_dei` holds **65,197** against an upstream count of **65,237**. That 40-row delta
looks like loss and is not: a full re-walk of all 9 windows on 2026-08-08 inserted **0 new
rows**. Those 40 are duplicate records *within the feed* that collapse under the content
hash. Same shape elsewhere: `md_commerce` 7,300 fetched → 7,246 held; `ok_quality` 4,324 →
4,217. The bug was real and would have lost the next genuine upstream change — it simply
had not cost anything yet. (An earlier draft of this report asserted 40 rows were missing;
the full walk disproved it.)

### Fix
`ingest-state-incentives` **v1.1 → v1.2**: the chain cursor becomes `(source_index, offset)`
instead of `offset` alone, so **one source per hop**. Work per invocation is now bounded
and roughly constant rather than scaling with the size of the source registry — a 14th
source can no longer break the 13 before it. Also: the hop authenticated with
`SUPABASE_ANON_KEY` and swallowed every outcome via `.catch(() => {})`; `fetch()` only
rejects on transport errors, so a 401/5xx hop resolved normally and vanished. It now uses
the service-role key, checks the status, and writes a `chain_hop_failed` health row.

---

## Lane 2 — International (jobids 24–27) · **MIXED: mostly correct, one real hang**

**The 24-day gap is mostly correct behaviour.** These are annual sources (World Bank
`mrv=1`, Ember/OECD/RSF annual releases) registered as `weekly-check / annual-update`. The
07-19 and 07-26 runs completed `success` with `rows_upserted=0, rows_skipped=<all>` — that
is content-hash idempotency working. `intl_country_raw` last moving 2026-07-15 is expected.

**The real defect:** on 2026-08-02 `intl:worldbank-wdi` (run 38) and `intl:worldbank-wgi`
(run 39) were left `status='running'`, `finished_at IS NULL`, and had stayed that way for
6 days. Both `ingestWdi`'s success path and its `catch` call `runFinish`, so a stuck
`running` means the isolate died reaching neither. Because `ingestWdi` is awaited before
`ingestEmber`, **Ember and RSF-PFI never started at all** on 08-02 — no run rows.

Corrected during investigation: `intl_run_start` has **no concurrency guard**, so the stuck
rows did *not* block the following Sunday. They were a false "in progress" signal, not a
blocker.

**Action taken:** both rows reaped to `status='error'` with an explanatory `error` string.

---

## Lane 3 — Shovels (jobids 136/137) · **DEFECT, already partly fixed; now billing-blocked**

- **jobid 137 has never run in its life** (0 rows in `cron.job_run_details`, all time). It
  was created after 2026-07-15, so **2026-08-15 is its first fire**. It did not miss a run.
- **jobid 136 did fire on 2026-08-01** and failed loudly: `status='failed_contract'`,
  **HTTP 422 on all 51 states** — `state` is no longer a `/v2/permits/search` parameter;
  the API now requires `geo_id`. A genuine **upstream contract change**.
- That 422 was already fixed out-of-band on 2026-08-03 (CC-SHOVELS-422-1.0) and runs
  resumed, storing 34 rows.
- **Current blocker is not code:** `shovels 402 [credits_exhausted]` — *"Trial credit limit
  reached."* This needs a plan upgrade; no code change will clear it.

**Also corrects the ticket's table:** the biweekly cron writes **`shovels_permit_snapshots`**
(last write 2026-08-03, fresh), not `shovels_permit_history` (last write 2026-07-23).
`shovels_permit_history` is populated by the separate `shovels-permit-history` function,
which **has no cron at all** — it is a manual seed table, not a stalled lane.

---

## Lane 4 — EIA 860/861 (jobid 40) · **WORKING AS INTENDED (D4)**

No fix. No defect.

- The cron **did not miss 08-03** — it ran at 02:00:03.
- `eia_ingest_runs` for that run: `rows_seen 28,103 · rows_new 0 · rows_duped 28,103` —
  textbook content-hash idempotency.
- The preceding 07-27 run was the real ingest: `rows_new 28,103`, `attrs_written 31,202`.
- EIA-860 is an **annual** inventory. A weekly cron over an annual source correctly writes
  nothing between releases. `eia_generator_inventory` last moving 2026-07-27 is right.

This lane is **reported as correct**, per D4, and is deliberately registered **poll-only**
in the staleness watch — a data-freshness watch here would be a permanent false positive.

---

## Related — NCSL half-lane (jobid 122) · **DEFECT, upstream**

`ncsl_moratorium_bills` last moved 2026-07-13 while `ncsl_incentive_programs` moved
2026-08-06 behind the same monthly cron. The 08-06 run's stats explain it exactly:

```json
{"subsidies":  {"unchanged": 51, "fetched_via": "wayback", ...},
 "moratorium": {"error": "Error: wayback CDX → 504"}}
```

The subsidies half succeeded; the moratorium half failed on a Wayback Machine CDX **504**.
The run recorded the error faithfully in `ncsl_ingest_runs.error` — and nothing read it.
Caught by the new `error`-mode watch. The upstream 504 itself is transient and out of scope.

---

## Deliverable 3 — the staleness alert

`ingest_staleness_watch` + `fn_ingest_staleness_check()` (migration `0042`) +
`ingest-staleness-healthcheck` edge function + daily 09:00 UTC cron (migration `0043`).
Registering a lane is **one INSERT**; no per-lane code.

### ⚠️ The ticket's premise for a generic alert was half-wrong

`source_registry.cadence` **is** a normalised vocabulary across all 10,783 rows
(`weekly` 9,087 · `daily` 1,600 · `archival_refresh` 59 · `hourly` 14 · `event_driven` 10 ·
`annual` 7 · `quarterly` 4 · `one_time` 2) — but that table is the **source-poller** corpus
and does **not** carry these four lanes. They live in `jw_data_source_registry`, whose
`cadence` is **free text: 57 distinct values across 100 rows**, including prose such as
`'irregular; page metadata shows last modified 2020-07-16 despite site being actively
maintained overall (comments continue through 2026) -- this specific page may not have been
refreshed'`. That cannot drive a machine comparison. `ingest_staleness_watch` is the
normalised binding layer; a follow-up could backfill a `cadence_norm` onto the jw registry.

### Three check modes, because data-freshness alone gets both edge cases wrong

A destination-table timestamp conflates *"nobody polled this"* (defect) with *"polled fine,
upstream unchanged"* (correct). Checking only data freshness would **page every week on
EIA-860** (violating D4) and **never fire on state incentives** (whose table looks fresh
because 3 of 12 sources still run, masking the 9 that stopped).

| mode | question | catches |
|---|---|---|
| `poll` | when did we last *attempt* this source? | all four stalled lanes |
| `data` | when did the destination last change? | only where cadence guarantees change |
| `error` | does the latest run row carry an error? | NCSL's 504, Shovels' 402 |

### Test result — fired against live prod data, in `BEGIN … ROLLBACK`

24 watches → **14 breached, 10 clean**, every one correct:

- **10 state-incentive sources** breached (`md_commerce`, `de_eeif`, `or_*`, `ok_quality`,
  `wi_wedc`, `ia_ieda`, `dc_tif`) — exactly the sources that stopped being polled.
- **`intl:ember` + `intl:rsf-pfi`** breached at 13.7d against a 10.5d threshold — exactly
  the two that never started on 08-02.
- **`ncsl:error`** breached with `Error: wayback CDX → 504`.
- **`shovels:permits:error`** breached with the 402.
- **`eia:860:poll` clean** — D4 honoured, the healthy annual source does not alert.
- `ct_decd`, `ny_esd_dei`, `ny_ida_projects`, and the 4 intl sources that ran: clean.

Nothing was committed — `to_regclass`/`to_regprocedure` confirmed all three objects `null`
afterwards.

### Two bugs the test caught before they shipped

1. **`notes::jsonb` blew up with `22P02`.** `automation_health_log.notes` is free text on
   **17,603 of 17,823** rows. The jsonb filter is now a `CASE ... IS JSON OBJECT`, not
   `AND` — `AND` does not guarantee evaluation order and the planner may hoist the cast
   above the guard; `CASE` is the only construct that guarantees short-circuit.
2. **`errors = '[]'` read as a breach.** That is how a *clean* shovels run records "no
   errors", so every healthy run would have false-alarmed. Now guarded.

### Known limitation

`poll` mode catches "not polled" but not "polled **shallowly**" — `ny_esd_dei` reads clean
because it *was* polled, just only at offset 0. The v1.2 chain fix addresses that directly;
a future `pending_offset` watch could close it in the detector too.

---

## Deliverable 4 — re-ingest

Run against the **currently deployed v1.1** with narrow `sources` scopes (narrow calls stay
inside the isolate budget — proven by the 07-26 backfill). 12 requests, **all HTTP 200**:

- 9 previously-unpolled sources walked to `next_offset=null`: **0 new rows** — genuinely
  current, not broken.
- `ny_esd_dei` walked across all 9 windows (65,237 records): **0 new rows**.
- `ca_calcompetes` produced **no health row at all** — see below.

**Result: `state_incentive_disclosures` unchanged at 120,510.** The lane had no data gap;
it had a polling gap.

### ⚠️ D2 was explicitly waived by Myke (2026-08-08)

The ingest path ends in `fn_state_incentives_resolve_and_score()`, whose final statement is
an unconditional `INSERT INTO jpas_attributes … ON CONFLICT DO UPDATE SET … captured_at =
now()`. **Any** re-ingest therefore writes scoring rows, even with zero new data — so D2
("zero writes to scoring tables") and Deliverable 4 ("re-ingest") cannot both hold. Asked
and answered: *re-ingest normally, accept the scoring writes.*

Quantified, before → after:

| | before | after |
|---|---|---|
| `state_incentive_disclosures` | 120,510 | **120,510** |
| `jpas_attributes` total | 663,878 | **663,878** |
| `jpas_attributes` INC rows | 1,220 / 244 juris | **1,220 / 244 juris** |
| INC `captured_at` | max 2026-07-28 | **1,220 rows re-stamped** |

No rows created, no values changed, no jurisdictions added — only `captured_at` refreshed on
the existing 1,220 INC rows. **Success criterion 5 is therefore not met, by explicit
decision, and this is the exact extent of the deviation.**

### `ca_calcompetes` is push-only, not a stalled source

It is **not in `mappers.ts LIVE_SOURCES`** — the edge runtime cannot fetch its JS-rendered
Ninja Tables widget, so it is seeded by `scrapers/state-incentives/adapters/ca-calcompetes.mjs`
via GitHub Actions into `ingest-state-incentives-push`. A poll watch against the weekly cron
would read `never polled` forever, so it is deliberately excluded from the seed. **The lane
is 12 fetchable sources + 1 push-only, not 13 fetchable.**

---

## What is NOT done

- **Nothing deployed.** Per Myke's "PR first" call: migrations `0042`/`0043` un-applied,
  `ingest-staleness-healthcheck` un-deployed, `ingest-state-incentives` v1.2 un-deployed
  (prod still runs v1.1). Deploy order: **function first, then `0042`, then `0043`.**
- **Shovels needs a paid plan.** 402 `credits_exhausted` is a billing action, not code.
- **The NCSL Wayback 504** is transient upstream; the alert will now surface a recurrence.
- **`jw_data_source_registry.cadence` was not normalised** — out of scope (registry schema),
  but it is the prerequisite for driving the watch table off the registry automatically.
- **FAR-350 comparison:** the root cause here matches the FAR-350 signature (`success=true`
  with `artifacts_new=0` masking a dead lane) but the mechanism differs — FAR-350's BLS lane
  is its own ticket, untouched.

## Verification

- `npm test` — **72/72 pass** (9 new in `test/ingest-staleness-alert.test.mjs`, fixtures
  taken from the real live check output).
- Alert detection exercised against live prod data in `BEGIN … ROLLBACK`; nothing committed.
- Prod writes made this session, in full: 2 `intl_source_runs` rows reaped; 12 ingest
  invocations (0 new disclosure rows); 1,220 `jpas_attributes` INC `captured_at` refreshes.
