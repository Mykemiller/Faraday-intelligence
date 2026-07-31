-- CC-STATE-BRIEF-SCAFFOLD-1.0 / Work Package A
-- State Brief Agent Network: section-level brief persistence.
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-07-31 as `state_brief_section_architecture`.
--
-- D5: read-only from the signal tables. This migration writes nothing to
-- jpas_attributes, jw_briefings, or any JPS column.

-- 1. SECTION REGISTRY (D6)
create table if not exists jw_brief_section_registry (
  section_code      text primary key,
  section_name      text        not null,
  display_order     int         not null,
  base_target_words int         not null,
  min_words         int         not null,
  max_words         int         not null,
  jpas_anchor_tiers text[]      not null default '{}',
  cadence           text        not null default 'weekly'
    check (cadence in ('weekly','episodic','session','monthly')),
  status            text        not null default 'active'
    check (status in ('active','incubating','retired')),
  activation_gate   text,
  created_at        timestamptz not null default now(),
  constraint budget_sane check (min_words <= base_target_words
                                and base_target_words <= max_words)
);

-- The 5 active sections sum to exactly 1,000 base words (D1/D7).
insert into jw_brief_section_registry
  (section_code, section_name, display_order, base_target_words,
   min_words, max_words, jpas_anchor_tiers, cadence, status, activation_gate)
values
  ('READ','The Read',1, 90, 70,130,'{}','weekly','active',null),
  ('POWER','Power & Interconnection',2,230,120,340,'{PWR}','weekly','active',null),
  ('PROJECTS','Projects & Capital',3,230,120,340,'{}','weekly','active',null),
  ('POLITICS','Politics & Community',4,230,120,340,'{REG,COM,INC}','weekly','active',null),
  ('RESOURCES','Resources & Siting',5,220,110,320,'{WTR,RSC,ENV,LBR}','weekly','active',null),
  ('CONNECTIVITY','Connectivity & Fiber',6,0,0,0,'{NET}','weekly','incubating',
   'FAR-360 NET tier ingestion + licensing resolution')
on conflict (section_code) do nothing;

-- 2. FEED BINDINGS
create table if not exists jw_brief_feed_bindings (
  id            uuid primary key default gen_random_uuid(),
  section_code  text not null references jw_brief_section_registry(section_code),
  feed_key      text not null,
  source_ref    text not null,
  state_filter  text,
  is_load_bearing boolean not null default false,
  status        text not null default 'active'
    check (status in ('active','degraded','blocked','planned')),
  notes         text,
  unique (section_code, feed_key)
);

-- 3. EDITION ENVELOPE
create table if not exists jw_brief_editions (
  id                uuid primary key default gen_random_uuid(),
  jurisdiction_id   uuid not null references jurisdictions(id),
  state_abbr        text not null,
  edition_week      date not null,
  total_word_budget int  not null default 1000,
  words_rendered    int,
  sections_rendered int,
  sections_dark     int,
  sections_failed   int not null default 0,
  status            text not null default 'building'
    check (status in ('building','audited','published','held','failed')),
  published_at      timestamptz,
  model             text,
  created_at        timestamptz not null default now(),
  unique (jurisdiction_id, edition_week)
);
create index if not exists idx_brief_ed_state_week
  on jw_brief_editions (state_abbr, edition_week desc);

-- 4. SECTION CONTENT
create table if not exists jw_brief_sections (
  id                uuid primary key default gen_random_uuid(),
  edition_id        uuid not null references jw_brief_editions(id) on delete cascade,
  section_code      text not null references jw_brief_section_registry(section_code),
  content           text,
  words_allocated   int  not null,
  words_actual      int,
  coverage_label    text not null
    check (coverage_label in ('documented','corroborated','single_source','quiet','dark')),
  audit_state       text not null default 'pending'
    check (audit_state in ('pending','passed','failed')),
  -- D9 + D12: a dark section and a failed section are both silent to
  -- subscribers but still present for ops reporting.
  renders           boolean generated always as
                      (coverage_label <> 'dark'
                       and content is not null
                       and audit_state = 'passed') stored,
  feed_fingerprint  text,
  last_material_change date,
  carry_forward_count int not null default 0,
  prior_section_id  uuid references jw_brief_sections(id),
  content_hash      text,
  generated_at      timestamptz not null default now(),
  unique (edition_id, section_code)
);
create index if not exists idx_brief_sec_code_label
  on jw_brief_sections (section_code, coverage_label);
create index if not exists idx_brief_sec_fingerprint
  on jw_brief_sections (feed_fingerprint);

-- 5. AUDITOR SHARDS (D8/D11 - 10 shards)
create table if not exists jw_brief_auditor_shards (
  id            uuid primary key default gen_random_uuid(),
  auditor_key   text not null,
  section_code  text not null references jw_brief_section_registry(section_code),
  region        text not null check (region in ('EAST','WEST')),
  state_abbrs   text[] not null,
  is_active     boolean not null default true,
  unique (auditor_key)
);

