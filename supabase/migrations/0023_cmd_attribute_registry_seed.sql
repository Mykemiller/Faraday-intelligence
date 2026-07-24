-- CMD-1.0 — seed company_attribute_registry (registration != population).
-- Every attribute: code, label, data_type, tier, source_class, subscriber_tier_gate,
-- is_vendor_dependent, is_derivable. subscriber_tier_gate = 'internal' everywhere this
-- pass (Myke: internal-only). populated_count refreshed by 0028 after population.
-- Vendor-dependent §5 out-of-scope attributes are registered with is_vendor_dependent=true
-- so the gap is visible and honest, never quietly omitted.

insert into public.company_attribute_registry
  (attribute_code, label, description, data_type, unit, tier, category, source_class, subscriber_tier_gate, is_vendor_dependent, is_derivable, notes)
values
-- Tier 1 — Identity & Ownership (Airtable + internal)
('legal_name','Legal Name','Registered legal entity name','text',null,'T1','identity','airtable','internal',false,false,null),
('company_type','Company Type / Role','Company type/role classification','text',null,'T1','identity','airtable','internal',false,false,null),
('ownership_structure','Ownership Structure','Ownership structure detail','text',null,'T1','identity','airtable','internal',false,false,null),
('ownership_public_private','Public / Private / Non-Profit','Public/private/non-profit status','text',null,'T1','identity','airtable','internal',false,false,'stored on companies.ownership_public_private'),
('ultimate_parent','Ultimate Parent','Ultimate parent entity','text',null,'T1','identity','airtable+internal','internal',false,true,null),
('hq_location_raw','HQ Location','Raw HQ location string','text',null,'T1','identity','airtable','internal',false,false,'stored on companies.hq_location_raw'),
('hq_country','HQ Country','Derived HQ country','text',null,'T1','identity','airtable+internal','internal',false,true,null),
('ticker','Stock Ticker','Public equity ticker','text',null,'T1','identity','airtable','internal',false,false,'stored on companies.ticker'),
('website_url','Website URL','Primary website','text',null,'T1','identity','airtable','internal',false,false,'stored on companies.website_url'),
('linkedin_url','LinkedIn URL','LinkedIn company page','text',null,'T1','identity','airtable','internal',false,false,'stored on companies.linkedin_url'),
-- Tier 1 — Scale & Footprint (Wave C derived from jw_facilities)
('facility_count_active','Active Facility Count','Count of operational facilities','integer',null,'T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities status=operational'),
('facility_count_pipeline','Pipeline Facility Count','Count of permitted/construction/acquisition facilities','integer',null,'T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities status in (permitted,construction,acquisition)'),
('operating_capacity_mw_derived','Operating Capacity (MW, derived)','Sum capacity_mw of operational facilities','numeric','MW','T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities'),
('pipeline_capacity_mw_derived','Pipeline Capacity (MW, derived)','Sum capacity_mw of pipeline facilities','numeric','MW','T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities'),
('site_acres_total','Total Site Acres','Sum of site_acres across facilities','numeric','acres','T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities'),
('building_sqft_total','Total Building Sqft','Sum of building_sqft across facilities','numeric','sqft','T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities'),
('footprint_states','Footprint States','Distinct US states with facilities','jsonb',null,'T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities.state_abbr'),
('footprint_countries','Footprint Countries','Distinct countries with facilities','jsonb',null,'T1','footprint','faraday_internal','internal',false,true,'derived: jw_facilities.country_code'),
('footprint_regions','Footprint Regions','Distinct regions with facilities','jsonb',null,'T1','footprint','faraday_internal','internal',false,true,'derived via jurisdictions.region'),
-- Tier 1 — Commercial (Airtable, partial)
('annual_revenue_raw','Annual Revenue (raw)','Reported annual revenue, raw text','text',null,'T1','commercial','airtable','internal',false,false,'keep raw; do not parse-fabricate'),
('market_cap_raw','Market Cap / Valuation (raw)','Market cap or valuation, raw text','text',null,'T1','commercial','airtable','internal',false,false,null),
('capex_guided_raw','Capex Guided (raw)','Annual guided capex, raw text','text',null,'T1','commercial','airtable','internal',false,false,null),
('total_funding_raised_raw','Total Funding Raised (raw)','Total funding raised, raw text','text',null,'T1','commercial','airtable','internal',false,false,null),
('employees_approx','Employees (approx)','Approximate employee count','text',null,'T1','commercial','airtable','internal',false,false,null),
('primary_target_customers','Primary Target Customers','Primary target customer segments','text',null,'T1','commercial','airtable','internal',false,false,null),
('anchor_tenants','Anchor Tenants','Anchor tenants','jsonb',null,'T1','commercial','airtable+internal','internal',false,true,'also derivable from jw_facilities.tenant_names[]'),
-- Tier 1 — Technical & Energy
('cooling_architecture','Cooling Architecture','Normalized cooling approaches','jsonb',null,'T1','technical','airtable','internal',false,false,'normalized from Airtable Cooling Approach free text'),
('power_sourcing_strategy','Power Sourcing Strategy','Normalized power sourcing strategy','text',null,'T1','technical','airtable','internal',false,false,'normalized from Airtable Energy Strategy'),
('power_source_mix','Power Source Mix','Distribution of facility power sources','jsonb',null,'T1','technical','faraday_internal','internal',false,true,'derived: jw_facilities.power_source (currently 100% NULL -> 0%)'),
-- Tier 1 — Leadership
('ceo_name','CEO','Chief Executive Officer','text',null,'T1','leadership','airtable','internal',false,false,null),
('cfo_name','CFO','Chief Financial Officer','text',null,'T1','leadership','airtable','internal',false,false,null),
('cto_name','CTO','Chief Technology Officer','text',null,'T1','leadership','airtable','internal',false,false,null),
-- Tier 2 — Grid, Capital, ESG (partial)
('primary_utility_partners','Primary Utility Partners','Serving utilities','jsonb',null,'T2','grid','airtable+internal','internal',false,true,null),
('interconnect_queue_mw','Interconnect Queue MW','MW in interconnect queue','numeric','MW','T2','grid','airtable','internal',false,false,null),
('onsite_generation_mw','Onsite Generation MW','Behind-the-meter generation capacity','numeric','MW','T2','grid','airtable','internal',false,false,null),
('pe_debt_backers','PE / Debt Backers','Private-equity or debt backers','jsonb',null,'T2','capital','airtable','internal',false,false,null),
('historical_ma_events','Historical M&A Events','M&A history','jsonb',null,'T2','capital','airtable','internal',false,false,null),
('net_zero_target_year','Net-Zero Target Year','Stated net-zero target year','integer',null,'T2','esg','airtable','internal',false,false,null),
('compliance_certifications','Compliance Certifications','Held certifications','jsonb',null,'T2','esg','airtable','internal',false,false,null),
-- Faraday-specific (§7)
('entity_class','Entity Class','CMD entity-class discriminator','text',null,'T1','faraday','faraday_internal','internal',false,true,'stored on companies.entity_class; §7.1'),
('jurisdiction_exposure','Jurisdiction Exposure (JPS)','MW-weighted mean JPS, posture distribution, cautious/restricted facility count','jsonb',null,'T1','faraday','faraday_internal','internal',false,true,'§7.2 join jw_facilities->jurisdictions; Faraday-unique'),
('idf_domain_exposure','IDF Domain Exposure','Material IDF domains','jsonb',null,'T2','faraday','airtable','internal',false,false,'§7.3 Airtable Primary Domain(s)'),
('idf_subdomain_exposure','IDF Sub-Domain Exposure','Material IDF sub-domains','jsonb',null,'T2','faraday','airtable','internal',false,false,'§7.3'),
('theme_exposure','Theme Exposure','Material active Themes','jsonb',null,'T2','faraday','airtable','internal',false,false,'§7.3'),
('signal_density_30d','Signal Density 30d','Classified signals/artifacts referencing company, 30d','integer',null,'T2','faraday','faraday_internal','internal',false,true,'§7.4'),
('signal_density_90d','Signal Density 90d','Classified signals/artifacts referencing company, 90d','integer',null,'T2','faraday','faraday_internal','internal',false,true,'§7.4'),
('signal_density_365d','Signal Density 365d','Classified signals/artifacts referencing company, 365d','integer',null,'T2','faraday','faraday_internal','internal',false,true,'§7.4'),
('prognostication_exposure','Prognostication Exposure','Open/resolved predictions naming company','jsonb',null,'T2','faraday','airtable','internal',false,false,'§7.5'),
('constraint_exposure','Constraint Exposure','Binding-constraint vector','jsonb',null,'T2','faraday','airtable+internal','internal',false,false,'§7.6'),
('supply_chain_position','Supply-Chain Position','Position in the stack','jsonb',null,'T2','faraday','airtable+internal','internal',false,false,'§7.7'),
('btm_posture','Behind-the-Meter Posture','Structured BTM generation strategy','text',null,'T1','faraday','airtable','internal',false,false,'§7.8 normalized enum from Energy Strategy'),
('opposition_exposure','Opposition Exposure','Community-opposition projects linked to developer','jsonb',null,'T2','faraday','faraday_internal','internal',false,true,'§7.9 Community Opposition Registry; Faraday-unique'),
('legislation_exposure','Legislation Exposure','States with tracked bills affecting footprint','jsonb',null,'T2','faraday','airtable+internal','internal',false,true,'§7.10'),
('coverage_status','Coverage Status','Is this company actually crawled: covered/partial/uncovered','text',null,'T1','faraday','faraday_internal','internal',false,true,'§7.11 operational-honesty metric'),
('geopolitical_flag','Geopolitical Flag','Export-control / national-security relevance','boolean',null,'T2','faraday','airtable','internal',false,false,'§7.12 seed from DC Providers Enriched China Flag; flag only'),
('brand_assets','Brand Assets','Logo / SVG logo / hosted SVG / lockup URLs','jsonb',null,'T1','faraday','airtable','internal',false,true,'§7.13 stored on companies logo columns; Daily Challenge Logo Match dependency'),
('public_id','Public ID','Stable immutable subscriber-facing id','text',null,'T1','faraday','faraday_internal','internal',false,true,'§7.14 frozen at assignment'),
('slug','Slug','Stable subscriber-facing slug','text',null,'T1','faraday','faraday_internal','internal',false,true,'§7.14 never recomputed'),
('editorial_owner','Editorial Owner','Byline routing persona (Gil / Mach)','text',null,'T2','faraday','manual','internal',false,false,'§7.15 unpopulated pending Myke routing rules'),
('nvidia_dsx_partner','NVIDIA DSX Partner','NVIDIA DSX partner flag','boolean',null,'T2','faraday','airtable','internal',false,false,'stored on companies.nvidia_dsx_partner'),
('faraday_read','Faraday Read','Editorial market position / Faraday read','text',null,'T1','faraday','airtable','internal',false,false,'editorial; mirror only, never generate'),
('major_initiatives','Major Initiatives','Major initiatives','text',null,'T2','faraday','airtable','internal',false,false,null),
('latest_faraday_signal','Latest Faraday Signal','Latest Faraday signal note','text',null,'T2','faraday','airtable','internal',false,false,null),
('mw_total_airtable','MW Total (Airtable-declared)','Airtable-declared total MW','numeric','MW','T1','faraday','airtable','internal',false,false,'kept separate from operating_capacity_mw_derived (§3)'),
('mw_live_airtable','MW Live (Airtable-declared)','Airtable-declared live MW','numeric','MW','T1','faraday','airtable','internal',false,false,'kept separate from derived MW (§3)'),
-- Vendor-dependent — OUT of scope this pass (registered for honest 0% gap; §5)
('portfolio_occupancy_rate','Portfolio Occupancy Rate','Portfolio occupancy %','numeric','%','T2','vendor','vendor','internal',true,false,'DataCenterHawk/DC Byte/Uptime territory — not populated'),
('average_rent_rate_kw_month','Avg Rent Rate ($/kW/mo)','Average rent rate','numeric','$/kW/mo','T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated'),
('average_max_rack_density_kw','Avg Max Rack Density (kW)','Average max rack density','numeric','kW','T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated'),
('average_portfolio_pue','Avg Portfolio PUE','Average PUE','numeric',null,'T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated'),
('land_bank_acres','Land Bank Acres (company-level)','Company-level land-bank total','numeric','acres','T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated'),
('total_enterprise_value','Total Enterprise Value','Enterprise value','numeric','USD','T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated'),
('max_floor_load_capacity','Max Floor Load Capacity','Max floor load','numeric',null,'T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated'),
('meet_me_room_count','Meet-Me Room Count','MMR count','integer',null,'T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated'),
('connectivity_detail','Connectivity Detail','MMR / on-ramp / subsea connectivity detail','jsonb',null,'T2','vendor','vendor','internal',true,false,'vendor-dependent — not populated');
