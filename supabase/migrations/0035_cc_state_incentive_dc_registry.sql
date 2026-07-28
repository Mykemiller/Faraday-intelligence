-- CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 · Wave 2 registry
-- Registers the DC TIF ArcGIS feed (the one Wave-2 source with a clean live API).
-- Applied to prod 2026-07-26 alongside the Wave-2 deploy (fn v13/v14) + DC seed.
-- Idempotent on source_key (PK).

insert into public.jw_data_source_registry
  (source_key, name, provider, url, license, cadence, confidence_cap,
   default_confidence_tier, scope, feed_status, matched_jurisdictions, notes)
values
  ('dc_tif_areas', 'DC Tax Increment Financing (TIF) areas', 'DC OCTO / OCFO (via DCGIS ArcGIS)',
   'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Incentives_WebMercator/MapServer/26',
   'Open Data (DC)', 'quarterly', 'SRC', 'SRC', 'us-state', 'ingested', 1,
   'ArcGIS MapServer layer 26. 13 TIF areas @ probe 2026-07-26; dollar figure carried '
   || 'in-layer (INITIAL_AUTHORIZATION, e.g. "$50.0 million") so no OCFO scrape needed → SRC. '
   || 'Resolves to the DC county-equivalent jurisdiction. Other Wave-2 states (TN/MN/TX) are '
   || 'PENDING with documented fetch/URL blockers — see mappers.ts PENDING_SOURCES.')
on conflict (source_key) do nothing;
