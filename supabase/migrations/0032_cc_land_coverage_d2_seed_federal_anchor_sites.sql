-- CC-LAND-COVERAGE-1.0 · D2 (seed)
-- Mechanical roster of DOE national laboratories + NNSA production/cleanup
-- sites from public DOE/NNSA rosters. jurisdiction_id resolved by exact
-- county-FIPS match against public.jurisdictions (never guessed; unmatched
-- left null). Every row review_status='pending'. Idempotent on site_key.
-- Applied to project ycadmmngkdhvpcsrcuaq 2026-07-24 (26 rows, all 26 resolved).

with seed(site_key, site_name, site_category, program, operator, nearest_city, state, state_fips, county_name, county_fips, latitude, longitude, source_note) as (
  values
  -- DOE Office of Science national laboratories
  ('ornl','Oak Ridge National Laboratory','national_laboratory','DOE-SC','UT-Battelle, LLC','Oak Ridge','TN','47','Anderson County','47001', 35.93, -84.31, 'Largest DOE Office of Science multiprogram lab; on the Oak Ridge Reservation (also spans Roane County 47145).'),
  ('anl','Argonne National Laboratory','national_laboratory','DOE-SC','UChicago Argonne, LLC','Lemont','IL','17','DuPage County','17043', 41.71, -87.98, NULL),
  ('bnl','Brookhaven National Laboratory','national_laboratory','DOE-SC','Brookhaven Science Associates, LLC','Upton','NY','36','Suffolk County','36103', 40.87, -72.88, NULL),
  ('lbnl','Lawrence Berkeley National Laboratory','national_laboratory','DOE-SC','University of California','Berkeley','CA','06','Alameda County','06001', 37.876, -122.25, NULL),
  ('fnal','Fermi National Accelerator Laboratory','national_laboratory','DOE-SC','Fermi Research Alliance, LLC','Batavia','IL','17','Kane County','17089', 41.84, -88.26, 'Site straddles DuPage (17043) and Kane (17089) counties; Batavia mailing address is in Kane.'),
  ('pnnl','Pacific Northwest National Laboratory','national_laboratory','DOE-SC','Battelle Memorial Institute','Richland','WA','53','Benton County','53005', 46.34, -119.28, NULL),
  ('slac','SLAC National Accelerator Laboratory','national_laboratory','DOE-SC','Stanford University','Menlo Park','CA','06','San Mateo County','06081', 37.42, -122.20, NULL),
  ('pppl','Princeton Plasma Physics Laboratory','national_laboratory','DOE-SC','Princeton University','Princeton','NJ','34','Mercer County','34021', 40.35, -74.60, NULL),
  ('ames','Ames National Laboratory','national_laboratory','DOE-SC','Iowa State University','Ames','IA','19','Story County','19169', 42.03, -93.65, NULL),
  ('jlab','Thomas Jefferson National Accelerator Facility','national_laboratory','DOE-SC','Jefferson Science Associates, LLC','Newport News','VA','51','Newport News city','51700', 37.10, -76.48, 'Located in the independent city of Newport News (county-equivalent, FIPS 51700).'),
  -- NNSA national laboratories
  ('lanl','Los Alamos National Laboratory','national_laboratory','NNSA','Triad National Security, LLC','Los Alamos','NM','35','Los Alamos County','35028', 35.84, -106.29, NULL),
  ('llnl','Lawrence Livermore National Laboratory','national_laboratory','NNSA','Lawrence Livermore National Security, LLC','Livermore','CA','06','Alameda County','06001', 37.69, -121.71, NULL),
  ('snl-nm','Sandia National Laboratories (New Mexico)','national_laboratory','NNSA','National Technology & Engineering Solutions of Sandia, LLC','Albuquerque','NM','35','Bernalillo County','35001', 35.05, -106.54, 'Primary Sandia site; a second campus (SNL-CA) is co-located with LLNL in Livermore, Alameda County CA.'),
  -- Other DOE national laboratories
  ('inl','Idaho National Laboratory','national_laboratory','DOE-NE','Battelle Energy Alliance, LLC','Idaho Falls','ID','16','Butte County','16023', NULL, NULL, 'Desert site spans Butte/Bingham/Bonneville/Jefferson/Clark counties; HQ in Idaho Falls (Bonneville County 16019). County set to primary site county Butte.'),
  ('nrel','National Renewable Energy Laboratory','national_laboratory','DOE-EERE','Alliance for Sustainable Energy, LLC','Golden','CO','08','Jefferson County','08059', 39.74, -105.17, NULL),
  ('netl','National Energy Technology Laboratory','national_laboratory','DOE-FE','U.S. DOE (government-owned, government-operated)','Pittsburgh','PA','42','Allegheny County','42003', NULL, NULL, 'Multi-site GOGO lab: Pittsburgh PA (Allegheny 42003), Morgantown WV (Monongalia 54061), Albany OR (Linn 41043). County set to Pittsburgh.'),
  ('srnl','Savannah River National Laboratory','national_laboratory','DOE-EM','Battelle Savannah River Alliance, LLC','Aiken','SC','45','Aiken County','45003', 33.34, -81.74, 'Applied national lab located on the Savannah River Site.'),
  -- NNSA production / test sites (non-laboratory)
  ('pantex','Pantex Plant','production_site','NNSA','Consolidated Nuclear Security, LLC','Amarillo','TX','48','Carson County','48065', 35.32, -101.56, 'Nuclear weapons assembly/disassembly.'),
  ('y12','Y-12 National Security Complex','production_site','NNSA','Consolidated Nuclear Security, LLC','Oak Ridge','TN','47','Anderson County','47001', 35.99, -84.25, 'Uranium processing / secondaries; Oak Ridge Reservation.'),
  ('kcnsc','Kansas City National Security Campus','production_site','NNSA','Honeywell FM&T','Kansas City','MO','29','Jackson County','29095', 38.85, -94.55, 'Non-nuclear components manufacturing.'),
  ('nnss','Nevada National Security Site','test_site','NNSA','Mission Support and Test Services, LLC','Mercury','NV','32','Nye County','32023', 37.12, -116.06, 'Formerly the Nevada Test Site; experiments and subcritical testing.'),
  ('srs','Savannah River Site','production_site','NNSA','Savannah River Nuclear Solutions, LLC','Aiken','SC','45','Aiken County','45003', 33.30, -81.66, 'NNSA tritium mission + DOE-EM cleanup; hosts SRNL. Also spans Barnwell/Allendale counties.'),
  -- DOE-EM cleanup / fuel-cycle anchor sites
  ('hanford','Hanford Site','cleanup_site','DOE-EM',NULL,'Richland','WA','53','Benton County','53005', 46.55, -119.49, 'Largest DOE environmental cleanup; former plutonium production. Also spans Franklin/Grant/Adams counties.'),
  ('wipp','Waste Isolation Pilot Plant','cleanup_site','DOE-EM',NULL,'Carlsbad','NM','35','Eddy County','35015', 32.37, -103.79, 'Deep geologic transuranic waste repository.'),
  ('portsmouth','Portsmouth Gaseous Diffusion Plant','cleanup_site','DOE-EM',NULL,'Piketon','OH','39','Pike County','39131', 39.02, -82.98, 'Former uranium enrichment; D&D cleanup.'),
  ('paducah','Paducah Gaseous Diffusion Plant','cleanup_site','DOE-EM',NULL,'West Paducah','KY','21','McCracken County','21145', 37.10, -88.81, 'Former uranium enrichment; D&D cleanup.')
)
insert into public.federal_anchor_sites
  (site_key, site_name, site_category, program, operator, nearest_city, state, state_fips, county_name, county_fips,
   jurisdiction_id, latitude, longitude, source_key, source_note, review_status, dataset_version, hash)
select s.site_key, s.site_name, s.site_category, s.program, s.operator, s.nearest_city, s.state, s.state_fips, s.county_name, s.county_fips,
       j.id, s.latitude, s.longitude, 'doe:anchor-roster', s.source_note, 'pending', 'roster-2026-07-24', md5(s.site_key)
from seed s
left join public.jurisdictions j on j.fips_code = s.county_fips and j.fips_type = 'county'
on conflict (site_key) do nothing;
