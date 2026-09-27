-- CC-ARTIFACT-BODY-FETCH-1.0 — align the puc_gov lane with the Phase 1 slice as run.
-- Phase 1 (docs/body-fetch/PHASE-1-RUN-REPORT.md, merged PR #66) defined the slice as
-- source_type in (state_puc_filing, permit_utility) plus regulatory rows whose
-- source_url contains '.gov' — 1,443 rows. 0083 used a narrower .gov-host rule
-- (1,046 rows); this makes the lane (and so embed/measure) cover exactly the rows
-- Phase 1 fetched. The puc_gov FETCH gate stays off: Phase 1 already fetched them
-- with its own abf_* machinery.
create or replace function public.artifact_body_lane(p_source_type text, p_source_url text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select case
    when p_source_type = 'sec_filing'
         and p_source_url ~* '^https?://(www\.)?sec\.gov/Archives/' then 'sec'
    when p_source_type in ('state_puc_filing', 'permit_utility')
      or (p_source_type = 'regulatory' and p_source_url like '%.gov%') then 'puc_gov'
    else null
  end
$$;
