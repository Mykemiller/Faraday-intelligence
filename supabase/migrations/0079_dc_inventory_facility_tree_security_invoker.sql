-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / fix to R4. APPLIED to prod 2026-08-09.
-- A Postgres view runs as its OWNER unless security_invoker is set, so
-- dc_facility_tree as created read dc_facilities with owner rights and re-exposed
-- exactly the rows RLS fences. Caught as a new security_definer_view ERROR in the
-- advisor delta. Same trap already documented for the jw_brief_* views.
alter view public.dc_facility_tree set (security_invoker = true);
