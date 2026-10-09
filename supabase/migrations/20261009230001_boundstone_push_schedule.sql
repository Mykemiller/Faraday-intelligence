-- UN-APPLIED — applied by Myke on merge
-- ===========================================================================
-- 20261009230001 — FDY-91: the hourly schedule for boundstone-local-push
-- ===========================================================================
--
-- Separate from 20261009230000 on purpose. The ledger and its three functions
-- are the change; the cron job is the decision to RUN it. Myke can apply the
-- first and hold the second, and turning the lane off later is
-- `cron.unschedule` rather than a migration that has to be reasoned about.
--
-- ---------------------------------------------------------------------------
-- HOURLY AT :40 — and why that is safe next to FDY-90's jobs
-- ---------------------------------------------------------------------------
-- The brief specifies hourly at :40. FDY-90's `gnews-resolve-20min` also fires
-- at :40 (it runs :00/:20/:40), so the two overlap once an hour. That was
-- checked rather than assumed, and it is harmless:
--
--   * They share no lease. gnews-resolve holds artifact_body_fetch_lanes'
--     fetch_lease_until; this job takes no lease at all, because the ledger's
--     primary key is its idempotency key.
--   * They write disjoint objects. gnews-resolve writes crawl_metadata and
--     body_*; this one writes only public.boundstone_push_ledger.
--   * The worst case is a read skew of one batch: up to 30 artifacts resolved
--     during this run's SELECT are not visible to it. They are picked up at
--     :40 the next hour. No row is lost, nothing is double-sent, and nothing
--     needs a lock to make that true.
--
-- NO HOUR GUARD, deliberately. The 0022/0026/FDY-62 hour-guard pattern exists
-- for jobs that must fire at a particular LOCAL time, where the UTC expression
-- drifts an hour across DST. This job is hourly: every hour is the right hour
-- in every timezone, so a guard would add a branch that can only ever be true.
--
-- NOT ENABLED ON ITS OWN. The function exits 0 and ledgers nothing unless
-- BOUNDSTONE_PUSH_ENABLED=true is set as a secret, and it ledgers every row
-- 'skipped'/'no_credential' until `boundstone_push_jwt` is in the Vault. So it
-- is safe for this job to exist from the moment it is applied; the live switch
-- is Myke's, in step 5 of the PR body.
-- ===========================================================================

do $ordering$
begin
  if to_regprocedure('public.boundstone_push_due(int)') is null then
    raise exception '20261009230001 cannot apply — public.boundstone_push_due(int) is missing. '
                    'Apply 20261009230000_boundstone_push_ledger.sql first.';
  end if;
  if to_regprocedure('public.cron_http_post(text,jsonb,text,integer)') is null then
    raise exception '20261009230001 cannot apply — public.cron_http_post(text,jsonb,text,integer) '
                    'is missing. It is the shared cron caller every other job in this repo uses; '
                    'this file must not invent a second one.';
  end if;
end
$ordering$;

begin;

select cron.unschedule(jobid) from cron.job where jobname = 'boundstone-local-push-hourly';

-- limit 100 is the brief's batch size. One invocation is bounded by the edge
-- function's own 130 s budget, well inside pg_net's 150 s timeout below.
select cron.schedule('boundstone-local-push-hourly', '40 * * * *',
  $$select public.cron_http_post('https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/boundstone-local-push',
      '{"mode":"push","limit":100}'::jsonb, 'cron_caller_token', 150000)$$);

commit;

do $gate$
declare
  v_schedule text;
  v_command  text;
  v_active   boolean;
  v_n        integer;
begin
  select schedule, command, active into v_schedule, v_command, v_active
    from cron.job where jobname = 'boundstone-local-push-hourly';

  if v_schedule is null then
    raise exception 'G1 FAILED: the job was not installed.';
  end if;
  if v_schedule <> '40 * * * *' then
    raise exception 'G1 FAILED: schedule is %, expected ''40 * * * *''.', v_schedule;
  end if;
  if not v_active then
    raise exception 'G1 FAILED: the job is installed inactive.';
  end if;

  -- Exactly one job, so a re-apply cannot leave two hourly pushes running.
  select count(*) into v_n from cron.job where jobname = 'boundstone-local-push-hourly';
  if v_n <> 1 then
    raise exception 'G1 FAILED: % jobs named boundstone-local-push-hourly.', v_n;
  end if;

  -- G2 — it calls the right function, in push mode, through the shared caller.
  if v_command not like '%/functions/v1/boundstone-local-push%' then
    raise exception 'G2 FAILED: the command does not call boundstone-local-push: %', v_command;
  end if;
  if v_command not like '%"mode":"push"%' then
    raise exception 'G2 FAILED: the command does not set mode=push: %', v_command;
  end if;
  if v_command not like '%cron_http_post%' then
    raise exception 'G2 FAILED: the command bypasses public.cron_http_post.';
  end if;
  -- ⚠️ No secret, key or token VALUE in the command text. 'cron_caller_token'
  -- is the NAME of a Vault secret that cron_http_post resolves; the token
  -- itself must never be stored in cron.job, which is world-readable to any
  -- role with USAGE on the cron schema.
  if v_command ~ 'eyJ[A-Za-z0-9_-]{10,}' or v_command ~* 'service_role_key|sb_secret' then
    raise exception 'G2 FAILED: the cron command appears to embed a credential.';
  end if;

  -- G3 — FDY-90's jobs are untouched. This file adds a lane; it does not
  -- reschedule somebody else's.
  select count(*) into v_n from cron.job
   where jobname in ('gnews-resolve-20min', 'gnews-body-fetch-20min');
  raise notice 'FDY-90 jobs still present: % of 2 (this file did not touch them).', v_n;

  raise notice '20261009230001 gates passed: one active hourly job at :40, mode=push, through '
               'cron_http_post, with no credential in the command text.';
end
$gate$;

-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   select cron.unschedule(jobid) from cron.job where jobname = 'boundstone-local-push-hourly';
--
-- Unscheduling stops the lane and leaves the ledger intact, so nothing is
-- re-pushed when it is scheduled again.
