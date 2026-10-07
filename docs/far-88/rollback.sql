-- UN-APPLIED — rollback for 20261009200000_local_watch_query_scoping.sql (FDY-88).
-- Run ONLY if the v2 local-gov queries need to be reverted. Restores
-- fetch_config.query from fetch_config.query_v1 and rebuilds feed_url / url
-- from it, then removes the query_v1 / query_rev markers.
--
-- Safe to run exactly once, after the forward migration. It asserts that every
-- gsearch:loc-% row still carries query_v1 before touching anything.

begin;

do $guard$
declare
  n_live int;
  n_v1   int;
begin
  select count(*) into n_live from public.source_registry where source_key like 'gsearch:loc-%';
  select count(*) into n_v1 from public.source_registry
    where source_key like 'gsearch:loc-%' and fetch_config ? 'query_v1';
  if n_v1 <> n_live then
    raise exception 'FDY-88 rollback: % of % gsearch:loc-%% rows have no query_v1 — refusing', n_live - n_v1, n_live;
  end if;
end
$guard$;

update public.source_registry sr
set fetch_config = (sr.fetch_config
                      || jsonb_build_object('query', sr.fetch_config -> 'query_v1'))
                   - 'query_v1' - 'query_rev',
    feed_url = 'https://news.google.com/rss/search?q='
               || public.gsearch_seed_url(sr.fetch_config ->> 'query_v1')
               || '&hl=en-US&gl=US&ceid=US:en',
    url      = 'https://news.google.com/search?q='
               || public.gsearch_seed_url('"' || split_part(sr.fetch_config ->> 'entity', ',', 1) || '" '
                                          || btrim(split_part(sr.fetch_config ->> 'entity', ',', 2))),
    updated_at = now()
where sr.source_key like 'gsearch:loc-%';

do $verify$
declare n int;
begin
  select count(*) into n from public.source_registry
    where source_key like 'gsearch:loc-%'
      and (fetch_config ? 'query_v1' or fetch_config ? 'query_rev');
  if n <> 0 then
    raise exception 'FDY-88 rollback: % rows still carry query_v1/query_rev', n;
  end if;
end
$verify$;

commit;
