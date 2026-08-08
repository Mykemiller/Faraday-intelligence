-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1 ROLLBACK
--
-- Restores jw_facilities to a plain table and removes everything this
-- sprint added. The legacy table was RENAMED, never dropped, so no data
-- is at risk: the rollback is a rename back.
--
-- Run top to bottom. Safe to re-run.
-- =====================================================================

begin;

-- 1. drop the compatibility view + its INSTEAD OF trigger, then rename the
--    frozen legacy table back into place.
drop trigger if exists trg_jw_facilities_compat_insert on public.jw_facilities;
drop view    if exists public.jw_facilities;
drop function if exists public.fn_jw_facilities_compat_insert();

alter table public.jw_facilities_legacy_20260808 rename to jw_facilities;
comment on table public.jw_facilities is null;

-- 2. read views
drop view if exists public.dc_facility_public;
drop view if exists public.dc_facility_current;

-- 3. cron + recompute
select cron.unschedule('dc-facility-score-recompute-weekly')
where exists (select 1 from cron.job where jobname = 'dc-facility-score-recompute-weekly');
drop function if exists public.fn_dc_recompute_facility_scores();

-- 4. the five tables (drop the append-only trigger first so the cascade is clean)
drop trigger if exists trg_dc_observations_append_only on public.dc_facility_observations;
drop trigger if exists trg_dc_facilities_touch         on public.dc_facilities;

drop table if exists public.dc_facility_merges;
drop table if exists public.dc_facility_identifiers;
drop table if exists public.dc_facility_observations;
drop table if exists public.dc_facility_confidence_bands;
drop table if exists public.dc_facilities;

-- 5. functions
drop function if exists public.fn_dc_observations_append_only();
drop function if exists public.fn_dc_facilities_touch();
drop function if exists public.fn_dc_backfill_from_jw_facilities(boolean);
drop function if exists public.fn_dc_backfill_legacy_metadata();
drop function if exists public.fn_dc_attribute_agreement_points(uuid, boolean);
drop function if exists public.dc_compute_facility_confidence(uuid);
drop function if exists public.dc_compute_publishable(uuid);
drop function if exists public.dc_compute_jds_layer(uuid);
drop function if exists public.dc_mint_fdc_id(date);
drop function if exists public.fn_dc_jds_from_lifecycle(text);
drop function if exists public.fn_dc_jsonb_to_text_array(jsonb);
drop function if exists public.fn_dc_legacy_source_key(text);
drop function if exists public.fn_dc_legacy_source_class(text);
drop function if exists public.fn_dc_legacy_lifecycle(text);

-- 6. the 213 source_registry rows this sprint minted.
--    DELIBERATELY LEFT IN PLACE by default - they are a genuine record of
--    sources in use and are on the licence-review queue. Uncomment only if
--    you want a truly pristine rollback.
--
-- delete from public.source_registry
--  where notes like 'Registered by the DC inventory entity-model backfill%';

commit;

-- 7. verify
-- select count(*) from public.jw_facilities;                      -- expect 2283
-- select to_regclass('public.jw_facilities_legacy_20260808');     -- expect NULL
-- select to_regclass('public.dc_facilities');                     -- expect NULL
