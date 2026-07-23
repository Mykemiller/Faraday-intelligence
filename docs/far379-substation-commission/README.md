# FAR-379 — Substation Commissioning-Date Scoop (CC-SCOOP-SUBSTATION-COMMISSION-DATES-1.0)

National, repeatable scoop that extracts substation **commissioning / in-service
dates** — plus the wider grid-buildout "treasure trove" — from two public,
structured regulatory sources, resolves the mentions against the HIFLD-anchored
`substations` spine (FAR-372), and writes `commissioned_year` where a
high-confidence anchor match co-occurs with an *actual/energized* date.
Implements options 1 & 2 of FAR-375's free stack.

- **Migration:** `supabase/migrations/0017_far379_grid_buildout_projects.sql` (applied).
- **Adapters:** `supabase/functions/grid-buildout-sync/` (ISO/RTO), `supabase/functions/puc-substation-extract/` (PUC).
- **Tests:** `test/grid-buildout-sync.test.mjs`, `test/puc-substation-extract.test.mjs` (`npm test`).
- **Project:** Supabase `ycadmmngkdhvpcsrcuaq`.

---

## Investigation gate (I1–I6) — reported before any DDL

| # | Finding |
|---|---|
| **I1** | `puc_filings.raw_text` is a **title-only index** (median 19 words, max 48; matches "substation" **0×** across all 5,033). Substation identity is in **`puc_dockets.docket_title`** (esp. TX CCN transmission cases); actual dates live only in the filing PDFs at `source_url`. Corpus skews to **two states** — VA (FIPS 51, 4,146 filings) + TX (FIPS 48, 887), 2025-07→2026-07. → **material D1 refinement** (below). |
| **I2** | Pilot three all publish machine-readable plans, materially different (per-ISO adapters): **ERCOT TPIT** (quarterly xlsx; Future/**Completed**/Cancelled/RTP tabs — cleanest planned-vs-actual split), **MISO MTEP Appendix A** (quarterly xlsx; Portal login-gated → use published exports), **PJM RTEP** (interactive table; no clean single export). Public/redistributable. |
| **I3** | Anchor spine is match-ready (100% normalized_name, **99.5%** county, 75.5% voltage) — **but only 17,554 / 75,327 (23%) have a real name**; 57,773 are `UNKNOWN######`/`TAP######` geometry placeholders. Existing substations resolve; **proposed** CCN/plan endpoints don't (HIFLD is an *existing*-asset inventory). |
| **I4** | Date-semantics: PUC corpus today is **application/siting-stage** (0 dockets with energized language, 28 CCN) → projected/approved → **0 gradable**. ISO: predominantly projected; defensible **actual** only from ERCOT TPIT "Completed Projects" (+ MISO/ISO-NE status transitions). → capture status transitions across quarters, don't trust one snapshot. |
| **I5** | `ref_ferc_queue` (ERCOT/MISO/PJM) is generation-interconnection dominated and has **no in-service date** → cannot grade, not a competing date source. Overlap with ISO plans is conceptual (a queued generator *driving* a network upgrade); dedupe by county+name, low collision. |
| **I6** | Secondary "treasure-trove" fields confirmed present & worth capturing (cost, driver, MW, voltage, docket meta) → justifies the dedicated landing table (D3). Driver fields increasingly cite large-load/data-center interconnection (the load-growth leading indicator). |

## Decisions D1–D7 (signed off 2026-07-23)

All seven recommendations accepted. One ratified refinement:

- **D1 (input surface).** LLM-over-`raw_text` as literally written is not viable — `raw_text` carries no substation names or dates. **Ratified D1:** regex/keyword pre-filter over **`docket_title`** → fetch the underlying filing PDF at `source_url` (server-side via the `http` extension) → LLM-parse for the actual date. Same intent, different input surface + one fetch step.
- D2 pilot PJM+MISO+ERCOT (ERCOT first) · D3 dedicated `grid_buildout_projects` · D4 land-rich/wire-minimal (only `commissioned_year` wired) · D5 `planned_inservice_date` for forward dates · D6 auto-write only ≥0.90 exact-name+county (voltage tiebreaker) · D7 quarterly ISO refresh, PUC rides FAR-353.

---

## What this migration creates

