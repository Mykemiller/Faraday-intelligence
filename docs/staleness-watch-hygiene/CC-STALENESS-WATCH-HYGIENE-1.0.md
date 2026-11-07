# CC-STALENESS-WATCH-HYGIENE-1.0 — FDY-16 deliverable

**Runs:** 2026-10-04 10:26–11:50 CDT (G0, G1, G4, G5, Shovels follow-up — applied) ·
**2026-11-06 18:45–19:00 CT (this pass: G0 re-measured, G2/G3 staged, G5 re-read).**
Supabase `ycadmmngkdhvpcsrcuaq` only (decoy guard passed 17:02 CT: dc_facilities 18,217 ·
jurisdictions 39,507 · artifacts reltuples 676,301). IDF 5.0 governing doc read first (Notion
canonical page; the PDF is not on this container). This pass wrote **nothing** to the project —
the orchestrator's hard rule holds DML until Myke rules on D1/D2, so G2/G3 are staged, not run.
Runs sequentially after FDY-11 (same table `ingest_staleness_watch`).

## G0 — guard + measure (read-only, 2026-11-06 17:05–18:50 CT)

**How the checker evaluates a watch** (`pg_get_functiondef('fn_ingest_staleness_check')`, live):
- Generic source: `to_regclass(src_schema.src_table)` + dynamic SQL — **any table works, so
  `automation_health_log` is a valid src_table** (the G2 hard stop is not met).
- `poll` and `data` compute the same thing: `max(freshness_column)` vs
  `fn_ingest_cadence_interval(expected_cadence) × grace_multiplier`; NULL max ⇒ breach
  ("never polled" / "destination has never been written"); unmapped cadence ⇒ breach.
- `error`: newest row only (`order by freshness_column desc limit 1`), **no staleness test**;
  `error_is_boolean_ok=true` ⇒ `case when <error_column> then null else 'run reported
  success=false' end` (a NULL boolean reads as failure); otherwise `nullif(btrim(col::text),'')`
  with `'[]'`/`'{}'`/`'null'` treated as clean.
- Filter: exactly **one** equality, `filter_column = filter_value`, or a jsonb-key equality when
  `filter_json_key` is set (guarded by `CASE WHEN col IS JSON OBJECT`). Applies to all modes.
- Per-watch EXCEPTION isolation (one subtransaction per watch).
- The deployed edge function `ingest-staleness-healthcheck` **v13** only calls this RPC plus
  `fn_ingest_owner_cron_check()`; no shape logic lives in TypeScript.
- Limitations: no severity tiers (the 4× "critical" in the companies notes is documentation
  only); error mode cannot exclude rows by a second predicate (e.g. `mode='run' AND …`).

**Companies watches today**

| watch_key | check_mode | src_table | freshness_column | owner_cron | cadence | grace |
|---|---|---|---|---|---|---|
| companies:aliases | data | company_aliases | created_at | companies-alias-miner-weekly (299 ✓) | weekly | 2.0 |
| companies:entity_links | data | company_entity_links | bound_at | companies-entity-binder-nightly (294 ✓) | daily | 2.0 |
| companies:facts | data | company_facts | created_at | companies-about-probe-weekly (442 ✓) | weekly | 2.0 |
| companies:signal_rollup | data | company_signal_rollup | refreshed_at | companies-signal-rollup-nightly (295 ✓) | daily | 2.0 |
| companies:spine | data | companies | updated_at | companies-confidence-recompute-nightly (297 ✓) | daily | 2.0 |

**Heartbeats, last 30 days (`automation_health_log`)**

| crawler_id | runs | success | last run (UTC) | max gap |
|---|---|---|---|---|
| companies-confidence-recompute_v1.0 | 30 | 30 | 2026-11-06 03:55 | 1 day |
| companies-alias-generator_v1.0 | 4 | 4 | 2026-11-02 05:10 | 7 days |
| companies-alias-miner_v1.0 | 4 | 4 | 2026-11-02 05:10 | 7 days |
| companies-entity-binder_v1.0 | 25 | 25 | 2026-11-06 03:15 | **6 days** |

`fn_ingest_staleness_check()` 17:05 CT: **companies:spine breached** (data stale 4d 19h vs 2d) and
**companies:aliases breached** (18d 17h vs 14d) while both owner jobs ran clean — the false-positive
class this CC exists for. `companies:entity_links` reads clear today but its 6-day heartbeat gap
was invisible to the data watch. `companies:facts` and `companies:signal_rollup` clear.

**Wildcard / missing owners:** `owner_cron ~ '[*%]'` → one row, `intl:jds-directories`, now
`enabled=false, dormant_class='retired'` (FDY-15, applied 14:49 CT today), so
`fn_ingest_owner_cron_check()` → **0 rows**. Both `shovels:permits:*` watches carry
`shovels-refresh-first` (10-04 follow-up).

## G1 — snapshot (applied 2026-10-04)

