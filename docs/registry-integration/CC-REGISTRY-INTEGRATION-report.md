# CC-REGISTRY-INTEGRATION-1.0 — investigation + execution plan

**Type:** Report only. **Zero writes performed** — every statement issued against
`ycadmmngkdhvpcsrcuaq` in this investigation was a `SELECT`. No DDL, no DML, no
edge-function deploy, no cron change.

**Date:** 2026-08-08. **Baseline:** `source_registry` = 10,783 rows.

---

## 0. Headline: the ticket's premise is wrong on three of six tables

Before planning a fold, the ticket's table was verified row-by-row against prod.
**Three of the six "unreconciled" tables are already reconciled**, and the two
cited as the motivating defect — PUC and agenda — are **not collapsed into one row
each**.

| Ticket claim | Verified reality |
|---|---|
| `puc_sources` "collapsed into one `puc:dockets` row" | **False.** 25 per-portal rows exist: `puc:al`, `puc:az`, … `puc:wi`, each carrying `legacy_ref = {"table":"puc_sources","pk":"<STATE>"}`. `puc:dockets` is a *separate* row inherited from the retired `jw_data_source_registry`, deliberately marked `countable=false`. |
| `jurisdiction_agenda_sources` "collapsed into one `agenda:legistar` row" | **False.** 21 per-portal rows exist: `agenda:<uuid>`, one per portal, `legacy_ref = {"table":"jurisdiction_agenda_sources","pk":"<uuid>"}`. `agenda:legistar` is likewise a non-countable inherited umbrella row. |
| `source_destination_map` "mapping table, 3 alias conventions" | **False.** 188 of 188 rows join `source_registry.source_key` **exactly**. There is a real `FOREIGN KEY (source_key) REFERENCES source_registry(source_key) ON DELETE CASCADE`. Zero unmatched, zero ambiguous, zero aliases. |
| `jw_local_feed_sources` "50 by feed_url, 379 LIVE FEEDS ABSENT" | **Confirmed exactly.** 645 total, 50 matched, 429 live, **379 live unregistered.** |

The counts line up precisely — `subsystem='puc'` in `source_registry` is 25 rows and
`puc_sources` is 25 rows; `subsystem='agenda'` is 21 and `jurisdiction_agenda_sources`
is 21 — because migration `0002_source_registry_phase0_backfill.sql` §2 and §3 already
expanded both, one registry row per portal.

**This changes the shape of the work.** D3 (per-portal visibility) is not blocked on a
fold that was never needed. The real defect is different, and worse in a quieter way:

> **The per-portal rows are a frozen snapshot. Nothing keeps them current.**

`ingest-puc-dockets` (deployed edge fn, `jw` repo, cron 121) writes
`puc_sources.status` / `.cursor` / `.notes` and **never touches `source_registry`**.
Same for the agenda lane. So the registry mirror was accurate the day migration 0002
ran and decays silently from then on. Today the two happen to agree — every PUC
portal's `source_registry.status` still matches the mapping applied at backfill — but
that is coincidence, not a mechanism.

**And that is precisely the symptom the ticket describes, arriving by a different
route.** `jurisdiction_agenda_items` holds 0 rows while 11 agenda registry rows read
`status='active'` with `last_artifact_at = 2026-07-17`. That timestamp was **copied
from `jurisdiction_agenda_sources.last_scraped_at` at backfill time** (migration 0002
line 51: `case when a.scrape_status = 'active' then a.last_scraped_at end`). It is not
evidence of a successful recent run. The board looks green because it is a
three-week-old photograph, not because a collapsed row is hiding failures.

---

## 1. Per-table grain classification (Investigation gate §1)

Grain answers one question: *what does one row mean?* Fold only same-grain
(D2).

