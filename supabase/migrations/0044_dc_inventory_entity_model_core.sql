-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 1 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808211449
--   dc_inventory_0044_entity_model_core
--
-- Canonical facility entity + append-only sourced observations.
-- Additive only. Touches nothing that exists.
-- =====================================================================

-- ---------------------------------------------------------------- 1/5
create table if not exists public.dc_facilities (
  id                        uuid primary key default gen_random_uuid(),
  fdc_id                    text not null unique,
  grain                     text not null
                              check (grain in ('campus','site','building')),
  parent_facility_id        uuid null references public.dc_facilities(id),
  primary_name              text not null,
  country_code              char(2) not null,
  subdivision_code          text null,
  geog                      geography(Point,4326) null,
  geo_precision             text not null default 'none'
                              check (geo_precision in ('verified','parcel','address',
                                     'centroid','municipality','estimated','none')),
  lifecycle_status          text not null
                              check (lifecycle_status in ('rumored','announced','entitled',
                                     'permitted','construction','commissioning',
                                     'operational','expansion','decommissioned')),
  jurisdiction_id           uuid null references public.jurisdictions(id),
  facility_confidence_score smallint null,
  facility_confidence_band  text null,
  publishable               boolean not null default false,
  jds_layer                 text null,
  superseded_by             uuid null references public.dc_facilities(id),
  discovered_at             date not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.dc_facilities is
  'Canonical data-center facility entity. THIN by design: operator, capacity, sqft, acres, '
  'tenants, power source and dates are NOT columns here - they are resolved from '
  'dc_facility_observations by view (dc_facility_current / dc_facility_public).';
comment on column public.dc_facilities.jurisdiction_id is
  'US only. DERIVED by PostGIS spatial join against jurisdiction_census_profile.geom_full '
  '(county level). Never hand-set, never copied from a prior join.';
comment on column public.dc_facilities.jds_layer is
  'Computed weekly by dc_compute_jds_layer(). NEVER written by an ingest path.';
comment on column public.dc_facilities.facility_confidence_score is
  'Computed by dc_compute_facility_confidence(). Not source-of-truth; recomputable at any time.';
comment on column public.dc_facilities.superseded_by is
  'Set when this facility was merged away. fdc_id is NEVER reused or renumbered, so any '
  'published citation of a merged fdc_id stays resolvable through this pointer.';

create index if not exists dc_facilities_geog_gix     on public.dc_facilities using gist (geog);
create index if not exists dc_facilities_fdc_id_ix    on public.dc_facilities (fdc_id);
create index if not exists dc_facilities_parent_ix    on public.dc_facilities (parent_facility_id);
create index if not exists dc_facilities_country_ix   on public.dc_facilities (country_code);
create index if not exists dc_facilities_lifecycle_ix on public.dc_facilities (lifecycle_status);
create index if not exists dc_facilities_publish_ix   on public.dc_facilities (publishable);
create index if not exists dc_facilities_name_trgm_ix on public.dc_facilities using gin (primary_name gin_trgm_ops);
create index if not exists dc_facilities_jurisdiction_ix on public.dc_facilities (jurisdiction_id);

-- ---------------------------------------------------------------- 2/5
create table if not exists public.dc_facility_observations (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid null references public.dc_facilities(id),
  source_key          text not null references public.source_registry(source_key),
  source_class        text not null
                        check (source_class in ('official_record','operator_first_party',
                               'commercial_dataset','directory','news','derived')),
  source_url          text,
  source_document_ref text,
  observed_at         date not null,
  ingested_at         timestamptz not null default now(),
  attribute           text not null,
  value_text          text,
  value_num           numeric,
  value_json          jsonb,
  unit                text,
  capacity_basis      text null
                        check (capacity_basis in ('it_load','critical_it','gross_utility',
                               'contracted','announced_total')),
  primary_lineage_key text not null,
  is_primary_source   boolean not null default false,
  redistributable     boolean not null,
  license_status_snap text not null,
  confidence_cap      text check (confidence_cap in ('VRF','SRC','INF','EST')),
  superseded          boolean not null default false,
  retracted           boolean not null default false,
  notes               text,
  -- A bare capacity number with no stated basis is the single most common way
  -- this dataset goes wrong. Refuse it at the table.
  constraint dc_fobs_capacity_basis_required
    check (attribute <> 'capacity' or capacity_basis is not null)
);

comment on table public.dc_facility_observations is
  'APPEND-ONLY sourced claims. One row = one source asserting one attribute on one date. '
  'facility_id NULL = unresolved candidate (a claim with no identified subject). '
  'UPDATE is restricted by trigger to the superseded / retracted flags; DELETE is blocked.';
comment on column public.dc_facility_observations.primary_lineage_key is
  'Stable hash of the ORIGINATING document. All derivative coverage of one press release '
  'shares one key and is counted ONCE by the confidence and publishability functions.';
comment on column public.dc_facility_observations.redistributable is
  'STAMPED AT WRITE TIME from source_registry.license_status '
  '(cleared | attribution_required -> true; gated | blocked | unreviewed -> false). '
  'Never resolved at read time - a licence review that happens later must be a deliberate restamp.';

create index if not exists dc_fobs_facility_ix   on public.dc_facility_observations (facility_id);
create index if not exists dc_fobs_source_ix     on public.dc_facility_observations (source_key);
create index if not exists dc_fobs_lineage_ix    on public.dc_facility_observations (primary_lineage_key);
create index if not exists dc_fobs_attribute_ix  on public.dc_facility_observations (attribute);
create index if not exists dc_fobs_class_ix      on public.dc_facility_observations (source_class);
create index if not exists dc_fobs_live_ix       on public.dc_facility_observations (facility_id, attribute)
                                                  where not retracted and not superseded;

-- Append-only enforcement -------------------------------------------------
create or replace function public.fn_dc_observations_append_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dc_facility_observations is append-only: DELETE is not permitted (id=%)', old.id
      using errcode = 'P0001';
  end if;

  -- Only the supersede/retract flags (and their explanatory note) may move.
  -- facility_id is the one further exception: an unresolved candidate may later
  -- be attached to a subject (NULL -> value), never re-pointed.
  if (new.source_key, new.source_class, new.source_url,
      new.source_document_ref, new.observed_at, new.ingested_at, new.attribute,
      new.value_text, new.value_num, new.value_json, new.unit, new.capacity_basis,
      new.primary_lineage_key, new.is_primary_source, new.redistributable,
      new.license_status_snap, new.confidence_cap, new.id)
     is distinct from
     (old.source_key, old.source_class, old.source_url,
      old.source_document_ref, old.observed_at, old.ingested_at, old.attribute,
      old.value_text, old.value_num, old.value_json, old.unit, old.capacity_basis,
      old.primary_lineage_key, old.is_primary_source, old.redistributable,
      old.license_status_snap, old.confidence_cap, old.id)
  then
    raise exception 'dc_facility_observations is append-only: only superseded/retracted/notes '
                    'may be updated (or facility_id resolved from NULL). id=%', old.id
      using errcode = 'P0001';
  end if;

  if new.facility_id is distinct from old.facility_id and old.facility_id is not null then
    raise exception 'dc_facility_observations: facility_id may only be resolved from NULL, '
                    'never re-pointed. id=%', old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dc_observations_append_only on public.dc_facility_observations;
create trigger trg_dc_observations_append_only
  before update or delete on public.dc_facility_observations
  for each row execute function public.fn_dc_observations_append_only();

-- ---------------------------------------------------------------- 3/5
create table if not exists public.dc_facility_identifiers (
  facility_id uuid not null references public.dc_facilities(id),
  source_key  text not null references public.source_registry(source_key),
  external_id text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  constraint dc_facility_identifiers_uq unique (source_key, external_id)
);
comment on table public.dc_facility_identifiers is
  'External IDs per source, for re-ingest matching. unique(source_key, external_id).';
create index if not exists dc_facility_identifiers_facility_ix
  on public.dc_facility_identifiers (facility_id);

-- ---------------------------------------------------------------- 4/5
create table if not exists public.dc_facility_merges (
  id                    uuid primary key default gen_random_uuid(),
  surviving_facility_id uuid not null references public.dc_facilities(id),
  merged_facility_id    uuid not null references public.dc_facilities(id),
  merged_fdc_id         text not null,
  match_score           numeric,
  method                text not null check (method in ('auto','manual')),
  reason                text not null,
  actor                 text not null,
  merged_at             timestamptz not null default now(),
  reversed_at           timestamptz null
);
comment on table public.dc_facility_merges is
  'Reversible merge audit trail. merged_fdc_id is retained verbatim: fdc_id is NEVER '
  'reused or renumbered, and a merged id stays resolvable via dc_facilities.superseded_by.';
create index if not exists dc_facility_merges_surviving_ix on public.dc_facility_merges (surviving_facility_id);
create index if not exists dc_facility_merges_merged_ix    on public.dc_facility_merges (merged_facility_id);

-- ---------------------------------------------------------------- 5/5
create table if not exists public.dc_facility_confidence_bands (
  band       text primary key,
  min_score  smallint not null,
  max_score  smallint not null,
  sort_order int not null,
  constraint dc_fcb_range check (min_score <= max_score)
);
comment on table public.dc_facility_confidence_bands is
  'EDITABLE score -> label config. dc_compute_facility_confidence() READS this table; '
  'thresholds are never hardcoded in the function. Band labels are subscriber-facing: '
  'changing one is a Myke decision.';

insert into public.dc_facility_confidence_bands (band, min_score, max_score, sort_order) values
  ('Identified',                0,  19, 1),
  ('Suspect',                  20,  39, 2),
  ('Preliminary Confirmation', 40,  59, 3),
  ('Confirmed',                60,  84, 4),
  ('Validated',                85, 100, 5)
on conflict (band) do nothing;

-- ---------------------------------------------------- updated_at keeper
create or replace function public.fn_dc_facilities_touch()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_dc_facilities_touch on public.dc_facilities;
create trigger trg_dc_facilities_touch before update on public.dc_facilities
  for each row execute function public.fn_dc_facilities_touch();

-- =====================================================================
-- RLS — enabled in the SAME migration that creates the tables.
-- authenticated-only. NO anon read on any of them, including the tables
-- behind dc_facility_public: subscriber access is gated separately (FAR-402).
-- service_role bypasses RLS and remains the only writer.
-- =====================================================================
alter table public.dc_facilities                enable row level security;
alter table public.dc_facility_observations     enable row level security;
alter table public.dc_facility_identifiers      enable row level security;
alter table public.dc_facility_merges           enable row level security;
alter table public.dc_facility_confidence_bands enable row level security;

drop policy if exists dc_facilities_authenticated_read                on public.dc_facilities;
drop policy if exists dc_facility_observations_authenticated_read     on public.dc_facility_observations;
drop policy if exists dc_facility_identifiers_authenticated_read      on public.dc_facility_identifiers;
drop policy if exists dc_facility_merges_authenticated_read           on public.dc_facility_merges;
drop policy if exists dc_facility_confidence_bands_authenticated_read on public.dc_facility_confidence_bands;

create policy dc_facilities_authenticated_read
  on public.dc_facilities for select to authenticated using (true);
create policy dc_facility_observations_authenticated_read
  on public.dc_facility_observations for select to authenticated using (true);
create policy dc_facility_identifiers_authenticated_read
  on public.dc_facility_identifiers for select to authenticated using (true);
create policy dc_facility_merges_authenticated_read
  on public.dc_facility_merges for select to authenticated using (true);
create policy dc_facility_confidence_bands_authenticated_read
  on public.dc_facility_confidence_bands for select to authenticated using (true);

-- anon gets nothing at all on these five.
revoke all on public.dc_facilities                from anon;
revoke all on public.dc_facility_observations     from anon;
revoke all on public.dc_facility_identifiers      from anon;
revoke all on public.dc_facility_merges           from anon;
revoke all on public.dc_facility_confidence_bands from anon;
