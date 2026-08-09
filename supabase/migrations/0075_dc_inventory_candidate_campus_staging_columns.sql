-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / R6. APPLIED to prod 2026-08-09.
-- dc_candidate_facilities could not express campus structure at all: no grain, no
-- parent. campus_key is a GROUPING key, not a foreign key -- candidates are
-- pre-resolution, so there is no parent uuid to point at yet.
-- country_code is deliberately left exactly as found (country_iso2 carries the clean value).
alter table public.dc_candidate_facilities
  add column if not exists grain      text,
  add column if not exists campus_key text;

alter table public.dc_candidate_facilities
  drop constraint if exists dc_candidate_facilities_grain_check;

alter table public.dc_candidate_facilities
  add constraint dc_candidate_facilities_grain_check
  check (grain is null or grain = any (array['campus','site','building']));

create index if not exists dc_candidate_facilities_campus_key_idx
  on public.dc_candidate_facilities (campus_key)
  where campus_key is not null;

comment on column public.dc_candidate_facilities.grain is
  'Optional pre-mint grain hint, same vocabulary as dc_facilities.grain. NULL = unassessed.';
comment on column public.dc_candidate_facilities.campus_key is
  'Source-scoped grouping key tying sibling candidates to one physical campus BEFORE a parent uuid exists. Not a foreign key. NULL = ungrouped.';
