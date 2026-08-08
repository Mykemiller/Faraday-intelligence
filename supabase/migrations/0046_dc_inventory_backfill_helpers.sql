-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 3 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808212112
--   dc_inventory_0046_backfill_observations_and_facilities
--
-- ⚠ THE BACKFILL BODY THAT SHIPPED IN THE PROD VERSION OF THIS MIGRATION
--   IS SUPERSEDED BY 0047, which resets the five tables and re-runs a
--   corrected, lossless backfill. Replaying it here would write rows that
--   0047 immediately deletes, so only the parts 0047 still DEPENDS ON are
--   kept: the two classification helpers.
--
--   The three defects 0047 fixes are documented in its header. Prod
--   migration history retains the original statements under the version
--   above; this file is the forward-replayable equivalent.
-- =====================================================================

-- Deterministic source_class for the jw_facilities legacy corpus.
-- Verified at backfill time to classify all 214 distinct source_name values
-- with zero fall-through:
--   official_record      172 sources / 1,171 rows
--   operator_first_party  36 sources /   727 rows
--   news                   3 sources /   190 rows
--   commercial_dataset     1 source  /   118 rows
--   directory              2 sources /    77 rows
create or replace function public.fn_dc_legacy_source_class(p_source_name text)
returns text language sql immutable security invoker set search_path = public, pg_temp as $$
  select case
    when p_source_name = 'Shovels Permits (seed)' then 'official_record'
    when p_source_name ~* '\y(Planning|Assessor|Recorder|Register|Records|Property|Probate|CAD)\y'
      then 'official_record'
    when p_source_name ~* '( IR$|Disclosures$|Facility Locations$|Facility Press$|Data Center Locations$)'
      then 'operator_first_party'
    when p_source_name in ('DCD','DC Frontier','Bisnow')   then 'news'
    when p_source_name in ('DC Map','DataCenterMap')       then 'directory'
    when p_source_name in ('CBRE Research')                then 'commercial_dataset'
    else 'commercial_dataset'
  end;
$$;
comment on function public.fn_dc_legacy_source_class(text) is
  'Deterministic source_class for the jw_facilities legacy corpus. Verified to classify all '
  '214 distinct source_name values with zero fall-through at backfill time.';

-- Legacy status -> lifecycle_status.
create or replace function public.fn_dc_legacy_lifecycle(p_status text)
returns text language sql immutable security invoker set search_path = public, pg_temp as $$
  select case p_status
    when 'operational'  then 'operational'
    when 'construction' then 'construction'
    when 'permitted'    then 'permitted'
    -- 'acquisition' is a 4th legacy status the Sprint-1 enum does not carry.
    -- It sits at legacy jds_layer L4, which is exactly announced/rumored, so it
    -- maps to 'announced' and dc_compute_jds_layer reproduces L4 unchanged.
    when 'acquisition'  then 'announced'
  end;
$$;
comment on function public.fn_dc_legacy_lifecycle(text) is
  'jw_facilities.status -> dc_facilities.lifecycle_status. The legacy vocabulary had four '
  'values; acquisition maps to announced so the JDS layer is reproduced 1:1.';
