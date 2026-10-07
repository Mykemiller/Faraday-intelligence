-- UN-APPLIED — applied by Myke on merge
--
-- FDY-89 · L2 · Fix source-poller starvation of the local gov watch.
--
-- Ships three objects, all read-only helpers — no DML, no schema change to
-- source_registry, no trigger, no cron edit:
--
--   public.poller_cadence_interval(text) -> interval
--   public.poller_select_due(int)        -> TABLE(...)   [SECURITY DEFINER]
--   public.v_poller_lag_by_segment       -> view
--
-- ROOT CAUSE this replaces (measured read-only on project ycadmmngkdhvpcsrcuaq,
-- 2026-10-07, by replaying the deployed v1.8 selection as SQL):
--   all 80 slots of a run went to daily segments — dc_operators 61,
--   hyperscalers 18, federal_gov 1 — and ZERO to any weekly segment, while
--   895 of 1,000 local_gov rows were due and 873 were more than 2x overdue.
--   Two compounding defects:
--     1. the priority-cadence pool is concatenated ahead of the general pool
--        with no ceiling, and the priority cohort (1,312 rows on a 20h
--        interval = ~1,566 due events/day) already exceeds the 1,920 slots/day
--        the cron buys, so the general pool is never reached;
--     2. ordering is absolute `last_fetch_at ASC`, i.e. wall-clock staleness,
--        not staleness relative to the promised cadence — a daily row 1.05x
--        overdue outranks a weekly row 5.9x overdue, and inside the priority
--        lane the 7 hourly rows at 10x overdue lost to 320 daily rows at 1.05x.
--
-- The fix: rank by OVERDUE RATIO (now - due_at) / interval(cadence), and give
-- named segments a per-run floor so an arithmetically larger cohort can never
-- crowd them out. Unused floor spills to the global ranking.
--
-- The TypeScript reference implementation is
-- supabase/functions/source-poller/poller-schedule.ts; the edge function calls
-- poller_select_due() and falls back to that module when this migration has not
-- been applied yet. test/source-poller-schedule.test.mjs reads THIS FILE and
-- asserts the cadence table and the local_gov floor below match the TS
-- constants, so the two cannot drift.

begin;

-- ---------------------------------------------------------------------------
-- 1. cadence -> interval. Mirrors CADENCE_MINUTES in poller-schedule.ts.
--    Unknown/NULL cadence is treated as daily, never as "skip".
-- ---------------------------------------------------------------------------
create or replace function public.poller_cadence_interval(p_cadence text)
returns interval
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case p_cadence
    when 'hourly'           then interval '50 minutes'      -- 50
    when 'daily'            then interval '1200 minutes'    -- 1200
    when 'weekly'           then interval '9360 minutes'    -- 9360 (6.5 days)
    when 'event_driven'     then interval '1200 minutes'    -- 1200
    when 'archival_refresh' then interval '38880 minutes'   -- 38880 (27 days)
    when 'one_time'         then interval '525600 minutes'  -- 525600 (365 days)
    else                         interval '1200 minutes'    -- default: daily
  end
$$;

comment on function public.poller_cadence_interval(text) is
  'FDY-89: cadence -> minimum interval between polls. Canonical mirror of CADENCE_MINUTES in supabase/functions/source-poller/poller-schedule.ts.';

