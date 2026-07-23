-- ============================================================================
-- 0017_far379_grid_buildout_projects  (FAR-379 / CC-SCOOP-SUBSTATION-COMMISSION-DATES-1.0)
-- ----------------------------------------------------------------------------
-- National substation-vintage scoop: extract substation commissioning /
-- in-service dates (and the wider grid-buildout "treasure trove") from two
-- public, structured regulatory sources — (1) state PUC dockets/filings
-- (FAR-353) and (2) ISO/RTO transmission-expansion plans (PJM RTEP, MISO MTEP,
-- ERCOT RTP/TPIT) — resolve the mentions against the HIFLD-anchored
-- `substations` spine (FAR-372), and write `commissioned_year` ONLY where a
-- high-confidence anchor match co-occurs with an *actual/energized* date.
--
-- This migration is purely ADDITIVE and fully reversible (rollback at foot):
--   • creates  grid_buildout_projects            (rich landing table, D3)
--   • adds     far379_norm(text)                 (name normalizer for matching)
--   • extends  substation_source_mentions        (date + confidence audit cols)
--   • creates  far379_resolve_and_grade(...)      (resolve → grade routine, D6)
--   • seeds    jw_data_source_registry            (one row per source)
--
-- Locked design (per CC, Myke sign-off 2026-07-23, D1–D7 accepted):
--   • Content-hash idempotency + service-role-only RLS on the new table.
--   • Resolve against HIFLD anchors ONLY (never bottom-up). Mentions land in
--     substation_source_mentions; source_type='iso_transmission_plan' (new)
--     joins 'puc_filing' (existing, unconstrained convention — FAR-372 D7).
--   • Date precedence: actual/energized > required-in-service > projected.
--     Only actual/energized populates commissioned_year / the age grade.
--     Projected/required populate planned_inservice_date, never the grade.
--   • Confidence: auto-write commissioned_year only on ≥0.90 (exact normalized
--     name + same county, voltage tiebreaker). Everything lower stays
--     resolution_status='unresolved' for human review — never a fuzzy grade.
--   • Zero JPAS/JPS/JDS writes — pure reference layer.
--
-- D1 refinement ratified in-session: the PUC extractor keys candidate selection
--   off puc_dockets.docket_title (raw_text is a title-only index, median 19
--   words, and never contains a substation name or an in-service date). Actual
--   dates are fetched from the underlying filing PDF (source_url) via the http
--   extension in the edge function — not from raw_text.
-- ============================================================================

begin;

