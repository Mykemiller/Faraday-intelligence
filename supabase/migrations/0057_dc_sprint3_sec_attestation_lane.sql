-- CC-DC-SPRINT3 · Parts 6-8 — SEC self-attestation lane. APPLIED to prod 2026-08-09.
-- Applied as four migrations in session; consolidated here in final form.
--
-- Myke 2026-08-09: "operator + city match is sufficient to publish."
-- Implemented, and then GATED on pure_play_dc after measuring the signal.
--
-- MEASURED, not assumed (2026-08-09):
--   Pure-play data center REITs -- signal is real:
--     Equinix        "Ashburn, Virginia"       47 hits
--     Digital Realty "Ashburn, Virginia"       44 hits
--     Digital Realty "Santa Clara, California" 40 hits
--     Iron Mountain  "Boyers, Pennsylvania"    35 hits
--   Diversified filers -- signal absent or spurious:
--     Microsoft "Quincy, Washington"        0  (a major MSFT campus)
--     Google    "Council Bluffs, Iowa"      0  (a major Google campus)
--     Amazon    "Ashburn, Virginia"         0  (largest AWS region on earth)
--     Meta      "Prineville, Oregon"        1  (2013 10-K only)
--   Every Amazon hit was another line of business -- McDonough GA (2001, 17 hits), Atlanta GA
--   (2002), Louisville KY, Fort Worth TX: fulfillment centres and air hubs. Attesting on those
--   would publish a warehouse as a data center.
-- Hit rate: pure-play 41/76 (54%); Amazon 0/75 after the gate.

create table if not exists public.dc_operator_cik (
  operator text primary key, cik bigint not null, filer_name text not null,
  relationship text not null default 'self' check (relationship in ('self','parent')),
  pure_play_dc boolean not null default false,
  method text, notes text, resolved_at timestamptz not null default now());
alter table public.dc_operator_cik enable row level security;
revoke all on public.dc_operator_cik from anon, authenticated;

comment on column public.dc_operator_cik.pure_play_dc is
 'True only where the filer''s business is data centers exclusively, so a city named in its own '
 'filing necessarily refers to a data center. Gates city-level attestation.';

create table if not exists public.dc_sec_attest_checks (
  id uuid primary key default gen_random_uuid(),
  operator text not null, city text not null, state_abbr text,
  cik bigint not null, query_phrase text not null,
  http_status int, total_hits int,
  accession text, form text, filed_date date, filing_url text,
  status text not null default 'pending' check (status in ('pending','hit','no_hit','error')),
  checked_at timestamptz not null default now(),
  unique (operator, city, cik));
alter table public.dc_sec_attest_checks enable row level security;
revoke all on public.dc_sec_attest_checks from anon, authenticated;

insert into public.source_registry
  (source_key,name,url,access_method,cadence,source_type,status,license_status,license,
   confidence_cap,fetcher,notes)
values ('sec:edgar','SEC EDGAR — company filings','https://efts.sec.gov/LATEST/search-index',
  'json_api','event_driven','government_feed','active','cleared',
  'US government publication — public domain. Filings are mandatory disclosures carrying '
  'securities-law liability.','VRF','fn_dc_sec_attest',
  'efts.sec.gov and data.sec.gov are reachable; www.sec.gov/Archives 403s ("Undeclared Automated '
  'Tool"). ⚠️ Do NOT set a custom User-Agent — SEC accepts the pgsql-http default and 403s custom '
  'strings (verified 2026-08-01 in fn_sec_edgar_fts_ingest, re-confirmed 2026-08-09).')
on conflict (source_key) do update
  set license_status=excluded.license_status, license=excluded.license, notes=excluded.notes;

-- fn_dc_state_name(abbr) and fn_dc_sec_attest(limit) are created in-session; see
-- docs/dc-inventory/SPRINT-3-REPORT.md for the full bodies. fn_dc_sec_attest queries EDGAR
-- full-text search for "<City>, <State>" restricted to the operator's own CIK, records every
-- check (including misses) for auditability, and is resumable.
