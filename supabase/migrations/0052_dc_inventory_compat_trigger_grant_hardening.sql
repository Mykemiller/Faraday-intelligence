-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 9 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as
--   dc_inventory_0052_compat_trigger_grant_hardening
--
-- fn_jw_facilities_compat_insert() is SECURITY DEFINER (it must be: it
-- writes the RLS-fenced dc_* tables on behalf of the legacy writer). Supabase
-- ships ALTER DEFAULT PRIVILEGES granting EXECUTE on every new public
-- function to PUBLIC, anon and authenticated AT CREATE TIME, so it was left
-- executable by both. Postgres refuses to call a trigger function directly,
-- so this was not exploitable - but it is a standing
-- security_definer_function_executable finding and dead privilege either way.
--
-- Revoked BY NAME: `revoke ... from public` alone does NOT clear the role
-- grants.
--
-- Note the compat view itself only ever carried SELECT for anon/authenticated,
-- so no unprivileged role could reach the INSERT path regardless.
-- =====================================================================
revoke all on function public.fn_jw_facilities_compat_insert() from public, anon, authenticated;

-- Same treatment for the two other trigger functions this work added. They are
-- SECURITY INVOKER and therefore harmless, but there is no reason for anon to
-- hold EXECUTE on them.
revoke all on function public.fn_dc_facilities_touch()         from public, anon, authenticated;
revoke all on function public.fn_dc_observations_append_only() from public, anon, authenticated;

-- The pure helpers below are DELIBERATELY left executable by authenticated:
-- fn_dc_jds_from_lifecycle and fn_dc_jsonb_to_text_array are called from
-- inside the security_invoker views, so revoking them would break
-- authenticated reads of jw_facilities / dc_facility_current. They are
-- immutable, touch no tables, and take no privileged action.
comment on function public.fn_dc_jds_from_lifecycle(text) is
  'Pure lifecycle -> JDS layer mapping. Executable by authenticated ON PURPOSE: the '
  'security_invoker views call it. Immutable, no table access.';
comment on function public.fn_dc_jsonb_to_text_array(jsonb) is
  'Pure jsonb array -> text[] helper. Executable by authenticated ON PURPOSE: the '
  'jw_facilities compatibility view calls it. Immutable, no table access.';