| Table | Rows | Grain | Evidence | Fold-eligible? |
|---|---|---|---|---|
| `jw_local_feed_sources` | 645 | **Origin (feed instance = origin here)** | PK `id`, unique `(state_abbr, feed_url)`. One row = one outlet's one syndication feed — the same thing a `source_registry` row with `source_type='news_feed'` means. `access_kind ∈ (rss, atom, json, html_scrape, api, partner)` maps onto `access_method`. | **YES — same grain** |
| `source_destination_map` | 188 | **Destination mapping (child of origin)** | PK = `source_key`, FK → `source_registry` ON DELETE CASCADE. 1:1 with a registry row; describes where that source *lands*, not what it *is*. | **NO — already a correct child** |
| `forecast_sources` | 51 | **Publication / document catalog** | PK `source_id` (text slug). Columns are `horizon_end_year`, `latest_vintage`, `revision_signal`, `archive_recoverable`, `jpas_tiers`, `attribute_codes`. `machine_access` includes **`PDF Only`**. A row is a *forecast product* (e.g. an ISO load forecast edition series), not a pollable feed. | **NO — different grain** |
| `puc_sources` | 25 | **Origin (portal) + runtime cursor state** | PK `state_abbr`. Carries `cursor jsonb` (live paging state: `last_from`/`last_to`/`earliest_filed`), `access_kind`, `state_fips`. The *identity* half is already mirrored; the *runtime* half is not. | **Split — identity mirrored, state stays** |
| `ext_source_series` | 24 | **Series (child of origin)** | PK `(source, series_code)`. `source` is a registry key. **9 of 9 distinct `source` values resolve to a `source_registry.source_key`** (`wb:wdi`, `fao:aquastat`, `eurostat:regional`, `cred:emdat`, `ilo:ilostat`, `ilo:normlex`, `ituc:gri`, `oecd:regional`, `wri:aqueduct40`). N series under 1 origin. | **NO — already a correct child** |
| `jurisdiction_agenda_sources` | 21 | **Origin (portal) + runtime state**, jurisdiction-scoped | PK `id`, FK → `jurisdictions`, unique `(jurisdiction_id, platform)`. Same split as `puc_sources`. | **Split — identity mirrored, state stays** |
| `jw_source_candidates` | 8 | **Candidate (pre-registration queue)** | `status ∈ (pending_review, approved, rejected, deferred, activated)`, `reviewed_by`, `scout_rationale`, `licensing_risk`. A row is a *proposal*, not a source. Only 1 of 8 matches the registry by URL — correctly, since candidates are by definition not yet registered. | **NO — never fold a queue** |

**Three distinct grains are present. Only one table (`jw_local_feed_sources`) is
origin-grain and unfolded.** That is the whole fold.

---

## 2. Writer inventory (Investigation gate §2)

What breaks if folded. Searched: `pg_proc` source text, `cron.job` (56 active jobs),
all 76 deployed edge functions, and all four repos.

| Table | Writers | If folded, what orphans |
|---|---|---|
| `jw_local_feed_sources` | **NONE automated.** No `pg_proc` function writes it. No cron. No edge function. No repo code — it appears only in migrations `0038`/`0041` (DDL). Populated by hand-run session SQL through the `http` extension (per CLAUDE.md CC-STATE-BRIEF-SCAFFOLD-1.0). | **Nothing — no writer to orphan.** But see the *reader* below, which is the real constraint. |
| `source_destination_map` | None found (seeded by migration). | n/a — not folding |
| `forecast_sources` | `scripts/forecast-seed/00_mirror_forecast_sources.sql` (manual seed). Read by `fn_capture_forecast_metrics` (cron 149) and `fn_forecast_vintage_harvest` — **neither writes it.** | n/a — not folding |
| `puc_sources` | **`ingest-puc-dockets`** edge fn v15 (`jw/supabase/functions/ingest-puc-dockets/index.ts` lines 426, 441, 495) — reads roster, writes `status`/`cursor`. Cron 121 `puc-dockets-weekly`, states TX+VA. | Folding the *cursor* would break the weekly ingest. Identity mirror is already safe. |
| `ext_source_series` | `ext-global-ingest` edge fn (deployed; no VCS copy). Read by `ext_coverage_heat`. | n/a — not folding |
| `jurisdiction_agenda_sources` | **`opposition-signals-ingest`** edge fn v17 (deployed, **no VCS copy in any repo**), cron 22 `opposition-agenda-daily` + cron 23 `opposition-docket-weekly`. | Same as PUC — runtime state must stay put. |
| `jw_source_candidates` | Hand-run (state-brief scout). | n/a — not folding |

**Functions that write `source_registry` today** (so the fold has precedent to follow):
`fn_source_depth_refresh`, `fn_sec_edgar_fts_ingest`, `fiscalnote_daily_health`. Plus
`source-poller` (crons 133 `verify` /15m, 134 `run` hourly) which owns
`status`/`cursor`/`etag`/`last_*`/`consecutive_failures` on every row it polls.

