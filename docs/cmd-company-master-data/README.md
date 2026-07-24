# CMD-1.0 — Company Master Data spine (CC-COMPANY-ENRICH-1.0)

**Project:** Faraday Intelligence · **Supabase:** `ycadmmngkdhvpcsrcuaq` · **Airtable base:** `appxfti7VuoHYUeu6`
**Branch:** `claude/company-master-data-spine-sldn54` · **Status:** applied to prod, PR open, **nothing merged**.
Governance: named migrations only; zero fabricated data; every fact carries provenance; RLS-on/service-role-only on all new tables.

Myke's decisions (unblocking the STOP gates in the spec §6): **(1)** merge the roster into the spine, minimize
duplicates; **(2)** approve the `entity_class` taxonomy; **(3)** add the `company_uid` FK to `tracking_companies`;
**(4)** `subscriber_tier_gate = 'internal'` on every attribute; **(5)** approve the trigram alias methodology
(proposals stay `approved=false`); **(6/7)** mirror editorial verbatim, leave anything unsourced NULL.

## 1. Migrations applied (0021–0029)

| # | Name | Creates / does |
|---|---|---|
| 0021 | `cmd_0021_core_spine` | `companies`, `company_aliases`, `company_attribute_registry`, `company_facts`, `company_relationships`; `cmd_normalize_name()`; RLS + deny-all policies |
| 0022 | `cmd_0022_staging_report` | `stg_company_classification`, `cmd_merge_candidates` (RLS-on) |
| 0023 | `cmd_0023_attribute_registry_seed` | 76 attributes (Tier-1/2 + Faraday-specific + vendor-dependent, all `internal`) |
| 0024 | `cmd_0024_classify_roster` | classifies all 7,824 roster rows → staging with rule trace |
| 0025 | `cmd_0025_airtable_mirror` | mirrors 469 Airtable Tracking Companies → `stg_airtable_companies` → `companies` + facts + aliases (+2 raw-text attrs) |
| 0026 | `cmd_0026_merge_roster_aliases_fk` | roster → canonical companies (dedupe), aliases (exact/normalized approved; trigram proposals), **`company_uid` FK on `tracking_companies`**, merge-candidate evidence, slug/public_id |
| 0027 | `cmd_0027_wavec_footprint_jps` | Wave C: facility counts, MW, acres, footprint, anchor tenants, **jurisdiction_exposure (JPS)** from `jw_facilities`→`jurisdictions` |
| 0028 | `cmd_0028_wavec_coverage` | Wave C: `coverage_status` from Automation Registry + RSS Feeds link graph |
| 0029 | `cmd_0029_registry_counts` | refreshes `populated_count` |

`tracking_companies` after: columns are exactly `company_id, name, active, company_uid` — original three untouched, only the nullable FK added.

## 2. Classification (all 7,824 roster rows → `stg_company_classification`)

`municipality` 1,561 · `operator` 353 · `utility_iou` 148 · `utility_coop` 93 · `utility_municipal` 81 ·
`academic` 4 · `association` 3 · `standards_body` 2 · **`unclassified` 5,579 (71%)**.
High-confidence = municipal/coop/municipal-utility patterns; medium = other name patterns + jw_facilities membership;
low = unclassified. **71% unclassified matches the "~30% is not a company / rest needs review" finding** — nothing was force-classified.

## 3. Resolution to `company_uid`

| Source | Count | Resolved | Method |
|---|---|---|---|
| `tracking_companies` roster | 7,824 | **7,824 (100%)** | normalized → FK |
| Airtable Tracking Companies | 469 records | **358 companies** | 111 exact Airtable duplicates collapsed on normalized name |
| `jw_facilities.operator` | 96 distinct | 82 | normalized |
| `jw_facilities.operator_parent` | 93 distinct | 92 | normalized |
| `jw_facility_operators` | 856 distinct | 231 | normalized (**625 unresolved** — outside the spine) |

Spine = **7,687 companies** (358 Airtable-curated + 7,329 roster-only), one per normalized name.
`company_uid = 'cmp_'||substr(md5(name_normalized),1,16)` — deterministic, so Airtable and roster dedupe naturally.
Aliases: **8,365** (exact/normalized `approved=true`; **2 trigram proposals `approved=false`** — only 2 of the 625 unresolved jw operators cleared similarity ≥ 0.92).

## 4. Coverage (populated_count highlights)