- **`grid_buildout_projects`** — land-rich record for BOTH sources (driver, cost, MW, voltage, tariff/docket meta, `planned_inservice_date` vs `actual_inservice_date`, `date_type`, `is_large_load_dc`). Service-role-only RLS; content-hash idempotency; `unique (source_key, source_ref)`.
- **`far379_norm(text)`** — name normalizer aligning extracted names to the spine (strips switch/substation/tap suffixes; NULLs HIFLD placeholders). Backed by a functional index on `substations`.
- **`substation_source_mentions`** additive cols — `extracted_inservice_date`, `extracted_date_type`, `extraction_confidence`, `match_confidence`, `grid_buildout_project_id`, `commissioned_year_written` (the resolution/grade audit trail). `source_type='iso_transmission_plan'` joins the existing `'puc_filing'`.
- **`far379_resolve_and_grade(source_type, min_conf, commit)`** — resolves mentions to anchors by exact normalized name + county gate (voltage tiebreaker) and writes `commissioned_year` only for ≥conf **actual**-date matches. `commit=false` → dry-run.
- **`jw_data_source_registry`** rows — `iso:ercot-tpit`, `iso:miso-mtep`, `iso:pjm-rtep`, `puc:substation-commission`.

### Confidence model
Exact normalized-name candidates only: unique-in-county → **0.95** (0.97 if voltage also matches); ambiguous-in-county → 0.85; no-county-hint unique-in-state → 0.70; name-only/mismatch → 0.60; none → 0. Only **≥0.90 + `date_type='actual'` + a date** writes the grade. Everything else stays `unresolved` (or `resolved_no_grade` when anchored but the date can't grade) for human review — never a fuzzy grade.

---

## End-to-end run results (real, sourced data)

**ERCOT** (3 real projects → tested `normalizeErcotTpit` → resolve):

| Substation | County | Date | date_type | outcome |
|---|---|---|---|---|
| **Cottonwood** (CREZ SS) | Dickens (48125) | 2013-12-04 | actual | **graded 2013 → age_grade A** |
| **San Miguel** (STEC) | Atascosa (48013) | 2024-05-02 | actual | **graded 2024 → age_grade A** |
| Bakersfield | Pecos (48371) | 2027 (planned) | projected | resolved_no_grade (0.97 anchor, date can't grade) |
| Edith Clarke, Palmito | — | — | — | unresolved (not in spine / county mismatch) |

**PUC** (18 real TX CCN siting dockets screened from live `puc_dockets` → tested `screenDocket` → resolve): 33 endpoints, **0 graded** (all application-stage `approved` — I4), **Deaf Smith** (48117) + **Grapevine** (48179) anchored at 0.95 → `resolved_no_grade`, rest unresolved (proposed/rural or multi-county).

Totals: **21** `grid_buildout_projects`, **41** mentions, **2 substations graded**, **2 `substation_age_grade` non-null**. **Zero JPAS/JPS/JDS writes.**

---

## Deploy gates (not cron-wired / not deployed by this PR)

1. **ERCOT TPIT live fetch** — ERCOT.com 403s automated fetchers in-session; production reads data product `pg7-048-m` server-side (allow-listed egress / `http` extension). xlsx parsing stubbed in `fetchLiveProjects`.
2. **PUC PDF actual-date extraction** — needs an LLM key + `http` extension to fetch `source_url` server-side (`fetchActualDate` stubbed). Without it, candidates land as `approved`/`projected` → no grade (correct for today's corpus).
3. **County→FIPS gazetteer** — no `ref_counties` table exists; PUC county hints resolve to FIPS only for a small inline map. A gazetteer is a prerequisite for PUC auto-grading at scale.
4. **MISO / PJM adapters** — phase-2 (`normalizeMiso`/`normalizePjm` not built).
5. **AUTO ids** in the Airtable Automation Registry (`AUTO-FAR379-*` placeholders).

## Rollback

Purely additive & reversible — see the ROLLBACK block at the foot of the migration. Null-out is by the mention audit trail:
```sql
update substations s set commissioned_year = null
  from substation_source_mentions m
  where m.substation_id = s.id and m.commissioned_year_written is not null;
```
then drop the function/columns/table/registry rows.