### ⚠ The binding that actually constrains the fold

`jw_brief_feed_bindings.source_ref` is **free text with no foreign key**, and it binds
by *table name + outlet_class*:

| section | feed_key | source_ref | load-bearing | status |
|---|---|---|---|---|
| POLITICS | local_news_statehouse | `jw_local_feed_sources:statehouse` | **true** | active |
| POLITICS | local_news_community | `jw_local_feed_sources:community_platform` | false | active |
| POWER | local_news_power | `jw_local_feed_sources:trade` | false | active |
| PROJECTS | local_news_business | `jw_local_feed_sources:business_journal` | false | degraded |
| RESOURCES | local_news_rural | `jw_local_feed_sources:rural_weekly` | false | active |
| POWER | puc_dockets | `puc_sources` | false | degraded |

**Five active bindings — one load-bearing — resolve through `outlet_class`.** A fold
that drops `outlet_class`, or that leaves the table in place while the ingest worker
reads `source_registry` instead, silently desyncs the state-brief funnel. `outlet_class`
is therefore not optional metadata; it is a join key. Same for the literal `puc_sources`
reference.

---

## 3. Overlap matrix vs `source_registry` (Investigation gate §3)

Matched by `feed_url`, then `url`, then `name` (case-insensitive).

| Table | Total | Matched | Unmatched | Ambiguous | Match basis |
|---|---|---|---|---|---|
| `jw_local_feed_sources` | 645 | **50** | **595** | 0 | `feed_url` = `source_registry.feed_url`. `url` match: **0**. Name match not attempted (outlet names are not registry names). |
| — of which `status='live'` | 429 | 50 | **379** | 0 | **The headline.** |
| — of which live **and** `robots_ok IS TRUE` | 425 | 50 | **375** | 0 | The D4-gated ingestable set. |
| `source_destination_map` | 188 | **188** | 0 | 0 | `source_key` exact, FK-enforced |
| `forecast_sources` | 51 | **0** | 51 | 0 | `primary_url` vs `url`/`feed_url` → 0; `source_name` vs `name` → 0 |
| `puc_sources` | 25 | **25** | 0 | 0 | via `legacy_ref->>'pk'` = `state_abbr` |
| `ext_source_series` | 24 (9 distinct sources) | **9/9 sources** | 0 | 0 | `source` = `source_key` exact |
| `jurisdiction_agenda_sources` | 21 | **21** | 0 | 0 | via `legacy_ref->>'pk'` = `id` |
| `jw_source_candidates` | 8 | 1 | 7 | 0 | `source_url` vs `url`/`feed_url`. **7 unmatched is correct** — a candidate is by definition unregistered. |

**Net: the only real registration gap is 379 live local-news feeds.** Everything else
is either already reconciled or correctly separate.

### The 379, broken down

| outlet_class | live | ingestable (robots_ok) | **live unregistered** | states |
|---|---|---|---|---|
| tv_affiliate | 130 | 130 | **130** | 48 |
| statehouse | 80 | 78 | **31** | 50 |
| community_platform | 69 | 69 | **68** | 43 |
| public_radio | 59 | 59 | **59** | 40 |
| metro_daily | 43 | 42 | **43** | 30 |
| rural_weekly | 21 | 21 | **21** | 15 |
| trade | 17 | 16 | **17** | 16 |
| business_journal | 10 | 10 | **10** | 10 |
| **total** | **429** | **425** | **379** | 52 |

The 50 already-registered feeds are almost entirely `statehouse` (49 of 50) — the
statehouse lane was registered; the other seven classes were not.

Coverage of the ingestable set: **52 jurisdictions, avg 8.2 feeds/state, min 6, and
2 states below the documented floor of 7.** (CLAUDE.md records avg 8.3 / floor 7 at
scaffold time; the drift is the 4 `robots_ok IS NULL` rows now excluded — see §4.)

---

## 4. Uniqueness — columns with no `source_registry` home (Investigation gate §4)

This is what decides new-column vs child-table.

### `jw_local_feed_sources` — 6 columns unhoused

