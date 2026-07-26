-- CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 · registry backfill
-- Registers every state-incentive disclosure feed in jw_data_source_registry.
-- Gap closed: BEFORE this migration, NONE of the state-incentive sources were
-- registered (not even the 8 pre-existing live Socrata feeds) — the task's
-- cross-cutting rule "no source ships without a registry row" was unmet.
--
-- Idempotent on source_key (PK): on conflict do nothing.
-- UN-APPLIED as of 2026-07-26 — apply at promotion (same deploy gate as the
-- ingest-state-incentives Wave-1 redeploy). All are primary/per-recipient
-- disclosures → confidence_cap = 'SRC', source_level precedence = primary
-- (Good Jobs First / Upjohn aggregators would be capped lower; none used here).

insert into public.jw_data_source_registry
  (source_key, name, provider, url, license, cadence, confidence_cap,
   default_confidence_tier, scope, feed_status, notes)
values
  -- ── Pre-existing live Socrata feeds (registry backfill) ──
  ('ny_esd_dei', 'NY ESD Database of Economic Incentives (DEI)', 'NYS Empire State Development',
   'https://data.ny.gov/d/26ei-n4eb', 'Open Data (NY)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. ~65k rows. Per-recipient state assistance; county carried → INC-01..05 resolve.'),
  ('ny_ida_projects', 'NY Industrial Development Agency (IDA) Projects', 'NYS Authorities Budget Office',
   'https://data.ny.gov/d/9rtk-3fkw', 'Open Data (NY)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. ~34k rows. County derived from authority_name (GML §859 PILOTs/exemptions).'),
  ('ct_decd_business_assistance', 'CT DECD Business Assistance', 'CT Dept. of Economic & Community Development',
   'https://data.ct.gov/d/xnw3-nytd', 'Open Data (CT)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. Grants/loans w/ statutory_reference + county_1.'),
  ('md_commerce_finance_tracker', 'MD Commerce Consolidated Finance Tracker', 'Maryland Dept. of Commerce',
   'https://opendata.maryland.gov/d/cf3i-xdgb', 'Open Data (MD)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. ~7k rows. Intermittent Cloudflare gate; NY app token reused.'),
  ('or_ez_parta_2025', 'OR Enterprise Zone Exemptions (PARTA FY2025)', 'Oregon Dept. of Revenue / Business Oregon',
   'https://data.oregon.gov/d/9cc3-52ar', 'Open Data (OR)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. Property-tax exemptions, ORS 285C, oregon_county carried.'),
  ('or_ez_parta_2024', 'OR Enterprise Zone Exemptions (PARTA FY2024)', 'Oregon Dept. of Revenue / Business Oregon',
   'https://data.oregon.gov/d/ecbu-9t3b', 'Open Data (OR)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. Prior-year enterprise-zone PARTA companion set.'),
  ('or_energy_incentive_program', 'OR Energy Incentive Program tax credits', 'Oregon Dept. of Energy',
   'https://data.oregon.gov/d/ria5-vqsx', 'Open Data (OR)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. Final tax credit / grant certificates; site_county carried.'),
  ('de_eeif_grants', 'DE Energy Efficiency Investment Fund grants', 'Delaware DNREC',
   'https://data.delaware.gov/d/vukm-g6g5', 'Open Data (DE)', 'weekly', 'SRC', 'SRC', 'us-state',
   'ingested', 'Socrata. Grantee + county + final_award_amount.'),

  -- ── Wave 1 — API drop-in (verified live 2026-07-26; not yet seeded) ──
  ('ok_quality_jobs', 'OK Quality Jobs Program incentive payments', 'Oklahoma Tax Commission (via data.ok.gov)',
   'https://data.ok.gov/dataset/oklahoma-quality-jobs-program', 'Open Data (OK)', 'weekly', 'SRC', 'SRC', 'us-state',
   'registered-pending-seed',
   'CKAN datastore (resource d4845ba8…), 4,324 rows @ probe. Per-vendor cash rebate (68 O.S. §3601). '
   || 'COVERAGE GAP: source carries city/zip only (no county) → rows land in state_incentive_disclosures '
   || 'but write no INC-* attribute until a city/zip→county resolver exists. Not fabricated — county left ABS.'),
  ('wi_wedc_ared', 'WI WEDC All Reportable Economic Development (ARED) awards', 'Wisconsin Economic Development Corp.',
   'https://www.wedc.org/about-wedc/transparency/', 'Open Data (WI)', 'weekly', 'SRC', 'SRC', 'us-state',
   'registered-pending-seed',
   'ArcGIS hosted FeatureServer (services2.arcgis.com/xkpZtaTA2F05Vq7i), 4,867 features @ probe. '
   || 'Carries county + municipality + numeric awardAmount → full INC-01..05 resolution.'),
  ('ia_ieda_awards', 'IA Economic Development Authority award contracts', 'Iowa Economic Development Authority',
   'https://www.iowaeda.com/impact/', 'Open Data (IA)', 'weekly', 'SRC', 'SRC', 'us-state',
   'registered-pending-seed',
   'Iowa Data Hub JSON (idh-be.iowa.gov dataset 946). Carries county + city. award_value = direct '
   || 'assistance + tax benefits (capital_investment excluded — that is the recipient''s own spend).'),

  -- ── Registered, deliberately NOT ingested (documented low yield) ──
  ('hi_film_tax_credit', 'HI Film Tax Credit (anonymized)', 'State of Hawaii (opendata.hawaii.gov)',
   'https://opendata.hawaii.gov/dataset/film-tax-credit', 'ocd-by (HI)', 'annual', 'SRC', 'SRC', 'us-state',
   'registered-not-ingested',
   'CKAN datastore live but LOW YIELD: recipient names anonymized by source, film-only (not site/DC), '
   || 'last modified 2020-10-19. Recipient-level capture would fabricate identities the source suppresses — '
   || 'so registered for provenance only, no rows ingested.')
on conflict (source_key) do nothing;
