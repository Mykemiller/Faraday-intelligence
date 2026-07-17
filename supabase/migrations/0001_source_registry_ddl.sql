-- CC-SOURCE-SCALE-500 §5.3 — unified source registry (Myke-approved 2026-07-17)
create table if not exists source_registry (
  source_key            text primary key,
  name                  text not null,
  provider              text,
  url                   text not null default '',
  feed_url              text,
  access_method         text not null default 'json_api' check (access_method in
                          ('rss','atom','json_api','html','bulk_file','webhook','manual')),
  cadence               text not null check (cadence in
                          ('hourly','daily','weekly','event_driven','archival_refresh','one_time')),
  confidence_cap        text not null default 'SRC' check (confidence_cap in ('VRF','SRC','INF','EST')),
  license               text not null default 'unreviewed',
  license_status        text not null default 'unreviewed' check (license_status in
                          ('cleared','attribution_required','gated','blocked','unreviewed')),
  idf_domains           text[] not null default '{}',
  scope                 text,
  countable             boolean not null default false,
  status                text not null default 'registered' check (status in
                          ('registered','active','error','paused','retired')),
  subsystem             text,
  legacy_ref            jsonb,
  auto_id               text,
  fetcher               text not null default 'source-poller',
  fetch_config          jsonb not null default '{}',
  cursor                jsonb not null default '{}',
  etag                  text,
  last_modified         text,
  last_fetch_at         timestamptz,
  last_ok_at            timestamptz,
  last_artifact_at      timestamptz,
  consecutive_failures  int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_source_registry_status on source_registry (status);
create index if not exists idx_source_registry_countable on source_registry (countable) where countable;

alter table source_registry enable row level security;
create policy "service role only" on source_registry
  as permissive for all to service_role using (true) with check (true);
revoke all on source_registry from anon, authenticated;

create or replace view v_source_census
with (security_invoker = true) as
select
  count(*) filter (where countable)                                        as registered,
  count(*) filter (where countable and status = 'active'
                   and last_artifact_at > now() - interval '30 days')      as active_30d,
  count(*) filter (where countable and status = 'active'
                   and cadence in ('hourly','daily')
                   and last_artifact_at > now() - interval '30 days')      as daily_or_better_30d,
  count(*) filter (where countable and status = 'active' and cadence = 'hourly'
                   and last_artifact_at > now() - interval '30 days')      as hourly_30d
from source_registry;
revoke all on v_source_census from anon, authenticated;