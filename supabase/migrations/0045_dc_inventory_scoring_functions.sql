-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 2 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808211621
--   dc_inventory_0045_scoring_functions
--
-- dc_mint_fdc_id / dc_compute_facility_confidence /
-- dc_compute_publishable / dc_compute_jds_layer
--
-- NOTE: fn_dc_attribute_agreement_points is CORRECTED in migration 0051 -
-- read that before relying on the term (c) definition below.
-- =====================================================================

-- Explicit drops: CREATE OR REPLACE with a changed signature makes an
-- OVERLOAD, not a replacement. Nothing to drop on a fresh install, but the
-- statements make re-application deterministic.
drop function if exists public.dc_mint_fdc_id(date);
drop function if exists public.dc_mint_fdc_id();
drop function if exists public.dc_compute_facility_confidence(uuid);
drop function if exists public.dc_compute_publishable(uuid);
drop function if exists public.dc_compute_jds_layer(uuid);

-- ---------------------------------------------------------------------
-- dc_mint_fdc_id() -> FDC-YYYYMM-XXXXXX
-- YYYYMM = DISCOVERY MONTH. Month, not day: day-grain leaks how thin
-- coverage was on a given date and buys no extra collision resistance.
-- Suffix: 6 chars of crypto-random (pgcrypto gen_random_bytes) over an
-- uppercase base32-style alphabet with I/L/O/0/1 excluded (31 symbols,
-- ~8.9e8 space per month). Retries on unique violation.
-- ---------------------------------------------------------------------
create function public.dc_mint_fdc_id(p_discovered_at date default current_date)
returns text
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  k_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';  -- 31 symbols
  k_len      constant int  := length(k_alphabet);
  v_prefix   text := 'FDC-' || to_char(p_discovered_at, 'YYYYMM') || '-';
  v_suffix   text;
  v_bytes    bytea;
  v_candidate text;
  i          int;
begin
  for attempt in 1..50 loop
    v_suffix := '';
    v_bytes  := gen_random_bytes(6);
    for i in 0..5 loop
      v_suffix := v_suffix || substr(k_alphabet, (get_byte(v_bytes, i) % k_len) + 1, 1);
    end loop;
    v_candidate := v_prefix || v_suffix;

    if not exists (select 1 from public.dc_facilities where fdc_id = v_candidate) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'dc_mint_fdc_id: could not mint a free id for month % after 50 attempts',
    to_char(p_discovered_at, 'YYYYMM');
end;
$$;

comment on function public.dc_mint_fdc_id(date) is
  'Mints FDC-YYYYMM-XXXXXX. YYYYMM is the DISCOVERY MONTH. fdc_id is never reused or renumbered.';