| Column | Type | Home in `source_registry`? | Disposition |
|---|---|---|---|
| **`robots_ok`** | `boolean` **NULL-able** | **NONE** | **NEW COLUMN — D4** |
| **`tos_reviewed`** | `boolean NOT NULL DEFAULT false` | **NONE** | **NEW COLUMN — D4** |
| `outlet_class` | text, 8-value CHECK | NONE | **NEW COLUMN** — it is a live join key (§2) |
| `state_abbr` | text | `scope` is free text, not a state | NEW COLUMN or `fetch_config` key |
| `item_count_at_verify` | integer | NONE | `fetch_config` / `notes` |
| `verified_at` | timestamptz | `last_ok_at` is close but means "last poll OK", not "verified at registration" | Distinct — keep separate |

Mapped cleanly: `feed_url`→`feed_url`, `outlet_name`→`name`, `access_kind`→`access_method`,
`status`→`status` (needs a value map — see below), `last_fetched_at`→`last_fetch_at`,
`last_error`→(no column; `consecutive_failures` exists), `notes`→`notes`.

> **⚠ `status` does not map 1:1.** `jw_local_feed_sources.status ∈ (registered, live,
> degraded, blocked, retired)`; `source_registry.status ∈ (registered, active, error,
> paused, retired)`. `live→active` and `blocked→paused` are defensible;
> **`degraded` has no target** and must not silently become `active`. 39 rows are
> `degraded`.

### ⚠⚠ D4 — the compliance columns, and why a NULL default is a bug

**`robots_ok` is three-valued and the third value is load-bearing.** Live distribution:

| status | robots_ok | tos_reviewed | rows |
|---|---|---|---|
| live | **true** | false | **425** |
| live | **NULL** | false | **4** |
| blocked | NULL | false | 89 |
| blocked | **false** | false | **7** |
| retired | NULL | false | 81 |
| degraded | NULL | false | 39 |

- **`robots_ok IS NULL` means *unknown*, never *allowed*.** There are **4 rows that are
  `status='live'` with `robots_ok IS NULL`** — they pass a naive `status='live'` filter
  and **must not be ingested.** The gate is `status='live' AND robots_ok IS TRUE` → 425,
  not 429. Any fold that adds `robots_ok boolean NOT NULL DEFAULT true`, or that
  coalesces NULL→true, converts 4 unknown-compliance feeds into approved ones. That is
  the compliance regression D4 exists to prevent.
- The **7 `robots_ok = false`** rows are the documented robots.txt demotions. They must
  land as `false`, not NULL — `false` (disallowed) and NULL (unverifiable) are different
  facts and the distinction is the audit trail.
- **`tos_reviewed` is `false` on all 645 rows.** It must fold as
  `NOT NULL DEFAULT false`, and no ingest worker may treat absence as review.

### Other tables

- `puc_sources`: `access_kind` (5-value CHECK incl. `blocked-waf`), `cursor jsonb`,
  `state_fips`. `source_registry.cursor` exists and is the natural home — but it is
  **owned by `source-poller`**, and `ingest-puc-dockets` is a different fetcher. Two
  writers on one column is a corruption path.
- `forecast_sources`: `horizon_end_year`, `horizon_tier`, `latest_vintage`,
  `revision_signal`, `archive_recoverable`, `jpas_tiers[]`, `attribute_codes[]`,
  `dc_specific`, `faraday_read`. **Nine columns with no registry analogue** — confirming
  the grain difference. `source_registry.years_of_data_available` / `first_year_ingested`
  are backward-looking; `horizon_end_year` is forward-looking. Not the same axis.
- `jw_source_candidates`: `licensing_risk`, `est_coverage`, `dark_states_closed`,
  `scout_rationale`, `reviewed_by`, `reviewed_at`. Review-workflow columns; no registry
  analogue and none wanted.

---

## 5. Cardinality: one-row-per-portal vs collapsed (Investigation gate §5)

**Moot as posed — per-portal already exists.** The live question is whether to *keep*
25+21 per-portal rows or retire them to the umbrella. Keep them. Costs:

| Option | Cost |
|---|---|
| **Per-portal (current, recommended)** | 46 registry rows whose `status` has no writer → **decays into false confidence**, which is exactly today's agenda situation. Fixed by step 2 below. |
| Collapse to umbrella | Loses the ability to say *which* of 25 PUC portals is WAF-blocked. Today `puc:mn`/`puc:oh`/`puc:wi` carry `status='error'` and 9 agenda portals carry `error` — that granularity disappears. **Violates D3.** Not recommended. |

