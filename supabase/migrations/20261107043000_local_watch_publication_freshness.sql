-- UN-APPLIED — requires Myke's approval (apply via apply_migration)
--
-- FDY-154 · CC-LOCAL-WATCH-FRESHNESS-1.0 — local-watch publication freshness guard.
--
-- Why: on 2026-10-09 the local-watch corpus showed max(published_at) = 2026-09-05 while
-- the poller was still writing rows, and every health signal read green
-- (consecutive_failures = 0, fetches succeeding). The lane reported success while
-- delivering nothing dated. Re-measured 2026-11-06 22:32 CT: the symptom no longer
-- reproduces (4,786 rows discovered since 2026-09-06, 0 null published_at, newest
-- published 2026-11-06 20:01 UTC). This view exists so a recurrence is visible instead
-- of reading green.
--
-- One row per ISO week of discovered_at over the last 12 weeks.
--   flag = 'LAG'   when lag_days   > 7    (newest publication trails newest discovery)
--          'NULLS' when null_share > 0.2  (rows arriving without a publication date)
--          'ok'    otherwise
-- LAG is checked first: a week can be both, and a stalled date is the worse failure.
-- A week whose rows are ALL undated has lag_days NULL and null_share 1 → 'NULLS'.
--
-- Local-watch membership uses the `= any(array(select …))` form on purpose — see the
-- FDY-90 changelog note: the EXISTS / CTE-join forms take 10–12 s on production because
-- the planner underestimates the artifacts side; the InitPlan array form takes < 1 s.
--
-- Read-only, internal health view: security_invoker, no anon/authenticated access,
-- select granted to service_role only. Not wired to any alert or cron (out of scope).

create or replace view public.v_local_watch_publication_freshness
with (security_invoker = true)
as
with lw as (
  select a.discovered_at, a.published_at
    from public.artifacts a
   where a.crawl_metadata->>'feed_url' = any (
           array(select sr.feed_url
                   from public.source_registry sr
                  where sr.source_key like 'gsearch:loc-%'
                    and sr.feed_url is not null))
     and a.discovered_at >= date_trunc('week', now()) - interval '11 weeks'
),
wk as (
  select date_trunc('week', discovered_at)::date            as week,
         count(*)                                           as rows_discovered,
         count(published_at)                                as rows_with_published_at,
         count(*) - count(published_at)                     as null_published_at,
         round((count(*) - count(published_at))::numeric
               / nullif(count(*), 0), 4)                    as null_share,
         max(published_at)                                  as max_published_at,
         max(discovered_at)                                 as max_discovered_at
    from lw
   group by 1
)
select week,
       rows_discovered,
       rows_with_published_at,
       null_published_at,
       null_share,
       max_published_at,
       max_discovered_at,
       (max_discovered_at::date - max_published_at::date)  as lag_days,
       case
         when (max_discovered_at::date - max_published_at::date) > 7 then 'LAG'
         when null_share > 0.2                                       then 'NULLS'
         else 'ok'
       end                                                  as flag
  from wk
 order by week;

comment on view public.v_local_watch_publication_freshness is
  'FDY-154: weekly freshness of local-watch (gsearch:loc-%) artifacts by discovered week, last 12 weeks. '
  'flag LAG when lag_days > 7, NULLS when null_share > 0.2, else ok. service_role only.';

revoke all on public.v_local_watch_publication_freshness from public;
revoke all on public.v_local_watch_publication_freshness from anon;
revoke all on public.v_local_watch_publication_freshness from authenticated;
grant select on public.v_local_watch_publication_freshness to service_role;
