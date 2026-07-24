-- CMD-1.0 (CC-COMPANY-ENRICH-1.0) Wave A — canonical company master-data spine.
-- Project ycadmmngkdhvpcsrcuaq. ADDITIVE ONLY. Does not touch public.tracking_companies.
-- RLS enabled on every table with an explicit deny-all (service-role-only) policy.
--   subscriber_tier_gate is 'internal' everywhere this pass (Myke: internal-only).
-- Governance: named migration; zero fabricated data; every company_fact carries provenance.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Name normalization helper. IMMUTABLE + deterministic so it can back a unique
-- index. lower -> strip leading "the" -> punctuation to space -> strip corporate
-- suffixes (two passes for stacked suffixes) -> collapse whitespace. ASCII-only
-- by design (accents are absent from this roster; kept truly IMMUTABLE for the
-- unique index rather than depending on the STABLE unaccent dictionary).
-- ---------------------------------------------------------------------------
create or replace function public.cmd_normalize_name(p text)
returns text
language sql
immutable
parallel safe
as $$
  with s0 as (select lower(coalesce(p,'')) t),
  s1 as (select regexp_replace(t, '^\s*the\s+', '')                          t from s0),
  s2 as (select regexp_replace(t, '[^a-z0-9]+', ' ', 'g')                    t from s1),
  s3 as (select regexp_replace(t, '\s+(incorporated|inc|llc|ltd|limited|corp|corporation|plc|sa|ag|gmbh|nv|bv|co|company|companies|holdings|holding|group|lp|llp|sarl|pte|pty)\s*$', '') t from s2),
  s4 as (select regexp_replace(t, '\s+(incorporated|inc|llc|ltd|limited|corp|corporation|plc|sa|ag|gmbh|nv|bv|co|company|companies|holdings|holding|group|lp|llp)\s*$', '')          t from s3),
  s5 as (select btrim(regexp_replace(t, '\s+', ' ', 'g'))                    t from s4)
  select nullif(t, '') from s5;
$$;
comment on function public.cmd_normalize_name(text) is 'CMD-1.0 deterministic company-name normalizer (IMMUTABLE; backs companies.name_normalized unique index and alias matching).';

