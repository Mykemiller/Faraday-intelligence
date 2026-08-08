-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 4 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808212549
--   dc_inventory_0047_backfill_rebuild_lossless
--
-- Supersedes the 0046 backfill. Three corrections, all about LOSSLESSNESS:
--
--  1. The 'DC Map' / 'DataCenterMap' -> dcmap:facilities alias is DROPPED.
--     Two legacy spellings collapsing onto one registry key made
--     source_name non-round-trippable for 77 rows. Each legacy spelling now
--     gets its own dcinv: row (same unreviewed licence posture, so nothing
--     about redistributability changes). shovels:permits stays aliased -
--     it is one spelling, and it mints no facilities anyway.
--  2. source_document_ref now carries 'jwf:<legacy row id>' on EVERY
--     observation. That is genuinely what it is for (the originating record
--     reference), and it is what lets the compatibility view recover the
--     legacy identity of an UNRESOLVED candidate - which has no facility row
--     and therefore no identifier row.
--  3. The legacy jurisdiction_id is preserved as its own observation.
--     dc_facilities.jurisdiction_id is still derived fresh by spatial join
--     per rule 6 and the legacy value is NEVER copied into it. But the value
--     has to survive somewhere, because jw_briefing_inputs and the live
--     jw-state-jds-rollup cron key off it, and the compatibility view must
--     not change what they see.
--
-- The backfill is a re-runnable FUNCTION so this is the last time it needs
-- to be written out.
-- =====================================================================

create or replace function public.fn_dc_legacy_source_key(p_source_name text)
returns text language sql immutable security invoker set search_path = public, pg_temp as $$
  select case
    when p_source_name = 'Shovels Permits (seed)' then 'shovels:permits'
    else 'dcinv:' || lower(regexp_replace(trim(p_source_name), '[^a-zA-Z0-9]+', '_', 'g'))
  end;
$$;
comment on function public.fn_dc_legacy_source_key(text) is
  'jw_facilities.source_name -> source_registry.source_key. Exactly ONE legacy name resolves '
  'to a pre-existing registry row (shovels:permits); the other 213 are minted under the '
  'dcinv: namespace as licence-unreviewed. The mapping is injective, so source_name '
  'round-trips exactly through the compatibility view.';

