-- CC-STATE-BRIEF-SCAFFOLD-1.0 / Work Package B tooling
-- Exception-safe HTTP probes used to verify the local-news funnel and by the
-- weekly Data Scout (D10) / staleness re-checks (D4).
--
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-07-31 as
--   jw_probe_feed_helper -> jw_probe_feed_helper_v2 -> jw_probe_robots_helper
--   -> jw_probe_functions_lock_down
-- and consolidated here into final state.
--
-- Uses the `http` extension (extensions schema, v1.6) rather than pg_net: the
-- probe needs the response body synchronously to count feed items. Note the
-- extension whitelists curlopts - CURLOPT_FOLLOWLOCATION is NOT permitted, so
-- redirects are followed by hand off the Location header.

create or replace function jw_probe_feed(p_url text, p_timeout_ms int default 15000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  resp     extensions.http_response;
  body     text;
  loc      text;
  cur      text := p_url;
  hops     int  := 0;
  n_item   int  := 0;
  n_entry  int  := 0;
  kind     text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', p_timeout_ms::text);

  loop
    resp := extensions.http_get(cur);
    exit when resp.status not in (301,302,303,307,308) or hops >= 4;
    loc := (select value from unnest(resp.headers) h where lower(h.field)='location' limit 1);
    exit when loc is null;
    cur  := case when loc ~ '^https?://' then loc
                 else regexp_replace(cur, '^(https?://[^/]+).*$', '\1') || loc end;
    hops := hops + 1;
  end loop;

  body := coalesce(resp.content, '');

  n_item  := (length(body) - length(replace(body, '<item>',  ''))) / 6
           + (length(body) - length(replace(body, '<item ',  ''))) / 6;
  n_entry := (length(body) - length(replace(body, '<entry>', ''))) / 7
           + (length(body) - length(replace(body, '<entry ', ''))) / 7;

  kind := case
            when body ~* '<rss[ >]'  or n_item  > 0 then 'rss'
            when body ~* '<feed[ >]' or n_entry > 0 then 'atom'
            when left(ltrim(body),1) in ('{','[')   then 'json'
            else 'unknown'
          end;

  -- ok requires BOTH a 2xx and at least one item: a 200 that returns a
  -- login wall or an empty feed is not a usable source (D4).
  return jsonb_build_object(
    'ok',           resp.status between 200 and 299 and greatest(n_item,n_entry) > 0,
    'status',       resp.status,
    'final_url',    cur,
    'hops',         hops,
    'content_type', (select value from unnest(resp.headers) h where lower(h.field)='content-type' limit 1),
    'bytes',        length(body),
    'items',        greatest(n_item, n_entry),
    'kind',         kind,
    'title',        substring(body from '<title[^>]*>(?:<!\[CDATA\[)?\s*([^<\]]{1,120})')
  );
exception when others then
  return jsonb_build_object('ok', false, 'status', null, 'items', 0,
                            'kind', 'error', 'error', left(sqlerrm, 300));
end;
$$;

-- Conservative robots.txt check for a feed URL (D13 compliance posture).
-- Returns robots_ok=null when robots.txt itself could not be fetched - the
-- caller must treat null as "unknown", never as "allowed".
create or replace function jw_probe_robots(p_url text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  root  text := regexp_replace(p_url, '^(https?://[^/]+).*$', '\1');
  path  text := coalesce(nullif(regexp_replace(p_url, '^https?://[^/]+', ''), ''), '/');
  resp  extensions.http_response;
  body  text;
  ln    text;
  ua_all boolean := false;
  rule  text;
  blocked boolean := false;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
  resp := extensions.http_get(root || '/robots.txt');
  if resp.status = 404 then
    return jsonb_build_object('robots_ok', true, 'basis', 'no robots.txt');
  elsif resp.status < 200 or resp.status > 299 then
    return jsonb_build_object('robots_ok', null, 'basis', 'robots fetch HTTP '||resp.status);
  end if;

  body := coalesce(resp.content,'');
  foreach ln in array string_to_array(replace(body, E'\r', ''), E'\n') loop
    ln := btrim(split_part(ln, '#', 1));
    continue when ln = '';
    if lower(ln) ~ '^user-agent\s*:' then
      ua_all := btrim(split_part(ln, ':', 2)) = '*';
    elsif ua_all and lower(ln) ~ '^disallow\s*:' then
      rule := btrim(substring(ln from position(':' in ln)+1));
      if rule <> '' and position(rule in path) = 1 then
        blocked := true;
      end if;
    end if;
  end loop;

  return jsonb_build_object('robots_ok', not blocked,
                            'basis', case when blocked then 'Disallow matches feed path'
                                          else 'allowed for User-agent: *' end);
exception when others then
  return jsonb_build_object('robots_ok', null, 'basis', left(sqlerrm,120));
end;
$$;

-- Both functions fetch an ARBITRARY caller-supplied URL server-side as
-- SECURITY DEFINER, so an anon/authenticated EXECUTE grant is an SSRF vector
-- reachable through PostgREST. Revoking from anon/authenticated alone is NOT
-- enough - both inherit the default PUBLIC grant, so PUBLIC must be revoked
-- explicitly. (Caught by the security advisor: 4 new WARNs, now cleared.)
revoke all on function jw_probe_feed(text,int)  from public, anon, authenticated;
revoke all on function jw_probe_robots(text)    from public, anon, authenticated;
grant execute on function jw_probe_feed(text,int) to service_role;
grant execute on function jw_probe_robots(text)   to service_role;
