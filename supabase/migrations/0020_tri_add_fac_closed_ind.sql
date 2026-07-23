-- 0020_tri_add_fac_closed_ind.sql
-- CC-RSC-STRANDED-INDUSTRIAL-1.0 — TRI carries a direct facility-closed indicator
-- (fac_closed_ind, "1"=closed) on tri_facility. This supersedes last-reporting-year
-- gap inference for closure and is the core stranded-industrial discovery signal.

alter table public.tri_facility_history add column if not exists fac_closed_ind text;
comment on column public.tri_facility_history.fac_closed_ind is
  'EPA TRI facility-closed indicator (1=closed) — direct closure signal, supersedes gap inference where present.';
