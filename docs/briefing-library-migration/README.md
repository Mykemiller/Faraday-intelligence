# Briefing Library → Supabase Migration

**Date:** 2026-07-18 · **Requested by:** Myke (chat go, 3-item directive) · **Status:** DRAFT — migration file `supabase/migrations/0015_briefing_library_migration.sql` is prepared but **not applied**.

Migrates the Airtable **Briefing Library** (`appxfti7VuoHYUeu6` / `tbl4kbby85nx6Z891`, 436 records, snapshotted 2026-07-18 in this directory) into Supabase project `ycadmmngkdhvpcsrcuaq`, with full linkage to the IDF registries and Tracking Companies.

## Target schema

| Table | Purpose |
|---|---|
| `faraday_briefings` | One row per briefing. Keeps the Airtable autonumber as `briefing_id` (stable public code) and `airtable_record_id` for provenance. Columns mirror all Airtable fields: title, description, status (`Live/Draft/Coming Soon/Retired` — Airtable's `Retired ` trailing space trimmed), `gamma_url`, `gamma_id`, `canonical_flag`, `download_count`, `go_live_date`, `attachments` jsonb (empty on all 436 source rows), `airtable_created_at`. |
| `faraday_briefing_domains` | M:N → `faraday_domains(domain_code)` |
| `faraday_briefing_subdomains` | M:N → `faraday_subdomains(subdomain_code)` |
| `faraday_briefing_companies` | M:N → `tracking_companies(company_id)` (Airtable rec-ID keyed) |
| `faraday_briefing_themes` | M:N → `faraday_themes(theme_code)` |

## Link-mapping rules

- **Domains** (30 links): mapped by exact Airtable domain-registry name → `domain_code` (all 23 canon names covered; all 30 mapped).
- **Sub-domains** (59 links): mapped name → `subdomain_code` using the CC-IDF-OPEN3 crosswalk, including the drifted legacy names (e.g. "Site Selection Criteria & Market Scoring" → D14.1, "Behind-the-Meter Generation (BYOP/BYOG)" → D2.2). **58 mapped; 1 unmapped**: "Jurisdiction Posture Intelligence (JPS)" has no canon code (D18.4 proposed, awaiting canon mint) — preserved in `unmapped_links`.
- **Companies** (366 links): mapped by Airtable record ID, which is `tracking_companies.company_id`. Inserted through an EXISTS guard; any ID not present in `tracking_companies` is preserved per-briefing in `unmapped_links.companies` (id + name) rather than dropped.
- **Themes** (14 links): mapped by **canon** theme name → T-code (The Power Reckoning→T-001, The Consent Crisis→T-003, The Capital Concentration→T-004, The Inference Economy→T-005). **11 mapped; 3 unmapped**: "The Rack Revolution" is a legacy theme with no canon code — preserved in `unmapped_links`.

Nothing is silently dropped: every unmappable link name survives in `faraday_briefings.unmapped_links` jsonb.

## ⚠ Findings surfaced by this migration (for the design session)

1. **`faraday_themes` is drifted from canon.** Supabase has T-001="Capital Flows" … T-007="Risk & Resilience", while canon (Notion `37189a0c…` §03) defines T-001="The Power Reckoning" … T-007="The New Energy Stack". The Airtable theme links used canon names. This migration maps to canon **codes** (FKs remain valid), but the `faraday_themes.name` values need their own canon-sync fix.
2. **"The Rack Revolution"** theme and **JPS** sub-domain exist in Airtable history but not in canon — decide: mint codes (D18.4 for JPS; new T-code or retire for Rack Revolution) or leave as historical `unmapped_links`.
3. Snapshot status distribution: 357 Coming Soon placeholders / 79 Draft; only ~11 briefings have Gamma URLs. The "Coming Soon" placeholder-per-entity pattern (one stub row per company/sub-domain) is a modeling choice worth revisiting — stubs could be derived (absence of a Live briefing) instead of stored.

## Code-update spec (briefing library code)

The briefing-library UI/API code is **not in this repo** — it lives in the engine project `v0-faraday-daily-challenge` (per FAR-119, this repo is the retired static site). Required changes there once the migration is applied:

1. Replace any Airtable reads of `tbl4kbby85nx6Z891` with Supabase queries (types below, `faraday-briefings.types.ts`):
   - List: `from('faraday_briefings').select('*, faraday_briefing_subdomains(subdomain_code), faraday_briefing_domains(domain_code), faraday_briefing_companies(company_id), faraday_briefing_themes(theme_code)')`.
   - Filter by Thread/Sector: join through the link tables on `subdomain_code`/`domain_code`.
   - "Coming Soon" rendering: `status = 'Coming Soon'` (or derive from absence of Live briefing — design-session decision).
2. Download counter: increment `download_count` via RPC (add `jw`-style atomic RPC rather than client-side update).
3. Tag contract (canon §02): briefing surfaces should display Theater/Sector/Thread labels resolved from `faraday_themes` / `faraday_domains` / `faraday_subdomains` — no counts in subscriber-facing copy.
4. RLS: tables are created without policies in the draft; before exposing to the client, add read-only anon policies (or route through an edge function) consistent with the project's existing patterns.

## Files

- `airtable-briefing-library-snapshot.json` — raw 436-record snapshot (pre-retirement source of truth).
- `airtable-idf-subdomain-registry-snapshot.json` — raw 61-row snapshot of the IDF Sub-Domain Registry (`tbla7rtRY9AaeoWhu`), taken immediately before the table's retirement/deletion (Myke, 2026-07-18).
- `faraday-briefings.types.ts` — TypeScript types for the engine repo.
- `../../supabase/migrations/0015_briefing_library_migration.sql` — the draft migration (schema + full seed + guarded link inserts + verification notices).