-- 6. AUDIT VERDICTS (D2)
create table if not exists jw_brief_audits (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references jw_brief_sections(id) on delete cascade,
  auditor_key     text not null,
  verdict         text not null
    check (verdict in ('pass','pass_with_cuts','fail_uncited','fail_stale','fail_contradiction')),
  claims_checked  int,
  claims_cut      int,
  assigned_label  text,
  notes           text,
  audited_at      timestamptz not null default now()
);

-- 7. LOCAL FEED SOURCES (Work Package B target)
create table if not exists jw_local_feed_sources (
  id             uuid primary key default gen_random_uuid(),
  state_abbr     text not null,
  outlet_name    text not null,
  outlet_class   text not null
    check (outlet_class in ('metro_daily','statehouse','public_radio',
                            'business_journal','trade','rural_weekly',
                            'tv_affiliate','community_platform')),
  feed_url       text not null,
  access_kind    text not null default 'rss'
    check (access_kind in ('rss','atom','json','html_scrape','api','partner')),
  status         text not null default 'registered'
    check (status in ('registered','live','degraded','blocked','retired')),
  robots_ok      boolean,
  tos_reviewed   boolean not null default false,
  verified_at    timestamptz,
  item_count_at_verify int,
  last_fetched_at timestamptz,
  last_error     text,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (state_abbr, feed_url)
);
create index if not exists idx_local_feed_state_status
  on jw_local_feed_sources (state_abbr, status);

-- 8. SOURCE CANDIDATES (Data Scout - D10)
create table if not exists jw_source_candidates (
  id              uuid primary key default gen_random_uuid(),
  discovered_for_section text references jw_brief_section_registry(section_code),
  target_states   text[],
  source_name     text not null,
  source_url      text not null,
  access_kind     text,
  est_coverage    text check (est_coverage in ('national','multi_state','single_state','local')),
  est_cadence     text,
  licensing_risk  text not null default 'unassessed'
    check (licensing_risk in ('unassessed','open','attribution','tos_restricted',
                              'proprietary','requires_partnership')),
  dark_states_closed int,
  scout_rationale text,
  status          text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected','deferred','activated')),
  reviewed_by     text,
  reviewed_at     timestamptz,
  discovered_at   timestamptz not null default now(),
  unique (source_url)
);

-- RLS: deny-all / service-role-only. Every pre-existing jw_* table (26 of 26)
-- carries this posture; without it these 8 tables would be anon-readable
-- through PostgREST. NOT in the original DDL spec - added deliberately.
alter table jw_brief_section_registry enable row level security;
alter table jw_brief_feed_bindings    enable row level security;
alter table jw_brief_editions         enable row level security;
alter table jw_brief_sections         enable row level security;
alter table jw_brief_auditor_shards   enable row level security;
alter table jw_brief_audits           enable row level security;
alter table jw_local_feed_sources     enable row level security;
alter table jw_source_candidates      enable row level security;

-- 9. OPS VIEW: dark register (D9)
-- security_invoker=true so the views honour the base tables' RLS instead of
-- running as owner (which would re-expose the rows the RLS above just fenced).
create or replace view v_jw_brief_dark_register
with (security_invoker = true) as
select e.state_abbr,
       s.section_code,
       e.edition_week,
       s.coverage_label,
       b.feed_key,
       b.status as feed_status,
       b.notes
from jw_brief_sections s
join jw_brief_editions e on e.id = s.edition_id
left join jw_brief_feed_bindings b
       on b.section_code = s.section_code and b.is_load_bearing
where s.coverage_label = 'dark';

-- 10. OPS VIEW: failed-section register (D12)
create or replace view v_jw_brief_failed_sections
with (security_invoker = true) as
select e.state_abbr, e.edition_week, s.section_code,
       a.verdict, a.claims_checked, a.claims_cut, a.notes
from jw_brief_sections s
join jw_brief_editions e on e.id = s.edition_id
join jw_brief_audits a on a.section_id = s.id
where s.audit_state = 'failed';

-- 11. RUNTIME VIEW: county-page injection
create or replace view v_jw_state_brief_current
with (security_invoker = true) as
select e.state_abbr, e.edition_week, s.section_code,
       r.section_name, r.display_order, s.content,
       s.coverage_label, s.words_actual
from jw_brief_sections s
join jw_brief_editions e on e.id = s.edition_id
join jw_brief_section_registry r on r.section_code = s.section_code
where s.renders
  and e.status = 'published'
  and e.edition_week = (select max(edition_week) from jw_brief_editions e2
                        where e2.state_abbr = e.state_abbr and e2.status='published')
order by e.state_abbr, r.display_order;
