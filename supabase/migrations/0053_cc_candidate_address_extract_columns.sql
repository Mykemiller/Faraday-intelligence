-- CC-CANDIDATE-ADDRESS-EXTRACT-1.0 — Part 1 of 3 (DDL)
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-08-09.
--
-- Promotes street-address data already held in dc_candidate_facilities.raw
-- into typed columns. Additive only. Creates no new facts, calls no external
-- API, spends nothing.
--
-- Deliberately does NOT touch latitude/longitude/geo_precision/geo_basis.
-- raw.city_coords holds a municipality-precision [lat,lon] array on 9,303 rows;
-- promoting it is a SEPARATE geocoding decision and is out of scope here.

alter table public.dc_candidate_facilities
  add column if not exists street_address   text,
  add column if not exists postal_code      text,
  add column if not exists country_iso2     text,
  add column if not exists address_basis    text,
  add column if not exists address_parsed_at timestamptz;

comment on column public.dc_candidate_facilities.street_address is
  'Street line promoted from raw. NEVER geocoded or inferred. See address_basis for derivation and its known limits.';
comment on column public.dc_candidate_facilities.postal_code is
  'Postal code promoted from raw.zip (atlas_presplit) or parsed from a strict US address tail (atlas_freetext_us).';
comment on column public.dc_candidate_facilities.country_iso2 is
  'ISO 3166-1 alpha-2, mapped from the country NAME held in country_code. NULL where the source value is not a resolvable country (junk address fragments, "Unknown", deprecated codes) - deliberately not guessed.';
comment on column public.dc_candidate_facilities.address_basis is
  'Provenance stamp. atlas_presplit = raw.street verbatim, a literal prefix of raw.address but TRUNCATED on ~64% of rows by a broken upstream tokenizer (do not treat as a complete street line). atlas_freetext_us = strict right-to-left parse of a comma-delimited US address. atlas_freetext / atlas_freetext_unsegmented = leading comma segment only, street confidence low. country_only = no street data in raw; country_iso2 normalization only.';
comment on column public.dc_candidate_facilities.address_parsed_at is
  'When this row last went through the address extraction pass.';

-- country_iso2 must be a well-formed alpha-2 or absent; never a name, never junk.
alter table public.dc_candidate_facilities
  drop constraint if exists dc_candidate_facilities_country_iso2_format;
alter table public.dc_candidate_facilities
  add constraint dc_candidate_facilities_country_iso2_format
  check (country_iso2 is null or country_iso2 ~ '^[A-Z]{2}$');

-- Any row carrying extracted address data must carry its provenance stamp.
-- NOTE: this is a per-STATEMENT check. A backfill statement that writes
-- country_iso2 must set address_basis in the SAME statement, not a later one.
alter table public.dc_candidate_facilities
  drop constraint if exists dc_candidate_facilities_address_basis_required;
alter table public.dc_candidate_facilities
  add constraint dc_candidate_facilities_address_basis_required
  check (
    (street_address is null and postal_code is null and country_iso2 is null)
    or address_basis is not null
  );

create index if not exists dc_candidate_facilities_country_iso2_idx
  on public.dc_candidate_facilities (country_iso2);
create index if not exists dc_candidate_facilities_address_basis_idx
  on public.dc_candidate_facilities (address_basis);
