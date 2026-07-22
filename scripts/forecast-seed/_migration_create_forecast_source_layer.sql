-- Reference copy of the schema migration APPLIED via Supabase apply_migration
-- (name: create_forecast_source_layer, project ycadmmngkdhvpcsrcuaq).
-- apply_migration is the only production DDL write path; this file is for the record.
-- Approved verbatim by Myke 2026-07-21 (incl. jurisdiction FK amendment). Do not edit without re-approval.

create table forecast_sources (
  source_id            text primary key,
  source_name          text not null,
  publisher            text,
  jpas_tiers           text[],
  attribute_codes      text[],
  horizon_end_year     int,
  horizon_tier         text,
  cadence              text,
  latest_vintage       text,
  dc_specific          text,
  geography_scope      text,
  machine_access       text,
  revision_signal      text check (revision_signal in ('High','Medium','Low')),
  archive_recoverable  text,
  primary_url          text,
  archive_url          text,
  faraday_read         text,
  status               text default 'Cataloged',
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create table forecast_vintages (
  vintage_id        uuid primary key default gen_random_uuid(),
  source_id         text not null references forecast_sources(source_id),
  vintage_label     text not null,
  published_date    date,
  horizon_end_year  int,
  source_url        text,
  archive_url       text,
  retrieved_at      timestamptz default now(),
  notes             text,
  unique (source_id, vintage_label)
);

create table forecast_observations (
  observation_id  uuid primary key default gen_random_uuid(),
  vintage_id      uuid not null references forecast_vintages(vintage_id),
  source_id       text not null references forecast_sources(source_id),
  jurisdiction_id uuid references jurisdictions(id),
  attribute_code  text,
  target_year     int not null,
  metric_name     text not null,
  value           numeric,
  unit            text,
  scenario        text default 'base',
  confidence      text,
  method          text default 'manual',
  extracted_at    timestamptz default now(),
  notes           text
);

create view forecast_revisions as
select
  o.source_id, o.jurisdiction_id, o.attribute_code,
  o.target_year, o.scenario, o.metric_name,
  v.vintage_label, v.published_date, o.value,
  o.value - lag(o.value) over w  as delta_vs_prior_vintage,
  v.published_date - lag(v.published_date) over w as days_between_vintages
from forecast_observations o
join forecast_vintages v using (vintage_id)
window w as (
  partition by o.source_id, o.jurisdiction_id, o.attribute_code, o.target_year, o.scenario, o.metric_name
  order by v.published_date
);
