-- CC-ARTIFACT-BODY-FETCH-1.0 Phase 2 — SEC access path: pgsql-http's DEFAULT User-Agent
-- (Myke 2026-09-28: "Use the default").
--
-- Probe 2a was refused three times with a declared UA ("Faraday Intelligence LLC
-- mykemiller@gmail.com"), both as an extra header and via CURLOPT_USERAGENT. The daily
-- EDGAR jobs (fn_sec_edgar_fts_ingest, fn_dc_sec_attest) send NO User-Agent override and
-- SEC accepts pgsql-http's default ("pgsql-http/<ver> libcurl/<ver>") from this egress.
-- This RPC now does the same: it resets every curl option first (options are session-level
-- on pooled connections, so a leftover CURLOPT_USERAGENT could otherwise leak in), sets only
-- the timeout, and sends no custom headers at all. Pacing / backoff / the 3-block stop stay
-- in the artifact-body-fetch edge function, unchanged.
create or replace function public.artifact_body_sec_http_get(p_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_resp extensions.http_response;
  v_ct   text;
begin
  if p_url !~* '^https://(www\.|data\.)?sec\.gov/' then
    raise exception 'artifact_body_sec_http_get: sec.gov URLs only (got %)', left(p_url, 120);
  end if;
  perform extensions.http_reset_curlopt();
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');
  v_resp := extensions.http(('GET', p_url, null, null, null)::extensions.http_request);
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

-- Record the access decision on the lane (the column is informational for sec now).
update public.artifact_body_fetch_lanes
   set user_agent = 'pgsql-http default (Myke 2026-09-28); declared UA refused 3x on 2026-09-27',
       updated_at = now()
 where lane = 'sec';