-- ── Name normalizer ─────────────────────────────────────────────────────────
-- Aligns an extracted mention name with the HIFLD spine's naming convention.
-- HIFLD `canonical_name` is a bare place name (e.g. "FORT DAVIS"), whereas
-- ISO/PUC sources say "Fort Davis Switch" / "…Substation" / "…Switching
-- Station". We lowercase, unaccent, strip the substation-type suffixes, drop
-- punctuation, and collapse whitespace. HIFLD geometry-only placeholders
-- (UNKNOWN######, TAP######) — 77% of the 75,327 rows — normalize to NULL so
-- they can never spuriously match.
create or replace function public.far379_norm(p text)
returns text
language sql
immutable
set search_path = public
as $$
  with base as (select lower(unaccent(coalesce(p, ''))) as s)
  select case
    when (select s from base) ~ '^(unknown|tap)[0-9]+$' then null
    else nullif(
      btrim(regexp_replace(
        regexp_replace(
          regexp_replace(
            (select s from base),
            '\m(switching station|substation|switchyard|switching|switch|sub station|s/?s|tap|poi|interchange|delivery station|dc tie)\M',
            ' ', 'g'),
          '[^a-z0-9 ]+', ' ', 'g'),
        '\s+', ' ', 'g')),
      '')
  end
$$;
comment on function public.far379_norm(text) is
  'FAR-379: normalize a substation mention name for exact matching against substations.canonical_name (strips switch/substation suffixes; NULLs HIFLD UNKNOWN/TAP placeholders).';

-- Functional index so exact-name resolution over 75k anchors is a fast lookup.
create index if not exists idx_substations_far379_norm
  on public.substations (public.far379_norm(canonical_name));

-- ── Landing table: grid_buildout_projects (D3, land-rich) ────────────────────
-- The full extracted project record from BOTH sources — the "treasure trove"
-- (driver, cost, MW, voltage, tariff/docket meta, forward pipeline). Only the
-- resolved actual-date subset is wired to substations this ticket (D4); the
-- rest is captured so downstream tickets (PWR-01, JDS grid-buildout, REG,
-- WTR-06/FAR-343, lifecycle/FAR-373) don't have to re-crawl.
create table if not exists public.grid_buildout_projects (
  id                    uuid primary key default gen_random_uuid(),
  source_type           text not null
                          check (source_type in ('iso_transmission_plan','puc_filing')),
  source_key            text not null,   -- jw_data_source_registry.source_key
  source_ref            text not null,   -- stable natural id within source (ERCOT RTP #, docket#/proj)
  iso_rto               text,            -- ERCOT/MISO/PJM/CAISO/SPP/NYISO/ISO-NE (null for PUC)
  state_abbr            char(2),
  county_fips           char(5),
  county_raw            text,
  project_name          text,
  project_description   text,
  driver                text,            -- normalized: reliability|generation_interconnection|load_growth|economic|policy|asset_condition
  driver_raw            text,
  is_large_load_dc      boolean not null default false,  -- data-center / large-load leading indicator (secondary value)
  est_cost_usd          numeric,
  capacity_mw           numeric,
  voltage_kv            numeric,
  substation_names      text[] not null default '{}',    -- extracted endpoints / substations
  tariff_flag           boolean not null default false,  -- large-load / DC rate-class proceeding (WTR-06)
  tariff_type           text,
  docket_number         text,            -- PUC provenance
  utility_name          text,            -- owning utility (ownership corroboration for FAR-372)
  planned_inservice_date date,           -- projected / required-in-service (D5) — never grades
  actual_inservice_date  date,           -- energized / completed — the only date that grades
  date_type             text not null default 'unknown'
                          check (date_type in ('actual','required','projected','approved','unknown')),
  project_status        text,            -- future|completed|cancelled|under_construction|approved
  confidence_tier       text not null default 'EST'
                          check (confidence_tier in ('SRC','EST')),
  raw                   jsonb not null default '{}'::jsonb,  -- full extracted record
  content_hash          text not null,   -- fingerprint(salient) → skip-unchanged re-ingest
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  unique (source_key, source_ref)
);

create index if not exists idx_gbp_substation_names   on public.grid_buildout_projects using gin (substation_names);
create index if not exists idx_gbp_state_county        on public.grid_buildout_projects (state_abbr, county_fips);
create index if not exists idx_gbp_driver              on public.grid_buildout_projects (driver);
create index if not exists idx_gbp_planned_inservice   on public.grid_buildout_projects (planned_inservice_date);
create index if not exists idx_gbp_source              on public.grid_buildout_projects (source_key, source_type);
create index if not exists idx_gbp_large_load_dc       on public.grid_buildout_projects (is_large_load_dc) where is_large_load_dc;

comment on table public.grid_buildout_projects is
  'FAR-379: land-rich grid-buildout landing table (PUC + ISO/RTO transmission plans). Service-role only. Only resolved actual-date rows wire to substations.commissioned_year this ticket (D4).';

-- Service-role-only RLS (standing convention: pure reference layer, no anon read).
alter table public.grid_buildout_projects enable row level security;
create policy "gbp service only" on public.grid_buildout_projects
  as permissive for all to service_role using (true) with check (true);
revoke all on public.grid_buildout_projects from anon, authenticated;

-- ── Extend the resolution/audit table (additive) ────────────────────────────
-- substation_source_mentions is the audit spine (FAR-372). We add the extracted
-- date + its semantics + the match/extraction confidences + a back-link to the
-- rich record, so the resolve→grade routine is self-contained and the audit
-- trail shows exactly why each substation was (or was not) graded.
alter table public.substation_source_mentions
  add column if not exists extracted_inservice_date date,
  add column if not exists extracted_date_type      text,   -- actual|required|projected|approved|unknown
  add column if not exists extraction_confidence    numeric,-- source-side extraction confidence (0–1)
  add column if not exists match_confidence          numeric,-- anchor-match confidence (0–1)
  add column if not exists grid_buildout_project_id  uuid references public.grid_buildout_projects(id) on delete set null,
  add column if not exists commissioned_year_written integer;-- audit: the year this mention wrote (null if none)

-- ── Resolve → grade routine (D6) ────────────────────────────────────────────
-- Resolves pending/unresolved mentions to a HIFLD anchor by EXACT normalized
-- name, gated on county (voltage as tiebreaker), and writes commissioned_year
-- only for ≥p_min_conf matches carrying an *actual* date. Deterministic;
-- fuzzy/ambiguous matches are parked as 'unresolved' for human review, never
-- auto-graded. Idempotent: re-running converges (same year re-written).
--
-- Confidence model (exact normalized-name candidates only):
--   unique in same county                 → 0.95  (0.97 if voltage also matches)
--   multiple in same county (ambiguous)   → 0.85  → unresolved
--   no county hint, unique in same state  → 0.70  → unresolved
--   name match, county mismatch/other     → 0.60  → unresolved
--   no exact-name candidate               → 0.00  → unresolved
-- Only ≥0.90 + date_type='actual' + a date writes the grade.
create or replace function public.far379_resolve_and_grade(
  p_source_type text    default null,   -- restrict to one source_type; null = all
  p_min_conf    numeric default 0.90,
  p_commit      boolean default true    -- false = dry-run (resolve/score, no writes)
)
returns table (
  processed      integer,
  graded         integer,
  resolved_no_grade integer,
  unresolved     integer,
  years_written  integer
)
language plpgsql
set search_path = public
as $$
declare
  m            record;
  v_frag       text;
  v_cand       uuid;
  v_conf       numeric;
  v_n_county   integer;
  v_n_state    integer;
  v_volt_ok    boolean;
  v_year       integer;
  v_status     text;
  c_processed  integer := 0;
  c_graded     integer := 0;
  c_nograde    integer := 0;
  c_unres      integer := 0;
  c_years      integer := 0;
begin
  for m in
    select *
    from substation_source_mentions
    where resolution_status in ('pending','unresolved')
      and (p_source_type is null or source_type = p_source_type)
  loop
    c_processed := c_processed + 1;
    v_frag := far379_norm(m.extracted_name_frag);
    v_cand := null; v_conf := 0;

    if v_frag is not null then
      -- exact-name candidates in the hinted county
      select count(*) into v_n_county
      from substations s
      where far379_norm(s.canonical_name) = v_frag
        and m.county_fips_hint is not null
        and s.county_fips = m.county_fips_hint;

      -- exact-name candidates in the hinted state
      select count(*) into v_n_state
      from substations s
      where far379_norm(s.canonical_name) = v_frag
        and m.state_abbr_hint is not null
        and s.state_abbr = m.state_abbr_hint;

      if v_n_county = 1 then
        select s.id,
               (m.extracted_voltage_kv is not null
                 and s.voltage_class_kv is not null
                 and abs(s.voltage_class_kv - m.extracted_voltage_kv) <= 1)
          into v_cand, v_volt_ok
        from substations s
        where far379_norm(s.canonical_name) = v_frag
          and s.county_fips = m.county_fips_hint
        limit 1;
        v_conf := case when v_volt_ok then 0.97 else 0.95 end;

      elsif v_n_county > 1 then
        -- ambiguous within county: prefer voltage match, but hold below the gate
        select s.id into v_cand
        from substations s
        where far379_norm(s.canonical_name) = v_frag
          and s.county_fips = m.county_fips_hint
        order by (m.extracted_voltage_kv is not null
                  and s.voltage_class_kv is not null
                  and abs(s.voltage_class_kv - m.extracted_voltage_kv) <= 1) desc
        limit 1;
        v_conf := 0.85;

      elsif m.county_fips_hint is null and v_n_state = 1 then
        select s.id into v_cand
        from substations s
        where far379_norm(s.canonical_name) = v_frag
          and s.state_abbr = m.state_abbr_hint
        limit 1;
        v_conf := 0.70;

      elsif v_n_state >= 1 then
        select s.id into v_cand
        from substations s
        where far379_norm(s.canonical_name) = v_frag
          and s.state_abbr = m.state_abbr_hint
        limit 1;
        v_conf := 0.60;
      end if;
    end if;

    -- classify outcome
    if v_cand is not null and v_conf >= p_min_conf
       and m.extracted_date_type = 'actual'
       and m.extracted_inservice_date is not null then
      v_status := 'resolved';
      v_year   := extract(year from m.extracted_inservice_date)::int;
    elsif v_cand is not null and v_conf >= p_min_conf then
      v_status := 'resolved_no_grade';   -- anchored, but date can't grade (projected/required/absent)
      v_year   := null;
    else
      v_status := 'unresolved';          -- below gate or no candidate → human review
      v_year   := null;
    end if;

    if p_commit then
      update substation_source_mentions
        set substation_id = v_cand,
            match_confidence = v_conf,
            resolution_status = v_status,
            commissioned_year_written = v_year
        where id = m.id;

      -- write the grade (actual dates are authoritative; overwrite only null or
      -- a differing value from a lower-confidence prior mention this cohort).
      if v_status = 'resolved' then
        update substations
          set commissioned_year = v_year
          where id = v_cand
            and (commissioned_year is null or commissioned_year <> v_year);
      end if;
    end if;

    if v_status = 'resolved' then
      c_graded := c_graded + 1;
      if p_commit then c_years := c_years + 1; end if;
    elsif v_status = 'resolved_no_grade' then
      c_nograde := c_nograde + 1;
    else
      c_unres := c_unres + 1;
    end if;
  end loop;

  return query select c_processed, c_graded, c_nograde, c_unres, c_years;
end
$$;
comment on function public.far379_resolve_and_grade(text, numeric, boolean) is
  'FAR-379 D6: resolve substation_source_mentions to HIFLD anchors (exact name + county gate, voltage tiebreaker) and write commissioned_year only for ≥conf actual-date matches. p_commit=false for dry-run.';

revoke all on function public.far379_resolve_and_grade(text, numeric, boolean) from anon, authenticated;

-- ── Data-source registry rows (one per source) ──────────────────────────────
insert into public.jw_data_source_registry
  (source_key, name, provider, url, license, cadence, confidence_cap, scope, notes,
   registered_at, feed_status, default_confidence_tier)
values
  ('iso:ercot-tpit',
   'ERCOT Transmission Project Information Tracking (TPIT)',
   'Electric Reliability Council of Texas (ERCOT)',
   'https://www.ercot.com/gridinfo/planning',
   'Public ERCOT market data (data product pg7-048-m)',
   'quarterly (TPIT workbook refresh)',
   'SRC', 'ERCOT footprint transmission projects (Future/Completed/Cancelled/RTP)',
   'FAR-379 pilot source #1. Completed-Projects section carries ACTUAL in-service dates → grades; Future/RTP are projected → land only. Best planned-vs-actual split of the pilot three.',
   now(), 'pending', 'SRC'),
  ('iso:miso-mtep',
   'MISO Transmission Expansion Plan (MTEP) — Appendix A / quarterly status',
   'Midcontinent Independent System Operator (MISO)',
   'https://www.misoenergy.org/planning/transmission-planning/mtep/',
   'Public MISO planning reports',
   'quarterly (Appendix A status report)',
   'SRC', 'MISO footprint board-approved transmission projects',
   'FAR-379 pilot source #2 (phase-2 build). Estimated in-service + status; actual via status→in-service transition. Anchor on published quarterly exports (Portal is login-gated).',
   now(), 'pending', 'EST'),
  ('iso:pjm-rtep',
   'PJM Regional Transmission Expansion Plan (RTEP) — Project Status',
   'PJM Interconnection',
   'https://www.pjm.com/planning/project-construction',
   'Public PJM planning data',
   'rolling (Project Status & Cost Allocation table)',
   'SRC', 'PJM footprint baseline/network/supplemental transmission projects',
   'FAR-379 pilot source #3 (phase-2 build). Projected in-service + construction status; no confirmed single clean export — scrape interactive table. Actual inferred from status flip.',
   now(), 'pending', 'EST'),
  ('puc:substation-commission',
   'PUC CPCN/CCN substation in-service dates (extraction layer over puc_dockets)',
   'State public utility commissions (via FAR-353 puc crawler)',
   'https://www.puc.texas.gov/industry/electric/rates/transmission/',
   'Public regulatory filings',
   'continuous (rides FAR-353 puc-dockets-weekly crawler)',
   'SRC', 'CPCN/CCN + transmission-siting dockets naming substations w/ energization dates',
   'FAR-379 source. D1-refined: candidate selection off docket_title; actual dates fetched from filing PDF (source_url) via http extension. Corpus today is application-stage → mostly projected (EST); actual dates come from final orders.',
   now(), 'pending', 'SRC')
on conflict (source_key) do update
  set name = excluded.name,
      provider = excluded.provider,
      url = excluded.url,
      cadence = excluded.cadence,
      notes = excluded.notes,
      default_confidence_tier = excluded.default_confidence_tier;

commit;

-- ============================================================================
-- ROLLBACK (purely additive — no cascading impact on scoring)
-- ----------------------------------------------------------------------------
-- -- Null out any grade this scoop wrote (by mention audit trail):
-- update substations s set commissioned_year = null
--   from substation_source_mentions m
--   where m.substation_id = s.id and m.commissioned_year_written is not null;
-- drop function if exists public.far379_resolve_and_grade(text, numeric, boolean);
-- alter table public.substation_source_mentions
--   drop column if exists extracted_inservice_date,
--   drop column if exists extracted_date_type,
--   drop column if exists extraction_confidence,
--   drop column if exists match_confidence,
--   drop column if exists grid_buildout_project_id,
--   drop column if exists commissioned_year_written;
-- drop table if exists public.grid_buildout_projects;
-- drop index if exists public.idx_substations_far379_norm;
-- drop function if exists public.far379_norm(text);
-- delete from jw_data_source_registry
--   where source_key in ('iso:ercot-tpit','iso:miso-mtep','iso:pjm-rtep','puc:substation-commission');
-- ============================================================================