-- ---------------------------------------------------------------------------
-- 2. Fair due-selection.
--
--    due_at        = last_fetch_at + interval(cadence); NULL last_fetch_at is
--                    "never fetched" and ranks as the most overdue thing there
--                    is (sentinel ratio 1e9 — matches NEVER_FETCHED_RATIO).
--    overdue_ratio = (now() - due_at) / interval(cadence)
--    order         = overdue_ratio desc, created_at asc (FIFO), source_key asc
--    floor         = local_gov is guaranteed ceil(p_limit * 0.25) of each run's
--                    slots WHILE it has due rows. A floor, not a cap: local_gov
--                    rows can also win ordinary slots on merit, and any part of
--                    the floor it cannot fill spills to the global ranking.
--
--    STABLE + SECURITY DEFINER: reads source_registry only, writes nothing.
--    It exists so the selection cannot be skewed by whatever row-visibility the
--    caller happens to have, exactly like public.artifact_body_fetch_claim.
-- ---------------------------------------------------------------------------
create or replace function public.poller_select_due(p_limit integer default 80)
returns table (
  source_key    text,
  segment       text,
  cadence       text,
  last_fetch_at timestamptz,
  due_at        timestamptz,
  overdue_ratio numeric,
  quota_lane    text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with p as (
    select greatest(coalesce(p_limit, 80), 0)::int as lim,
           0.25::numeric                           as local_gov_floor,
           now()                                   as t
  ),
  due as (
    select r.source_key::text                                        as source_key,
           coalesce(r.fetch_config->>'segment', '(none)')::text      as segment,
           r.cadence::text                                           as cadence,
           r.last_fetch_at,
           r.created_at,
           r.last_fetch_at + public.poller_cadence_interval(r.cadence) as due_at,
           case
             when r.last_fetch_at is null then 1000000000::numeric
             else round(
               extract(epoch from (p.t - (r.last_fetch_at + public.poller_cadence_interval(r.cadence))))::numeric
               / extract(epoch from public.poller_cadence_interval(r.cadence))::numeric, 6)
           end                                                       as overdue_ratio
    from public.source_registry r
    cross join p
    where r.subsystem = 'poller'
      and r.status    = 'active'
      and r.feed_url is not null
      and (r.last_fetch_at is null
           or r.last_fetch_at + public.poller_cadence_interval(r.cadence) <= p.t)
  ),
  loc as (
    select d.source_key,
           row_number() over (order by d.overdue_ratio desc,
                                       coalesce(d.created_at, '-infinity'::timestamptz),
                                       d.source_key) as rn
    from due d
    where d.segment = 'local_gov'
  ),
  floor_sel as (
    select l.source_key
    from loc l cross join p
    where l.rn <= ceil(p.lim * p.local_gov_floor)
  ),
  rest_sel as (
    select d.source_key,
           row_number() over (order by d.overdue_ratio desc,
                                       coalesce(d.created_at, '-infinity'::timestamptz),
                                       d.source_key) as rn
    from due d
    where not exists (select 1 from floor_sel f where f.source_key = d.source_key)
  ),
  picked as (
    select f.source_key, 'floor:local_gov'::text as quota_lane from floor_sel f
    union all
    select r.source_key, 'overdue_rank'::text
    from rest_sel r cross join p
    where r.rn <= p.lim - (select count(*) from floor_sel)
  )
  select d.source_key, d.segment, d.cadence, d.last_fetch_at, d.due_at,
         d.overdue_ratio, k.quota_lane
  from picked k
  join due d on d.source_key = k.source_key
  order by d.overdue_ratio desc,
           coalesce(d.created_at, '-infinity'::timestamptz),
           d.source_key;
$$;

comment on function public.poller_select_due(integer) is
  'FDY-89: fair due-selection for the source-poller run lane. Ranks by overdue ratio (now - due_at)/interval(cadence); local_gov holds a floor of ceil(p_limit*0.25) slots while it has due rows, and unused floor spills. Read-only.';

revoke all on function public.poller_select_due(integer) from public;
grant execute on function public.poller_select_due(integer) to service_role;
grant execute on function public.poller_cadence_interval(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Lag observability. One row per (segment, cadence).
-- ---------------------------------------------------------------------------
create or replace view public.v_poller_lag_by_segment as
select
  coalesce(r.fetch_config->>'segment', '(none)')::text as segment,
  r.cadence::text                                      as cadence,
  count(*)                                             as total,
  count(*) filter (
    where r.last_fetch_at is null
       or r.last_fetch_at + public.poller_cadence_interval(r.cadence) <= now()
  )                                                    as due_now,
  count(*) filter (
    where r.last_fetch_at is null
       or r.last_fetch_at + 2 * public.poller_cadence_interval(r.cadence) <= now()
  )                                                    as overdue_gt_2x,
  min(r.last_fetch_at)                                 as oldest_last_fetch
from public.source_registry r
where r.subsystem = 'poller'
  and r.status    = 'active'
  and r.feed_url is not null
group by 1, 2;

comment on view public.v_poller_lag_by_segment is
  'FDY-89: per-segment/cadence poller lag. due_now and overdue_gt_2x count never-fetched rows as overdue. Active poller rows with a feed_url only.';

grant select on public.v_poller_lag_by_segment to service_role;

commit;
