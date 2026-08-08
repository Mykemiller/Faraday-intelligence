-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 5 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808212846
--   dc_inventory_0048_legacy_record_metadata_and_read_views
--
--  (a) carry the legacy record metadata (created_at / updated_at) as
--      observations, so the compatibility view can be value-exact;
--  (b) single source of truth for the JDS mapping;
--  (c) dc_facility_current (INTERNAL) and dc_facility_public.
-- =====================================================================

-- (b) one JDS mapping, used by the compute function AND by the compat view.
create or replace function public.fn_dc_jds_from_lifecycle(p_lifecycle text)
returns text language sql immutable security invoker set search_path = public, pg_temp as $$
  select case p_lifecycle
    when 'operational'    then 'L1'
    when 'commissioning'  then 'L1'
    when 'expansion'      then 'L1'
    when 'construction'   then 'L2'
    when 'permitted'      then 'L3'
    when 'entitled'       then 'L3'
    when 'announced'      then 'L4'
    when 'rumored'        then 'L4'
    when 'decommissioned' then null
  end;
$$;

-- signature unchanged => a genuine replacement, not an overload
create or replace function public.dc_compute_jds_layer(p_facility_id uuid)
returns text language sql stable security invoker set search_path = public, pg_temp as $$
  select public.fn_dc_jds_from_lifecycle(f.lifecycle_status)
  from public.dc_facilities f where f.id = p_facility_id;
$$;

-- (a) legacy record metadata as observations. Idempotent.
create or replace function public.fn_dc_backfill_legacy_metadata()
returns int
language plpgsql security invoker set search_path = public, extensions, pg_temp
as $$
declare v_n int;
begin
  insert into public.dc_facility_observations
    (facility_id, source_key, source_class, source_url, source_document_ref,
     observed_at, attribute, value_text, primary_lineage_key, is_primary_source,
     redistributable, license_status_snap, confidence_cap, notes)
  select
    i.facility_id,
    public.fn_dc_legacy_source_key(f.source_name),
    public.fn_dc_legacy_source_class(f.source_name),
    f.source_url,
    'jwf:' || f.id::text,
    coalesce(f.last_verified, f.announced_date, f.created_at::date),
    a.attribute,
    a.value_text,
    encode(digest(public.fn_dc_legacy_source_key(f.source_name) || ':jwf:' || f.id::text, 'sha256'), 'hex'),
    public.fn_dc_legacy_source_class(f.source_name) in ('official_record','operator_first_party'),
    sr.license_status in ('cleared','attribution_required'),
    sr.license_status,
    f.source_confidence,
    'LEGACY jw_facilities record metadata, carried for backward compatibility ONLY. '
    'It describes when the legacy ROW was written, not when the source asserted anything.'
  from public.jw_facilities f
  join public.source_registry sr on sr.source_key = public.fn_dc_legacy_source_key(f.source_name)
  left join public.dc_facility_identifiers i
    on i.external_id = 'jwf:' || f.id::text
   and i.source_key  = public.fn_dc_legacy_source_key(f.source_name)
  cross join lateral (values
    ('legacy_created_at', f.created_at::text),
    ('legacy_updated_at', f.updated_at::text)
  ) as a(attribute, value_text)
  where not exists (
    select 1 from public.dc_facility_observations o2
    where o2.source_document_ref = 'jwf:' || f.id::text
      and o2.attribute = a.attribute
  );

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.fn_dc_backfill_legacy_metadata() from public, anon, authenticated;

do $$
declare v_created int; v_updated int;
begin
  perform public.fn_dc_backfill_legacy_metadata();
  select count(*) into v_created from public.dc_facility_observations where attribute = 'legacy_created_at';
  select count(*) into v_updated from public.dc_facility_observations where attribute = 'legacy_updated_at';
  if v_created <> 2283 or v_updated <> 2283 then
    raise exception 'GATE: legacy metadata coverage is %/% (expected 2283/2283)', v_created, v_updated;
  end if;
end;
$$;

