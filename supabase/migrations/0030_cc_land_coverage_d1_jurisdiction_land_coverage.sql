-- CC-LAND-COVERAGE-1.0 · D1
-- Per-county public-land coverage caveat, structurally modeled on
-- public.jurisdiction_water_stress. This is a COVERAGE signal only: it
-- describes how much of a jurisdiction's land is under public (federal /
-- state / tribal) control and is NEVER an input to any score. It does not
-- and must not reduce jpas_score / jds_score / current_score.
--
-- Population is source-gated (PAD-US county Summary Statistics). The schema,
-- constraints, and RLS ship now; rows land once the tenure source is ingested.
-- Applied to project ycadmmngkdhvpcsrcuaq 2026-07-24.

create table if not exists public.jurisdiction_land_coverage (
  jurisdiction_id      uuid    not null references public.jurisdictions(id) on delete cascade,
  dataset_version      text    not null,
  -- county whose tenure figures populate this row: the jurisdiction's own
  -- county for directly-computed rows; the containing county for inherited rows
  source_county_fips   text,
  -- fraction of census land area under any public tenure (0..1). Fee only.
  public_land_fraction numeric not null,
  -- component tenure fractions of census land area (0..1); may be null when a
  -- component is not separately resolved by the source
  federal_fraction     numeric,
  state_fraction       numeric,
  tribal_fraction      numeric,
  -- denominator used = jurisdictions.census_land_area_sqmi (never re-derived)
  land_area_sqmi       numeric,
  -- easement acreage is NOT public tenure; when true it was excluded from the
  -- fractions above (fee interest only)
  fee_only             boolean not null default true,
  join_method          text    not null,   -- 'padus_county_direct' | 'inherited_county'
  coverage             text    not null default 'covered',
  source_key           text,               -- -> public.jw_data_source_registry.source_key
  dataset_vintage      text,               -- e.g. 'PAD-US 4.0 (2024)'
  hash                 text    not null,
  loaded_at            timestamptz not null default now(),
  primary key (jurisdiction_id, dataset_version),
  -- §2 invariant: every populated row has a public_land_fraction in [0,1]
  constraint jlc_public_fraction_range check (public_land_fraction >= 0 and public_land_fraction <= 1),
  -- §2 invariant: components never exceed the public total (small float tolerance)
  constraint jlc_component_sum check (
    coalesce(federal_fraction,0) + coalesce(state_fraction,0) + coalesce(tribal_fraction,0)
      <= public_land_fraction + 0.001),
  constraint jlc_federal_range check (federal_fraction is null or (federal_fraction >= 0 and federal_fraction <= 1)),
  constraint jlc_state_range   check (state_fraction   is null or (state_fraction   >= 0 and state_fraction   <= 1)),
  constraint jlc_tribal_range  check (tribal_fraction  is null or (tribal_fraction  >= 0 and tribal_fraction  <= 1)),
  constraint jlc_join_method   check (join_method in ('padus_county_direct','inherited_county'))
);

create index if not exists idx_jlc_source_county_fips on public.jurisdiction_land_coverage (source_county_fips);
create index if not exists idx_jlc_join_method        on public.jurisdiction_land_coverage (join_method);

comment on table public.jurisdiction_land_coverage is
  'CC-LAND-COVERAGE-1.0 D1: per-jurisdiction public-land coverage caveat (federal/state/tribal fraction of census land area). COVERAGE signal only — never an input to any score, never a penalty. Modeled on jurisdiction_water_stress. Loader contract: never write a row where jurisdictions.census_land_area_sqmi is null; V1 populates fips_type=county directly and sub-county rows inherit from containing_county_fips with join_method=inherited_county.';
comment on column public.jurisdiction_land_coverage.fee_only is
  'When true, conservation/agricultural easements are excluded from all fractions (fee interest only). Easement acreage is not public tenure.';
comment on column public.jurisdiction_land_coverage.join_method is
  'padus_county_direct = tenure computed for this county; inherited_county = sub-county jurisdiction inheriting its containing county''s fractions.';

alter table public.jurisdiction_land_coverage enable row level security;
-- Deny-all posture: RLS enabled with NO policies (service role bypasses RLS),
-- matching jurisdiction_water_stress / jw_data_source_registry convention. Not anon-readable.
