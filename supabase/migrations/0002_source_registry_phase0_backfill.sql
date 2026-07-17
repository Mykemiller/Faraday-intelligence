-- CC-SOURCE-SCALE-500 §5.4 Phase 0 — backfill (zero behavior change; registry is read-model only)

-- 1) jw_data_source_registry → all 72 rows
insert into source_registry (source_key, name, provider, url, cadence, confidence_cap, license,
                             license_status, scope, countable, status, subsystem, legacy_ref, fetch_config)
select
  r.source_key,
  r.name,
  r.provider,
  coalesce(r.url, ''),
  case
    when r.cadence ilike '%hourly%' then 'hourly'
    when r.cadence ilike '%daily%'  then 'daily'
    when r.cadence ilike '%weekly%' then 'weekly'
    when r.cadence ilike '%per %' or r.cadence ilike '%continuous%' or r.cadence ilike '%event%'
      then 'event_driven'
    else 'archival_refresh'
  end,
  coalesce(r.confidence_cap, 'SRC'),
  coalesce(r.license, 'unreviewed'),
  case
    when r.source_key in ('dc:atlas','dc:cleanview','fiberlocator:routes','peeringdb:ix',
                          'zayo:mapbook-2020','cred:emdat') or r.license ilike '%GATED%' then 'gated'
    else 'unreviewed'
  end,
  r.scope,
  -- census dedup: umbrella / duplicate / derived / paired-lane rows are not countable
  r.source_key not in ('agenda:legistar','puc:dockets','wb:wdi','moratorium-nation:opposition',
                       'wri:aqueduct40-basins','ferc:queue-rollup','jw:cousub-rollup',
                       'ncsl:inherit','ncsl:data-center-moratorium'),
  'registered',
  'jw',
  jsonb_build_object('table','jw_data_source_registry','pk',r.source_key),
  jsonb_build_object('legacy_cadence', r.cadence, 'access_unmapped', true)
from jw_data_source_registry r
on conflict (source_key) do nothing;

-- 2) agenda portals → 21 rows
insert into source_registry (source_key, name, url, cadence, confidence_cap, license, license_status,
                             scope, countable, status, subsystem, legacy_ref, last_artifact_at, idf_domains)
select
  'agenda:' || a.id::text,
  coalesce(a.client_id, a.base_url, a.id::text) || ' (' || a.platform || ')',
  coalesce(a.base_url, ''),
  'daily', 'SRC',
  'Public record (municipal legislative agendas)', 'cleared',
  'local', true,
  case a.scrape_status when 'active' then 'active' when 'error' then 'error' else 'registered' end,
  'agenda',
  jsonb_build_object('table','jurisdiction_agenda_sources','pk',a.id),
  case when a.scrape_status = 'active' then a.last_scraped_at end,
  array['D13','D18']
from jurisdiction_agenda_sources a
on conflict (source_key) do nothing;

-- 3) PUC portals → 25 rows
insert into source_registry (source_key, name, url, cadence, confidence_cap, license, license_status,
                             scope, countable, status, subsystem, legacy_ref, last_artifact_at, idf_domains)
select
  'puc:' || lower(p.state_abbr),
  p.commission,
  coalesce(p.portal_url, ''),
  'weekly', 'SRC',
  'Public records - per-portal ToS; metadata + extracted signals only', 'cleared',
  'us-state', true,
  case p.status when 'live' then 'active' when 'blocked' then 'error' else 'registered' end,
  'puc',
  jsonb_build_object('table','puc_sources','pk',p.state_abbr),
  case when p.status = 'live' then p.updated_at end,
  array['D3']
from puc_sources p
on conflict (source_key) do nothing;

-- 4) Socrata state-incentive feeds (live 8; the 24 pending states live in code config and register later)
insert into source_registry (source_key, name, url, cadence, confidence_cap, license, license_status,
                             scope, countable, status, subsystem, legacy_ref, last_artifact_at, idf_domains)
select
  'socrata:' || d.source_key,
  d.source_key || ' (state incentive disclosures)',
  '', 'weekly', 'SRC',
  'State open-data portal (Socrata) - per-portal terms', 'cleared',
  'us-state', true, 'active', 'incentives',
  jsonb_build_object('table','state_incentive_disclosures','source_key',d.source_key),
  d.last_touch,
  array['D19']
