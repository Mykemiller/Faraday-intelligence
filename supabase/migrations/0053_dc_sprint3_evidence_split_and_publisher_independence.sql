-- CC-DC-SPRINT3 · Part 1 — evidence resolution: merge-aware, publisher-independent,
-- read-time licence, corroboration/citation split.  APPLIED to prod 2026-08-09.
--
-- WHY read-time licence: dc_facility_observations is append-only. redistributable and
-- license_status_snap are FROZEN at ingest (trg_dc_observations_append_only), so a licence
-- review could never affect an already-ingested row. Licence is now resolved from
-- source_registry at read time; the snapshot columns are retained as an audit record of what
-- we believed at ingest and are deliberately NOT the control surface.

create table if not exists public.dc_publish_rules (
  key text primary key, value text not null, notes text,
  updated_at timestamptz not null default now());
alter table public.dc_publish_rules enable row level security;
revoke all on public.dc_publish_rules from anon, authenticated;

insert into public.dc_publish_rules (key, value, notes) values
  ('independence_axis','publisher',
   'lineage | source | publisher. publisher = one county government or one operator counts once, '
   'however many record systems or channels it publishes through.'),
  ('min_corroborating','3','Distinct independent units required on the configured axis.'),
  ('require_citable_official_record','1',
   'Publishable requires >=1 official_record that is itself citable.'),
  ('directory_counts_toward_bar','0','Directory/aggregator classes support confidence, not the bar.'),
  ('news_derived_counts_toward_bar','0','Sources whose own evidence is news must not pass the news exclusion.')
on conflict (key) do nothing;

create table if not exists public.dc_source_traits (
  source_key text primary key, news_derived boolean not null default false,
  notes text, updated_at timestamptz not null default now());
alter table public.dc_source_traits enable row level security;
revoke all on public.dc_source_traits from anon, authenticated;

-- One county government publishes through planning, assessor AND register; one operator
-- through _ir, _disclosures, _facility_locations. Counting source_key counts one
-- institution up to three times.
create or replace function public.dc_source_publisher(p_source_key text)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
  select case
    when p_source_key ~ '_(planning|assessor|cad|property|register|recorder|deed_records|records|probate|tax_records|land_records)$'
      then 'county:' || regexp_replace(regexp_replace(p_source_key,'^[a-z]+:',''),
           '_(planning|assessor|cad|property|register|recorder|deed_records|records|probate|tax_records|land_records)$','')
    when p_source_key ~ '_(ir|disclosures|facility_locations|facility_press)$'
      then 'operator:' || regexp_replace(regexp_replace(p_source_key,'^[a-z]+:',''),
           '_(ir|disclosures|facility_locations|facility_press)$','')
    else 'org:' || p_source_key end;
$$;

create or replace function public.dc_licence_is_citable(p_status text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $$
  select coalesce(p_status in ('cleared','attribution_required'), false);
$$;

drop view if exists public.dc_facility_evidence;
create view public.dc_facility_evidence as
with obs as (
  select g.root_id as facility_id, o.primary_lineage_key, o.source_key, o.source_class,
         public.dc_source_publisher(o.source_key) as publisher,
         public.dc_licence_is_citable(r.license_status) as citable,
         coalesce(t.news_derived,false) as news_derived, o.observed_at
  from public.dc_facility_merge_group g
  join public.dc_facility_observations o on o.facility_id = g.facility_id and not o.retracted
  left join public.source_registry r on r.source_key = o.source_key
  left join public.dc_source_traits t on t.source_key = o.source_key),
bar as (select * from obs
        where source_class <> 'news' and not news_derived and source_class <> 'directory')
select o.facility_id,
  count(distinct o.primary_lineage_key) filter (where o.source_class <> 'news') as nonnews_lineages,
  count(distinct o.source_key) as distinct_sources,
  count(distinct o.source_key) filter (where o.source_class <> 'news') as distinct_nonnews_sources,
  count(distinct o.primary_lineage_key) filter (where o.source_class='official_record') as official_lineages,
  count(distinct o.primary_lineage_key) filter (where o.source_class <> 'news' and o.citable) as redistributable_lineages,
  count(*) as observations,
  (select count(distinct b.publisher) from bar b where b.facility_id=o.facility_id) as corroborating_publishers,
  (select count(distinct b.publisher) from bar b where b.facility_id=o.facility_id and b.citable) as citable_publishers,
  (select count(distinct b.source_key) from bar b where b.facility_id=o.facility_id) as corroborating_sources,
  (select count(distinct b.primary_lineage_key) from bar b where b.facility_id=o.facility_id) as corroborating_lineages,
  exists (select 1 from obs x where x.facility_id=o.facility_id and x.source_class='official_record' and x.citable) as has_citable_official_record,
  exists (select 1 from obs x where x.facility_id=o.facility_id and x.source_class='official_record') as has_any_official_record
from obs o group by o.facility_id;

alter view public.dc_facility_evidence set (security_invoker = true);
revoke all on public.dc_facility_evidence from anon, authenticated;
