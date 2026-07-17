-- Mechanism vs subject model (Myke 2026-07-17). Applied to prod as
-- 'source_registry_search_query_type_and_entity' (+ scope-fix follow-up).
-- source_type = publishing MECHANISM ('search_query' added for query-lane rows);
-- fetch_config.entity / entity_kind = SUBJECT captured (company|government|industry_org).
alter table source_registry drop constraint source_registry_source_type_check;
alter table source_registry add constraint source_registry_source_type_check
  check (source_type = any (array['news_feed','blog','company_feed','industry_entity','government_feed','data_portal','status_feed','wire_service','search_query','other']));

update source_registry set source_type = 'search_query' where scope = 'query_feed';

update source_registry
set fetch_config = fetch_config || jsonb_build_object(
  'entity', substring(fetch_config->>'query' from '"([^"]+)"'), 'entity_kind', 'company')
where scope = 'query_feed' and fetch_config->>'query' like '%"%';

update source_registry set fetch_config = fetch_config || jsonb_build_object('entity_kind','government')
where scope = 'query_feed' and fetch_config->>'entity' in ('CISA','Saudi Data & AI Authority (SDAIA)');
update source_registry set fetch_config = fetch_config || jsonb_build_object('entity_kind','industry_org')
where scope = 'query_feed' and fetch_config->>'entity' in ('NYISO','CAISO','PJM Interconnection','Uptime Institute','iMasons');

-- Named first-party feeds: the publisher IS the subject. NOTE: 'scope' also
-- carries geo scopes on Phase-0 rows — exclude only the query lane.
update source_registry
set fetch_config = fetch_config || jsonb_build_object(
  'entity', provider,
  'entity_kind', case source_type when 'government_feed' then 'government'
    when 'industry_entity' then 'industry_org' else 'company' end)
where scope is distinct from 'query_feed'
  and source_type in ('company_feed','government_feed','industry_entity')
  and provider is not null and not (fetch_config ? 'entity');
