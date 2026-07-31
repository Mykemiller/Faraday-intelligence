-- CC-STATE-BRIEF-SCAFFOLD-1.0 / seed data
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-07-31.
-- Idempotent: every insert carries an ON CONFLICT DO NOTHING.

-- D8/D11: EXACTLY 10 auditor shards = 5 active sections x 2 regions.
-- CONNECTIVITY is `incubating`, so it deliberately gets no shard - that is
-- what keeps this at 10 rather than 12. Region split is at roughly the
-- Mississippi, 26 jurisdictions each (50 states + DC + PR = 52).
insert into jw_brief_auditor_shards (auditor_key, section_code, region, state_abbrs)
select 'AUD-'||r.section_code||'-'||g.region, r.section_code, g.region, g.states
from jw_brief_section_registry r
cross join (values
  ('EAST', array['AL','CT','DC','DE','FL','GA','IL','IN','KY','MA','MD','ME','MI','NC','NH','NJ','NY','OH','PA','PR','RI','SC','TN','VA','VT','WV']),
  ('WEST', array['AK','AZ','AR','CA','CO','HI','IA','ID','KS','LA','MN','MO','MS','MT','ND','NE','NM','NV','OK','OR','SD','TX','UT','WA','WI','WY'])
) as g(region, states)
where r.status = 'active'
on conflict (auditor_key) do nothing;

-- Feed bindings. `is_load_bearing` marks the feeds whose loss takes the
-- section dark - these are what v_jw_brief_dark_register reports against (D9).
-- Statuses below reflect VERIFIED state as of 2026-07-31, not aspiration.
insert into jw_brief_feed_bindings (section_code, feed_key, source_ref, is_load_bearing, status, notes) values
('READ','derived_sections','jw_brief_sections',false,'active','Synthesis of the other sections; carries no primary feed of its own'),
('POWER','interconnection_queue','jw_signal_events:interconnection_queue_delta',true,'active','1,013 events, 0 null-state'),
('POWER','puc_dockets','puc_sources',false,'degraded','Only 2 of 25 state PUC sources live (TX,VA); 3 WAF-blocked, 20 registered_pending'),
('POWER','local_news_power','jw_local_feed_sources:trade',false,'active','Energy/utility trade feeds within the local funnel'),
('PROJECTS','facility_registry','jw_signal_events:facility_registry_delta',true,'active','903 events, 0 null-state'),
('PROJECTS','permit_velocity','jw_signal_events:permit_velocity_mom_jurisdiction',false,'active','484 jurisdiction + 126 state events'),
('PROJECTS','state_incentives','jw_signal_events:incentive_filing',false,'active','111,256 events; per-source confidence tiering per FAR-341'),
('PROJECTS','local_news_business','jw_local_feed_sources:business_journal',false,'degraded','bizjournals.com (23 feeds) Cloudflare-403; BridgeTower titles robots-disallowed'),
('POLITICS','opposition_events','jw_signal_events:opposition_event',true,'degraded','ALL 84 rows carry state IS NULL - cannot be routed to a state edition until backfilled'),
('POLITICS','moratorium_inventory','jw_signal_events:moratorium_inventory_delta',false,'active','222 events, 0 null-state'),
('POLITICS','local_news_statehouse','jw_local_feed_sources:statehouse',true,'active','Statehouse/nonprofit tier - highest-yield class in the local funnel'),
('POLITICS','local_news_community','jw_local_feed_sources:community_platform',false,'active','Community/nonprofit newsrooms'),
('POLITICS','nextdoor','jw_source_candidates:nextdoor_partner',false,'planned','D13: official partner/API path only. No scraping of login-walled content.'),
('RESOURCES','water_facts','jw_signal_events:water_facts_delta',true,'degraded','318 of 1,724 rows carry state IS NULL'),
('RESOURCES','wtr_jts','jw_wtr_jts_staging',false,'active','Water JTS staging layer'),
('RESOURCES','local_news_rural','jw_local_feed_sources:rural_weekly',false,'active','Rural/weekly tier - siting and land-use coverage'),
('CONNECTIVITY','net_tier','FAR-360',true,'planned','Section is incubating; blocked on NET tier ingestion + licensing resolution')
on conflict (section_code, feed_key) do nothing;

-- Data Scout candidate register (D10). Every entry below was probed live on
-- 2026-07-31; the rationale records the observed HTTP behaviour, not a guess.
insert into jw_source_candidates
 (discovered_for_section, target_states, source_name, source_url, access_kind, est_coverage,
  est_cadence, licensing_risk, dark_states_closed, scout_rationale, status) values
('POLITICS', array['ALL'],'Nextdoor for Developers (official partner API)','https://developer.nextdoor.com/','api','national','continuous','requires_partnership',0,
 'D13: pursue via official partner/API path ONLY. Verified live 2026-07-31 (HTTP 200). Neighborhood-level sentiment + opposition signal is unreachable from RSS. NO scraping of login-walled content - registration/discovery only in this task; ingestion is gated on an executed partner agreement.','pending_review'),
('PROJECTS', array['ALL'],'American City Business Journals (bizjournals.com)','https://www.bizjournals.com/','api','national','daily','requires_partnership',0,
 'All 23 probed market feeds return Cloudflare 403 to server-side fetch. Highest-value per-metro capital/project coverage in the country. Needs a licensed feed or syndication deal - the URL pattern is correct, the block is policy.','pending_review'),
('PROJECTS', array['MT','WI','NE','SD','ND','OK','VA','AZ'],'Lee Enterprises (TownNews properties)','https://lee.net/','rss','multi_state','daily','tos_restricted',0,
 '20 titles return persistent HTTP 429 to datacenter egress even when throttled to 1.2s; richmond.com on the same CMS serves 50 items, so the block is per-domain bot policy, not the URL pattern. Retry from a residential/licensed path or negotiate access.','pending_review'),
('PROJECTS', array['ALL'],'Gannett / USA TODAY Network','https://www.gannett.com/','api','national','daily','requires_partnership',0,
 'All 18 probed rssfeeds.* endpoints return 404 - Gannett has retired public RSS network-wide. Confirmed against 4 additional /rss/ fallbacks, all 404. Only a licensed content API remains.','pending_review'),
('POLITICS', array['ALL'],'States Newsroom network','https://statesnewsroom.com/','rss','national','daily','attribution',0,
 'Nonprofit statehouse outlet in nearly every state on WordPress /feed/ - the single highest-yield class discovered (84% live, 100 items/feed). Republishing is CC-BY with attribution. Already activated in jw_local_feed_sources.','activated'),
('POWER', array['ALL'],'Utility Dive','https://www.utilitydive.com/feeds/news/','rss','national','daily','attribution',0,
 'National utility/interconnection trade feed, verified live (10 items). Complements the state PUC funnel where only 2 of 25 PUC sources are live.','approved'),
('POWER', array['ALL'],'Energy News Network','https://energynews.us/feed/','rss','national','daily','attribution',0,
 'Nonprofit energy trade desk with regional bureaus; useful where a state PUC source is WAF-blocked.','approved'),
('RESOURCES', array['ALL'],'Associated Press','https://www.ap.org/','api','national','continuous','requires_partnership',0,
 'apnews.com/hub/<state>.rss returns 404 - the public per-state hub feeds are gone. AP content requires a member/licensing agreement.','pending_review')
on conflict (source_url) do nothing;
