-- Forecast-layer post-seed validation (read-only). Supabase project ycadmmngkdhvpcsrcuaq.

-- 1) Row counts per table
select 'forecast_sources' t, count(*) n from forecast_sources
union all select 'forecast_vintages', count(*) from forecast_vintages
union all select 'forecast_observations', count(*) from forecast_observations;

-- 2) Canonical revision story A: PJM Dominion-zone data-center load, target_year 2037
select vintage_label, published_date, value,
       delta_vs_prior_vintage, days_between_vintages
from forecast_revisions
where source_id='pjm-long-term-load-forecast'
  and target_year=2037
  and metric_name='Dominion (DOM) zone data-center load'
order by published_date;

-- 3) Canonical revision story B: Texas SWP statewide total capital cost
select vintage_label, published_date, value,
       delta_vs_prior_vintage, days_between_vintages
from forecast_revisions
where source_id='texas-state-water-plan'
  and metric_name='Statewide total recommended capital cost (whole-plan)'
order by published_date;

-- 4) Observations with NULL jurisdiction_id, by source (expected: national/iso-zone/state scopes)
select source_id, count(*) filter (where jurisdiction_id is null) as null_jur,
                  count(*) filter (where jurisdiction_id is not null) as mapped_jur
from forecast_observations group by source_id order by source_id;

-- 5) WARNING list (soft FK): attribute_codes on observations NOT present in jpas_attribute_registry.
--    Logged, not blocked, per Myke's no-hard-FK decision. Empty = clean.
select distinct o.attribute_code
from forecast_observations o
where o.attribute_code is not null
  and not exists (select 1 from jpas_attribute_registry r where r.attribute_code = o.attribute_code)
order by 1;

-- 6) Data-quality guard: any numeric observation missing a unit (expected: 0 rows)
select observation_id, source_id, metric_name, value
from forecast_observations
where value is not null and (unit is null or unit = '');