-- =====================================================================
-- dc_facility_current — best resolved value per attribute per facility.
-- Resolution order: highest confidence_cap -> most recent observed_at ->
-- most independent lineages agreeing.
-- INCLUDES non-redistributable observations. INTERNAL ONLY.
-- =====================================================================
drop view if exists public.dc_facility_public;
drop view if exists public.dc_facility_current;

create view public.dc_facility_current
with (security_invoker = true) as
with live as (
  select o.*,
    case o.confidence_cap when 'VRF' then 4 when 'SRC' then 3
                          when 'INF' then 2 when 'EST' then 1 else 0 end as cap_rank,
    coalesce(o.value_text, o.value_num::text, o.value_json::text) as value_key
  from public.dc_facility_observations o
  where o.facility_id is not null and not o.retracted and not o.superseded
),
agree as (
  select facility_id, attribute, value_key, count(distinct primary_lineage_key) as lineages
  from live group by 1, 2, 3
),
ranked as (
  select l.*, a.lineages,
         row_number() over (
           partition by l.facility_id, l.attribute
           order by l.cap_rank desc, l.observed_at desc, a.lineages desc,
                    l.ingested_at desc, l.id
         ) as rn
  from live l
  join agree a on a.facility_id = l.facility_id
              and a.attribute   = l.attribute
              and a.value_key is not distinct from l.value_key
),
best as (select * from ranked where rn = 1)
select
  f.id, f.fdc_id, f.grain, f.parent_facility_id, f.primary_name,
  f.country_code, f.subdivision_code, f.geog, f.geo_precision,
  f.lifecycle_status, f.jurisdiction_id,
  f.facility_confidence_score, f.facility_confidence_band, f.publishable,
  f.jds_layer, f.superseded_by, f.discovered_at, f.created_at, f.updated_at,
  max(b.value_text) filter (where b.attribute = 'name')            as name,
  max(b.value_text) filter (where b.attribute = 'operator')        as operator,
  max(b.value_text) filter (where b.attribute = 'operator_parent') as operator_parent,
  max(b.value_text) filter (where b.attribute = 'developer')       as developer,
  max(b.value_text) filter (where b.attribute = 'facility_type')   as facility_type,
  max(b.value_text) filter (where b.attribute = 'power_source')    as power_source,
  max(b.value_num)  filter (where b.attribute = 'site_acres')      as site_acres,
  max(b.value_num)  filter (where b.attribute = 'building_sqft')   as building_sqft,
  max(b.value_num)  filter (where b.attribute = 'total_power_mw')  as total_power_mw,
  max(b.value_num)  filter (where b.attribute = 'capacity')                    as capacity_value,
  max(b.capacity_basis) filter (where b.attribute = 'capacity')                as capacity_basis,
  max(b.value_num)  filter (where b.attribute = 'capacity_unspecified_basis')  as capacity_unspecified_basis_mw,
  (array_agg(b.value_json) filter (where b.attribute = 'coordinates'))[1]     as coordinates,
  (array_agg(b.value_json) filter (where b.attribute = 'address'))[1]         as address,
  (array_agg(b.value_json) filter (where b.attribute = 'tenant'))[1]          as tenants,
  (array_agg(b.value_json) filter (where b.attribute = 'compute_profile'))[1] as compute_profile,
  (array_agg(b.value_json) filter (where b.attribute = 'external_ids'))[1]    as external_ids,
  max(b.value_text) filter (where b.attribute = 'announced_date')::date          as announced_date,
  max(b.value_text) filter (where b.attribute = 'operational_date')::date        as operational_date,
  max(b.value_text) filter (where b.attribute = 'construction_start_date')::date as construction_start_date,
  max(b.value_text) filter (where b.attribute = 'last_verified')::date           as last_verified,
  count(distinct b.primary_lineage_key)        as resolved_lineages,
  bool_or(not b.redistributable)               as has_restricted_input
from public.dc_facilities f
left join best b on b.facility_id = f.id
group by f.id;

comment on view public.dc_facility_current is
  'INTERNAL ONLY. Best resolved value per attribute per facility, including '
  'non-redistributable observations. Never expose this to a subscriber surface - use '
  'dc_facility_public. has_restricted_input flags a facility whose resolved values drew on '
  'a gated/blocked/unreviewed source.';

