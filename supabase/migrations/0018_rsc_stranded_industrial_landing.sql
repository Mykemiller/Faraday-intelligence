-- 0018_rsc_stranded_industrial_landing.sql
-- CC-RSC-STRANDED-INDUSTRIAL-1.0 — landing tables for the RSC (Real Estate / Site)
-- stranded-industrial feasibility layer. RAW SOURCE LANDING ONLY.
--
-- Boundaries: additive, RLS service-role-only (deny-by-default, reads via service
-- role + explicit checks — mirrors dc_facilities / grid_buildout_projects posture).
-- Content-hash idempotency on every table so re-runs are safe. Touches NO JPAS/JPS/
-- JDS object, NO scoring function, NO tier weight. RSC stays at 0 attributes, weight 0.
--
-- Join spine to public.jurisdictions:
--   county_fips (char 5)  → jurisdictions.fips_code (level='county')
--                         → jurisdictions.containing_county_fips (level in cousub/place)

-- ── 1. Shovels commercial new-construction permit history (RSC-05 velocity) ──────
create table if not exists public.shovels_permit_history (
  id                uuid primary key default gen_random_uuid(),
  shovels_permit_id text not null unique,
  county_fips       char(5),
  geo_id            text,
  permit_type       text,
  tags              text[] not null default '{}',
  status            text,
  property_type     text,
  file_date         date,
  issue_date        date,
  lag_days          integer,          -- issue_date - file_date, precomputed
  job_value         numeric,
  building_area_sqft numeric,
  latitude          numeric,
  longitude         numeric,
  content_hash      text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);
create index if not exists shovels_permit_history_county_issue_idx
  on public.shovels_permit_history (county_fips, issue_date desc);
create index if not exists shovels_permit_history_tags_idx
  on public.shovels_permit_history using gin (tags);

-- ── 2. EIA-860M retired generators (stranded power-plant proxy; full 2002+ list) ──
create table if not exists public.eia_retired_generators (
  id                uuid primary key default gen_random_uuid(),
  plant_code        text not null,
  generator_id      text not null,
  plant_name        text,
  state             text,
  county            text,
  county_fips       char(5),
  latitude          numeric,
  longitude         numeric,
  technology        text,
  energy_source     text,
  prime_mover       text,
  nameplate_capacity_mw numeric,
  operating_year    integer,
  retirement_year   integer,
  retirement_month  integer,
  balancing_authority_code text,
  sector            text,
  source            text not null default 'eia:860m',
  source_hash       text not null,
  ingested_at       timestamptz not null default now(),
  unique (plant_code, generator_id)
);
create index if not exists eia_retired_generators_county_idx
  on public.eia_retired_generators (county_fips);
create index if not exists eia_retired_generators_retyear_idx
  on public.eia_retired_generators (retirement_year);

-- ── 3. TRI facility reporting history (site discovery + closure inference) ────────
-- Grain = facility × reporting_year presence. Closure is INFERRED from a
-- last-reporting-year gap (noisy: threshold drop / chemical delisting also cause
-- drop-out). NEVER an SRC closure assertion.
create table if not exists public.tri_facility_history (
  id                uuid primary key default gen_random_uuid(),
  tri_facility_id   text not null,
  frs_registry_id   text,             -- EPA FRS spine (join backbone)
  facility_name     text,
  reporting_year    integer not null,
  naics_primary     text,
  industry_class    text,             -- steel|smelter|paper|fab|refinery|chemical|auto|other
  state             text,
  county            text,
  county_fips       char(5),
  latitude          numeric,
  longitude         numeric,
  content_hash      text not null,
  ingested_at       timestamptz not null default now(),
  unique (tri_facility_id, reporting_year)
);
create index if not exists tri_facility_history_county_idx
  on public.tri_facility_history (county_fips);
create index if not exists tri_facility_history_frs_idx
  on public.tri_facility_history (frs_registry_id);
create index if not exists tri_facility_history_naics_idx
  on public.tri_facility_history (naics_primary);

-- ── RLS: deny-by-default; service role bypasses RLS, so no policy = no anon access ─
alter table public.shovels_permit_history enable row level security;
alter table public.eia_retired_generators  enable row level security;
alter table public.tri_facility_history     enable row level security;

comment on table public.shovels_permit_history is
  'CC-RSC-STRANDED-INDUSTRIAL-1.0 RSC-05 velocity source. Commercial new-construction only. Content-hash idempotent.';
comment on table public.eia_retired_generators is
  'CC-RSC-STRANDED-INDUSTRIAL-1.0 EIA-860M retired grid generators (>=1MW). Retired power plants, NOT captive industrial gen.';
comment on table public.tri_facility_history is
  'CC-RSC-STRANDED-INDUSTRIAL-1.0 TRI facility-year presence for site discovery. Closure is INFERRED, never SRC.';
