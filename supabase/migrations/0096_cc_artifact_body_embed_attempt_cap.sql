-- CC-ARTIFACT-BODY-FETCH Phase 2 — embed "Everything" (Myke 2026-09-28) for the SEC lane.
--
-- Before opening the sec embed gate: a row whose embed keeps failing (OpenAI 400, a
-- replace error, a worker killed mid-row) would be re-claimed at the head of every
-- invocation and re-billed by OpenAI each time. Mirror the fetch lane's rule — charge
-- the attempt at CLAIM time, so even a killed worker counts — and stop claiming a row
-- after 3 attempts. The counter lives in body_meta.embed_attempts (body_* only).
-- No edge-function change: success is still stamped by artifact_body_replace_chunks.
create or replace function public.artifact_body_embed_claim(p_lane text, p_limit integer, p_lease_seconds integer default 170)
returns table(artifact_id uuid, raw_content text, body_text text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  update public.artifact_body_fetch_lanes l
     set embed_lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where l.lane = p_lane
     and l.embed_enabled
     and (l.embed_lease_until is null or l.embed_lease_until <= now());
  if not found then return; end if;

  return query
  with picked as (
    select a.artifact_id
      from public.artifacts a
     where public.artifact_body_lane(a.source_type::text, a.source_url) = p_lane
       and (case when p_lane = 'sec' then a.source_type = 'sec_filing'
                 else a.source_type not in ('sec_filing', 'web_news') end)
       and a.body_fetch_status = 'ok'
       and a.body_embedded_at is null
       and a.body_char_count >= 2 * length(coalesce(a.raw_content, ''))
       and a.body_char_count >= length(coalesce(a.raw_content, '')) + 500
       and coalesce((a.body_meta->>'embed_attempts')::int, 0) < 3
       and public.artifact_should_chunk(a.artifact_id)
     order by coalesce((a.body_meta->>'embed_attempts')::int, 0), a.body_fetched_at, a.artifact_id
     limit p_limit
  ), charged as (
    update public.artifacts a
       set body_meta = coalesce(a.body_meta, '{}'::jsonb)
                       || jsonb_build_object('embed_attempts', coalesce((a.body_meta->>'embed_attempts')::int, 0) + 1,
                                             'embed_claimed_at', now())
      from picked p
     where a.artifact_id = p.artifact_id
    returning a.artifact_id, a.raw_content, a.body_text, a.body_fetched_at
  )
  select c.artifact_id, c.raw_content, c.body_text from charged c order by c.body_fetched_at, c.artifact_id;
end $function$;

revoke all on function public.artifact_body_embed_claim(text, integer, integer) from public, anon, authenticated;
grant execute on function public.artifact_body_embed_claim(text, integer, integer) to service_role;