-- ---------------------------------------------------------------------
create or replace function public.fn_dc_backfill_from_jw_facilities(p_reset boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $fn$
declare
  r record;
  v_facility_id uuid;
  v_minted      int := 0;
  v_obs         int;
  v_unresolved  int;
  v_legacy      int;
begin
  if p_reset then
    -- The observations table is append-only by trigger. Lifting it for a
    -- controlled rebuild of backfill-only data is deliberate; there is no
    -- other writer and nothing downstream reads these tables yet.
    execute 'alter table public.dc_facility_observations disable trigger trg_dc_observations_append_only';
    delete from public.dc_facility_observations;
    execute 'alter table public.dc_facility_observations enable trigger trg_dc_observations_append_only';
    delete from public.dc_facility_merges;
    delete from public.dc_facility_identifiers;
    delete from public.dc_facilities;
  end if;

  -- STEP A — register every source we are about to cite. Never guess a licence.
  insert into public.source_registry
    (source_key, name, url, access_method, cadence, confidence_cap,
     license, license_status, status, source_type, source_level, countable, notes)
  select
    m.source_key, m.source_name, '', 'manual', 'one_time', m.modal_conf,
    'unreviewed', 'unreviewed', 'registered',
    case m.source_class
      when 'official_record'      then 'government_feed'
      when 'operator_first_party' then 'company_feed'
      when 'news'                 then 'news_feed'
      when 'directory'            then 'data_portal'
      else 'other'
    end,
    case when m.source_class in ('official_record','operator_first_party') then 'primary'
         else 'secondary' end,
    false,
    'Registered by the DC inventory entity-model backfill (Sprint 1) so every legacy '
    'jw_facilities observation could cite a registry row. LICENCE NOT REVIEWED - '
    'observations from this source are redistributable=false until a human reviews it.'
  from (
    select
      public.fn_dc_legacy_source_key(f.source_name)   as source_key,
      min(f.source_name)                              as source_name,
      public.fn_dc_legacy_source_class(f.source_name) as source_class,
      (array_agg(f.source_confidence order by f.source_confidence))[1] as modal_conf
    from public.jw_facilities f
    where f.source_name is not null
    group by 1, 3
  ) m
  on conflict (source_key) do nothing;

  -- STEP B — mint one facility per IDENTIFIED subject.
  -- Rule 3: a Shovels seed permit with no coordinates, no operator, no
  -- developer and no external ids is a permit record with NO identified
  -- subject. It mints NO facility.
  for r in
    select f.id as legacy_id, f.facility_name, f.state_abbr, f.lat, f.lng,
           f.created_at::date                            as discovered_at,
           public.fn_dc_legacy_lifecycle(f.status)       as lifecycle_status,
           public.fn_dc_legacy_source_key(f.source_name) as source_key
    from public.jw_facilities f
    where not (
      public.fn_dc_legacy_source_key(f.source_name) = 'shovels:permits'
      and f.lat is null and f.lng is null
      and f.operator is null and f.developer is null
      and coalesce(f.external_ids, '{}'::jsonb) = '{}'::jsonb
    )
    order by f.created_at, f.id
  loop
    v_facility_id := gen_random_uuid();
    insert into public.dc_facilities
      (id, fdc_id, grain, primary_name, country_code, subdivision_code,
       geog, geo_precision, lifecycle_status, discovered_at)
    values
      (v_facility_id, public.dc_mint_fdc_id(r.discovered_at), 'site',
       r.facility_name, 'US',
       case when nullif(trim(r.state_abbr), '') is null then null
            else 'US-' || upper(trim(r.state_abbr)) end,
       case when r.lat is null or r.lng is null then null
            else st_setsrid(st_makepoint(r.lng::float8, r.lat::float8), 4326)::geography end,
       -- Rule 4: coordinates come in as 'estimated'. Nothing is upgraded to
       -- 'verified' in this sprint. Verification is Sprint 3.
       case when r.lat is null or r.lng is null then 'none' else 'estimated' end,
       r.lifecycle_status, r.discovered_at);

    insert into public.dc_facility_identifiers (facility_id, source_key, external_id)
    values (v_facility_id, r.source_key, 'jwf:' || r.legacy_id::text);

    v_minted := v_minted + 1;
  end loop;

  -- STEP C — one observation per non-null legacy attribute.
  --
  -- primary_lineage_key = sha256(source_key || ':jwf:' || legacy row id).
  -- One legacy row IS one originating document, so all of its attributes share
  -- a single lineage and are counted ONCE by the scoring functions.
  insert into public.dc_facility_observations
    (facility_id, source_key, source_class, source_url, source_document_ref,
     observed_at, attribute, value_text, value_num, value_json, unit,
     capacity_basis, primary_lineage_key, is_primary_source, redistributable,
     license_status_snap, confidence_cap, notes)
  select
    a.facility_id, a.source_key, a.source_class, a.source_url, a.doc_ref,
    a.observed_at, a.attribute, a.value_text, a.value_num, a.value_json, a.unit,
    null::text, a.lineage,
    a.source_class in ('official_record','operator_first_party'),
    sr.license_status in ('cleared','attribution_required'),
    sr.license_status, a.confidence_cap, a.notes
  from (
    with base as (
      select f.*,
        public.fn_dc_legacy_source_key(f.source_name)   as source_key,
        public.fn_dc_legacy_source_class(f.source_name) as source_class,
        public.fn_dc_legacy_lifecycle(f.status)         as lifecycle_status,
        'jwf:' || f.id::text                            as doc_ref,
        encode(digest(public.fn_dc_legacy_source_key(f.source_name)
                      || ':jwf:' || f.id::text, 'sha256'), 'hex') as lineage,
        -- the date the SOURCE asserts, best available
        coalesce(f.last_verified, f.announced_date, f.created_at::date) as observed_at,
        i.facility_id
      from public.jw_facilities f
      left join public.dc_facility_identifiers i
        on i.external_id = 'jwf:' || f.id::text
       and i.source_key  = public.fn_dc_legacy_source_key(f.source_name)
    )
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'existence' as attribute, facility_name as value_text,
           null::numeric as value_num, null::jsonb as value_json, null::text as unit,
           source_confidence as confidence_cap, notes, lineage from base
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'name', facility_name, null, null, null, source_confidence, null, lineage from base
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'operator', operator, null, null, null, source_confidence, null, lineage
      from base where operator is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'operator_parent', operator_parent, null, null, null, source_confidence, null, lineage
      from base where operator_parent is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'lifecycle_status', lifecycle_status, null, null, null, source_confidence, null, lineage
      from base where lifecycle_status is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'coordinates', null, null,
           jsonb_build_object('lat', lat, 'lng', lng, 'geo_precision', 'estimated'),
           null, source_confidence,
           'Legacy coordinate at geo_precision=estimated. Unaudited - verification is Sprint 3.',
           lineage
      from base where lat is not null and lng is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'address', city, null,
           jsonb_build_object('city', city, 'state_abbr', nullif(trim(state_abbr), ''),
                              'address', address),
           null, source_confidence, null, lineage
      from base where city is not null or nullif(trim(state_abbr), '') is not null or address is not null
    union all
    -- The LEGACY jurisdiction join, preserved verbatim as a claim and clearly
    -- labelled. dc_facilities.jurisdiction_id is derived fresh by PostGIS and
    -- never reads this. It exists so the compatibility view can keep
    -- jw_briefing_inputs and the jw-state-jds-rollup cron seeing what they see today.
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'legacy_jurisdiction_id', jurisdiction_id::text, null, null, null,
           source_confidence,
           'LEGACY jw_facilities.jurisdiction_id, carried for backward compatibility ONLY. '
           'Known-suspect join (metro tier for identified rows). NOT used to populate '
           'dc_facilities.jurisdiction_id, which is derived by county-level spatial join.',
           lineage
      from base where jurisdiction_id is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'site_acres', null, site_acres, null, 'acres', source_confidence, null, lineage
      from base where site_acres is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'building_sqft', null, building_sqft, null, 'sqft', source_confidence, null, lineage
      from base where building_sqft is not null
    union all
    -- CAPACITY: the legacy capacity_mw column records NO basis anywhere. Writing
    -- attribute='capacity' would require inventing one of it_load / critical_it /
    -- gross_utility / contracted / announced_total - exactly the fabrication the
    -- capacity_basis CHECK exists to prevent. Preserved verbatim under a distinct
    -- attribute, excluded from the agreement term and from dc_facility_public.
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'capacity_unspecified_basis', null, capacity_mw, null, 'MW', source_confidence,
           'Legacy jw_facilities.capacity_mw. NO capacity_basis was ever recorded, so this is '
           'deliberately NOT attribute=capacity. Awaiting a basis ruling before it can be '
           'scored or published.', lineage
      from base where capacity_mw is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'total_power_mw', null, total_power_mw, null, 'MW', source_confidence, null, lineage
      from base where total_power_mw is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'announced_date', announced_date::text, null, null, null, source_confidence, null, lineage
      from base where announced_date is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'operational_date', operational_date::text, null, null, null, source_confidence, null, lineage
      from base where operational_date is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'construction_start_date', construction_start_date::text, null, null, null,
           source_confidence, null, lineage
      from base where construction_start_date is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'last_verified', last_verified::text, null, null, null, source_confidence, null, lineage
      from base where last_verified is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'power_source', power_source, null, null, null, source_confidence, null, lineage
      from base where power_source is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'facility_type', facility_type, null, null, null, source_confidence, null, lineage
      from base where facility_type is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'developer', developer, null, null, null, source_confidence, null, lineage
      from base where developer is not null
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'tenant', null, null, to_jsonb(tenant_names), null, source_confidence, null, lineage
      from base where tenant_names is not null and cardinality(tenant_names) > 0
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'compute_profile', null, null, compute_profile, null, source_confidence, null, lineage
      from base where compute_profile is not null and compute_profile <> '{}'::jsonb
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'data_sources', null, null, to_jsonb(data_sources), null, source_confidence, null, lineage
      from base where data_sources is not null and cardinality(data_sources) > 0
    union all
    select facility_id, source_key, source_class, source_url, doc_ref, observed_at,
           'external_ids', null, null, external_ids, null, source_confidence, null, lineage
      from base where external_ids is not null and external_ids <> '{}'::jsonb
  ) a
  join public.source_registry sr on sr.source_key = a.source_key;

  -- STEP D — jurisdiction_id by county-level PostGIS spatial join (rule 6).
  -- County level is non-overlapping and complete across the US, unlike place /
  -- cousub / metro. The old jw_facilities.jurisdiction_id is NOT copied - it
  -- pointed at the metro tier (a known-suspect ghost-row path).
  update public.dc_facilities f
  set jurisdiction_id = j.jurisdiction_id
  from (
    select fac.id as facility_id, p.jurisdiction_id
    from public.dc_facilities fac
    join public.jurisdiction_census_profile p
      on p.geom_full is not null and st_contains(p.geom_full, fac.geog::geometry)
    join public.jurisdictions ju
      on ju.id = p.jurisdiction_id and ju.level::text = 'county'
    where fac.geog is not null
  ) j
  where f.id = j.facility_id;

  -- STEP E — populate the computed columns.
  update public.dc_facilities f
  set jds_layer = x.jds_layer, facility_confidence_score = x.score,
      facility_confidence_band = x.band, publishable = x.publishable
  from (
    select fac.id,
           public.dc_compute_jds_layer(fac.id)   as jds_layer,
           c.score, c.band,
           public.dc_compute_publishable(fac.id) as publishable
    from public.dc_facilities fac
    cross join lateral public.dc_compute_facility_confidence(fac.id) c
  ) x
  where f.id = x.id;

  select count(*) into v_legacy from public.jw_facilities;
  select count(*) into v_obs    from public.dc_facility_observations;
  select count(*) into v_unresolved
    from public.dc_facility_observations where facility_id is null;

  return jsonb_build_object(
    'legacy_rows', v_legacy, 'facilities_minted', v_minted,
    'observations', v_obs, 'unresolved_observations', v_unresolved);
end;
$fn$;

comment on function public.fn_dc_backfill_from_jw_facilities(boolean) is
  'Re-runnable rewrite of jw_facilities into the observation model. p_reset=true clears the '
  'five tables first (lifting the append-only trigger for the duration). READ ONLY against '
  'jw_facilities - it never inserts, updates or deletes a legacy row.';

revoke all on function public.fn_dc_backfill_from_jw_facilities(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Run it, then gate hard.
-- ---------------------------------------------------------------------
do $run$
declare
  v_res jsonb;
  v_legacy int; v_fac int; v_unresolved_rows int;
  v_orphan int; v_jds_mismatch int; v_src_roundtrip int;
begin
  v_res := public.fn_dc_backfill_from_jw_facilities(true);
  raise notice 'dc backfill rebuild: %', v_res;

  select count(*) into v_legacy from public.jw_facilities;
  if v_legacy <> 2283 then
    raise exception 'GATE: jw_facilities row count changed (% <> 2283) - backfill must be read-only', v_legacy;
  end if;

  select count(*) into v_fac from public.dc_facilities;
  select count(*) into v_unresolved_rows
  from public.jw_facilities f
  where public.fn_dc_legacy_source_key(f.source_name) = 'shovels:permits'
    and f.lat is null and f.lng is null and f.operator is null and f.developer is null
    and coalesce(f.external_ids, '{}'::jsonb) = '{}'::jsonb;

  if v_fac + v_unresolved_rows <> v_legacy then
    raise exception 'GATE: % facilities + % unresolved <> % legacy rows', v_fac, v_unresolved_rows, v_legacy;
  end if;

  -- every legacy row must be recoverable from source_document_ref
  select count(*) into v_orphan
  from public.jw_facilities f
  where not exists (select 1 from public.dc_facility_observations o
                    where o.source_document_ref = 'jwf:' || f.id::text);
  if v_orphan > 0 then
    raise exception 'GATE: % legacy rows are not recoverable via source_document_ref', v_orphan;
  end if;

  -- source_name must round-trip exactly through the registry
  select count(*) into v_src_roundtrip
  from public.jw_facilities f
  join public.source_registry sr on sr.source_key = public.fn_dc_legacy_source_key(f.source_name)
  where sr.name is distinct from f.source_name
    and public.fn_dc_legacy_source_key(f.source_name) <> 'shovels:permits';
  if v_src_roundtrip > 0 then
    raise exception 'GATE: source_name does not round-trip for % rows', v_src_roundtrip;
  end if;

  select count(*) into v_jds_mismatch
  from public.dc_facilities fac
  join public.dc_facility_identifiers i on i.facility_id = fac.id
  join public.jw_facilities l on 'jwf:' || l.id::text = i.external_id
  where fac.jds_layer is distinct from l.jds_layer;
  if v_jds_mismatch > 0 then
    raise exception 'GATE: % facilities disagree with the legacy jds_layer', v_jds_mismatch;
  end if;

  raise notice 'dc backfill rebuild gates PASSED';
end;
$run$;
