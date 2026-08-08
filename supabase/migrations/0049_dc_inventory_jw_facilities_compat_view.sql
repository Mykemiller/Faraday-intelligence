-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 6 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808213026
--   dc_inventory_0049_jw_facilities_compat_view
--
-- Rename the base table and put a backward-compatible VIEW in its place.
--
-- ⚠ WHY THIS VIEW REPRODUCES THE LEGACY ROWS *EXACTLY*, RATHER THAN
--   PROJECTING dc_facility_current:
--
--   jw_facilities is read by jw_briefing_inputs(), by the LIVE daily cron
--   jw-state-jds-rollup (03:20 UTC, jobid 21), by jw-facility-health-check
--   (05:00 UTC, jobid 17, which keys on created_at), by jw_brief_map_geojson
--   and by inference_pass4/5. dc_facility_current deliberately drops the 865
--   unresolved permit candidates and re-derives jurisdiction_id at COUNTY
--   tier (rule 6) where the legacy join sat at METRO tier. Projecting it
--   would silently change what every one of those consumers sees - which is
--   the ~29-hour full re-fingerprint of ~39.5k jurisdictions the ticket
--   names as a STOP condition (FAR-377 precedent).
--
--   So: the canonical inventory (dc_facilities) is 1,418 and the headline
--   count falls exactly as approved. The compatibility shim is value-exact
--   at 2,283 and changes nothing downstream. An equivalence gate at the
--   bottom of this migration PROVES that, column by column, and rolls the
--   whole migration back if it is off by a single cell.
-- =====================================================================

create or replace function public.fn_dc_jsonb_to_text_array(p jsonb)
returns text[] language sql immutable security invoker set search_path = public, pg_temp as $$
  select case
    when p is null then null
    when jsonb_typeof(p) <> 'array' then null
    else array(select jsonb_array_elements_text(p))
  end;
$$;

alter table public.jw_facilities rename to jw_facilities_legacy_20260808;
comment on table public.jw_facilities_legacy_20260808 is
  'FROZEN legacy flat facility table (2,283 rows), renamed 2026-08-08 by the DC inventory '
  'entity-model cutover. RETAINED, not dropped. The views jds_status and '
  'v_idf_d14_facilities still bind to this table by OID and therefore followed the rename - '
  'that is safe while nothing writes here, and is flagged for Sprint 2.';

