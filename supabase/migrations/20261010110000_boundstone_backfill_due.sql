-- UN-APPLIED — applied by Myke on merge
-- ===========================================================================
-- 20261010110000 — FDY-92: a window-bounded, keyset-paged twin of
--                  public.boundstone_push_due, for the one-off backfill.
-- ===========================================================================
--
-- Depends on 20261009230000 (FDY-91), which must be applied first: this file
-- reads public.boundstone_push_ledger and the $ordering$ block below refuses
-- without it. 20261009230000 in turn refuses without FDY-90's 20261009220000.
--
-- ---------------------------------------------------------------------------
-- ⚠️ WHY A SECOND FUNCTION EXISTS AT ALL, GIVEN THAT COPYING A PREDICATE IS
--    THE THING ONE SHOULD NOT DO
-- ---------------------------------------------------------------------------
-- scripts/boundstone-local-backfill.ts has to do two things the hourly lane
-- never does: walk 2026-07-01 → today in WEEKLY SLICES, and honour --since /
-- --until. public.boundstone_push_due(int) cannot express either. It takes one
-- argument, a limit, and caps it internally at 500 — so a caller cannot reach
-- row 501 and cannot ask for one week.
--
-- Three ways to avoid a second function were tried first, and each one is worse:
--
--   (a) Call boundstone_push_due(500) in a loop. It works in --apply, because
--       every pushed artifact gains a ledger row and drops out of the next
--       call. It does NOT work in --dry-run, which writes nothing: the same
--       oldest 500 rows come back forever. A dry run that can only ever see
--       the first 500 of 6,157 rows is not a dry run of this backfill.
--
--   (b) Filter/offset the RPC's result through PostgREST. The function's own
--       `limit` is applied inside, before PostgREST sees a row, so `offset=500`
--       returns nothing. Paging has to happen in SQL or not at all.
--
--   (c) Page public.artifacts directly from the script. Two blockers, either
--       fatal. First, eligibility needs
--       `source_registry.source_key like 'gsearch:loc-%'` joined on
--       `source_registry.feed_url = artifacts.crawl_metadata->>'feed_url'` —
--       a jsonb-expression join with no foreign key, which PostgREST cannot
--       express at all. Second, the script would have to SELECT raw_content to
--       recover the headline, and FDY-91 deliberately kept the article body out
--       of the caller's memory (see boundstone_push_due's comment: "the caller
--       cannot forward a body it was never given"). Re-opening that is a
--       regression dressed as an optimisation.
--
-- So the predicate is copied, and the copy is PINNED rather than trusted:
--   * gate G2 below asserts both function bodies carry the same four
--     eligibility fragments, so editing one and not the other fails the apply;
--   * gate G3 asserts the two functions return the SAME ROWS for the same
--     window — vacuously true today (both return 0; see below) and meaningful
--     the moment FDY-90's gate opens, and the notice says which case it was;
--   * scripts/boundstone-local-backfill-pglite.mjs proves the paging property
--     that no amount of reading can prove — that a keyset walk enumerates every
--     eligible row exactly once — on a seeded local database;
--   * test/boundstone-local-backfill.test.mjs §6 reads both migration files and
--     fails if the clause lists drift.
--
-- ---------------------------------------------------------------------------
-- ⚠️ IT RETURNS ZERO ROWS TODAY, AND THAT IS THE CORRECT ANSWER
-- ---------------------------------------------------------------------------
-- Measured live on ycadmmngkdhvpcsrcuaq, read-only, 2026-10-09 20:16 CT:
--     local-watch artifacts (source_key like 'gsearch:loc-%')        54,231
--     ... matching 'data ?cent'                                      13,820
--     ... and published_at >= 2026-07-01  (the backfill window)        6,157
--     ... with crawl_metadata->>'publisher_url' not null                   0
--     max applied migration version                        20261009090756
--
-- publisher_url appears only after Myke (a) applies FDY-90's 20261009220000 and
-- (b) opens its gate (his decision D5, FDY-98 resolved as Option 1):
--     update public.artifact_body_fetch_lanes
--        set fetch_enabled = true, aggregator_robots_ack = true
--      where lane = 'gnews_local';
-- Nothing in this file, in the backfill script, or in this PR performs it.
--
-- ---------------------------------------------------------------------------
-- ⚠️ TWO COLUMNS boundstone_push_due DOES NOT RETURN, AND WHY A BACKFILL NEEDS
--    THEM: body_fetch_status AND body_fetched_at
-- ---------------------------------------------------------------------------
-- Boundstone's press_items.retrieved_at is NOT NULL so the site never publishes
-- a link nobody fetched. The hourly lane sends `retrieved_at: now()` and
-- `http_status: 200` because it is pushing an article resolved minutes earlier,
-- so now() is true to the minute.
--
-- A BACKFILL CANNOT SAY THAT. Stamping a 12 July article with today's timestamp
-- would be a false claim about when the publisher URL was fetched, on a column
-- that exists to carry exactly that claim — and guardrail 7 says a press item is
-- transcribed, not computed. So this function returns FDY-90's own measurement,
-- public.artifacts.body_fetch_status and .body_fetched_at, and the script maps
--     body_fetch_status = 'ok'  →  http_status 200, retrieved_at body_fetched_at
--     anything else            →  no proof of retrieval; the row is DEFERRED
-- The deferral is not ledgered, deliberately: see the script's header. A row
-- whose body fetch has simply not happened yet must stay available to the hourly
-- lane, and a ledger row is forever.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CANNOT DO
-- ---------------------------------------------------------------------------
-- * It cannot write. `stable`, which Postgres itself enforces, and gate G1
--   asserts the volatility rather than trusting the declaration.
-- * It cannot reach Boundstone. Nothing here knows that project exists.
-- * It cannot return article text. The eight returned columns are named below
--   and raw_content is not one of them; the two strings the headline is
--   recovered from are produced by the same two splits headline-pure.ts uses.
-- * It cannot widen the window. p_since earlier than 2026-07-01 is ignored,
--   because the 2026-07-01 floor is a decision (Boundstone release v2026.07)
--   and not a default.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Ordering guard — outside begin; so a refusal leaves no aborted
--    transaction for a hand-applying operator.
-- ---------------------------------------------------------------------------
do $ordering$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.boundstone_push_ledger') is null then
    v_missing := v_missing ||
      ('public.boundstone_push_ledger — apply 20261009230000_boundstone_push_ledger.sql '
       || '(FDY-91) first. This file reads that table.')::text;
  end if;
  if to_regprocedure('public.boundstone_push_due(int)') is null then
    v_missing := v_missing ||
      ('public.boundstone_push_due(int) — apply 20261009230000_boundstone_push_ledger.sql '
       || '(FDY-91) first. Gates G2 and G3 compare this file against it.')::text;
  end if;
  if to_regclass('public.artifacts') is null then
    v_missing := v_missing || 'public.artifacts does not exist — wrong database'::text;
  end if;
  if to_regclass('public.source_registry') is null then
    v_missing := v_missing || 'public.source_registry does not exist — wrong database'::text;
  end if;

  if cardinality(v_missing) > 0 then
    raise exception E'20261010110000 cannot apply — missing dependencies:\n  %',
      array_to_string(v_missing, E'\n  ');
  end if;
