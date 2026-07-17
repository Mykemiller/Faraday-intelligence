-- 0010_wave5_wave6_rosters.sql — CC-SOURCE-SCALE-500 Waves 5+6 (Myke approved 2026-07-17).
-- Mechanical roster generation from in-DB data → Google News query-lane rows
-- (scope='query_feed': ingested, relevance-gated, NEVER countable).
-- Segments in fetch_config: utilities(2000) · local_gov(500) · state_gov(4×state)
-- · federal_gov(curated) · dc_operators(jw_facilities). Long tail = weekly cadence
-- (poller v1.3 is cadence-aware); federal + operators = daily.

create or replace function gsearch_seed_url(q text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(q,
    '%','%25'), '&','%26'), ' ','%20'), '"','%22'), '''','%27'), '(','%28'), ')','%29'), '/','%2F')
$$;

-- Wave 5a: utilities — top 2,000 EIA-861 utilities by county coverage.
insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select
  'gsearch:util-' || left(regexp_replace(lower(u.utility_name),'[^a-z0-9]+','-','g'),52),
  left('Google News search: "' || u.utility_name || '" (utility watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || u.utility_name || '"'),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || u.utility_name || '" data center OR interconnection OR transmission OR "load growth"') || '&hl=en-US&gl=US&ceid=US:en',
  'rss','weekly','SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D2','D3'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', u.utility_name, 'entity_kind','company', 'segment','utilities', 'wave',5,
    'query', '"' || u.utility_name || '" data center OR interconnection OR transmission OR "load growth"')
from (
  select utility_name from eia_utility_territories
  group by utility_name order by count(*) desc limit 2000
) u
where not exists (select 1 from source_registry sr where sr.fetch_config->>'entity' = u.utility_name)
on conflict (source_key) do nothing;

-- Wave 5b: DC operators from jw_facilities (parent preferred).
insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select
  'gsearch:op-' || left(regexp_replace(lower(o.op),'[^a-z0-9]+','-','g'),52),
  left('Google News search: "' || o.op || '" (operator watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || o.op || '"'),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || o.op || '" data center OR AI OR infrastructure') || '&hl=en-US&gl=US&ceid=US:en',
  'rss','daily','SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D6'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', o.op, 'entity_kind','company', 'segment','dc_operators', 'wave',5,
    'query', '"' || o.op || '" data center OR AI OR infrastructure')
from (
  select distinct coalesce(nullif(operator_parent,''), operator) as op
  from jw_facilities
  where coalesce(nullif(operator_parent,''), operator) is not null
    and length(coalesce(nullif(operator_parent,''), operator)) between 3 and 80
) o
where not exists (select 1 from source_registry sr where sr.fetch_config->>'entity' = o.op)
on conflict (source_key) do nothing;

-- Wave 6a: US local government — top 500 DC-market jurisdictions
-- (facility count first, then JPAS quality).
insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select
  'gsearch:loc-' || left(regexp_replace(lower(j.name || '-' || j.state_abbr),'[^a-z0-9]+','-','g'),52),
  left('Google News search: ' || j.name || ', ' || j.state_abbr || ' (local gov watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || j.name || '" ' || j.state_abbr),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || j.name || '" ' || j.state_abbr || ' data center OR rezoning OR zoning OR moratorium') || '&hl=en-US&gl=US&ceid=US:en',
  'rss','weekly','SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D13','D18'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', j.name || ', ' || j.state_abbr, 'entity_kind','government',
    'segment','local_gov', 'gov_level','local', 'gov_region','US', 'wave',6,
    'query', '"' || j.name || '" ' || j.state_abbr || ' data center OR rezoning OR zoning OR moratorium')
from (
  with fac as (
    select jurisdiction_id, count(*) as n from jw_facilities
    where jurisdiction_id is not null group by 1
  )
  select j.name, j.state_abbr
  from jurisdictions j
  left join fac on fac.jurisdiction_id = j.id
  where j.level in ('county','place') and j.state_abbr is not null and j.is_active
  order by coalesce(fac.n,0) desc, j.jpas_quality desc nulls last
  limit 500
) j
on conflict (source_key) do nothing;

-- Wave 6b: US state agencies — 4 watch queries per state (PUC, energy office,
-- commerce/econ-dev, environment). Template names; wrong-name queries return
-- nothing and stay inert — the gate + verify pipeline keep them honest.
insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select
  'gsearch:st-' || left(regexp_replace(lower(s.name || '-' || t.tag),'[^a-z0-9]+','-','g'),52),
  left('Google News search: ' || s.name || ' ' || t.label || ' (state gov watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || s.name || '" ' || t.q),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || s.name || '" ' || t.q || ' data center') || '&hl=en-US&gl=US&ceid=US:en',
  'rss','weekly','SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D3','D19'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', s.name || ' ' || t.label, 'entity_kind','government',
    'segment','state_gov', 'gov_level','state', 'gov_region','US', 'wave',6,
    'query', '"' || s.name || '" ' || t.q || ' data center')
from (select name from jurisdictions where level = 'state') s
cross join (values
  ('puc','Public Utilities Commission','("public utilities commission" OR "public service commission" OR "corporation commission")'),
  ('energy','Energy Office','("energy office" OR "department of energy")'),
  ('commerce','Commerce / Economic Development','("department of commerce" OR "economic development")'),
  ('environment','Environmental Agency','("environmental quality" OR "environmental protection" OR "department of natural resources")')
) t(tag, label, q)
on conflict (source_key) do nothing;

-- Wave 6c: US federal agencies — curated roster, daily cadence.
insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select
  'gsearch:fed-' || left(regexp_replace(lower(a.entity),'[^a-z0-9]+','-','g'),52),
  left('Google News search: ' || a.entity || ' (federal watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || a.entity || '"'),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || a.entity || '" data center OR AI OR grid OR infrastructure') || '&hl=en-US&gl=US&ceid=US:en',
  'rss','daily','SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D3','D15'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', a.entity, 'entity_kind','government',
    'segment','federal_gov', 'gov_level','federal', 'gov_region','US', 'wave',6,
    'query', '"' || a.entity || '" data center OR AI OR grid OR infrastructure')
from (values
  ('FERC'),('Department of Energy'),('Energy Information Administration'),('Nuclear Regulatory Commission'),
  ('Environmental Protection Agency'),('CISA'),('Bureau of Industry and Security'),('CFIUS'),
  ('Department of Commerce'),('Department of the Treasury'),('FCC'),('NTIA'),('National Institute of Standards and Technology'),
  ('Army Corps of Engineers'),('Bureau of Land Management'),('General Services Administration'),
  ('White House Office of Science and Technology Policy'),('National Science Foundation'),
  ('Securities and Exchange Commission'),('Federal Trade Commission'),('Department of Justice Antitrust Division'),
  ('Department of Labor'),('Occupational Safety and Health Administration'),('Bureau of Labor Statistics'),
  ('Department of Defense'),('Defense Information Systems Agency'),('National Nuclear Security Administration'),
  ('Loan Programs Office'),('Grid Deployment Office'),('Western Area Power Administration'),
  ('Bonneville Power Administration'),('Tennessee Valley Authority'),('Rural Utilities Service'),
  ('Fish and Wildlife Service'),('National Marine Fisheries Service'),('Federal Aviation Administration'),
  ('Department of Homeland Security'),('National Labor Relations Board'),('Export-Import Bank'),
  ('International Trade Commission'),('US Geological Survey'),('Census Bureau'),
  ('Federal Energy Management Program'),('Office of Management and Budget'),('Government Accountability Office')
) a(entity)
on conflict (source_key) do nothing;
