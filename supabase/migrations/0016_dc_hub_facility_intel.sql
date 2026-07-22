-- ============================================================================
-- 0016_dc_hub_facility_intel  (DRAFT — do not apply without Myke go)
-- ----------------------------------------------------------------------------
-- DC Hub facility intelligence cache for the shared Faraday data plane
-- (Supabase project ycadmmngkdhvpcsrcuaq). This is the read-model the
-- storefronts (Briefing Library, Jurisdiction Watch, …) consume — it is NOT a
-- hot-path call into DC Hub. A cron'd edge function (`dc-hub-sync`) mirrors DC
-- Hub's facility layer into `dc_facilities`; storefronts read the anon-facing
-- view / RPCs below. Mirrors the Briefing Library read-model + content-address
-- precedent (hash → skip-unchanged) and the source_registry RLS posture
-- (service-role writes; anon SELECT is the read contract, deny-by-default RLS
-- is the backstop).
--
-- Source: DC Hub (dchub.cloud), licensed CC-BY-4.0 — ATTRIBUTION REQUIRED.
--   Every readable row carries source_attribution so downstream surfaces can
--   cite "DC Hub, dchub.cloud". Do NOT persist paid-tier-gated DC Hub fields
--   into `raw`: this table is anon-readable, and re-publishing gated fields
--   would breach DC Hub's tier terms. The sync writes only the shareable
--   (free/identified-tier) projection.
--
-- Boundaries: this migration creates ONLY dc_facilities,
--   dc_facility_unmapped_operators, the dc_facilities_public view, and the
--   three read RPCs. It references (does not create) tracking_companies, which
--   already exists in the live project.
-- ============================================================================

begin;

