-- CC-ARTIFACT-BODY-FETCH Phase 2 step 2e — SEC embed driver ("Everything", Myke 2026-09-28).
--
-- Smoke (0097): 2 × 10-K → 558 chunks, 241,580 tokens, 28 s, no worker kill. Wall time is
-- dominated by HNSW inserts, not edge CPU, so a single lane-wide lease would serialise
-- 9.5k docs into ~37 h. Switch the embed claim to a PER-ROW lease: a row claimed within the
-- last p_lease_seconds is skipped, and FOR UPDATE SKIP LOCKED keeps two overlapping
-- invocations off the same row. embed_enabled is still the gate; the 3-attempt cap (0096)
-- still holds. Driver: 2 docs every 20 s (~2 invocations in flight).
create or replace function public.artifact_body_embed_claim(p_lane text, p_limit integer, p_lease_seconds integer default 170)
returns table(artifact_id uuid, raw_content text, body_text text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not exists (select 1 from public.artifact_body_fetch_lanes l where l.lane = p_lane and l.embed_enabled) then
    return;
  end if;

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
       and (a.body_meta->>'embed_claimed_at' is null
            or (a.body_meta->>'embed_claimed_at')::timestamptz < now() - make_interval(secs => p_lease_seconds))
       and public.artifact_should_chunk(a.artifact_id)
     order by coalesce((a.body_meta->>'embed_attempts')::int, 0), a.body_fetched_at, a.artifact_id
     limit p_limit
     for update of a skip locked
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

select cron.schedule('artifact-body-embed-sec', '20 seconds',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/artifact-body-fetch',
      '{"mode":"embed","lane":"sec","limit":2,"lease_seconds":140}'::jsonb, 'cron_caller_token', 150000)$$);