end
$ordering$;

begin;

-- ---------------------------------------------------------------------------
-- 1. public.boundstone_backfill_due(...) — READ-ONLY.
-- ---------------------------------------------------------------------------
-- Keyset cursor, not OFFSET: (published_at, artifact_id) is the same total order
-- the function returns, so `p_after_*` resumes exactly where the previous page
-- stopped. OFFSET would re-walk the prefix on every page and, worse, would skip
-- rows in --apply mode as ledgered rows drop out from under it.
create or replace function public.boundstone_backfill_due(
  p_since           timestamptz default timestamptz '2026-07-01 00:00:00+00',
  p_until           timestamptz default null,
  p_limit           int         default 100,
  p_after_published timestamptz default null,
  p_after_id        uuid        default null
)
returns table (
  artifact_id       uuid,
  published_at      timestamptz,
  publisher_url     text,
  publisher_domain  text,
  rss_line1         text,
  rss_publisher     text,
  body_fetch_status text,
  body_fetched_at   timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.artifact_id,
         a.published_at,
         a.crawl_metadata->>'publisher_url'    as publisher_url,
         a.crawl_metadata->>'publisher_domain' as publisher_domain,
         btrim(split_part(a.raw_content, E'\n', 1)) as rss_line1,
         -- everything after the LAST '&nbsp;&nbsp;' — headline-pure.ts's own
         -- rule, byte for byte the expression boundstone_push_due uses, so the
         -- two functions and the TypeScript cannot disagree about which
         -- substring is the publisher.
         btrim(reverse(split_part(reverse(a.raw_content), reverse('&nbsp;&nbsp;'), 1))) as rss_publisher,
         a.body_fetch_status,
         a.body_fetched_at
    from public.artifacts a
    join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
   where s.source_key like 'gsearch:loc-%'
     and a.crawl_metadata->>'publisher_url' is not null
     and a.raw_content ~* 'data ?cent'
     -- Both floors, deliberately. The literal is FDY-91's and is the decision;
     -- p_since can only ever narrow it.
     and a.published_at >= timestamptz '2026-07-01 00:00:00+00'
     and a.published_at >= coalesce(p_since, timestamptz '2026-07-01 00:00:00+00')
     and (p_until is null or a.published_at < p_until)
     and (p_after_published is null
          or (a.published_at, a.artifact_id) > (p_after_published, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
     and not exists (
       select 1 from public.boundstone_push_ledger l where l.artifact_id = a.artifact_id
     )
   order by a.published_at asc, a.artifact_id asc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

comment on function public.boundstone_backfill_due(timestamptz, timestamptz, int, timestamptz, uuid) is
  'FDY-92. READ-ONLY. The same eligibility predicate as public.boundstone_push_due(int) — '
  'local-watch source_key, publisher_url resolved by FDY-90, raw_content matching ''data ?cent'', '
  'published_at >= 2026-07-01, not already in boundstone_push_ledger — with a [p_since, p_until) '
  'window and a (published_at, artifact_id) keyset cursor, which boundstone_push_due cannot '
  'express and which scripts/boundstone-local-backfill.ts needs for weekly slices and for a '
  'dry run that writes nothing yet still advances past row 500. p_since can only narrow the '
  '2026-07-01 floor, never widen it. Also returns body_fetch_status and body_fetched_at so a '
  'backfill can transcribe FDY-90''s retrieval measurement instead of stamping now(). Returns '
  'raw_content NEVER, and 0 rows until FDY-90 is applied and its gate opened.';

revoke all on function public.boundstone_backfill_due(timestamptz, timestamptz, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.boundstone_backfill_due(timestamptz, timestamptz, int, timestamptz, uuid)
  to service_role;

commit;

-- ===========================================================================
-- Gates. Read-only throughout: this file inserts nothing, anywhere, so there is
-- no residue to prove absent — only that nothing moved and nothing leaked.
-- ===========================================================================
do $gate$
declare
  v_artifacts_before bigint;
  v_ledger_before    bigint;
  v_n                bigint;
  v_m                bigint;
  v_t                text;
  v_body_new         text;
  v_body_old         text;
  v_frag             text;
begin
  select count(*) into v_artifacts_before from public.artifacts;
  select count(*) into v_ledger_before    from public.boundstone_push_ledger;

  -- G1 — read-only in the strongest sense available: Postgres refuses a write
  -- inside a `stable` function, so this is enforcement and not a promise.
  if (select provolatile from pg_proc
       where oid = 'public.boundstone_backfill_due(timestamptz,timestamptz,int,timestamptz,uuid)'::regprocedure) <> 's' then
    raise exception 'G1 FAILED: boundstone_backfill_due is not STABLE, so it could write.';
  end if;

  -- G2 — THE ANTI-DRIFT GATE. Every eligibility fragment must appear in BOTH
  -- function bodies. Edit the predicate in one file and forget the other, and
  -- the apply stops here rather than producing a backfill that selects a
  -- different set of articles from the lane it is backfilling.
  select prosrc into v_body_new from pg_proc
   where oid = 'public.boundstone_backfill_due(timestamptz,timestamptz,int,timestamptz,uuid)'::regprocedure;
  select prosrc into v_body_old from pg_proc
   where oid = 'public.boundstone_push_due(int)'::regprocedure;

  foreach v_frag in array array[
    's.source_key like ''gsearch:loc-%''',
    'a.crawl_metadata->>''publisher_url'' is not null',
    'a.raw_content ~* ''data ?cent''',
    'a.published_at >= timestamptz ''2026-07-01 00:00:00+00''',
    'public.boundstone_push_ledger l where l.artifact_id = a.artifact_id',
    'btrim(split_part(a.raw_content, E''\n'', 1))',
    'btrim(reverse(split_part(reverse(a.raw_content), reverse(''&nbsp;&nbsp;''), 1)))'
  ] loop
    if position(v_frag in v_body_new) = 0 then
      raise exception 'G2 FAILED: boundstone_backfill_due has lost the clause: %', v_frag;
    end if;
    if position(v_frag in v_body_old) = 0 then
      raise exception 'G2 FAILED: boundstone_push_due no longer carries the clause: %. '
                      'The two predicates have drifted; reconcile 20261009230000 and '
                      '20261010110000 before applying.', v_frag;
    end if;
  end loop;

  -- G2b — and neither returns the body. A column named raw_content on either
  -- function would hand an article body to the caller.
  if exists (
    select 1 from pg_proc p, unnest(p.proargnames) n
     where p.oid in ('public.boundstone_backfill_due(timestamptz,timestamptz,int,timestamptz,uuid)'::regprocedure,
                     'public.boundstone_push_due(int)'::regprocedure)
       and lower(n) in ('raw_content','body','body_text','extract','excerpt','summary')
  ) then
    raise exception 'G2b FAILED: one of the two due functions returns article text.';
  end if;

  -- G3 — SAME ROWS. Over the backfill's own window with no cursor, the two
  -- functions must agree exactly. Today both return 0 and this is vacuous; the
  -- notice says so rather than letting a reader mistake it for a measurement.
  select count(*) into v_n from public.boundstone_push_due(500);
  select count(*) into v_m from public.boundstone_backfill_due(
    timestamptz '2026-07-01 00:00:00+00', null, 500, null, null);
  if v_n <> v_m then
    raise exception 'G3 FAILED: boundstone_push_due(500) returned % rows, '
                    'boundstone_backfill_due(same window, 500) returned %.', v_n, v_m;
  end if;
  if exists (
    select 1 from (
      select artifact_id from public.boundstone_push_due(500)
      except
      select artifact_id from public.boundstone_backfill_due(
        timestamptz '2026-07-01 00:00:00+00', null, 500, null, null)
      union all
      select artifact_id from public.boundstone_backfill_due(
        timestamptz '2026-07-01 00:00:00+00', null, 500, null, null)
      except
      select artifact_id from public.boundstone_push_due(500)
    ) d
  ) then
    raise exception 'G3 FAILED: the two due functions disagree about which artifacts are eligible.';
  end if;
  if v_n = 0 then
    raise notice '20261010110000 G3: both due functions return 0 rows, so the row-for-row '
                 'agreement is VACUOUS today. Expected: publisher_url is null on every '
                 'local-watch artifact until FDY-90 (20261009220000) is applied and its '
                 'gnews_local gate opened. G2 pinned the predicates textually instead.';
  else
    raise notice '20261010110000 G3: the two due functions agree row for row on % eligible '
                 'artifacts.', v_n;
  end if;

  -- G4 — the window floor is a floor. Asking for June cannot reach June.
  if exists (
    select 1 from public.boundstone_backfill_due(
      timestamptz '2020-01-01 00:00:00+00', null, 500, null, null) d
     where d.published_at < timestamptz '2026-07-01 00:00:00+00'
  ) then
    raise exception 'G4 FAILED: p_since widened the window below the 2026-07-01 floor.';
  end if;

  -- G5 — the surface. anon and authenticated reach nothing.
  v_t := 'boundstone_backfill_due(timestamptz,timestamptz,int,timestamptz,uuid)';
  if has_function_privilege('anon', 'public.' || v_t, 'EXECUTE') then
    raise exception 'G5 FAILED: anon can execute public.%', v_t;
  end if;
  if has_function_privilege('authenticated', 'public.' || v_t, 'EXECUTE') then
    raise exception 'G5 FAILED: authenticated can execute public.%', v_t;
  end if;
  if not has_function_privilege('service_role', 'public.' || v_t, 'EXECUTE') then
    raise exception 'G5 FAILED: service_role cannot execute public.%', v_t;
  end if;

  -- G6 — nothing moved. This file has no INSERT, UPDATE or DELETE in it; the
  -- gate proves the claim rather than asking to be believed.
  select count(*) into v_n from public.artifacts;
  if v_n <> v_artifacts_before then
    raise exception 'G6 FAILED: artifacts moved (% -> %).', v_artifacts_before, v_n;
  end if;
  select count(*) into v_n from public.boundstone_push_ledger;
  if v_n <> v_ledger_before then
    raise exception 'G6 FAILED: % ledger rows before, % after.', v_ledger_before, v_n;
  end if;

  raise notice '20261010110000 gates passed: the selector is STABLE, its predicate is pinned '
               'clause-for-clause to boundstone_push_due, it returns no article text, the '
               '2026-07-01 floor cannot be widened, anon reaches nothing, and nothing moved.';
end
$gate$;

-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   drop function if exists public.boundstone_backfill_due(
--     timestamptz, timestamptz, int, timestamptz, uuid);
--
-- Safe at any time and in any order. Nothing depends on this function except
-- scripts/boundstone-local-backfill.ts, which is a one-off operator script and
-- not on any schedule; the hourly lane uses boundstone_push_due and is
-- unaffected. Dropping it deletes no row and re-offers no artifact.