-- ── Facility cache ──────────────────────────────────────────────────────────
create table if not exists dc_facilities (
  facility_id          text primary key,                 -- DC Hub id/slug, e.g. equinix-dc1-ashburn
  slug                 text unique,
  name                 text not null,
  operator             text,                             -- raw operator string from DC Hub
  operator_company_id  text references tracking_companies(company_id),  -- best-effort resolved link (nullable)
  address              text,
  city                 text,
  state                text,                             -- state / region
  country              text,                             -- ISO 3166-1 alpha-2
  market               text,                             -- DCPI market
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  total_power_mw       numeric,
  used_power_mw        numeric,
  headroom_mw          numeric generated always as
                         (greatest(coalesce(total_power_mw, 0) - coalesce(used_power_mw, 0), 0)) stored,
  cooling_type         text,
  fiber_provider_count integer,
  fiber_carriers       text[] not null default '{}',
  commission_year      integer,
  operational_status   text not null default 'unknown'
                         check (operational_status in
                           ('operational','under_construction','planned','decommissioned','unknown')),
  dcpi_verdict         text,
  dcpi_market_rank     integer,
  tenants              text[] not null default '{}',
  raw                  jsonb not null default '{}'::jsonb,  -- shareable projection only (see header)
  content_hash         text not null,                    -- fingerprint(salient fields) → skip-unchanged re-sync
  source               text not null default 'dc_hub',
  source_license       text not null default 'CC-BY-4.0',
  source_attribution   text not null default 'DC Hub, dchub.cloud',
  dc_hub_retrieved_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_dc_facilities_country  on dc_facilities (country);
create index if not exists idx_dc_facilities_market   on dc_facilities (market);
create index if not exists idx_dc_facilities_status   on dc_facilities (operational_status);
create index if not exists idx_dc_facilities_operator on dc_facilities (operator_company_id);
-- keyset pagination on (total_power_mw desc nulls last, facility_id desc)
create index if not exists idx_dc_facilities_power    on dc_facilities (total_power_mw desc nulls last, facility_id desc);
create index if not exists idx_dc_facilities_carriers on dc_facilities using gin (fiber_carriers);
create index if not exists idx_dc_facilities_tenants  on dc_facilities using gin (tenants);

-- Operator strings that did not resolve to tracking_companies. Mirrors the
-- briefing_library unmapped_links pattern: misses are preserved, never dropped,
-- so an editor can reconcile them into the company canon later.
create table if not exists dc_facility_unmapped_operators (
  facility_id text primary key references dc_facilities(facility_id) on delete cascade,
  operator    text,
  noted_at    timestamptz not null default now()
);

-- ── RLS: service-role writes; anon reads the shareable columns only ──────────
alter table dc_facilities enable row level security;
create policy "dc_facilities service write" on dc_facilities
  as permissive for all to service_role using (true) with check (true);
create policy "dc_facilities anon read" on dc_facilities
  as permissive for select to anon, authenticated using (true);

-- Column-level grant: anon/authenticated may read the shareable projection but
-- NOT `raw` or `content_hash` (belt-and-braces against re-publishing gated
-- fields, even though the sync already withholds them from `raw`).
revoke all on dc_facilities from anon, authenticated;
grant select (
  facility_id, slug, name, operator, operator_company_id, address, city, state,
  country, market, latitude, longitude, total_power_mw, used_power_mw,
  headroom_mw, cooling_type, fiber_provider_count, fiber_carriers,
  commission_year, operational_status, dcpi_verdict, dcpi_market_rank, tenants,
  source, source_license, source_attribution, dc_hub_retrieved_at,
  created_at, updated_at
) on dc_facilities to anon, authenticated;

alter table dc_facility_unmapped_operators enable row level security;
create policy "dc_unmapped service only" on dc_facility_unmapped_operators
  as permissive for all to service_role using (true) with check (true);
revoke all on dc_facility_unmapped_operators from anon, authenticated;

-- ── Anon-facing read view (the storefront read contract) ────────────────────
create or replace view dc_facilities_public
with (security_invoker = true) as
select
  facility_id, slug, name, operator, operator_company_id, address, city, state,
  country, market, latitude, longitude, total_power_mw, used_power_mw,
  headroom_mw, cooling_type, fiber_provider_count, fiber_carriers,
  commission_year, operational_status, dcpi_verdict, dcpi_market_rank, tenants,
  source_attribution, dc_hub_retrieved_at, updated_at
from dc_facilities;

grant select on dc_facilities_public to anon, authenticated;

-- ── Read RPCs (SECURITY INVOKER, search_path-pinned, anon-executable) ────────
-- One facility by id/slug.
create or replace function dc_facility_get(p_facility_id text)
returns setof dc_facilities_public
language sql stable security invoker
set search_path = public
as $$
  select * from dc_facilities_public
  where facility_id = p_facility_id or slug = p_facility_id
  limit 1;
$$;

-- Every facility DC Hub knows for a tracked Faraday company. This is the join
-- the storefronts need most: "for company X, show its physical footprint."
create or replace function dc_facilities_for_company(p_company_id text)
returns setof dc_facilities_public
language sql stable security invoker
set search_path = public
as $$
  select * from dc_facilities_public
  where operator_company_id = p_company_id
  order by total_power_mw desc nulls last, facility_id desc;
$$;

-- Faceted, keyset-paginated search. Cursor is the last row's
-- (total_power_mw, facility_id); pass p_after_mw / p_after_id to page.
create or replace function dc_facilities_search(
  p_country     text    default null,
  p_market      text    default null,
  p_status      text    default null,
  p_min_mw      numeric default null,
  p_after_mw    numeric default null,
  p_after_id    text    default null,
  p_limit       integer default 48
)
returns setof dc_facilities_public
language sql stable security invoker
set search_path = public
as $$
  select * from dc_facilities_public
  where (p_country is null or country = p_country)
    and (p_market  is null or market  = p_market)
    and (p_status  is null or operational_status = p_status)
    and (p_min_mw  is null or total_power_mw >= p_min_mw)
    and (
      p_after_mw is null
      or (coalesce(total_power_mw, -1), facility_id) < (p_after_mw, coalesce(p_after_id, ''))
    )
  order by total_power_mw desc nulls last, facility_id desc
  limit greatest(1, least(coalesce(p_limit, 48), 200));
$$;

grant execute on function dc_facility_get(text)                                          to anon, authenticated;
grant execute on function dc_facilities_for_company(text)                                to anon, authenticated;
grant execute on function dc_facilities_search(text, text, text, numeric, numeric, text, integer) to anon, authenticated;

commit;
