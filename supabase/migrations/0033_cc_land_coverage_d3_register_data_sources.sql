-- CC-LAND-COVERAGE-1.0 · D3
-- Register the sources these deliverables depend on, plus the one
-- live-but-unregistered source already in the database (tri:facilities).
-- Idempotent on source_key (PK).
-- Applied to project ycadmmngkdhvpcsrcuaq 2026-07-24.

insert into public.jw_data_source_registry
  (source_key, name, provider, url, license, cadence, confidence_cap, scope, feed_status, notes)
values
  ('usgs:padus',
   'PAD-US — Protected Areas Database of the United States (county Summary Statistics)',
   'U.S. Geological Survey (Gap Analysis Project)',
   'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-statistics',
   'Public domain (U.S. federal; USGS GAP)',
   'annual (versioned releases; manual refresh)',
   'SRC', 'us-county',
   'pending-ingest',
   'Intended tenure source for jurisdiction_land_coverage (D1). Path A = county-level Summary Statistics Tabular Data CSV (federal/state/tribal by Manager Type; fee vs easement separable via Category). NOT YET INGESTED: the USGS/ScienceBase/data.doi.gov hosts are blocked by this session''s egress policy (GitHub-only allowlist), so the CSV could not be downloaded. Fee interest only; easements must be excluded from public_land_fraction. Vintage target: PAD-US 4.x.'),
  ('doe:anchor-roster',
   'DOE / NNSA federal anchor-site roster (national labs + production/cleanup sites)',
   'U.S. Department of Energy / National Nuclear Security Administration',
   'https://www.energy.gov/national-laboratories',
   'Public domain (U.S. federal — public DOE/NNSA site rosters)',
   'annual-manual-check',
   'SRC', 'facility',
   'seeded',
   'Source for federal_anchor_sites (D2). Mechanical roster only (site name / program / location); all rows review_status=pending pending Myke editorial qualification. DOD/MIRTA deferred to a later phase.'),
  ('tri:facilities',
   'EPA Toxics Release Inventory — facility roster',
   'U.S. Environmental Protection Agency',
   'https://www.epa.gov/toxics-release-inventory-tri-program',
   'Public domain (U.S. federal — EPA TRI)',
   'annual',
   'SRC', 'facility',
   'ingested',
   'Registry backfill for the live-but-unregistered TRI facility feed already in public.tri_facility_history (284,000 rows / 27,918 distinct FRS registry IDs, latest reporting year 2025 as of 2026-07-24). Keyed by FRS registry id; carries county_fips + lat/long.')
on conflict (source_key) do nothing;

-- record how many anchor rows resolved to a jurisdiction (26/26 at seed time)
update public.jw_data_source_registry
set matched_jurisdictions = (select count(*) from public.federal_anchor_sites where jurisdiction_id is not null)
where source_key = 'doe:anchor-roster';
