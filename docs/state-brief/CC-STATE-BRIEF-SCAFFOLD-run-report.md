# CC-STATE-BRIEF-SCAFFOLD-1.0 — run report

**Date:** 2026-07-31 · **Supabase project:** `ycadmmngkdhvpcsrcuaq`
**Scope:** (A) schema DDL for section-level brief persistence, (B) discovery +
verification of local news RSS feeds per state.

**No writes to `jpas_attributes`, `jw_briefings`, or any JPS column.** Verified
after the fact: `jw_briefings` = 5,257 (unchanged from gate I2),
`jpas_attributes` = 662,582 rows untouched, `jw_brief_editions` /
`jw_brief_sections` = 0 / 0 (the smoke test was rolled back).

---

## Investigation gates — all 8 PASS

| Gate | Result | Verdict |
|---|---|---|
| I1 | 0 of the 6 new tables existed. The 3 `jw_brief_%` hits were the legacy `jw_briefing_config` / `jw_briefing_runs` / `jw_briefings` caught by the LIKE pattern | PASS |
| I2 | `jw_briefings` = **5,257** | PASS (exact) |
| I3 | `id`=uuid ✓, `name`=text ✓, `level`=**enum** (`country,state,metro,county,place,cousub`), `state_abbr`=**character(2)** not `text` | PASS w/ deviation |
| I4 | `level='state'` = **52** | PASS (exact) |
| I5 | `pgcrypto` present → `gen_random_uuid()` available | PASS |
| I6 | **2 live** (TX html-structured, VA json-api) · **3 blocked** (MN/OH/WI blocked-waf) · **20 registered_pending** | PASS (exact) |
| I7 | `com_news_raw_signals` 7d = **48** (spec said ~39) | PASS — baseline recorded at 48 |
| I8 | **402** null-state rows total; `opposition_event` is **84/84 (100%)** exactly as stated | PASS — recorded, not fixed |

### Two findings worth carrying forward

1. **I3 — `jurisdictions.state_abbr` is `character(2)`, not `text`.** The FK
   target is `jurisdictions(id)` (uuid), so the DDL is unaffected, but
   `jw_brief_editions.state_abbr text` is not type-identical to its source.
   `bpchar`↔`text` comparison is safe; be aware `char(2)` blank-pads on read
   (every query in this task used `trim(state_abbr)`).
2. **I8 — the null-state gap is larger than the ticket assumed: 402, not 84.**
   `opposition_event` is exactly 84 as stated, but **`water_facts_delta` carries
   a second, bigger gap of 318 of 1,724 rows.** Both are load-bearing feeds
   (POLITICS and RESOURCES respectively), so both sections will report
   `degraded` until backfilled. Out of scope here — flagged for a follow-up.

---

## Work Package A — schema

Applied as `state_brief_section_architecture` (vendored as migration `0038`),
plus `0039` (probe helpers), `0040` (FK indexes), `0041` (seed data).

8 tables + 3 views. The 5 active sections sum to **exactly 1,000** base words
(90+230+230+230+220), consistent with D1/D7.

### Two deliberate additions to the supplied DDL

- **RLS enabled on all 8 tables.** The supplied DDL omitted it; **all 26
  pre-existing `jw_*` tables have RLS enabled**, and without it these tables
  (which hold unpublished brief copy) would be anon-readable through PostgREST.
  Deny-all, no policies — service role bypasses RLS. This is the house posture.
- **`security_invoker = true` on all 3 views.** Postgres views default to
  running as owner, which would have re-exposed exactly the rows the RLS above
  fences. With this set, the new views do **not** appear among the 8
  pre-existing `security_definer_view` advisor ERRORs.

### Verification (rollback-guarded, 0 rows persisted)

Seeded one TX edition with 4 sections covering every branch, then rolled back:

| Assertion | Result |
|---|---|
| `renders` generated column: dark → false, failed audit → false, null content → false, passed+documented → true | ✔ all 4 |
| `v_jw_state_brief_current` returns only the 2 rendering sections, in `display_order` (READ d1, POWER d2) — dark and failed suppressed per D12 | ✔ |
| `v_jw_brief_dark_register` surfaces the dark section joined to its load-bearing binding | ✔ |
| `v_jw_brief_failed_sections` surfaces the failed section with its verdict | ✔ |

### Seed data (`0041`)

- **10 auditor shards**, exactly per D8/D11 = 5 active sections × EAST/WEST.
  CONNECTIVITY is `incubating` and deliberately gets no shard — that is what
  holds the count at 10 rather than 12. Regions split at roughly the
  Mississippi, 26 jurisdictions each.
- **17 feed bindings, 6 load-bearing.** Statuses record *verified* state:
  `opposition_events` and `water_facts` are already `degraded` on the null-state
  gap above, and `puc_dockets` is `degraded` at 2 of 25 live.
- **8 scout candidates** (below).

---

## Work Package B — local news funnel

**645 candidates registered → 429 verified live across all 52 jurisdictions**,
carrying **16,080 items** at verification. Average **8.3 live feeds per state**,
floor of **7**, and **38 states at ≥8**. Zero states dark.

Every URL was actually fetched server-side (`http` extension via
`jw_probe_feed`) — nothing is marked live on the strength of a URL pattern.
`ok` requires **both** a 2xx **and** ≥1 parsed item, so a 200 returning a login
wall or an empty feed does not count.

### Status mapping

| Status | n | Meaning |
|---|---|---|
| `live` | 429 | 2xx + ≥1 item + robots-allowed |
| `blocked` | 96 | 401/403/429, transport error, or robots-disallowed |
| `retired` | 81 | 404/410 — the feed URL is dead |
| `degraded` | 39 | 2xx but 0 items, or 5xx |