**D3 compliance statement:** per-portal failure becomes visible not because the rows
exist (they do) but because **step 2 gives them a writer**. A registry row whose status
no writer updates is not visibility; it is a stale dashboard. The 21 agenda rows are the
proof — 11 read `active` against an empty destination table.

---

## 6. Sequenced execution plan

D5 sequences the 379 first. Each step is independently revertible.

### Step 1 — Register the 379 live local-news feeds *(D5 headline)*

**Do:** additive migration. Add to `source_registry`:
`robots_ok boolean` (nullable — **no default**), `tos_reviewed boolean NOT NULL DEFAULT false`,
`outlet_class text` (CHECK mirroring the source), `state_abbr text`.
Then insert 429 live rows as `source_key = 'localnews:' || <state_abbr> || ':' || <slug>`,
`subsystem='localnews'`, `source_type='news_feed'`, `fetcher='source-poller'`,
`confidence_cap='SRC'`, `countable=true`, carrying `robots_ok`/`tos_reviewed`/`outlet_class`
verbatim and `legacy_ref = {"table":"jw_local_feed_sources","pk":"<uuid>"}`.

**Status map — explicit, no coalesce:** `live`→`active`, `blocked`→`paused`,
`retired`→`retired`, `registered`→`registered`, **`degraded`→`error`** (39 rows; do not
map to `active`).

**Guards, all mandatory:**
- Insert **only** `status='live'`. Blocked/retired/degraded rows stay out of the poller's
  reach in v1.
- `robots_ok` must be **copied, never defaulted**. In-migration gate:
  `if (select count(*) from source_registry where subsystem='localnews' and robots_ok is null and status='active') <> 4 then raise`.
  Four is the correct, expected number of live-but-unverified rows — the gate asserts
  the fold neither invented nor destroyed compliance state.
- Second gate: `select count(*) ... where subsystem='localnews'` = 429, and
  `... and robots_ok is true` = 425.
- **The 50 already-registered feeds must not double-register** — `on conflict (feed_url)`
  is not available (no unique index on `feed_url`); pre-filter with
  `not exists (select 1 from source_registry r where r.feed_url = l.feed_url)`.

**Do NOT:** flip any of the 429 to a fetcher that will actually poll them in the same
migration. Registration and activation are separate decisions (see step 5).

**Rollback:** `delete from source_registry where subsystem='localnews'` + drop the four
columns. Nothing references them yet. `source_destination_map` has ON DELETE CASCADE, so
confirm no map rows were added first.

---

### Step 2 — Give the 46 mirrored portal rows a writer *(the real D3 fix)*

**This is the fix for the symptom the ticket named.** Per-portal rows exist; they are
just orphaned.

**Do:** one function, `fn_registry_sync_portal_status()`, that reads `puc_sources` and
`jurisdiction_agenda_sources` and updates the matching `source_registry` row **by
`legacy_ref->>'pk'`** (not by URL — URLs change):

- `puc_sources.status`: `live`→`active`, `blocked`→`error`, `registered_pending`→`registered`
- `jurisdiction_agenda_sources.scrape_status`: `active`→`active`, `error`→`error`,
  `unverified`/`not_implemented`/`no_portal`→`registered`
- `last_fetch_at` ← `last_scraped_at`

Schedule hourly, or call it at the tail of `ingest-puc-dockets` / `opposition-signals-ingest`.

**⚠ `last_artifact_at` must be derived from the destination table, not from
`last_scraped_at`.** That conflation is why 11 agenda rows read healthy against
`jurisdiction_agenda_items` = 0. Set it from
`max(created_at) from jurisdiction_agenda_items where <portal>` — and where the
destination is empty, **leave it NULL**. A source that has never produced a row should
look like one.

**Do NOT:** move `puc_sources.cursor` into `source_registry.cursor`. That column is
owned by `source-poller`; `ingest-puc-dockets` is a second fetcher and a shared cursor
is a corruption path. The cursor stays in `puc_sources`, which becomes the runtime-state
child table.

**Rollback:** drop the function + unschedule. The mirror simply refreezes at its current
values — no data lost.

---

### Step 3 — Add the missing FK on `ext_source_series`

9/9 `source` values already resolve. Add
`FOREIGN KEY (source) REFERENCES source_registry(source_key)` so it cannot drift.
Zero rows move. **Rollback:** drop constraint.

**No action on `source_destination_map`** — it is already exactly what a child table
should be (PK+FK, 188/188). Leave it.

---

### Step 4 — Decide `forecast_sources` (needs Myke)