-- =====================================================================
-- dc_facility_public — same resolution, restricted to redistributable
-- observations AND publishable facilities. THE ONLY view a subscriber
-- surface may ever read. Still authenticated-only at the RLS layer;
-- subscriber gating is separate (FAR-402).
-- =====================================================================
create view public.dc_facility_public
with (security_invoker = true) as
with live as (
  select o.*,
    case o.confidence_cap when 'VRF' then 4 when 'SRC' then 3
                          when 'INF' then 2 when 'EST' then 1 else 0 end as cap_rank,
    coalesce(o.value_text, o.value_num::text, o.value_json::text) as value_key
  from public.dc_facility_observations o
  join public.dc_facilities f on f.id = o.facility_id
  where o.facility_id is not null
    and not o.retracted and not o.superseded
    and o.redistributable is true       -- a blocked value is never laundered
    and f.publishable is true
),
agree as (
  select facility_id, attribute, value_key, count(distinct primary_lineage_key) as lineages
  from live group by 1, 2, 3
),
ranked as (
  select l.*, a.lineages,
         row_number() over (
           partition by l.facility_id, l.attribute
           order by l.cap_rank desc, l.observed_at desc, a.lineages desc,
                    l.ingested_at desc, l.id
         ) as rn
  from live l
  join agree a on a.facility_id = l.facility_id
              and a.attribute   = l.attribute
              and a.value_key is not distinct from l.value_key
),
best as (select * from ranked where rn = 1)
select
  f.id, f.fdc_id, f.grain, f.parent_facility_id, f.primary_name,
  f.country_code, f.subdivision_code, f.geog, f.geo_precision,
  f.lifecycle_status, f.jurisdiction_id,
  f.facility_confidence_score, f.facility_confidence_band,
  f.jds_layer, f.discovered_at,
  max(b.value_text) filter (where b.attribute = 'name')            as name,
  max(b.value_text) filter (where b.attribute = 'operator')        as operator,
  max(b.value_text) filter (where b.attribute = 'operator_parent') as operator_parent,
  max(b.value_text) filter (where b.attribute = 'developer')       as developer,
  max(b.value_text) filter (where b.attribute = 'facility_type')   as facility_type,
  max(b.value_text) filter (where b.attribute = 'power_source')    as power_source,
  max(b.value_num)  filter (where b.attribute = 'site_acres')      as site_acres,
  max(b.value_num)  filter (where b.attribute = 'building_sqft')   as building_sqft,
  max(b.value_num)  filter (where b.attribute = 'capacity')        as capacity_value,
  max(b.capacity_basis) filter (where b.attribute = 'capacity')    as capacity_basis,
  (array_agg(b.value_json) filter (where b.attribute = 'coordinates'))[1] as coordinates,
  (array_agg(b.value_json) filter (where b.attribute = 'address'))[1]     as address,
  (array_agg(b.value_json) filter (where b.attribute = 'tenant'))[1]      as tenants,
  max(b.value_text) filter (where b.attribute = 'announced_date')::date   as announced_date,
  max(b.value_text) filter (where b.attribute = 'operational_date')::date as operational_date,
  max(b.value_text) filter (where b.attribute = 'last_verified')::date    as last_verified,
  jsonb_agg(distinct jsonb_build_object(
    'source_key', b.source_key, 'source_class', b.source_class,
    'source_url', b.source_url, 'observed_at', b.observed_at,
    'license_status', b.license_status_snap)) as citations
from public.dc_facilities f
left join best b on b.facility_id = f.id
where f.publishable is true
group by f.id;

comment on view public.dc_facility_public is
  'The ONLY view a subscriber surface may read. Restricted to publishable facilities and '
  'redistributable observations. capacity is exposed only where a capacity_basis exists - '
  'the legacy basis-less numbers are deliberately absent.';

grant select on public.dc_facility_current to authenticated, service_role;
grant select on public.dc_facility_public  to authenticated, service_role;
revoke all on public.dc_facility_current from anon;
revoke all on public.dc_facility_public  from anon;
