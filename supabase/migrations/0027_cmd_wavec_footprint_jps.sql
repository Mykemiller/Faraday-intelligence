-- CMD-1.0 Wave C — internal derivations from jw_facilities + jurisdictions. NO external/vendor data.
-- Every fact: source_name='faraday_internal', source_class='faraday_internal', as_of=derivation date,
-- confidence='high' (Faraday-owned facility spine), method_note = the deriving logic.
-- Facilities are attributed to the OPERATOR company (normalized-name match). Counts insert even at 0
-- (a sourced 0); MW/acres/sqft/jsonb insert only when a value exists (a NULL stays a finding, not a 0).

insert into public.company_facts
  (company_uid, attribute_code, value_text, value_num, value_bool, value_date, value_jsonb, source_name, source_class, as_of, confidence, method_note)
with fc as (
  select c.company_uid, f.status, f.capacity_mw, f.site_acres, f.building_sqft,
         f.state_abbr, f.country_code, f.tenant_names, j.current_score jps, j.current_tier tier, j.region
  from public.jw_facilities f
  join public.companies c on c.name_normalized = public.cmd_normalize_name(f.operator)
  left join public.jurisdictions j on j.id = f.jurisdiction_id
  where coalesce(btrim(f.operator),'') <> ''
),
posture as (select company_uid, tier, count(*) n from fc where tier is not null group by 1,2),
pd as (select company_uid, jsonb_object_agg(tier, n) obj from posture group by 1),
tenants as (
  select company_uid, to_jsonb(array_agg(distinct t)) obj
  from (select company_uid, unnest(tenant_names) t from fc) x
  where t is not null and btrim(t) <> '' group by company_uid
),
agg as (
  select fc.company_uid,
    count(*) filter (where status='operational') n_active,
    count(*) filter (where status in ('permitted','construction','acquisition')) n_pipe,
    sum(capacity_mw) filter (where status='operational') mw_active,
    sum(capacity_mw) filter (where status in ('permitted','construction','acquisition')) mw_pipe,
    sum(site_acres) acres,
    sum(building_sqft) sqft,
    to_jsonb(array_agg(distinct state_abbr) filter (where state_abbr is not null)) states,
    to_jsonb(array_agg(distinct country_code) filter (where country_code is not null)) countries,
    to_jsonb(array_agg(distinct region) filter (where region is not null)) regions,
    count(*) filter (where jps is not null) n_scored,
    count(*) n_total,
    count(*) filter (where tier in ('Cautious','Restricted')) n_caut,
    round((sum(capacity_mw * jps) filter (where jps is not null and capacity_mw is not null))
          / nullif(sum(capacity_mw) filter (where jps is not null and capacity_mw is not null), 0), 2) mw_wt_jps,
    round(avg(jps) filter (where jps is not null), 2) mean_jps
  from fc group by fc.company_uid
)
select a.company_uid, 'facility_count_active', null::text, a.n_active::numeric, null::boolean, null::date, null::jsonb, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'count(jw_facilities where status=operational) attributed by operator normalized-name' from agg a
union all
select a.company_uid, 'facility_count_pipeline', null, a.n_pipe, null, null, null, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'count(jw_facilities where status in permitted/construction/acquisition)' from agg a
union all
select a.company_uid, 'operating_capacity_mw_derived', null, a.mw_active, null, null, null, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'sum(capacity_mw) where status=operational' from agg a where a.mw_active is not null
union all
select a.company_uid, 'pipeline_capacity_mw_derived', null, a.mw_pipe, null, null, null, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'sum(capacity_mw) where status in permitted/construction/acquisition' from agg a where a.mw_pipe is not null
union all
select a.company_uid, 'site_acres_total', null, a.acres, null, null, null, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'sum(site_acres) over operated facilities' from agg a where a.acres is not null
union all
select a.company_uid, 'building_sqft_total', null, a.sqft, null, null, null, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'sum(building_sqft) over operated facilities' from agg a where a.sqft is not null
union all
select a.company_uid, 'footprint_states', null, null, null, null, a.states, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'distinct jw_facilities.state_abbr' from agg a where a.states is not null
union all
select a.company_uid, 'footprint_countries', null, null, null, null, a.countries, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'distinct jw_facilities.country_code' from agg a where a.countries is not null
union all
select a.company_uid, 'footprint_regions', null, null, null, null, a.regions, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'distinct jurisdictions.region via jw_facilities.jurisdiction_id' from agg a where a.regions is not null
union all
select t.company_uid, 'anchor_tenants', null, null, null, null, t.obj, 'faraday_internal','faraday_internal', date '2026-07-23','high',
       'distinct unnest(jw_facilities.tenant_names) for operated facilities' from tenants t
union all
select a.company_uid, 'jurisdiction_exposure', null, null, null, null,
       jsonb_strip_nulls(jsonb_build_object(
         'mw_weighted_mean_jps', a.mw_wt_jps,
         'mean_jps', a.mean_jps,
         'facilities_scored', a.n_scored,
         'facilities_total', a.n_total,
         'facilities_cautious_restricted', a.n_caut,
         'posture_distribution', pd.obj)),
       'faraday_internal','faraday_internal', date '2026-07-23','high',
       'jw_facilities -> jurisdictions(current_score,current_tier); MW-weighted by capacity_mw (§7.2)'
from agg a left join pd on pd.company_uid = a.company_uid
where a.n_scored > 0
on conflict (company_uid, attribute_code, as_of, source_name) do nothing;