-- ---------------------------------------------------------------------
create view public.jw_facilities
with (security_invoker = true) as
with o as (
  select *
  from public.dc_facility_observations
  where source_document_ref like 'jwf:%'
    and not retracted and not superseded
),
p as (
  select
    substring(source_document_ref from 5)::uuid as legacy_id,
    min(source_key)  as source_key,
    min(source_url)  as source_url,
    min(confidence_cap) as source_confidence,
    max(value_text) filter (where attribute = 'name')                   as facility_name,
    max(value_text) filter (where attribute = 'operator')               as operator,
    max(value_text) filter (where attribute = 'operator_parent')        as operator_parent,
    max(value_text) filter (where attribute = 'developer')              as developer,
    max(value_text) filter (where attribute = 'facility_type')          as facility_type,
    max(value_text) filter (where attribute = 'power_source')           as power_source,
    max(value_text) filter (where attribute = 'lifecycle_status')       as lifecycle_status,
    max(value_text) filter (where attribute = 'legacy_jurisdiction_id') as legacy_jurisdiction_id,
    max(value_text) filter (where attribute = 'legacy_created_at')      as legacy_created_at,
    max(value_text) filter (where attribute = 'legacy_updated_at')      as legacy_updated_at,
    max(value_text) filter (where attribute = 'announced_date')         as announced_date,
    max(value_text) filter (where attribute = 'operational_date')       as operational_date,
    max(value_text) filter (where attribute = 'construction_start_date') as construction_start_date,
    max(value_text) filter (where attribute = 'last_verified')          as last_verified,
    max(notes)      filter (where attribute = 'existence')              as notes,
    max(value_num)  filter (where attribute = 'capacity_unspecified_basis') as capacity_mw,
    max(value_num)  filter (where attribute = 'site_acres')             as site_acres,
    max(value_num)  filter (where attribute = 'building_sqft')          as building_sqft,
    max(value_num)  filter (where attribute = 'total_power_mw')         as total_power_mw,
    (array_agg(value_json) filter (where attribute = 'coordinates'))[1]     as coordinates,
    (array_agg(value_json) filter (where attribute = 'address'))[1]         as addr,
    (array_agg(value_json) filter (where attribute = 'tenant'))[1]          as tenants,
    (array_agg(value_json) filter (where attribute = 'compute_profile'))[1] as compute_profile,
    (array_agg(value_json) filter (where attribute = 'data_sources'))[1]    as data_sources,
    (array_agg(value_json) filter (where attribute = 'external_ids'))[1]    as external_ids
  from o
  group by 1
)
select
  p.legacy_id                                            as id,
  nullif(p.legacy_jurisdiction_id, '')::uuid             as jurisdiction_id,
  p.facility_name,
  p.operator,
  p.operator_parent,
  public.fn_dc_jds_from_lifecycle(p.lifecycle_status)    as jds_layer,
  -- reverse of fn_dc_legacy_lifecycle: the legacy vocabulary called an
  -- L4 record 'acquisition'; the model calls it 'announced'.
  case p.lifecycle_status when 'announced' then 'acquisition'
                          else p.lifecycle_status end    as status,
  p.capacity_mw,
  p.site_acres,
  p.addr->>'address'                                     as address,
  p.addr->>'city'                                        as city,
  (p.addr->>'state_abbr')::char(2)                       as state_abbr,
  (p.coordinates->>'lat')::numeric                       as lat,
  (p.coordinates->>'lng')::numeric                       as lng,
  -- inverse of the single registry alias in fn_dc_legacy_source_key
  case when p.source_key = 'shovels:permits' then 'Shovels Permits (seed)'
       else sr.name end                                  as source_name,
  p.source_url,
  p.source_confidence,
  p.announced_date::date,
  p.operational_date::date,
  p.last_verified::date,
  p.notes,
  p.legacy_created_at::timestamptz                       as created_at,
  p.legacy_updated_at::timestamptz                       as updated_at,
  -- constant across all 2,283 legacy rows; proven by the equivalence gate below
  'US'::char(2)                                          as country_code,
  'estimated'::text                                      as geo_precision,
  p.developer,
  p.facility_type,
  p.total_power_mw,
  p.power_source,
  p.building_sqft,
  coalesce(p.compute_profile, '{}'::jsonb)               as compute_profile,
  p.construction_start_date::date,
  public.fn_dc_jsonb_to_text_array(p.tenants)            as tenant_names,
  coalesce(public.fn_dc_jsonb_to_text_array(p.data_sources), '{}'::text[]) as data_sources,
  coalesce(p.external_ids, '{}'::jsonb)                  as external_ids
from p
join public.source_registry sr on sr.source_key = p.source_key;

comment on view public.jw_facilities is
  'BACKWARD-COMPATIBILITY SHIM over the observation model. Reproduces the frozen '
  'jw_facilities_legacy_20260808 table exactly: same 35 columns, same 2,283 rows, same '
  'values. Deliberately NOT a projection of dc_facility_current - see the migration header. '
  'New work must read dc_facility_current (internal) or dc_facility_public (subscriber).';

-- Grants mirror the legacy table exactly (anon held a SELECT grant but no RLS
-- policy, so anon saw zero rows; security_invoker=true reproduces that).
grant select on public.jw_facilities to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- INSTEAD OF INSERT — jw_shovels_apply_jds_candidates() inserts into
-- jw_facilities, and a view is not insertable on its own. Route the write
-- into the observation model so the canonical tables stay canonical and
-- that function keeps working unchanged.
-- ---------------------------------------------------------------------
create or replace function public.fn_jw_facilities_compat_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_legacy_id   uuid := coalesce(new.id, gen_random_uuid());
  v_source_key  text := public.fn_dc_legacy_source_key(coalesce(new.source_name, 'unknown'));
  v_class       text := public.fn_dc_legacy_source_class(coalesce(new.source_name, 'unknown'));
  v_lifecycle   text := public.fn_dc_legacy_lifecycle(new.status);
  v_lineage     text;
  v_facility_id uuid;
  v_identified  boolean;
  v_license     text;
  v_redist      boolean;
