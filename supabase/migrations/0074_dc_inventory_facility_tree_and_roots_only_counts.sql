-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / R4 + R5. APPLIED to prod 2026-08-09.
-- R4: parent/child counterpart to dc_facility_merge_group. merge_group walks
-- superseded_by (merge lineage); this walks parent_facility_id (campus structure).
-- DIFFERENT AXES -- do not conflate.
create or replace view public.dc_facility_tree as
with recursive walk as (
  select f.id as facility_id, f.id as root_id, 0 as depth, f.grain as root_grain
    from public.dc_facilities f
   where f.parent_facility_id is null and f.superseded_by is null
  union all
  select f.id, w.root_id, w.depth + 1, w.root_grain
    from public.dc_facilities f
    join walk w on f.parent_facility_id = w.facility_id
   where w.depth < 3 and f.superseded_by is null
)
select facility_id, root_id, depth, root_grain from walk;

comment on view public.dc_facility_tree is
  'Campus/building hierarchy resolver: every facility mapped to its tree root and depth. Walks parent_facility_id. NOT the same axis as dc_facility_merge_group, which walks superseded_by (merge lineage).';

-- R5: counting rule -- ROOTS ONLY (Myke, 2026-08-09). A campus and its buildings
-- count ONCE. Keyed on parent_facility_id IS NULL rather than grain so the rule
-- survives changes to the grain vocabulary. child_facilities is APPENDED last so the
-- existing five-column contract and column order are preserved.
create or replace view public.dc_inventory_counts as
with fac as (
  select f.id,
         coalesce(f.publishable, false) as publishable,
         (f.parent_facility_id is null)  as is_root
    from public.dc_facilities f
   where f.superseded_by is null
), cand as (
  select count(*) filter (
           where dc_candidate_facilities.status = any (array['unresolved','distinct'])
         ) as unmatched_candidates
    from public.dc_candidate_facilities
)
select
  (select count(*) filter (where publishable and is_root) from fac) as validated_data_centers,
  (select count(*) filter (where is_root)                 from fac) as canonical_facilities,
  (select unmatched_candidates from cand)                           as unvalidated_candidates,
  (select count(*) filter (where is_root) from fac)
    + (select unmatched_candidates from cand)                       as suspected_data_centers,
  (select count(*) filter (where is_root) from fac)
    - (select count(*) filter (where publishable and is_root) from fac)
                                                                    as canonical_not_yet_validated,
  (select count(*) filter (where not is_root)             from fac) as child_facilities;

comment on view public.dc_inventory_counts is
  'Published inventory counts. Counts ROOT facilities only (parent_facility_id IS NULL) so a campus and its buildings count once; child_facilities exposes the rest. Rule set by Myke 2026-08-09.';
