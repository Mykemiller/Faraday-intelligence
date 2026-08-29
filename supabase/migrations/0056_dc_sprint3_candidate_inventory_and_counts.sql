-- CC-DC-SPRINT3 · Part 5 — third-party directories land as a SEPARATE candidate inventory,
-- never minted into dc_facilities. Myke 2026-08-09. APPLIED to prod 2026-08-09.
--
-- NAMING: dc_suspects (Sprint 2) means "suspected NOT to be a data center" — quarantined
-- non-DC permits. That is the OPPOSITE of the "Suspected data centers" count below. This
-- table is deliberately NOT named dc_suspect_*.

create table if not exists public.dc_candidate_facilities (
  id uuid primary key default gen_random_uuid(),
  source_key text not null, external_id text, name text, operator text,
  country_code text, subdivision_code text, city text,
  latitude numeric, longitude numeric,
  geo_precision text not null default 'none'
    check (geo_precision in ('verified','parcel','address','centroid','municipality','estimated','none')),
  geo_basis text, raw jsonb, content_hash text not null,
  matched_facility_id uuid references public.dc_facilities(id),
  match_method text, match_evidence jsonb,
  status text not null default 'unresolved'
    check (status in ('unresolved','matched','distinct','rejected')),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  notes text, unique (source_key, content_hash));
alter table public.dc_candidate_facilities enable row level security;
revoke all on public.dc_candidate_facilities from anon, authenticated;
create index if not exists dc_candidate_facilities_match_idx  on public.dc_candidate_facilities(matched_facility_id);
create index if not exists dc_candidate_facilities_status_idx on public.dc_candidate_facilities(status);
create index if not exists dc_candidate_facilities_geo_idx    on public.dc_candidate_facilities(latitude, longitude)
  where latitude is not null and longitude is not null;

comment on table public.dc_candidate_facilities is
 'Candidate data centers from broad third-party directories (ATLAS, Server Country). NOT '
 'facilities. A candidate never mints a dc_facilities row automatically and can never be '
 'Validated. Matched candidates write observations onto the canonical facility (feeding FCS); '
 'unmatched candidates are counted in "Suspected" only.';

create or replace view public.dc_inventory_counts as
with fac as (select f.id, coalesce(f.publishable,false) publishable
             from public.dc_facilities f where f.superseded_by is null),
cand as (select count(*) filter (where status in ('unresolved','distinct')) unmatched_candidates
         from public.dc_candidate_facilities)
select (select count(*) filter (where publishable) from fac)              as validated_data_centers,
       (select count(*) from fac)                                         as canonical_facilities,
       (select unmatched_candidates from cand)                            as unvalidated_candidates,
       (select count(*) from fac)+(select unmatched_candidates from cand)  as suspected_data_centers,
       (select count(*) from fac)-(select count(*) filter (where publishable) from fac)
                                                                          as canonical_not_yet_validated;
alter view public.dc_inventory_counts set (security_invoker = true);
revoke all on public.dc_inventory_counts from anon, authenticated;

comment on view public.dc_inventory_counts is
 'validated_data_centers = publishable. suspected_data_centers = canonical facilities + '
 'unmatched third-party candidates. Validated is always a SUBSET of Suspected.';