Different grain (§1) — it does not fold. Two defensible options:

- **(a) Leave it.** It is a curated analyst catalog, read by two forecast functions,
  written by nobody. Cost: 51 sources invisible to any registry-wide coverage count.
- **(b) Register only the machine-readable subset.** 15 rows are `Priority Ingest` (9)
  or `Validated` (6); of the 51, those with `machine_access ∈ (API, Bulk Download)` are
  genuinely pollable. Register those as origins, keep `forecast_sources` as the
  forecast-metadata child (`horizon_*`, `revision_signal`, `latest_vintage` have no
  registry home and should not get one).

**Recommendation: (b), scoped to `machine_access IN ('API','Bulk Download')` — and
explicitly not the `PDF Only` rows**, which cannot be polled and would register as
permanently-failing sources. This is a judgement call about what "registered" is meant
to promise; flagging rather than deciding.

---

### Step 5 — Only then, the ingest worker (out of scope here, sequenced for clarity)

No ingest worker exists for local news — `com_news_raw_signals` is still at its
48/7d baseline. When one is built it **must** gate on
`status='active' AND robots_ok IS TRUE AND tos_reviewed = <policy>`, and it must
resolve the state-brief bindings through `outlet_class` (§2) or those five bindings
break. Registration (step 1) does not start ingestion; keep them separate.

---

## 7. Explicit recommendation on the 379 (Deliverable §5)

**Register all 429 live feeds in step 1, carrying `robots_ok` and `tos_reviewed`
verbatim, and do not start polling them in the same change.**

Reasoning:

1. **Registering is not ingesting.** The compliance risk lives in the *fetch*, not the
   row. Registering makes 379 invisible feeds countable and auditable today; a separate,
   reviewable decision turns the tap on.
2. **Register 429, not 425.** Excluding the 4 `robots_ok IS NULL` rows at registration
   would hide the very rows that need review. Register them with `robots_ok` NULL so
   they are *visible and blocked*, rather than absent and forgotten. The gate lives in
   the worker's `WHERE`, not in the registry's membership.
3. **Do not register blocked/retired/degraded (216 rows) in v1.** They carry no
   verified `robots_ok` and would inflate the count with sources nothing intends to
   poll. `degraded` in particular has no honest `source_registry.status` target.
4. **`tos_reviewed = false` on all 645 is a standing debt, not a blocker.** It should
   fold as-is and be surfaced — 429 live feeds with zero ToS review is a real finding
   that the registry should be able to *report*, which today it cannot because the rows
   are not in it.

**What this buys:** registry-wide source counts stop understating local-news coverage by
379; `v_jw_brief_dark_register` and any coverage view can reason over one table; and the
4 unknown-compliance feeds become a visible 4-item review queue instead of an invisible
subset of a 429-row filter.

---

## 8. Success criteria

| # | Criterion | Status |
|---|---|---|
| 1 | All six tables classified, none skipped | ✅ §1 — plus `jw_source_candidates` (7th) |
| 2 | Every writer identified; no fold orphans one | ✅ §2 — the only fold target (`jw_local_feed_sources`) has **no** automated writer; its *reader* (`jw_brief_feed_bindings`, 5 active bindings via `outlet_class`) is the binding constraint and is preserved |
| 3 | Plan executable without re-investigating | ✅ §6 — per-step DDL shape, status maps, gate counts, rollback |
| 4 | `robots_ok` / `tos_reviewed` preservation explicit | ✅ §4 + §6 step 1 — nullable-no-default, 4/425/429 gates, NULL≠allowed |
| 5 | Zero writes | ✅ SELECT-only throughout |

## 9. Corrections to carry forward

1. `puc_sources` and `jurisdiction_agenda_sources` are **already per-portal** in
   `source_registry` (25 and 21 rows). Migration 0002 did this. `puc:dockets` /
   `agenda:legistar` are non-countable inherited umbrellas, not the operative rows.
2. `source_destination_map` has **no alias conventions** — 188/188 exact, FK-enforced.
3. The invisibility of per-portal failure is caused by **a missing writer**, not a
   collapsed row.
4. `jw_brief_feed_bindings.source_ref` binds by **table-name + outlet_class as free
   text with no FK** — an under-documented coupling that constrains any fold.
5. The safe ingestable count is **425, not 429** — four `live` rows have unverified
   robots.txt state.