-- ---------------------------------------------------------------------
-- dc_compute_jds_layer(facility_id) -> text
-- Derived from lifecycle_status. Recomputed weekly; never written by an
-- ingest path. (Re-pointed at fn_dc_jds_from_lifecycle in 0048.)
-- ---------------------------------------------------------------------
create function public.dc_compute_jds_layer(p_facility_id uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case f.lifecycle_status
           when 'operational'    then 'L1'
           when 'commissioning'  then 'L1'
           when 'expansion'      then 'L1'
           when 'construction'   then 'L2'
           when 'permitted'      then 'L3'
           when 'entitled'       then 'L3'
           when 'announced'      then 'L4'
           when 'rumored'        then 'L4'
           when 'decommissioned' then null
         end
  from public.dc_facilities f
  where f.id = p_facility_id;
$$;

comment on function public.dc_compute_jds_layer(uuid) is
  'L1 operational/commissioning/expansion; L2 construction; L3 permitted/entitled; '
  'L4 announced/rumored; NULL decommissioned.';

-- ---------------------------------------------------------------------
-- dc_compute_publishable(facility_id) -> boolean
--
-- Observations from gated/blocked/unreviewed sources ARE stored and DO
-- count toward internal research, but are excluded here, from published
-- value selection, and from citations. A blocked-source value is never
-- laundered by sitting next to a clean one (Boundstone posture, as already
-- recorded on the FiscalNote registry rows).
-- ---------------------------------------------------------------------
create function public.dc_compute_publishable(p_facility_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with counted as (
    -- the ONLY observations that may be counted toward publication
    select o.primary_lineage_key, o.source_class
    from public.dc_facility_observations o
    where o.facility_id = p_facility_id
      and not o.retracted
      and o.source_class <> 'news'
      and o.redistributable is true
  )
  select coalesce(
           count(distinct primary_lineage_key) >= 3
           and count(distinct primary_lineage_key)
                 filter (where source_class = 'official_record') >= 1,
           false)
  from counted;
$$;

comment on function public.dc_compute_publishable(uuid) is
  'TRUE only when: >=3 distinct non-news primary_lineage_key values, >=1 of them an '
  'official_record, and every counted observation redistributable. Gated/blocked/unreviewed '
  'sources are stored and usable internally but can never make a facility publishable.';

-- ---------------------------------------------------------------------
-- dc_compute_facility_confidence(facility_id) -> (score, band)
--
-- Operates on DISTINCT primary_lineage_key, excluding retracted rows.
--   a) independent NON-NEWS lineage count : 0->0 1->18 2->30 3->40 4+->45
--   b) >=1 source_class='official_record'                          : +15
--   c) cross-source agreement over core attributes (name, operator,
--      coordinates, capacity-at-matching-basis)                    : 0..15
--   d) recency of most recent NON-NEWS confirming observation
--         <=180d +10, <=365d +6, <=730d +3, else 0
--   e) geo_precision verified/parcel +15, address +10, centroid +5,
--         municipality +2, estimated/none 0
--
-- NEWS CAP: news lineages are excluded from (a) and (b) entirely, and
-- their total contribution to the rest is capped at +5. Implemented by
-- scoring term (c) twice - once over non-news observations, once over all -
-- and admitting at most 5 points of the difference. A news-only facility
-- therefore cannot exceed Suspect.
--
-- Band comes from dc_facility_confidence_bands. Thresholds are READ, never
-- hardcoded.
-- ---------------------------------------------------------------------
create function public.dc_compute_facility_confidence(p_facility_id uuid)
returns table (score smallint, band text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_nonnews_lineages int;
  v_has_official     boolean;
  v_a int := 0;
  v_b int := 0;
  v_c_nonnews int := 0;
  v_c_all     int := 0;
  v_d int := 0;
  v_e int := 0;
  v_recent_days int;
  v_geo text;
  v_base int;
  v_full int;
  v_score int;
  v_band text;
begin
  if not exists (select 1 from public.dc_facilities where id = p_facility_id) then
    return;
  end if;

  select f.geo_precision into v_geo from public.dc_facilities f where f.id = p_facility_id;

  -- (a) independent non-news lineage count -----------------------------
  select count(distinct o.primary_lineage_key)
    into v_nonnews_lineages
  from public.dc_facility_observations o
  where o.facility_id = p_facility_id
    and not o.retracted
    and o.source_class <> 'news';

  v_a := case
           when v_nonnews_lineages >= 4 then 45
           when v_nonnews_lineages  = 3 then 40
           when v_nonnews_lineages  = 2 then 30
           when v_nonnews_lineages  = 1 then 18
           else 0
         end;

  -- (b) at least one official record ------------------------------------
  select exists (
    select 1 from public.dc_facility_observations o
    where o.facility_id = p_facility_id
      and not o.retracted
      and o.source_class = 'official_record'
  ) into v_has_official;
  v_b := case when v_has_official then 15 else 0 end;

  -- (c) cross-source attribute agreement, scored twice ------------------
  v_c_nonnews := public.fn_dc_attribute_agreement_points(p_facility_id, false);
  v_c_all     := public.fn_dc_attribute_agreement_points(p_facility_id, true);

  -- (d) recency of most recent NON-NEWS confirming observation ----------
  select min(current_date - o.observed_at)
    into v_recent_days
  from public.dc_facility_observations o
  where o.facility_id = p_facility_id
    and not o.retracted
    and o.source_class <> 'news';

  v_d := case
           when v_recent_days is null then 0
           when v_recent_days <= 180  then 10
           when v_recent_days <= 365  then 6
           when v_recent_days <= 730  then 3
           else 0
         end;

  -- (e) geo precision ---------------------------------------------------
  v_e := case v_geo
           when 'verified'     then 15
           when 'parcel'       then 15
           when 'address'      then 10
           when 'centroid'     then 5
           when 'municipality' then 2
           else 0
         end;

  v_base := v_a + v_b + v_c_nonnews + v_d + v_e;
  v_full := v_a + v_b + v_c_all     + v_d + v_e;

  -- NEWS CAP: at most +5 of whatever news adds on top of the non-news score
  v_score := v_base + least(5, greatest(0, v_full - v_base));
  v_score := greatest(0, least(100, v_score));

  select b.band into v_band
  from public.dc_facility_confidence_bands b
  where v_score between b.min_score and b.max_score
  order by b.sort_order
  limit 1;

  score := v_score::smallint;
  band  := v_band;
  return next;
end;
$$;

comment on function public.dc_compute_facility_confidence(uuid) is
  'Facility-Confidence Score 0..100 + band. COMPUTED from observations, never stored as '
  'source-of-truth. Counts DISTINCT primary_lineage_key. News is excluded from the lineage '
  'and official-record terms and capped at +5 overall, so a news-only facility can never '
  'exceed Suspect. Band thresholds are read from dc_facility_confidence_bands.';

-- ---------------------------------------------------------------------
-- Helper: cross-source agreement points (term c), 0..15.
-- SUPERSEDED BY MIGRATION 0051 - see that file for the corrected rule.
-- ---------------------------------------------------------------------
create or replace function public.fn_dc_attribute_agreement_points(
  p_facility_id uuid,
  p_include_news boolean
)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with obs as (
    select o.*
    from public.dc_facility_observations o
    where o.facility_id = p_facility_id
      and not o.retracted
      and (p_include_news or o.source_class <> 'news')
      and o.attribute in ('name','operator','coordinates','capacity')
  ),
  norm as (
    select
      attribute,
      case attribute
        when 'name'     then lower(regexp_replace(coalesce(value_text,''), '\s+', ' ', 'g'))
        when 'operator' then lower(regexp_replace(coalesce(value_text,''), '\s+', ' ', 'g'))
        when 'coordinates' then
          round((value_json->>'lat')::numeric, 3)::text || ',' ||
          round((value_json->>'lng')::numeric, 3)::text
        when 'capacity' then
          coalesce(capacity_basis,'?') || ':' || round(coalesce(value_num,0), 1)::text
      end as bucket,
      primary_lineage_key
    from obs
  ),
  present as (
    select distinct attribute from norm where bucket is not null and bucket <> ''
  ),
  agreeing as (
    select attribute
    from norm
    where bucket is not null and bucket <> ''
    group by attribute, bucket
    having count(distinct primary_lineage_key) >= 2
  )
  select case
           when (select count(*) from present) = 0 then 0
           else floor(
                  15.0
                  * (select count(distinct attribute) from agreeing)
                  / (select count(*) from present)
                )::int
         end;
$$;

-- ---------------------------------------------------------------------
-- Grants: these are internal compute functions. service_role only.
-- anon/authenticated must be revoked BY NAME - Supabase ships
-- ALTER DEFAULT PRIVILEGES granting EXECUTE on every new public function
-- to PUBLIC, anon and authenticated AT CREATE TIME, so
-- `revoke ... from public` alone is not enough.
-- ---------------------------------------------------------------------
revoke all on function public.dc_mint_fdc_id(date)                    from public, anon, authenticated;
revoke all on function public.dc_compute_jds_layer(uuid)              from public, anon, authenticated;
revoke all on function public.dc_compute_publishable(uuid)            from public, anon, authenticated;
revoke all on function public.dc_compute_facility_confidence(uuid)    from public, anon, authenticated;
revoke all on function public.fn_dc_attribute_agreement_points(uuid, boolean) from public, anon, authenticated;

grant execute on function public.dc_mint_fdc_id(date)                 to service_role;
grant execute on function public.dc_compute_jds_layer(uuid)           to service_role;
grant execute on function public.dc_compute_publishable(uuid)         to service_role;
grant execute on function public.dc_compute_facility_confidence(uuid) to service_role;
grant execute on function public.fn_dc_attribute_agreement_points(uuid, boolean) to service_role;