from (select source_key, max(updated_at) as last_touch
      from state_incentive_disclosures group by source_key) d
on conflict (source_key) do nothing;

-- 5) Off-registry live sources found in the census
insert into source_registry (source_key, name, provider, url, cadence, confidence_cap, license,
                             license_status, scope, countable, status, subsystem, last_artifact_at, idf_domains)
values
  ('courtlistener:recap', 'CourtListener RECAP docket search', 'Free Law Project',
   'https://www.courtlistener.com', 'weekly', 'SRC',
   'Free API (public court records)', 'cleared', 'us-federal', true, 'active', 'jw',
   '2026-07-13', array['D13','D18']),
  ('shovels:permits', 'Shovels Permits API (seed corpus)', 'Shovels.ai',
   'https://www.shovels.ai', 'event_driven', 'SRC',
   'Commercial API (existing subscription; 1 credit per record returned)', 'cleared',
   'us-local', true, 'active', 'jw',
   null, array['D10','D13'])
on conflict (source_key) do nothing;

-- 6) Activity backfill for jw-subsystem countable actives (census evidence dates, Appendix B)
update source_registry sr set status = 'active', last_artifact_at = v.d::timestamptz
from (values
  ('bls:laus','2026-07-11'), ('bls:qcew','2026-07-11'),
  ('census:acs5','2026-07-12'), ('census:aiannh','2026-07-12'), ('census:pep','2026-07-12'),
  ('census:tiger','2026-07-12'), ('census:tiger-place-county','2026-07-12'), ('census:urban-rural','2026-07-12'),
  ('eia:860','2026-07-13'), ('eia:861','2026-07-13'),
  ('eurostat:regional','2026-07-08'), ('geonames:spine','2026-07-08'), ('ilo:ilostat','2026-07-08'),
  ('fao:aquastat','2026-07-08'), ('ilo:normlex','2026-07-08'), ('ituc:gri','2026-07-08'),
  ('intl:ember','2026-07-15'), ('intl:jds-directories','2026-07-12'), ('intl:oecd-fdi-rri','2026-07-12'),
  ('intl:rsf-pfi','2026-07-12'), ('intl:worldbank-db2020','2026-07-06'), ('intl:worldbank-wdi','2026-07-15'),
  ('intl:worldbank-wgi','2026-07-12'),
  ('iso:ercot-gis','2026-07-13'), ('iso:miso-queue','2026-07-13'), ('iso:pjm-queue','2026-07-13'),
  ('ixpdb:federation','2026-07-15'), ('moratorium-nation:inventory','2026-07-15'),
  ('ncsl:dc-moratoriums','2026-07-13'), ('ncsl:subsidizing-servers','2026-07-13'),
  ('fema:nri','2026-07-11'), ('sdwis:echo','2026-07-09'), ('usgs:waterdata','2026-07-15'),
  ('treasury:oz-designations','2026-07-12'),
  ('fcc:bdc','2026-07-15'), ('fcc:broadband-map','2026-07-15'), ('ntia:bead','2026-07-14'),
  ('wikipedia:ixp-list','2026-07-14'),
  ('hifld:iso-boundaries','2026-07-13'), ('hifld:utility-territories','2026-07-13'),
  ('wri:aqueduct40','2026-07-12')
) as v(k, d)
where sr.source_key = v.k;

-- 7) Refresh from live evidence tables where newer
update source_registry sr set last_artifact_at = greatest(sr.last_artifact_at, e.ts)
from (select source_key, max(started_at) ts from intl_source_runs group by source_key) e
where sr.source_key = e.source_key;

update source_registry sr set last_artifact_at = greatest(sr.last_artifact_at, e.ts)
from (select source, max(captured_at) ts from jpas_attributes
      where source in ('fcc:bdc','fcc:broadband-map','ntia:bead','wikipedia:ixp-list',
                       'sdwis:echo','usgs:waterdata','shovels:permits',
                       'ncsl:dc-moratoriums','ncsl:subsidizing-servers','moratorium-nation:inventory')
      group by source) e
where sr.source_key = e.source;