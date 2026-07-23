-- 0019_rsc_tier1_counties_fn.sql
-- CC-RSC-STRANDED-INDUSTRIAL-1.0 — Tier-1 target counties for the RSC-05 Shovels
-- crawl: scored counties that carry idle-but-interconnected generation (SB/OS/OA)
-- — the ~517 infrastructure-relevant counties where a data center could plausibly
-- land. SECURITY INVOKER, search_path pinned, read-only. Ranked by market importance.
-- Consumed by the shovels-permit-history Edge Function (tier=1).

create or replace function public.rsc_tier1_counties()
returns table (county_fips char(5))
language sql
stable
security invoker
set search_path = public
as $$
  with relevant as (
    select distinct trim(county_fips)::char(5) fips
    from eia_generator_inventory
    where status in ('SB','OS','OA') and county_fips is not null and trim(county_fips) <> ''
  )
  select j.fips_code::char(5)
  from jurisdictions j
  where j.level = 'county' and j.current_score is not null
    and j.fips_code in (select fips from relevant)
  order by j.market_tier_importance desc nulls last;
$$;
