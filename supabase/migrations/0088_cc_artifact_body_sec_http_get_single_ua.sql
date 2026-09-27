-- CC-ARTIFACT-BODY-FETCH-1.0 Phase 2 — fix the SEC fetch RPC's User-Agent.
--
-- Probe 2a (2026-09-27): both requests 403'd — 21:51 "Request Rate Threshold
-- Exceeded", 21:58 "Your Request Originates from an Undeclared Automated Tool".
-- Root cause is documented in fn_sec_edgar_fts_ingest (verified live 2026-08-01):
-- an http_header('User-Agent', ...) is sent IN ADDITION to pgsql-http's built-in
-- UA, and SEC rejects a request carrying two User-Agent headers as undeclared.
-- The fix is not a different identity: it is ONE User-Agent header, set through
-- CURLOPT_USERAGENT (replaces the default rather than adding a second), carrying
-- the declared organisation + contact email SEC's fair-access policy asks for.
-- Options are session-level on pooled connections, so they are reset after every
-- call (other SEC jobs rely on the extension defaults).
create or replace function public.artifact_body_sec_http_get(p_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_ua   text;
  v_resp extensions.http_response;
  v_ct   text;
begin
  if p_url !~* '^https://(www\.|data\.)?sec\.gov/' then
    raise exception 'artifact_body_sec_http_get: sec.gov URLs only (got %)', left(p_url, 120);
  end if;
  select user_agent into v_ua from public.artifact_body_fetch_lanes where lane = 'sec';
  perform extensions.http_set_curlopt('CURLOPT_USERAGENT', v_ua);
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');
  v_resp := extensions.http((
    'GET', p_url,
    array[extensions.http_header('Accept', 'text/html,text/plain,application/xhtml+xml,*/*;q=0.5')],
    null, null)::extensions.http_request);
  perform extensions.http_reset_curlopt();
  select h.value into v_ct from unnest(v_resp.headers) h where lower(h.field) = 'content-type' limit 1;
  return jsonb_build_object(
    'status', v_resp.status,
    'content_type', coalesce(v_resp.content_type, v_ct),
    'bytes', octet_length(v_resp.content),
    'content', v_resp.content);
exception when others then
  perform extensions.http_reset_curlopt();
  return jsonb_build_object('status', null, 'error', left(sqlerrm, 300));
end $$;
revoke all on function public.artifact_body_sec_http_get(text) from public, anon, authenticated;
grant execute on function public.artifact_body_sec_http_get(text) to service_role;
