-- CC-DC-SPRINT3 · Part 2+3 — register Server Country; clear the CC-BY sources;
-- ATLAS relicensed. APPLIED to prod 2026-08-09 (Myke-approved).

insert into public.source_registry
  (source_key, name, url, access_method, cadence, source_type, status,
   license_status, license, confidence_cap, fetcher, notes)
values (
  'sc:servercountry','Server Country — US data center project database',
  'https://servercountry.org/data/projects/','bulk_file','weekly','data_portal','registered','cleared',
  'CC BY 4.0 — share and adapt for any purpose INCLUDING COMMERCIALLY, with attribution. '
  'Cite: Server Country project database, SSRN doi 10.2139/ssrn.6964278. '
  'Book text and cover art are NOT covered by this licence.',
  'INF','dc-servercountry-sync',
  'Bulk: https://servercountry.org/data/all_projects.json (1,048 records, 33 fields, snapshot '
  '2026-07-17). Distinguishes itLoadMW from powerCapacityMW -> real capacity_basis. NO coordinates. '
  'NEWS-DERIVED (sampled project pages cite news + operator PR; documented overlap with dcinv:dcd). '
  'Feeds confidence, NOT the corroboration bar; never an official record.')
on conflict (source_key) do update
  set license_status=excluded.license_status, license=excluded.license, notes=excluded.notes;

update public.source_registry set license_status='cleared'
 where source_key='dc:epoch-ai' and license_status='unreviewed';

-- ATLAS: the 2026-07-08 "All Rights Reserved" gate is SUPERSEDED. Re-verified live
-- 2026-08-09 against the repo LICENSE — the author lifted the restriction.
update public.source_registry
   set license_status='attribution_required',
       license='PERMISSIVE, ATTRIBUTION REQUIRED (re-verified 2026-08-09). Free use/copy/publish/'
         'build-upon INCLUDING COMMERCIAL PRODUCTS. (1) VISIBLE attribution wherever shown — '
         '"Data centers (c) Ringmast4r - Global-Data-Center-Map"; buried attribution expressly does '
         'not count. (2) No claiming authorship; no relicensing that strips attribution downstream '
         '(attribution-persistence only — NOT ODbL-style copyleft). Provided AS IS.'
 where source_key='dc:atlas';

insert into public.dc_source_traits (source_key, news_derived, notes) values
  ('sc:servercountry', true, 'Aggregator over news + operator PR. Proven overlap with dcinv:dcd.'),
  ('dc:atlas', false, 'Compiled directory; provenance unspecified by author. NOT assessed as '
                      'news-derived. Excluded from the bar via source_class=directory.'),
  ('dcinv:dc_map', false, 'Provenance UNRECORDED — do not infer.'),
  ('dcinv:datacentermap', false, 'Provenance UNRECORDED.')
on conflict (source_key) do update
  set news_derived=excluded.news_derived, notes=excluded.notes;
