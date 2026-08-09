-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / backfill, canonical side.
-- APPLIED to prod 2026-08-09.
--
-- FINDING THAT BOUNDS THIS MIGRATION: the canonical set cannot support a
-- parent/child backfill today, and this is a data fact, not a shortfall of effort.
--   * 0 of 1,359 non-superseded facilities carry a street address
--     (address->>'address' is NULL for every row; only city/state exist), so there
--     is no address key to cluster siblings on.
--   * 0 facilities are named as a building.
--   * The 13 'Campus'-named rows are PEERS, not a parent plus children:
--     AWS IAD Campus A1..A7 span Ashburn AND Sterling, B1..B4 sit in Manassas, and
--     no 'AWS IAD Campus A' parent row exists.
-- Writing any parent edge here would require MINTING campus rows that no source
-- names. That is fabrication and is deliberately not done.
--
-- What IS defensible: record the grain each source already declares in the name.
-- Zero rows minted, zero relationships invented, fully reversible.
update public.dc_facilities
   set grain = 'campus'
 where superseded_by is null
   and grain = 'site'
   and primary_name ~* 'campus'
   and parent_facility_id is null;
