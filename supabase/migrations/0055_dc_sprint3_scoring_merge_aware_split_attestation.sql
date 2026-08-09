-- CC-DC-SPRINT3 · Part 4 — scoring becomes merge-aware; corroboration/citation split;
-- authoritative self-attestation. APPLIED to prod 2026-08-09.
--
-- WHY attestation: the >=3 bar is a proxy for confidence when source quality is unknown. It
-- cannot distinguish three trade-press repeats from one attestation by the definitive
-- authority. For "this facility exists and we operate it" the operator IS the authority, and an
-- SEC filing is that authority speaking under securities-law liability, permanently archived
-- with a citable accession. Attestation therefore satisfies publishable on its own, FCS 100.

create table if not exists public.dc_facility_attestations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.dc_facilities(id),
  source_key text not null, filer_cik text, filer_name text, form_type text,
  accession text, filed_at date, source_url text not null, source_document_ref text not null,
  attested_attributes text[] not null default '{}', operator_matched text,
  furnished_not_filed boolean not null default false, notes text,
  created_at timestamptz not null default now());
alter table public.dc_facility_attestations enable row level security;
revoke all on public.dc_facility_attestations from anon, authenticated;
create index if not exists dc_facility_attestations_facility_idx on public.dc_facility_attestations(facility_id);

comment on table public.dc_facility_attestations is
 'Operator self-attestation of its OWN facility in a filing carrying legal liability. The filer '
 'must map to the facility operator. ATTRIBUTE-SCOPED: attests existence/operator and whatever the '
 'document states. It NEVER confers geo_precision — filings name metros, not coordinates.';

create or replace function public.dc_facility_is_attested(p_facility_id uuid)
returns boolean language sql stable set search_path to 'public','pg_temp' as $$
  select exists (select 1 from public.dc_facility_attestations a
    left join public.source_registry r on r.source_key=a.source_key
    where a.facility_id=p_facility_id and a.operator_matched is not null
      and public.dc_licence_is_citable(r.license_status));
$$;

create or replace function public.dc_compute_publishable(p_facility_id uuid)
returns boolean language sql stable set search_path to 'public','pg_temp' as $$
  with rules as (
    select (select value::int from public.dc_publish_rules where key='min_corroborating') as min_corr,
           (select value      from public.dc_publish_rules where key='independence_axis') as axis,
           (select value::int from public.dc_publish_rules where key='require_citable_official_record') as need_off),
  e as (select * from public.dc_facility_evidence where facility_id=p_facility_id)
  select coalesce(
    public.dc_facility_is_attested(p_facility_id)
    or (case (select axis from rules)
          when 'publisher' then coalesce(e.corroborating_publishers,0)
          when 'source'    then coalesce(e.corroborating_sources,0)
          else                  coalesce(e.corroborating_lineages,0) end
        >= (select min_corr from rules)
        and ((select need_off from rules)=0 or coalesce(e.has_citable_official_record,false))),
  false)
  from e right join (select 1) _ on true;
$$;

-- dc_compute_facility_confidence: identical scoring maths, but every observation query is now
-- resolved through dc_facility_merge_group (it was blind to superseded_by, stranding 816
-- observations / 59 lineages), plus the attestation short-circuit.
create or replace function public.dc_compute_facility_confidence(p_facility_id uuid)
returns table(score smallint, band text) language plpgsql stable
set search_path to 'public','pg_temp' as $function$
declare v_nonnews_lineages int; v_has_official boolean;
        v_a int:=0; v_b int:=0; v_c_nonnews int:=0; v_c_all int:=0; v_d int:=0; v_e int:=0;
        v_recent_days int; v_geo text; v_base int; v_full int; v_score int; v_band text;
begin
  if not exists (select 1 from public.dc_facilities where id=p_facility_id) then return; end if;

  if public.dc_facility_is_attested(p_facility_id) then
    select b.band into v_band from public.dc_facility_confidence_bands b
     where 100 between b.min_score and b.max_score order by b.sort_order limit 1;
    score := 100::smallint; band := v_band; return next; return;
  end if;

  select f.geo_precision into v_geo from public.dc_facilities f where f.id=p_facility_id;

  select count(distinct o.primary_lineage_key) into v_nonnews_lineages
  from public.dc_facility_merge_group g
  join public.dc_facility_observations o on o.facility_id=g.facility_id and not o.retracted
  where g.root_id=p_facility_id and o.source_class <> 'news';
  v_a := case when v_nonnews_lineages>=4 then 45 when v_nonnews_lineages=3 then 40
              when v_nonnews_lineages=2 then 30 when v_nonnews_lineages=1 then 18 else 0 end;

  select exists (select 1 from public.dc_facility_merge_group g
    join public.dc_facility_observations o on o.facility_id=g.facility_id and not o.retracted
    where g.root_id=p_facility_id and o.source_class='official_record') into v_has_official;
  v_b := case when v_has_official then 15 else 0 end;

  v_c_nonnews := public.fn_dc_attribute_agreement_points(p_facility_id,false);
  v_c_all     := public.fn_dc_attribute_agreement_points(p_facility_id,true);

  select min(current_date - o.observed_at) into v_recent_days
  from public.dc_facility_merge_group g
  join public.dc_facility_observations o on o.facility_id=g.facility_id and not o.retracted
  where g.root_id=p_facility_id and o.source_class <> 'news';
  v_d := case when v_recent_days is null then 0 when v_recent_days<=180 then 10
              when v_recent_days<=365 then 6 when v_recent_days<=730 then 3 else 0 end;

  v_e := case v_geo when 'verified' then 15 when 'parcel' then 15 when 'address' then 10
                    when 'centroid' then 5 when 'municipality' then 2 else 0 end;

  v_base := v_a+v_b+v_c_nonnews+v_d+v_e;
  v_full := v_a+v_b+v_c_all+v_d+v_e;
  v_score := greatest(0, least(100, v_base + least(5, greatest(0, v_full-v_base))));
  select b.band into v_band from public.dc_facility_confidence_bands b
   where v_score between b.min_score and b.max_score order by b.sort_order limit 1;
  score := v_score::smallint; band := v_band; return next;
end; $function$;
