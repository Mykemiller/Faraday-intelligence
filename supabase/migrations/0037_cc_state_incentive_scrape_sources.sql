-- CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 · Wave 3 headless-scrape sources
-- Registers scrape-captured sources. These are first-party government
-- disclosures (source_level='primary') but captured by a headless render rather
-- than a clean API, so confidence_cap='INF' (0.60 via fn 0036) — they never
-- score SRC. The Playwright scraper (scrapers/state-incentives, run in GitHub
-- Actions) pushes rows through ingest-state-incentives-push.
--
-- Applied to prod 2026-07-28 (additive — one registry row). Idempotent on source_key.

insert into public.jw_data_source_registry
  (source_key, name, provider, url, license, cadence, confidence_cap,
   default_confidence_tier, scope, feed_status, source_level, notes)
values
  ('ca_calcompetes', 'CA California Competes Tax Credit — awardee list', 'CA GO-Biz (Governor''s Office of Business & Economic Development)',
   'https://business.ca.gov/california-competes-tax-credit/grant-awardee-list/',
   'Open Data (CA)', 'quarterly', 'INF', 'INF', 'us-state', 'registered-pending-scrape', 'primary',
   'JS-rendered awardee table (not a clean API), captured via the Wave-3 Playwright scraper → confidence INF. '
   || 'Primary GO-Biz disclosure. Adapter: scrapers/state-incentives/adapters/ca-calcompetes.mjs. '
   || 'feed_status flips to ingested once the extractor is mapped + a push run lands rows.')
on conflict (source_key) do nothing;
