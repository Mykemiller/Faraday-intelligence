-- Myke 2026-07-17: add "type" + "years of data available" to source_registry
alter table source_registry
  add column if not exists source_type text not null default 'other'
    check (source_type in ('news_feed','blog','company_feed','industry_entity',
                           'government_feed','data_portal','status_feed','wire_service','other')),
  add column if not exists years_of_data_available numeric;

comment on column source_registry.source_type is
  'What kind of publisher/feed this is: news_feed (editorial press), blog (independent/individual), company_feed (vendor newsroom/commercial API), industry_entity (association/NGO/standards body/ISO-RTO), government_feed (agency/statistical/portal incl. IGOs), data_portal (open datasets/directories/research corpora), status_feed (operational status pages), wire_service (PR wires), other (last resort).';
comment on column source_registry.years_of_data_available is
  'Approximate years of retrievable historical signal from the upstream source (not our ingest window). NULL = not yet assessed; refine during feed verification.';

-- Backfill source_type for the 128 Phase 0 rows
update source_registry set source_type = case
  -- derived/internal lanes
  when source_key in ('ncsl:inherit','ncsl:data-center-moratorium','ferc:queue-rollup','jw:cousub-rollup') then 'other'
  -- blogs
  when source_key like 'telecomramblings:%' then 'blog'
  -- company/commercial feeds
  when source_key like 'shovels:%' or source_key in ('dc:cleanview','telegeography:free-maps',
       'fiberlocator:routes','zayo:mapbook-2020','intl:jds-directories') then 'company_feed'
  -- datasets/directories/research corpora
  when source_key in ('geonames:spine','wikipedia:ixp-list','dc:atlas','dc:epoch-ai',
       'courtlistener:recap','openet:gee-ensemble','cred:emdat')
       or source_key like 'moratorium-nation:%' then 'data_portal'
  -- associations / NGOs / community orgs / ISO-RTOs
  when source_key like 'ncsl:%' or source_key like 'iso:%'
       or source_key in ('ituc:gri','intl:rsf-pfi','intl:ember','wri:aqueduct40',
                         'wri:aqueduct40-basins','peeringdb:ix','ixpdb:federation') then 'industry_entity'
  -- government + IGO statistical/portal feeds (incl. all agenda, PUC, Socrata subsystems)
  when subsystem in ('agenda','puc','incentives')
       or source_key like 'bls:%' or source_key like 'census:%' or source_key like 'eia:%'
       or source_key like 'fcc:%' or source_key like 'fema:%' or source_key like 'ntia:%'
       or source_key like 'treasury:%' or source_key like 'usgs:%' or source_key like 'sdwis:%'
       or source_key like 'hifld:%' or source_key like 'nso:%' or source_key like 'ilo:%'
       or source_key in ('eurostat:regional','fao:aquastat','wb:wdi','oecd:regional',
                         'intl:worldbank-wdi','intl:worldbank-wgi','intl:worldbank-db2020',
                         'intl:oecd-fdi-rri','agenda:legistar','puc:dockets') then 'government_feed'
  else 'other' end;

-- Backfill years_of_data_available where upstream history depth is well known (approximate)
update source_registry sr set years_of_data_available = v.yrs
from (values
  ('bls:laus', 50), ('bls:qcew', 35), ('bls:oews', 25),
  ('census:acs5', 17), ('census:pep', 25), ('census:tiger', 18), ('census:aiannh', 18),
  ('census:gazetteer', 15), ('census:urban-rural', 30), ('census:tiger-place-county', 10),
  ('census:gov-finance', 30), ('census:gov-units', 30),
  ('eia:860', 35), ('eia:861', 35),
  ('eurostat:regional', 30), ('fao:aquastat', 50),
  ('fcc:bdc', 3), ('fcc:broadband-map', 3),
  ('fema:nri', 5),
  ('hifld:iso-boundaries', 10), ('hifld:utility-territories', 10),
  ('ilo:ilostat', 50), ('ilo:normlex', 100),
  ('intl:ember', 25), ('intl:oecd-fdi-rri', 25), ('intl:rsf-pfi', 20),
  ('intl:worldbank-db2020', 15), ('intl:worldbank-wdi', 60), ('intl:worldbank-wgi', 30),
  ('wb:wdi', 60), ('oecd:regional', 20),
  ('iso:ercot-gis', 10), ('iso:miso-queue', 25), ('iso:pjm-queue', 25),
  ('ituc:gri', 10),
  ('moratorium-nation:inventory', 5), ('moratorium-nation:opposition', 5),
  ('ncsl:dc-moratoriums', 1), ('ncsl:subsidizing-servers', 1),
  ('ntia:bead', 3), ('openet:gee-ensemble', 10),
  ('sdwis:echo', 30), ('shovels:permits', 10), ('shovels:telecom', 10),
  ('treasury:oz-designations', 8), ('usgs:waterdata', 50),
  ('wri:aqueduct40', 1), ('wri:aqueduct40-basins', 1),
  ('cred:emdat', 100), ('courtlistener:recap', 20),
  ('puc:tx', 25), ('puc:va', 20),
  ('socrata:ny_esd_dei', 12), ('socrata:ny_ida_projects', 12)
) as v(k, yrs)
where sr.source_key = v.k;