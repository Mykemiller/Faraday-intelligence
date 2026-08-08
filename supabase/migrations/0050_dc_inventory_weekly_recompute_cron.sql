-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 7 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808213125
--   dc_inventory_0050_weekly_recompute_cron
--
-- Weekly recompute of jds_layer + FCS + band + publishable, logged to
-- automation_health_log as AUTO-207.
--
-- Deliberately a PLAIN SQL cron, not cron_http_post(). Per CLAUDE.md,
-- cron_http_post returns the moment pg_net QUEUES the request, so
-- cron.job_run_details reads 'succeeded' even when the work 401s or dies
-- mid-run. A direct SQL job's status is the real outcome.
-- =====================================================================

drop function if exists public.fn_dc_recompute_facility_scores();

create function public.fn_dc_recompute_facility_scores()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_started    timestamptz := clock_timestamp();
  v_total      int;
  v_changed    int;
  v_publish    int;
  v_err        text;
begin
  select count(*) into v_total from public.dc_facilities;

  with recomputed as (
    select fac.id,
           public.dc_compute_jds_layer(fac.id)   as jds_layer,
           c.score, c.band,
           public.dc_compute_publishable(fac.id) as publishable
    from public.dc_facilities fac
    cross join lateral public.dc_compute_facility_confidence(fac.id) c
  ),
  moved as (
    update public.dc_facilities f
    set jds_layer                 = r.jds_layer,
        facility_confidence_score = r.score,
        facility_confidence_band  = r.band,
        publishable               = r.publishable
    from recomputed r
    where f.id = r.id
      and (f.jds_layer                 is distinct from r.jds_layer
        or f.facility_confidence_score is distinct from r.score
        or f.facility_confidence_band  is distinct from r.band
        or f.publishable               is distinct from r.publishable)
    returning 1
  )
  select count(*) into v_changed from moved;

  select count(*) into v_publish from public.dc_facilities where publishable;

  insert into public.automation_health_log
    (auto_id, crawler_id, run_started_at, run_completed_at,
     artifacts_found, artifacts_new, artifacts_duped, errors, success, notes)
  values
    ('AUTO-207', 'dc-facility-score-recompute_v1.0', v_started, clock_timestamp(),
     v_total, v_changed, v_total - v_changed, '[]'::jsonb, true,
     jsonb_build_object('facilities', v_total, 'rows_changed', v_changed,
                        'publishable', v_publish)::text);

  return jsonb_build_object('facilities', v_total, 'rows_changed', v_changed,
                            'publishable', v_publish, 'success', true);
exception when others then
  v_err := sqlerrm;
  insert into public.automation_health_log
    (auto_id, crawler_id, run_started_at, run_completed_at,
     artifacts_found, artifacts_new, artifacts_duped, errors, success, notes)
  values
    ('AUTO-207', 'dc-facility-score-recompute_v1.0', v_started, clock_timestamp(),
     0, 0, 0, jsonb_build_array(jsonb_build_object('error', v_err)), false,
     'dc facility score recompute FAILED');
  raise;
end;
$$;

comment on function public.fn_dc_recompute_facility_scores() is
  'Weekly recompute of dc_facilities.jds_layer / facility_confidence_score / band / '
  'publishable from the observations. Writes ONLY computed columns - never an ingest path. '
  'Logs one automation_health_log row per run as AUTO-207, including on failure.';

revoke all on function public.fn_dc_recompute_facility_scores() from public, anon, authenticated;
grant execute on function public.fn_dc_recompute_facility_scores() to service_role;

-- Sunday 06:00 UTC
select cron.unschedule('dc-facility-score-recompute-weekly')
where exists (select 1 from cron.job where jobname = 'dc-facility-score-recompute-weekly');

select cron.schedule(
  'dc-facility-score-recompute-weekly',
  '0 6 * * 0',
  $cron$ select public.fn_dc_recompute_facility_scores(); $cron$
);
