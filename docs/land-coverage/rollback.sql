-- CC-LAND-COVERAGE-1.0 rollback (project ycadmmngkdhvpcsrcuaq)
-- Fully additive change; this reverses it with no impact on scoring or other tables.

begin;

-- D3: remove the three registered sources
delete from public.jw_data_source_registry
where source_key in ('usgs:padus','doe:anchor-roster','tri:facilities');

-- D2 + D1: drop the two new tables (federal_anchor_sites has FK to jurisdictions;
-- jurisdiction_land_coverage has FK to jurisdictions — both drop cleanly)
drop table if exists public.federal_anchor_sites;
drop table if exists public.jurisdiction_land_coverage;

commit;

-- Sanity after rollback:
--   select count(*) from public.jpas_attribute_registry;  -- expect 66
--   select md5(string_agg(id::text || coalesce(jpas_score::text,'') || coalesce(current_score::text,''), '|' order by id))
--     from public.jurisdictions;                            -- expect addd57af49ebeef15ac3e9435ebfc3ec