`archive.ingest_staleness_watch_20261004` — **68 rows**, equal to live at the time; still present
(re-counted 18:50 CT: 68). The G2/G3 file below takes a fresh snapshot
`archive.ingest_staleness_watch_20261106` before writing, because the table has moved since
(FDY-15 dormant row, Shovels owner fix, five wildcard conversions).

## G2 / G3 — staged, NOT executed (D1 / D2 pending Myke)

`cc-staleness-watch-hygiene-1.0-g2-g3.sql` (byte-identical to
`Mykemiller/Faraday docs/staged/fdy11_g3_companies_watches.sql`, PR #49 — FDY-11 re-derived it
against today's schema; apply one of the two, once):

| watch_key | before | after (staged) |
|---|---|---|
| companies:spine | data · companies.updated_at · grace 2.0 | **poll** · automation_health_log · `crawler_id='companies-confidence-recompute_v1.0'` · run_started_at · daily · **grace 2.5** (worst observed gap == the 2× threshold ⇒ 2× flaps) |
| companies:aliases | data · company_aliases.created_at | poll · automation_health_log · `crawler_id='companies-alias-generator_v1.0'` · weekly · grace 2.0 |
| companies:entity_links | data · company_entity_links.bound_at | poll · automation_health_log · `crawler_id='companies-entity-binder_v1.0'` · daily · grace 2.0 (a 6-day gap SHOULD breach) |
| companies:spine:error | — | error · success (boolean-ok) · same filter/owner · daily |
| companies:aliases:error | — | error · success (boolean-ok) · same filter/owner · weekly |
| companies:entity_links:error | — | error · success (boolean-ok) · same filter/owner · daily |
| companies:intake (D2) | — | data · companies.created_at · monthly · grace 1.5 · owner_cron NULL · labelled intake |

Every UPDATE is guarded on `check_mode='data'` and asserts exactly 1 row; INSERTs are
`on conflict do nothing` with count assertions; the file is one transaction with the reversal
(restore from the 2026-11-06 snapshot) in a trailing comment.
Expected after apply: the six heartbeat/error watches clear; **companies:intake breaches
immediately** (last company inserted 2026-09-07; threshold 46 days) — a true statement about
intake, by design.

## G4 — owner-cron existence check (applied 2026-10-04 — unchanged)

`fn_ingest_owner_cron_check()` (migration `20261004152725`) flags `owner_cron_wildcard` and
`owner_cron_missing`; healthcheck **v12 → v13** surfaces them in the mail and the response
(additive fields). The v12→v13 diff, token redacted on both sides, is in
`healthcheck-v12-to-v13.diff` (167 lines: owner-cron RPC call, `OwnerCronFinding` type,
`buildOwnerCronHtml`, subject suffix).

**Repo state of the function — read this before touching the copy in this repo.**
`supabase/functions/ingest-staleness-healthcheck/` here is the **v12** body (pre-G4) and it carries
the plaintext fcron house-token literal in git. The deployed v13 was captured verbatim in
`Mykemiller/faraday-jurisdiction-watch@ae4beaf` (2026-10-24) and converted by FDY-204
(`bb5f65e`) to read `CRON_TOKEN` from the function secret via `cron-auth.ts` — that repo is now
**ahead of production** and is the canonical home. This pass deliberately did **not** re-sync v13
into this repo (it would plant a second copy of the token literal); the recommendation, recorded as
CLAUDE-PROPOSED, is to retire this repo's copy once FDY-204 deploys.

## G5 — verify (read-only; the edge function was not invoked)

`fn_ingest_staleness_check()` at 17:05 CT: 57 enabled watches, 6 breached —
`companies:spine`, `companies:aliases` (this CC, cleared by G2 once applied),
`rsc:usfws:nwi:error` (FDY-11 G1), `ferc:form1:sched204:refresh`, `intl:ember`,
`rsc:fema:nfhl:poll` (out of scope, reported on FDY-11). `fn_ingest_owner_cron_check()`: 0 rows.
Post-apply check for Myke:

```sql
select watch_key, breached, detail from fn_ingest_staleness_check() where watch_key like 'companies:%' order by 1;
select * from fn_ingest_owner_cron_check();   -- zero rows
```

## Decisions

- **D1** — RECOMMENDED, **staged, not applied** (hard rule).
- **D2** — RECOMMENDED, **staged, not applied**; grace 2.5 on the spine heartbeat is the one
  parameter not in the original D1 text (reason above).
- **D3** — RECOMMENDED, applied 2026-10-04.
- **CLAUDE-PROPOSED:** retire this repo's v12 healthcheck copy in favour of the
  faraday-jurisdiction-watch copy; add a mode filter to `ncsl:poll` (FDY-11 G4 covers `ncsl:error`
  only); a transient-aware error watch (breach after N consecutive failing runs) as a checker
  change — the NWI lane shows why.

## Out of scope, untouched
`companies:facts` (FDY-12), severity tiers, any company crawler logic.