begin
  -- the source must be registered before it can be cited
  insert into public.source_registry
    (source_key, name, url, access_method, cadence, confidence_cap,
     license, license_status, status, source_type, source_level, countable, notes)
  values (v_source_key, coalesce(new.source_name, 'unknown'), '', 'manual', 'one_time',
          coalesce(new.source_confidence, 'INF'), 'unreviewed', 'unreviewed', 'registered',
          'other', 'secondary', false,
          'Auto-registered by the jw_facilities compatibility INSERT shim. LICENCE NOT REVIEWED.')
  on conflict (source_key) do nothing;

  select license_status into v_license from public.source_registry where source_key = v_source_key;
  v_redist := v_license in ('cleared','attribution_required');

  v_lineage := encode(digest(v_source_key || ':jwf:' || v_legacy_id::text, 'sha256'), 'hex');

  -- same rule 3 test the backfill uses
  v_identified := not (
    v_source_key = 'shovels:permits'
    and new.lat is null and new.lng is null
    and new.operator is null and new.developer is null
    and coalesce(new.external_ids, '{}'::jsonb) = '{}'::jsonb
  );

  if v_identified then
    v_facility_id := gen_random_uuid();
    insert into public.dc_facilities
      (id, fdc_id, grain, primary_name, country_code, subdivision_code, geog,
       geo_precision, lifecycle_status, discovered_at)
    values (v_facility_id, public.dc_mint_fdc_id(current_date), 'site',
            new.facility_name, coalesce(new.country_code, 'US'),
            case when nullif(trim(new.state_abbr), '') is null then null
                 else 'US-' || upper(trim(new.state_abbr)) end,
            case when new.lat is null or new.lng is null then null
                 else st_setsrid(st_makepoint(new.lng::float8, new.lat::float8), 4326)::geography end,
            case when new.lat is null or new.lng is null then 'none'
                 else coalesce(new.geo_precision, 'estimated') end,
            v_lifecycle, current_date);

    insert into public.dc_facility_identifiers (facility_id, source_key, external_id)
    values (v_facility_id, v_source_key, 'jwf:' || v_legacy_id::text)
    on conflict do nothing;
  end if;

  insert into public.dc_facility_observations
    (facility_id, source_key, source_class, source_url, source_document_ref, observed_at,
     attribute, value_text, value_num, value_json, unit, primary_lineage_key,
     is_primary_source, redistributable, license_status_snap, confidence_cap, notes)
  select v_facility_id, v_source_key, v_class, new.source_url,
         'jwf:' || v_legacy_id::text,
         coalesce(new.last_verified, new.announced_date, current_date),
         a.attribute, a.value_text, a.value_num, a.value_json, a.unit, v_lineage,
         v_class in ('official_record','operator_first_party'),
         v_redist, v_license, coalesce(new.source_confidence, 'INF'), a.notes
  from (values
    ('existence',                new.facility_name, null::numeric, null::jsonb, null::text, new.notes),
    ('name',                     new.facility_name, null, null, null, null),
    ('operator',                 new.operator, null, null, null, null),
    ('operator_parent',          new.operator_parent, null, null, null, null),
    ('developer',                new.developer, null, null, null, null),
    ('facility_type',            new.facility_type, null, null, null, null),
    ('power_source',             new.power_source, null, null, null, null),
    ('lifecycle_status',         v_lifecycle, null, null, null, null),
    ('legacy_jurisdiction_id',   new.jurisdiction_id::text, null, null, null, null),
    ('legacy_created_at',        coalesce(new.created_at, now())::text, null, null, null, null),
    ('legacy_updated_at',        coalesce(new.updated_at, now())::text, null, null, null, null),
    ('announced_date',           new.announced_date::text, null, null, null, null),
    ('operational_date',         new.operational_date::text, null, null, null, null),
    ('construction_start_date',  new.construction_start_date::text, null, null, null, null),
    ('last_verified',            new.last_verified::text, null, null, null, null),
    ('site_acres',               null, new.site_acres, null, 'acres', null),
    ('building_sqft',            null, new.building_sqft, null, 'sqft', null),
    ('total_power_mw',           null, new.total_power_mw, null, 'MW', null),
    -- still no basis => still not attribute='capacity'
    ('capacity_unspecified_basis', null, new.capacity_mw, null, 'MW',
       'Written through the jw_facilities compatibility shim with no capacity_basis.'),
    ('coordinates', null, null,
       case when new.lat is null or new.lng is null then null
            else jsonb_build_object('lat', new.lat, 'lng', new.lng,
                                    'geo_precision', coalesce(new.geo_precision,'estimated')) end,
       null, null),
    ('address', null, null,
       jsonb_build_object('city', new.city, 'state_abbr', nullif(trim(new.state_abbr), ''),
                          'address', new.address), null, null),
    ('tenant',          null, null, to_jsonb(new.tenant_names), null, null),
    ('compute_profile', null, null, nullif(new.compute_profile, '{}'::jsonb), null, null),
    ('data_sources',    null, null, to_jsonb(new.data_sources), null, null),
    ('external_ids',    null, null, nullif(new.external_ids, '{}'::jsonb), null, null)
  ) as a(attribute, value_text, value_num, value_json, unit, notes)
  where a.value_text is not null or a.value_num is not null or a.value_json is not null;

  if v_facility_id is not null then
    update public.dc_facilities f
    set jds_layer = public.dc_compute_jds_layer(f.id),
        facility_confidence_score = c.score,
        facility_confidence_band  = c.band,
        publishable               = public.dc_compute_publishable(f.id)
    from public.dc_compute_facility_confidence(v_facility_id) c
    where f.id = v_facility_id;
  end if;

  return new;