### Live feeds per state

```
AK=8 AL=8 AR=9 AZ=9 CA=7 CO=7 CT=10 DC=7 DE=8 FL=10 GA=9 HI=7 IA=8 ID=7
IL=8 IN=10 KS=8 KY=10 LA=7 MA=8 MD=8 ME=7 MI=9 MN=7 MO=9 MS=9 MT=7 NC=7
ND=8 NE=8 NH=7 NJ=8 NM=9 NV=7 NY=10 OH=11 OK=9 OR=9 PA=10 PR=8 RI=8 SC=8
SD=7 TN=9 TX=10 UT=8 VA=7 VT=8 WA=8 WI=8 WV=8 WY=8
```

### Yield by outlet class

| Class | live/total | % | items |
|---|---|---|---|
| statehouse | 80/87 | 92% | 5,432 |
| tv_affiliate | 130/151 | 86% | 3,807 |
| community_platform | 69/83 | 83% | 1,140 |
| trade | 17/26 | 65% | 1,308 |
| public_radio | 59/102 | 58% | 1,844 |
| rural_weekly | 21/38 | 55% | 626 |
| metro_daily | 43/106 | 41% | 1,823 |
| business_journal | 10/52 | 19% | 100 |

**The statehouse tier is the funnel's backbone** — 92% live, ~100 items/feed,
and present in nearly every state via the States Newsroom network.
**Metro dailies and business journals are structurally the weakest**, for the
licensing reasons below rather than for want of a correct URL.

### URL-pattern scorecard (this is the reusable finding)

| Pattern | live | note |
|---|---|---|
| Tegna `/feeds/syndication/rss/news` | 100% | |
| Hearst `/topstories-rss` | 100% | |
| Gray/Arc `/arc/outboundfeeds/rss/?outputType=xml` | 85% | |
| WordPress `/feed/` | 84% | States Newsroom + nonprofits |
| Grove & Scripps `/news.rss` | 76% | NPR member stations |
| TownNews `…&f=rss` | mixed | **requires `f=rss` as the TRAILING param** |
| Gannett `rssfeeds.*` | **0%** | RSS retired network-wide |
| bizjournals `/news/rss.xml` | **0%** | Cloudflare 403 |

Two mistakes worth not repeating: TownNews only emits RSS when `f=rss` is the
*trailing* parameter (richmond.com went 0 → 50 items on that one change), and
**27 initial 429s were my own burst rate-limiting, not real blocks** — they were
re-probed with throttling before being classified. 20 Lee Enterprises titles
still 429 persistently at 1.2s spacing while richmond.com on the same CMS
serves fine, so that block is per-domain bot policy.

### D13 / robots compliance

Every live feed's `robots.txt` was fetched and parsed for `User-agent: *`
`Disallow` rules covering the feed path. **421 allowed; 7 disallowed → demoted
to `blocked` and excluded from ingestion** (5 of the 7 are BridgeTower Media
business journals sharing one policy). 4 rows could not have robots verified and
are flagged in `notes` as **`ROBOTS UNVERIFIED — ingest worker must re-check
before first fetch`**; `robots_ok IS NULL` means *unknown*, never *allowed*.

**Nextdoor (D13): discovery + registration only, no scraping.**
`developer.nextdoor.com` verified live (HTTP 200) and registered as the official
partner/API path in `jw_source_candidates`, `licensing_risk =
requires_partnership`, `status = pending_review`. Ingestion is gated on an
executed partner agreement. Nothing login-walled was fetched.

---

## Security / advisors

The **final security advisor output is byte-identical to the post-DDL baseline**
(309,652 chars, 394 items; every level/name category unchanged). The 8 new
tables raise only the intended `rls_enabled_no_policy` INFO.

One real issue was found and fixed mid-task: `jw_probe_feed` / `jw_probe_robots`
are SECURITY DEFINER and fetch an arbitrary caller-supplied URL, and they were
briefly **anon-executable through PostgREST — an SSRF vector**. `REVOKE … FROM
anon, authenticated` was insufficient because both roles inherit the default
**PUBLIC** grant; `REVOKE … FROM PUBLIC` plus an explicit `service_role` grant
cleared it. Confirmed: `has_function_privilege` is now false/false/true.

Performance advisors (all 226 items read): new objects raise only INFO — 4
unindexed FKs and 1 unused index on an empty table. The two FKs that will be
joined at scale got covering indexes in `0040`; the two on ≤10-row tables were
left alone deliberately.

---

## What is NOT done (explicit)

- **The funnel is registered and verified, but not yet ingesting.** No worker
  reads `jw_local_feed_sources` and writes `com_news_raw_signals` — that table
  is still at its I7 baseline (48/7d). WP B scope was discovery + verification;
  **building the ingest worker is the next step**, and it must honour
  `status='live' AND robots_ok IS TRUE`.
- **No brief has been generated.** `jw_brief_editions` / `jw_brief_sections` are
  empty by design; agents, prompts, and the auditor runtime are not in scope.
- **`tos_reviewed` is `false` on every row** — robots.txt was checked
  programmatically, but no human ToS review has happened.
- **The I8 null-state gaps are recorded, not repaired** (84 `opposition_event`
  + 318 `water_facts_delta`), per the task instruction.
- Reaching a true 10-live floor in every state would need either licensed access
  (bizjournals, Gannett, Lee, AP) or per-state manual discovery beyond the
  network patterns; the 4 blocked networks are registered as scout candidates
  with the observed evidence.
