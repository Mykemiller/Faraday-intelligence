-- 0014_wave8_sql_extensions.sql — CC-SOURCE-SCALE-500 Wave 8, SQL-derivable
-- lanes (path to 10k captured). Applied to prod 2026-07-18: +895 utilities,
-- +500 local gov. NOTE: EIA-861 holds 2,895 distinct utilities total — the
-- roadmap's "3,300" was an over-estimate; this takes the segment to its ceiling.

-- Wave 8a: utilities long tail — ALL remaining EIA-861 utilities (2,000 → 2,895).
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
  jsonb_build_object('entity', u.utility_name, 'entity_kind','company', 'segment','utilities', 'country','US', 'wave',8,
    'query', '"' || u.utility_name || '" data center OR interconnection OR transmission OR "load growth"')
from (
  select utility_name from eia_utility_territories
  group by utility_name
  having length(utility_name) between 3 and 90
) u
where not exists (select 1 from source_registry sr where sr.fetch_config->>'entity' = u.utility_name)
on conflict (source_key) do nothing;

-- Wave 8b: US local gov 500 → 1,000 — next 500 by facility count → JPAS quality.
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
    'segment','local_gov', 'gov_level','local', 'gov_region','US', 'country','US', 'wave',8,
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
    and not exists (select 1 from source_registry sr
                    where sr.fetch_config->>'entity' = j.name || ', ' || j.state_abbr)
  order by coalesce(fac.n,0) desc, j.jpas_quality desc nulls last
  limit 500
) j
on conflict (source_key) do nothing;