end;
$$;

comment on function public.fn_jw_facilities_compat_insert() is
  'INSTEAD OF INSERT shim for the jw_facilities compatibility view. Routes legacy-shaped '
  'writes (jw_shovels_apply_jds_candidates) into the observation model. It mints a facility '
  'only when a subject is identified - the same rule 3 test the backfill uses - so an '
  'unidentified permit still creates NO facility.';

create trigger trg_jw_facilities_compat_insert
  instead of insert on public.jw_facilities
  for each row execute function public.fn_jw_facilities_compat_insert();

-- ---------------------------------------------------------------------
-- EQUIVALENCE GATE — 35 columns, 2,283 rows, cell for cell.
-- ---------------------------------------------------------------------
do $gate$
declare
  v_legacy_rows int; v_view_rows int;
  v_legacy_cols text[]; v_view_cols text[];
  v_diff_fwd int; v_diff_rev int;
begin
  select array_agg(column_name::text order by ordinal_position) into v_legacy_cols
  from information_schema.columns
  where table_schema='public' and table_name='jw_facilities_legacy_20260808';

  select array_agg(column_name::text order by ordinal_position) into v_view_cols
  from information_schema.columns
  where table_schema='public' and table_name='jw_facilities';

  if v_legacy_cols is distinct from v_view_cols then
    raise exception 'GATE: column set/order differs.% legacy=%  view=%', chr(10), v_legacy_cols, v_view_cols;
  end if;
  if array_length(v_view_cols,1) <> 35 then
    raise exception 'GATE: expected 35 columns, view has %', array_length(v_view_cols,1);
  end if;

  select count(*) into v_legacy_rows from public.jw_facilities_legacy_20260808;
  select count(*) into v_view_rows   from public.jw_facilities;
  if v_legacy_rows <> v_view_rows then
    raise exception 'GATE: row count differs - legacy % vs view %', v_legacy_rows, v_view_rows;
  end if;

  select count(*) into v_diff_fwd from (
    select * from public.jw_facilities
    except all
    select * from public.jw_facilities_legacy_20260808) d;

  select count(*) into v_diff_rev from (
    select * from public.jw_facilities_legacy_20260808
    except all
    select * from public.jw_facilities) d;

  if v_diff_fwd <> 0 or v_diff_rev <> 0 then
    raise exception 'GATE: view is not value-identical to the legacy table (% rows only in view, % only in table)',
      v_diff_fwd, v_diff_rev;
  end if;

  raise notice 'COMPAT GATE PASSED: 35/35 columns, %/% rows, 0 differing cells',
    v_view_rows, v_legacy_rows;
end;
$gate$;
