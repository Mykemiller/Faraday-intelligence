-- ISpyaDC Phase 0 — calibration schema (FAR-405 · D4)
-- ============================================================================
-- STATUS: DRAFT / UN-APPLIED. Pending Myke sign-off on column schema.
-- When approved, apply via mcp Supabase apply_migration (NOT execute_sql) as
-- e.g. supabase/migrations/00XX_ispyadc_phase0_calibration.sql.
--
-- Additive only. No FK into jw_facilities / jpas_attributes / JDS (deliberate:
-- Phase 0 must not couple to or write those systems — positives are referenced
-- by (source, source_id), not linked). Service-role RLS, matching the
-- jurisdiction_land_coverage / jw_data_source_registry deny-all convention.
-- ============================================================================

-- 1) The 500-site corpus (positives + controls) -----------------------------
create table if not exists public.ispyadc_sites (
  site_id            uuid primary key default gen_random_uuid(),
  corpus_role        text not null check (corpus_role in ('positive','control')),
  vintage_cohort     text          check (vintage_cohort in ('complete_cycle','current_phase')),
  -- provenance of a positive (never an FK): 'jw_facilities' | 'dc_hub' | ...
  source             text not null,
  source_id          text,                         -- e.g. jw_facilities.id as text
  facility_name      text,
  -- for a control: the positive it was drawn near (nearest-neighbor, D3)
  paired_positive_id uuid references public.ispyadc_sites(site_id) on delete set null,
  -- AOI geometry. Buffered because jw_facilities coords are geo_precision=
  -- 'estimated' (I4 caveat): a 30 m AOI on an estimated centroid can miss the
  -- real footprint, so we center a buffered AOI and record its provenance.
  lat                numeric not null,
  lng                numeric not null,
  aoi_radius_m       integer not null default 500,
  coord_precision    text    not null default 'estimated'
                       check (coord_precision in ('estimated','parcel_verified','manual')),
  ecoregion_stratum  text,                          -- one of the 8 (D2)
  nlcd_class         text,                          -- secondary within-stratum split
  -- labeled transition window for a positive (I4: no build-start date internally,
  -- so start is bounded by announced_date, end by operational_date)
  label_event        boolean not null default false,   -- true=transition expected, false=control non-event
  label_start_date   date,
  label_end_date     date,
  notes              jsonb  not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (source, source_id, corpus_role)
);
comment on table public.ispyadc_sites is
  'ISpyaDC Phase 0 corpus: 500 positive/control AOIs for Landsat calibration. '
  'Positives referenced by (source, source_id) — NEVER an FK into jw_facilities. '
  'Controls are nearest-neighbor non-events (D3). AOI buffered because source '
  'coordinates are geo_precision=estimated.';

-- 2) Per-stratum seasonal harmonic baseline ---------------------------------
create table if not exists public.ispyadc_seasonal_baseline (
  stratum            text not null,                 -- ecoregion_stratum
  nlcd_class         text not null default '_all',
  model_version      text not null,
  -- harmonic fit params (amplitude/phase per order + intercept + trend), plus
  -- residual sigma used to scale the change threshold
  harmonic           jsonb not null,
  residual_sigma     numeric,
  n_scenes           integer,
  fitted_at          timestamptz not null default now(),
  primary key (stratum, nlcd_class, model_version)
);
comment on table public.ispyadc_seasonal_baseline is
  'Per ecoregion-stratum (optionally x NLCD class) seasonal-harmonic NDVI '
  'baseline. Change threshold is expressed in residual-sigma units of this fit.';

-- 3) Deduped Landsat scene footprints (volume control) ----------------------
-- Dedup is by scene footprint (WRS-2 path/row + acquisition), NOT per-site, per
-- the success criteria — nearby AOIs share scenes.
create table if not exists public.ispyadc_scene (
  scene_id           text primary key,              -- USGS entity/display id
  wrs_path           integer,
  wrs_row            integer,
  acquired_date      date,
  dataset            text,                           -- landsat_ot_c2_l2 | ...
  cloud_cover        numeric,
  content_hash       text,                           -- idempotent re-pull guard
  retrieved_at       timestamptz not null default now()
);
comment on table public.ispyadc_scene is
  'Deduplicated Landsat C2 L2 scene footprints (WRS-2 path/row). One row per '
  'scene regardless of how many AOIs it covers — controls download volume.';

-- 4) THE outcome log (D4 — the named deliverable) ---------------------------
create table if not exists public.ispyadc_calibration_log (
  log_id             uuid primary key default gen_random_uuid(),
  run_id             text not null,                 -- one retrospective run
  site_id            uuid not null references public.ispyadc_sites(site_id) on delete cascade,
  observed_date      date not null,                 -- the monthly observation
  ndvi_value         numeric,
  ndvi_baseline      numeric,                        -- expected from seasonal model
  ndvi_delta         numeric,                        -- value - baseline
  delta_sigma        numeric,                        -- delta in residual-sigma units
  threshold_used     numeric not null,               -- calibrated threshold (sigma)
  flagged            boolean not null,               -- delta_sigma crossed threshold?
  -- confusion-matrix classification vs the site label + window
  outcome_class      text check (outcome_class in ('TP','FP','TN','FN')),
  scene_id           text references public.ispyadc_scene(scene_id) on delete set null,
  baseline_version   text,                           -- -> ispyadc_seasonal_baseline.model_version
  detail             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (run_id, site_id, observed_date)
);
comment on table public.ispyadc_calibration_log is
  'FAR-405 D4: raw per-observation outcome log for the retrospective Landsat '
  'calibration run. TP/FP/TN/FN vs each site''s label window drive the per-stratum '
  'false-positive / true-positive summary. Additive; no write to JPAS/JPS/JDS.';
create index if not exists idx_ispyadc_log_run     on public.ispyadc_calibration_log (run_id);
create index if not exists idx_ispyadc_log_site    on public.ispyadc_calibration_log (site_id);
create index if not exists idx_ispyadc_log_outcome on public.ispyadc_calibration_log (outcome_class);

-- 5) RLS — deny-all / service-role-only on all four (repo convention) --------
alter table public.ispyadc_sites             enable row level security;
alter table public.ispyadc_seasonal_baseline enable row level security;
alter table public.ispyadc_scene             enable row level security;
alter table public.ispyadc_calibration_log   enable row level security;
-- No policies: service role bypasses RLS; nothing anon-readable. Matches
-- jurisdiction_land_coverage / jw_data_source_registry.
