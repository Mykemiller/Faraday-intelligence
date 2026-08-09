-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / FAR-429. APPLIED to prod 2026-08-09.
-- (a) Register the EU EED data centre database (country-aggregate lane).
-- (b) Register national permit / building registries as non-US facility VALIDATION
--     sources -- the missing corroboration path for the 9,287 non-US candidates,
--     every one of which currently comes from a single source (dc:atlas).
--
-- TWO DISTINCT CLASSES, deliberately given different namespaces rather than lumped
-- together (class should describe what a record IS, not what it is about):
--   permit:*   planning / building-permit APPLICATION registers -> JDS L3/L4
--   bldgreg:*  building / cadastral registers -> JDS L1 existence + build year
--
-- EVERY row below was fetched server-side on 2026-08-09 and returned a live response.
-- Registries that could NOT be reached (Poland GUNB, Spain Catastro, Singapore URA,
-- NZ Stats) are deliberately NOT inserted -- they are listed in FAR-429 instead.
--
-- status='registered' throughout: catalogued, NOT ingesting. No fetcher is wired.
insert into source_registry
  (source_key, name, provider, url, access_method, cadence, confidence_cap,
   license, license_status, scope, status, source_type, source_level, notes)
values
  ('eu:eed-dc-db',
   'EU European database on data centres (EED Art.12 / DR 2024/1364)',
   'European Commission — DG ENER',
   'https://energy.ec.europa.eu/topics/energy-efficiency/energy-efficiency-targets-directive-and-rules/energy-efficiency-directive/energy-performance-data-centres_en',
   'manual', 'annual', 'SRC', 'CC BY 4.0 (Decision 2011/833/EU)', 'attribution_required',
   'country', 'registered', 'government_feed', 'primary',
   'COUNTRY AGGREGATE ONLY -- not a facility source. Art.5(5) of DR (EU) 2024/1364 makes per-facility data confidential; Annex IV publishes only Member State and Union level. Verified 2026-08-09 against the public Qlik app 940a61c3-bcfe-47d6-a786-25d93aa63b85: one table PublicEED, 346 rows, country x reporting period x size category x type, NO facility name/operator/LAU/coordinates. Values require a Qlik Engine WebSocket client; hence access_method=manual.'),
  ('permit:fr-sitadel',
   'France Sitadel — base des permis de construire et autorisations d''urbanisme',
   'Ministere de la Transition ecologique (SDES/CGDD)',
   'https://www.data.gouv.fr/api/1/datasets/?q=sitadel',
   'json_api', 'monthly', 'SRC', 'Licence Ouverte 2.0 (lov2)', 'attribution_required',
   'FR', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: data.gouv.fr API HTTP 200, 308KB JSON. Licence lov2 read directly off the dataset records. CAVEAT: search also returns departmental "Suivi des constructions de logements" series, which are AGGREGATE housing statistics, not per-permit. Pin the per-permit national extract before ingest.'),
  ('permit:uk-planning-data',
   'England Planning Data — planning application register',
   'UK Ministry of Housing, Communities and Local Government',
   'https://www.planning.data.gov.uk/entity.json?dataset=planning-application',
   'json_api', 'daily', 'SRC', 'expected OGL v3 — NOT verified', 'unreviewed',
   'GB-ENG', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: entity.json HTTP 200 JSON. Real queryable entity API. England only -- Scotland, Wales and NI run separate systems.'),
  ('permit:ie-planning-datagov',
   'Ireland planning applications (data.gov.ie CKAN)',
   'Government of Ireland',
   'https://data.gov.ie/api/3/action/package_search?q=planning%20applications',
   'json_api', 'monthly', 'SRC', 'not verified', 'unreviewed',
   'IE', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: CKAN package_search HTTP 200, 202 datasets. Publisher-fragmented per local authority.'),
  ('permit:au-nsw-planning-portal',
   'NSW Planning Portal — development application data',
   'NSW Department of Planning, Housing and Infrastructure',
   'https://www.planningportal.nsw.gov.au/opendata',
   'html', 'daily', 'SRC', 'not verified', 'unreviewed',
   'AU-NSW', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: HTTP 200 HTML. State-level; Australia has no federal permit register.'),
  ('permit:fi-lupapiste',
   'Finland Lupapiste — national e-permit service',
   'Cloudpermit / Finnish municipalities',
   'https://www.lupapiste.fi/',
   'html', 'event_driven', 'SRC', 'login required', 'gated',
   'FI', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: HTTP 200 HTML. Permit APPLICATION service, not open data -- behind authentication.'),
  ('bldgreg:nl-bag',
   'Netherlands BAG — Basisregistratie Adressen en Gebouwen',
   'Kadaster / PDOK',
   'https://service.pdok.nl/lv/bag/atom/bag.xml',
   'atom', 'monthly', 'SRC', 'expected public domain — NOT verified', 'unreviewed',
   'NL', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: PDOK Atom feed HTTP 200 XML (GeoPackage + Zip). NOTE api.pdok.nl/lv/bag/ogc/v1 404s -- use the Atom feed. BUILDING register, not permits.'),
  ('bldgreg:no-matrikkelen',
   'Norway Matrikkelen — cadastre (buildings) via Geonorge',
   'Kartverket',
   'https://kartkatalog.geonorge.no/api/search?text=matrikkelen',
   'json_api', 'monthly', 'SRC', 'expected NLOD — NOT verified', 'unreviewed',
   'NO', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: Geonorge catalogue API HTTP 200 JSON, 42 datasets incl. Matrikkelen - Bygningspunkt.'),
  ('bldgreg:dk-bbr',
   'Denmark BBR — Bygnings- og Boligregistret via Datafordeler',
   'Styrelsen for Dataforsyning og Infrastruktur',
   'https://datafordeler.dk/',
   'html', 'monthly', 'SRC', 'free but registration required', 'gated',
   'DK', 'registered', 'government_feed', 'primary',
   'Verified 2026-08-09: Datafordeler portal HTTP 200 HTML. BBR free but requires a registered service user.')
on conflict (source_key) do nothing;