Facts total **2,275** — 1,313 Airtable, 962 `faraday_internal`. Selected:
`entity_class` 2,443 (non-unclassified) · `idf_domain_exposure` 341 · `company_type` 355 · `hq_location_raw` 318 ·
`coverage_status` 358 · `power_sourcing_strategy` 105 · `mw_total_airtable` 116 · `mw_live_airtable` 104 ·
`ceo_name` 92 · `faraday_read` 156 · `jurisdiction_exposure` 82 · facility counts/acres 82 · `operating_capacity_mw_derived` 76 · `brand_assets` 40 · `slug`/`public_id` 7,687.

**Explicit 0% gaps (listed, not hidden):** `building_sqft_total` (0 of 2,283 facilities carry sqft), `footprint_regions`
(`jurisdictions.region` null for every facility), `power_source_mix` (`jw_facilities.power_source` 100% NULL),
`opposition_exposure` (**Community Opposition Registry has no company link field — not derivable**), `signal_density_*`
(deferred — name-matching artifacts risks false positives), and register-only T2 (`idf_subdomain_exposure`, `theme_exposure`,
`prognostication_exposure`, `constraint_exposure`, `supply_chain_position`, `btm_posture`, `legislation_exposure`,
`geopolitical_flag`, `editorial_owner`, `net_zero_target_year`, …). **All 9 vendor-dependent attributes = 0** (`is_vendor_dependent=true`).

## 5. Provenance proof

```sql
select count(*) from company_facts
 where (value_text is not null or value_num is not null or value_bool is not null
        or value_date is not null or value_jsonb is not null)
   and (source_name is null or as_of is null or confidence is null);
-- => 0
```
Enforced structurally by `company_facts_provenance_ck` (CHECK) + NOT NULL. **Zero rows with a value and no source.**

## 6. Wave C (source_name = `faraday_internal`, method_note carries the SQL)

Facilities attributed to the operator company by normalized name (82 companies have facilities).
`jurisdiction_exposure` = MW-weighted mean JPS (`jurisdictions.current_score`, weighted by `capacity_mw`) + posture
distribution (`current_tier`) + count in Cautious/Restricted — Faraday-unique. `coverage_status`: **38 covered**
(target of an *active* automation) · **288 partial** (configured in an automation/RSS feed but RSS Pipeline Status is
`Not Connected` for all 514 feeds) · **32 uncovered** — of the 358 curated companies.

## 7. Airtable MW vs derived MW divergence (reported, not reconciled)

| Company | MW Total (Airtable) | Operating MW (derived) | Δ |
|---|---|---|---|
| QTS Realty Trust | 3,842 | 480 | +3,362 |
| Rackspace | 2,235 | 150 | +2,085 |
| Equinix | 3,000 | 4,074 | −1,074 |
| EdgeConneX | 1,532 | 509 | +1,023 |
| Switch | 1,058 | 1,875 | −817 |

Airtable-declared (`mw_total_airtable`) and Wave C derived (`operating_capacity_mw_derived`) are kept as **separate
attributes** per spec §3 — not merged.

## 8. Findings & anomalies

- **Coverage gap (operational honesty):** of the entire 7,687-entity spine, only **38** are targets of an active crawl;
  the ~7,300 roster-only entities are outside the curated crawl-target graph entirely.
- **Airtable Tracking Companies carries ~111 exact-duplicate records** (e.g. "GE Vernova" ×4, "AMD" ×3) → 469 → 358.
- **Community Opposition Registry has no developer/company link** — the §7.9 derivation the spec assumed is not possible.
- **`unclassified` 68%** of the spine — expected: most roster entities lack a facility link or a clear name pattern.
- `regulator`/`developer` are near-empty in roster classification (developers matched as operators first; PUCs sparse in roster).

## 9. ⛔ Myke actions

- **Duplicate merges** — executed per Decision 1; evidence in `cmd_merge_candidates` (37 roster groups) + the 111 Airtable dupes. Audit if desired.
- **`entity_class` enum** — taxonomy approved (Decision 2) but kept as a `text` + CHECK this pass; promote to a Postgres enum type as a follow-up migration when ready.
- **`company_uid` FK** — added (Decision 3).
- **Trigram aliases** — 2 proposals in `company_aliases` (`approved=false`) awaiting review.
- **Jira epic** — assign a CMD-1.0 key (sibling of FAR-272 / MDI-1.0).
- **Wave D (vendor-dependent)** — 9 attributes registered at 0%; buy / defer / drop.
- **Follow-on derivations** — `signal_density_*` (artifact name-matching), `btm_posture` normalization (raw Energy Strategy retained), structured `company_relationships` from Key Partnerships (raw retained), `geopolitical_flag` from DC Providers China Flag.

## Rollback

All objects are additive. To reverse: `drop table` the seven new tables (cascade), `drop function cmd_normalize_name`,
and `alter table public.tracking_companies drop column company_uid`. No existing object was mutated.