-- ---------------------------------------------------------------------------
-- companies — canonical entity spine. One row per real-world entity.
-- entity_class is a text column with a CHECK (NOT a Postgres enum type yet —
-- taxonomy is an always-human carve-out; enum promotion deferred to a follow-up
-- even though Myke approved the value list, so the taxonomy stays cheap to amend).
-- ---------------------------------------------------------------------------
create table public.companies (
  company_uid           text primary key default ('cmp_' || encode(extensions.gen_random_bytes(8), 'hex')),
  canonical_name        text not null,
  name_normalized       text not null,
  slug                  text unique,
  public_id             text unique,
  entity_class          text not null default 'unclassified'
    check (entity_class in (
      'operator','developer','hyperscaler','enterprise_end_user',
      'utility_iou','utility_coop','utility_municipal','municipality','regulator',
      'standards_body','investor_pe','oem_supply_chain','epc_construction',
      'advisory_services','association','academic','media','unclassified')),
  player_classification text,
  company_type          text,
  ownership_public_private text,
  hq_location_raw       text,
  hq_country            text,
  ticker                text,
  website_url           text,
  linkedin_url          text,
  nvidia_dsx_partner    boolean,
  logo_url              text,
  svg_logo_url          text,
  svg_logo_hosted_url   text,
  logo_lockup_url       text,
  faraday_read          text,          -- editorial; mirrored from Airtable only, never generated
  editorial_owner       text,          -- byline routing; unpopulated pending Myke rules
  status                text default 'active',
  identity_source       text,          -- 'airtable' | 'tracking_companies'
  airtable_record_id    text unique,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create unique index companies_name_normalized_key on public.companies (name_normalized);
create index companies_entity_class_idx on public.companies (entity_class);
create index companies_name_trgm_idx on public.companies using gin (name_normalized gin_trgm_ops);
comment on table public.companies is 'CMD-1.0 canonical entity spine. entity_class discriminates the mixed roster (companies, utilities, municipalities, regulators, ...).';

-- ---------------------------------------------------------------------------
-- company_aliases — many aliases -> one company. Trigram/fuzzy links land here
-- with approved=false and are NEVER used to resolve a company until approved.
-- ---------------------------------------------------------------------------
create table public.company_aliases (
  alias_id         text primary key default ('cma_' || encode(extensions.gen_random_bytes(8), 'hex')),
  company_uid      text not null references public.companies(company_uid) on delete cascade,
  alias_raw        text not null,
  alias_normalized text not null,
  alias_source     text not null check (alias_source in ('airtable','jw_facilities','jw_facility_operators','tracking_companies','manual')),
  match_method     text not null check (match_method in ('exact','normalized','alias','trigram','manual')),
  match_confidence numeric,
  approved         boolean not null default false,
  created_at       timestamptz default now()
);
create index company_aliases_uid_idx  on public.company_aliases (company_uid);
create index company_aliases_norm_idx on public.company_aliases (alias_normalized);
create unique index company_aliases_uniq on public.company_aliases (company_uid, alias_normalized, alias_source);

-- ---------------------------------------------------------------------------
-- company_attribute_registry — the written attribute catalog (registration != population).
-- ---------------------------------------------------------------------------
create table public.company_attribute_registry (
  attribute_code       text primary key,
  label                text not null,
  description          text,
  data_type            text not null,
  unit                 text,
  tier                 text not null check (tier in ('T1','T2','T3')),
  category             text,
  source_class         text,
  subscriber_tier_gate text not null default 'internal' check (subscriber_tier_gate in ('internal','signal','core','premier')),
  is_vendor_dependent  boolean not null default false,
  is_derivable         boolean not null default false,
  populated_count      integer default 0,
  notes                text,
  created_at           timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- company_facts — every fact carries provenance. Enforced by CHECK, not convention.
-- ---------------------------------------------------------------------------
create table public.company_facts (
  fact_id        text primary key default ('cmf_' || encode(extensions.gen_random_bytes(8), 'hex')),
  company_uid    text not null references public.companies(company_uid) on delete cascade,
  attribute_code text not null references public.company_attribute_registry(attribute_code),
  value_text     text,
  value_num      numeric,
  value_bool     boolean,
  value_date     date,
  value_jsonb    jsonb,
  source_name    text not null,
  source_url     text,
  source_class   text,
  as_of          date not null,
  confidence     text not null check (confidence in ('high','medium','low')),
  method_note    text,
  verified_at    date,
  verified_by    text,
  created_at     timestamptz default now(),
  constraint company_facts_provenance_ck check (source_name is not null and as_of is not null and confidence is not null),
  constraint company_facts_uniq unique (company_uid, attribute_code, as_of, source_name)
);
create index company_facts_uid_idx  on public.company_facts (company_uid);
create index company_facts_attr_idx on public.company_facts (attribute_code);

-- ---------------------------------------------------------------------------
-- company_relationships — typed, directional, dated counterparty graph.
-- Unresolved counterparties keep their raw name; all links start approved=false.
-- ---------------------------------------------------------------------------
create table public.company_relationships (
  rel_id             text primary key default ('cmr_' || encode(extensions.gen_random_bytes(8), 'hex')),
  from_company_uid   text not null references public.companies(company_uid) on delete cascade,
  to_company_uid     text references public.companies(company_uid) on delete cascade,
  to_company_name_raw text,
  rel_type           text not null check (rel_type in ('tenant_of','operator_for','investor_in','parent_of','jv_with','supplier_to','utility_serving','developer_for','acquired')),
  as_of_start        date,
  as_of_end          date,
  source_name        text,
  source_url         text,
  confidence         text,
  approved           boolean not null default false,
  created_at         timestamptz default now()
);
create index company_relationships_from_idx on public.company_relationships (from_company_uid);
create index company_relationships_to_idx   on public.company_relationships (to_company_uid);

-- ---------------------------------------------------------------------------
-- RLS: enabled on all five, explicit deny-all for anon + authenticated.
-- The service role bypasses RLS, so these tables are service-role-only (internal).
-- ---------------------------------------------------------------------------
alter table public.companies                 enable row level security;
alter table public.company_aliases           enable row level security;
alter table public.company_attribute_registry enable row level security;
alter table public.company_facts             enable row level security;
alter table public.company_relationships     enable row level security;

create policy cmd_companies_service_only    on public.companies                 as restrictive for all to anon, authenticated using (false) with check (false);
create policy cmd_aliases_service_only      on public.company_aliases           as restrictive for all to anon, authenticated using (false) with check (false);
create policy cmd_registry_service_only     on public.company_attribute_registry as restrictive for all to anon, authenticated using (false) with check (false);
create policy cmd_facts_service_only        on public.company_facts             as restrictive for all to anon, authenticated using (false) with check (false);
create policy cmd_rel_service_only          on public.company_relationships     as restrictive for all to anon, authenticated using (false) with check (false);
