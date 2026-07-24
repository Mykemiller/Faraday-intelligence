-- CC-LAND-COVERAGE-1.0 · D2 (schema)
-- Curated registry of federal sites that matter to siting (DOE national labs,
-- NNSA production/cleanup sites). CC seeds the MECHANICAL roster from public
-- DOE/NNSA rosters; every row ships review_status='pending'. Editorial
-- qualification (anchor tiering, security tier, suitability) is Myke's pass,
-- NOT CC's. site_category / program here are the roster's own factual
-- descriptors, not a Faraday suitability judgment.
-- Applied to project ycadmmngkdhvpcsrcuaq 2026-07-24.

create table if not exists public.federal_anchor_sites (
  id              uuid primary key default gen_random_uuid(),
  site_key        text not null unique,   -- stable slug for idempotent re-seed
  site_name       text not null,
  site_category   text,                   -- factual roster class: national_laboratory | production_site | cleanup_site | test_site
  program         text,                   -- owning DOE program: DOE-SC | NNSA | DOE-EM | DOE-NE | DOE-EERE | DOE-FE
  operator        text,                   -- M&O / managing organization (public, may be null when contractor churns)
  nearest_city    text,
  state           text not null,          -- USPS 2-letter
  state_fips      text,
  county_name     text,
  county_fips     text,
  jurisdiction_id uuid references public.jurisdictions(id) on delete set null,
  latitude        numeric,                -- approximate site location (public), null when uncertain
  longitude       numeric,
  source_key      text,                   -- -> public.jw_data_source_registry.source_key
  source_note     text,
  review_status   text not null default 'pending',
  dataset_version text,
  hash            text,
  loaded_at       timestamptz not null default now(),
  constraint fas_review_status check (review_status in ('pending','qualified','rejected','superseded'))
);

create index if not exists idx_fas_state           on public.federal_anchor_sites (state);
create index if not exists idx_fas_jurisdiction_id  on public.federal_anchor_sites (jurisdiction_id);
create index if not exists idx_fas_review_status    on public.federal_anchor_sites (review_status);

comment on table public.federal_anchor_sites is
  'CC-LAND-COVERAGE-1.0 D2: curated registry of federal anchor sites (DOE national labs + NNSA production/cleanup). Mechanical roster seeded by CC; all rows review_status=pending pending Myke editorial qualification. No anchor_type/security_tier/suitability assigned by CC. DOD/MIRTA deferred (V1 = DOE/NNSA only).';
comment on column public.federal_anchor_sites.site_category is
  'Factual roster classification from the DOE/NNSA source (national_laboratory | production_site | cleanup_site | test_site). NOT a Faraday suitability tier.';
comment on column public.federal_anchor_sites.review_status is
  'Ships pending for every CC-seeded row. Editorial qualification is Myke''s pass.';

alter table public.federal_anchor_sites enable row level security;
-- Deny-all posture: RLS enabled, no policies (service role bypasses).
