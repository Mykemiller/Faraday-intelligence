-- boundstone-local-backfill-dryrun.sql — FDY-92.
--
-- READ-ONLY. The backfill's dry-run report, BY STATE and BY WEEKLY SLICE,
-- computed over the whole 2026-07-01 → today window without moving the corpus
-- off the database. Run it against Faraday (ycadmmngkdhvpcsrcuaq) as it is:
--
--   psql "$FARADAY_DB_URL" -v since="'2026-07-01'" -v until="'2026-10-10 02:00+00'" \
--        -f scripts/boundstone-local-backfill-dryrun.sql
--
-- The first statement is `set default_transaction_read_only = on`, so the file
-- cannot write even by accident.
--
-- ===========================================================================
-- WHY THIS FILE EXISTS ALONGSIDE scripts/boundstone-local-backfill.ts
-- ===========================================================================
-- The script is the deliverable; this is how its report was PRODUCED on
-- 2026-10-09, because the script could not be run against production from the
-- authoring session:
--
--   * SUPABASE_SERVICE_ROLE_KEY lives in Env.txt, which this work was barred
--     from opening or locating, so the script's own REST path was unreachable.
--   * Even with the key, the script would have refused: its selector
--     (20261010110000) is un-applied, so preflight() stops before reading an
--     artifact. That refusal is correct, and it is asserted by
--     test/boundstone-local-backfill.test.mjs §3 — but it is not a report.
--
-- Supabase MCP `execute_sql` was available read-only, so the report was measured
-- with this SQL instead. It is a MIRROR of the TypeScript, not the
-- implementation, and the mirror is pinned: it reuses FDY-91's
-- scripts/boundstone-local-push-dryrun.sql rule for rule, and that file is
-- pinned to attribution-pure.ts over 41 real headlines by
-- test/boundstone-local-push.test.mjs. The pin held — see the reconciliation
-- below, which reproduces FDY-91's published totals to the row.
--
-- ⚠️ TWO DELIBERATE DIFFERENCES FROM FDY-91'S VERSION, BOTH TOWARDS THE
--    TYPESCRIPT:
--   1. The restriction regex is push-pure.ts's, exactly: `\yban(s|ned|ning)?\y`
--      and `\ypaus(e|es|ed|ing)\y` rather than the looser `\ypause` prefix, and
--      the local-government noun list is word-anchored and includes
--      'quorum court'. This is why the candidate count below is 231 where
--      FDY-91's file reported 232: the looser prefix matched one extra row.
--   2. Weeks are 7-day slices anchored on `since`, not `date_trunc('week')`.
--      date_trunc would label the first three days of the window 2026-06-29, a
--      date the window does not contain, and would not match the slices the
--      script actually walks.
--
-- ⚠️ IT IS SHARDED IN PRACTICE. Over all 6,157 rows this takes longer than the
-- MCP tool's request timeout, so the measurement below was taken in three
-- consecutive shards on `since`/`until` — 07-01..07-29, 07-29..08-26,
-- 08-26..10-10T02Z — whose `window_rows` sum to exactly 6,157, which is the
-- independently measured size of the window. Under psql there is no timeout and
-- the whole window runs in one pass.
--
-- ===========================================================================
-- THE MEASUREMENT — ycadmmngkdhvpcsrcuaq, read-only, 2026-10-09 20:1x-20:5x CT
-- ===========================================================================
-- CORPUS
--   local-watch artifacts (source_key like 'gsearch:loc-%')         54,231
--   ... matching 'data ?cent'                                       13,820
--   ... and published_at >= 2026-07-01   (the backfill window)       6,157
--   ... distinct Google News tokens in that window                   3,714
--   ... distinct headlines in that window                            3,359
--   ... whose headline could be established                   6,157 (100%)
--   ... whose source_url is NOT on news.google.com                        0
--   ⚠️ ... with crawl_metadata->>'publisher_url' not null                0
--   max applied migration version                          20261009090756
--
-- SO TODAY THE BACKFILL IS ELIGIBLE FOR 0 ROWS. That is the FDY-90 gate, not
-- the bridge: publisher_url appears only after Myke applies 20261009220000 and
-- opens the gnews_local lane (his decision D5, FDY-98 Option 1). Every number
-- below is the PROJECTION for the moment that happens — the bridge's own
-- ceiling, which the resolver's success rate then discounts.
--
-- ATTRIBUTION OVER THE 6,157-ROW WINDOW
--   S1 — an unambiguous full state name                             1,125
--   S2 — a jurisdiction unique to one state nationally                377
--   S3 — a USPS code agreeing with a jurisdiction in the headline        5
--   PRESS ITEMS (total attributable)                      1,507  (43 states)
--     ... also a record candidate (review-only)                        231
--     ... carrying a verbatim jurisdiction_name                        398
--     ... state only                                                 1,109
--   REFUSED: no_honest_state                                         3,930
--   REFUSED: ambiguous_jurisdiction                                    691
--   REFUSED: ambiguous_state_named                                      29
--   TOTAL REFUSED                                          4,650  (75.5%)
--   1,507 + 4,650 = 6,157. The window reconciles exactly.
--
-- These reproduce FDY-91's published figures (1,125 / 377 / 5 / 1,507 / 3,930 /
-- 691 / 29 / 4,650 / 398) to the row, from an independent re-derivation two days
-- later. The one difference is the candidate count — 231, not 232 — explained
-- above.
--
-- ⚠️ 75.5% REFUSED IS THE DESIGN, NOT A SHORTFALL. Taking the FEED's state as a
-- fallback would "resolve" most of those 4,650, and attribution-pure.ts's header
-- lists the five live headlines that shows what it produces: an Alabama
-- moratorium filed under Oregon, a Michigan rezoning filed under Oregon, a
-- Kansas moratorium filed under Oregon. A press item on the wrong state's page
-- on boundstone.org is worse than no press item.
--
-- ⚠️ RESTRICTION VOLUME, MEASURED RATHER THAN QUOTED. The parent brief says
-- "~1,875 restriction-related; 396 local-restriction headlines since 1 Jul".
-- Measured over the same window on 2026-10-09:
--   a restriction VERB anywhere in the headline                       1,694
--   both halves (verb AND local-government noun) — the real test        958
--   ... distinct headlines among those                                  502
--   ... and attributable to a state, so actually proposed                231
-- The brief's 1,875 is close to the verb-only 1,694; its 396 sits between the
-- 502 distinct restriction headlines and the 231 that can be honestly placed.
--
-- ⚠️ FIVE OF THE FIFTEEN WEEKLY SLICES ARE EMPTY, AND IT IS NOT THIS LANE.
-- max(published_at) across ALL 54,231 local-watch artifacts is
-- 2026-09-05 14:05+00, and ZERO rows carry a later published_at — while
-- max(discovered_at) is 2026-10-09 18:12+00 and 48 rows were discovered since
-- 6 September. So the poller is still running and still writing rows, but
-- nothing it has written in the last five weeks claims a publication date in
-- those weeks. Nothing in FDY-92 causes or fixes that; it is recorded here
-- because it is why the by-week table below stops at 2026-09-02, and a reader
-- would otherwise suspect the slices.
-- ===========================================================================

set default_transaction_read_only = on;

\if :{?since}
\else
  \set since '2026-07-01'
\endif
\if :{?until}
\else
  \set until '2026-10-10 02:00+00'
\endif

-- ---------------------------------------------------------------------------
-- The window, and headline-pure.ts's two splits in SQL. `pub` is everything
-- after the LAST '&nbsp;&nbsp;'; line 1 must end in ' - ' || pub or the row is
-- declined rather than cut somewhere plausible.
-- ---------------------------------------------------------------------------
create temporary view bf_lw as
  select a.artifact_id, a.published_at, a.raw_content, a.source_url
    from public.artifacts a
    join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
   where s.source_key like 'gsearch:loc-%'
     and a.raw_content ~* 'data ?cent'
     and a.published_at >= greatest(timestamptz '2026-07-01 00:00:00+00', :'since'::timestamptz)
     and a.published_at <  :'until'::timestamptz;

create temporary view bf_headline as
  select artifact_id, published_at, source_url, pub,
         btrim(left(l1, length(l1) - length(' - ' || pub))) as headline
    from (
      select artifact_id, published_at, source_url,
             btrim(split_part(raw_content, E'\n', 1)) as l1,
             btrim(reverse(split_part(reverse(raw_content), reverse('&nbsp;&nbsp;'), 1))) as pub
        from bf_lw
    ) x
   where coalesce(pub, '') <> ''
     and l1 like '% - ' || pub
     and btrim(left(l1, length(l1) - length(' - ' || pub))) <> '';

create temporary view bf_folded as
  select artifact_id, published_at, headline,
         ' ' || btrim(regexp_replace(lower(translate(headline, U&'\2018\2019\02BC\2013\2014', '''''''--')),
                                     '\s+', ' ', 'g')) || ' ' as folded
    from bf_headline;

create temporary view bf_gazf as
  select name, upper(btrim(state_abbr)) as st, level::text as lvl,
         btrim(regexp_replace(
           regexp_replace(lower(translate(name, U&'\2018\2019\02BC', '''''')), '\s+', ' ', 'g'),
           '\s+(county|parish|city and borough|borough|city|town|village|township|municipality|plantation|gore|district|reservation)$',
           '')) as norm
    from public.jurisdictions
   where level::text in ('county', 'cousub', 'place')
     and btrim(coalesce(state_abbr, '')) ~ '^[A-Za-z]{2}$'
     and btrim(coalesce(name, '')) <> '';

create temporary view bf_gazff as select * from bf_gazf where length(norm) >= 4;

create temporary view bf_states as
  select distinct lower(btrim(name)) as nm, upper(btrim(state_abbr)) as ab
    from public.jurisdictions
   where level::text = 'state'
     and btrim(coalesce(state_abbr, '')) ~ '^[A-Za-z]{2}$'
     and btrim(coalesce(name, '')) <> '';

-- ⚠️ A PERFORMANCE DECISION THAT IS ALSO AN EQUIVALENCE. S1's "Michigan City"
-- guard asks whether `<state name> <next word>` is itself a gazetteer key. Every
-- such key begins with a state name followed by a space, so probing this ~300-row
-- view instead of all 38,887 is the same question asked of the same rows.
-- Without it the whole file exceeds the MCP request timeout.
create temporary view bf_compound as
  select distinct g.norm from bf_gazff g
   where exists (select 1 from bf_states s where g.norm like s.nm || ' %');

-- extractPhrases(): the three forms, same 1-3 word NAME, same lower-case
-- connective continuation (Lac qui Parle County).
create temporary view bf_phrases as
  select distinct f.artifact_id, m.kind,
         btrim(regexp_replace(
           regexp_replace(lower(translate(m.txt, U&'\2018\2019\02BC', '''''')), '\s+', ' ', 'g'),
           '\s+(county|parish|city and borough|borough|city|town|village|township|municipality|plantation|gore|district|reservation)$',
           '')) as text
    from bf_folded f
    cross join lateral (
      select 'county'::text as kind, mm[1] as txt
        from regexp_matches(f.headline,
          '([A-Z][A-Za-z''’.-]*(?:[ -](?:qui|la|le|des|du|of|the|[A-Z][A-Za-z''’.-]*)){0,2})[ \t]+(?:County|Parish)\y', 'g') mm
      union all
      select 'township', mm[1]
        from regexp_matches(f.headline,
          '([A-Z][A-Za-z''’.-]*(?:[ -](?:qui|la|le|des|du|of|the|[A-Z][A-Za-z''’.-]*)){0,2})[ \t]+Township\y', 'g') mm
      union all
      select 'cityof', mm[1]
        from regexp_matches(f.headline,
          '(?:City|Town|Village|Borough)[ \t]+of[ \t]+([A-Z][A-Za-z''’.-]*(?:[ -](?:qui|la|le|des|du|of|the|[A-Z][A-Za-z''’.-]*)){0,2})', 'g') mm
    ) m;

create temporary view bf_phrasesf as select * from bf_phrases where length(text) >= 4;

-- kindsFor(): "X Township" matches a county SUBDIVISION, never a place called X.
create temporary view bf_hits as
  select p.artifact_id, g.st, g.name, p.kind
    from bf_phrasesf p
    join bf_gazff g on g.norm = p.text
   where (p.kind = 'county'   and g.lvl = 'county')
      or (p.kind = 'township' and g.lvl = 'cousub')
      or (p.kind = 'cityof'   and g.lvl in ('place', 'cousub'));

create temporary view bf_s1 as
  select distinct f.artifact_id, s.ab
    from bf_folded f
    join bf_states s on position(' ' || s.nm || ' ' in f.folded) > 0
   where not exists (
     select 1 from bf_compound c
      where c.norm = s.nm || ' ' || regexp_replace(
              split_part(substr(f.folded, position(' ' || s.nm || ' ' in f.folded) + length(s.nm) + 2), ' ', 1),
              '[^a-z'']', '', 'g')
   );

create temporary view bf_verdict as
  select f.artifact_id, f.published_at, f.headline,
         case when s1.n = 1 then s1.ab
              when hs.n = 1 then hs.st
              when hs.n > 1 and s3.n = 1 then s3.code end as state_abbr,
         case when s1.n = 1 then 's1_state_name'
              when hs.n = 1 then 's2_unique_jurisdiction'
              when hs.n > 1 and s3.n = 1 then 's3_abbr_agrees' end as state_rule,
         case when s1.n = 1 or hs.n = 1 or (hs.n > 1 and s3.n = 1) then null
              when coalesce(s1.n, 0) > 1 then 'ambiguous_state_named'
              when coalesce(hs.n, 0) > 1 then 'ambiguous_jurisdiction'
              else 'no_honest_state' end as reason
    from bf_folded f
    left join (select artifact_id, count(*) n, min(ab) ab from bf_s1 group by 1) s1
           on s1.artifact_id = f.artifact_id
    left join (select artifact_id, count(distinct st) n, min(st) st from bf_hits group by 1) hs
           on hs.artifact_id = f.artifact_id
    left join (
      -- S3, refused on a SHOUTY headline where a two-letter token carries no signal.
      select f2.artifact_id, count(distinct c.code) n, min(c.code) code
        from bf_folded f2
        cross join lateral (
          select mm[1] as code from regexp_matches(f2.headline, '\y([A-Z]{2})\y', 'g') mm
        ) c
       where c.code in (select ab from bf_states)
         and c.code in (select st from bf_hits h where h.artifact_id = f2.artifact_id)
         and length(regexp_replace(f2.headline, '[^A-Za-z]', '', 'g')) >= 12
         and length(regexp_replace(f2.headline, '[^A-Z]', '', 'g'))::numeric
             / length(regexp_replace(f2.headline, '[^A-Za-z]', '', 'g')) <= 0.6
       group by 1
    ) s3 on s3.artifact_id = f.artifact_id;

create temporary view bf_named as
  select v.artifact_id, v.published_at, v.headline, v.state_abbr, v.state_rule, v.reason,
         case when n.c = 1 then n.nm end as jurisdiction_name,
         -- push-pure.ts restrictionKeywords(), exactly: BOTH halves required.
         (v.headline ~* '(moratori|\yban(s|ned|ning)?\y|\ypaus(e|es|ed|ing)\y|ordinance|rezon|prohibit)'
          and v.headline ~* '\y(count(y|ies)|parish|township|city|town|village|borough|board|commission(ers?)?|council|supervisors?|trustees?|zoning|planning|aldermen|selectmen|quorum court)\y')
           as is_candidate,
         -- The script's weekly slice label: 7 days anchored on `since`.
         to_char(greatest(timestamptz '2026-07-01 00:00:00+00', :'since'::timestamptz)
                 + (floor(extract(epoch from (v.published_at
                     - greatest(timestamptz '2026-07-01 00:00:00+00', :'since'::timestamptz))) / 604800)::int
                    * interval '7 days'), 'YYYY-MM-DD') as slice_start
    from bf_verdict v
    left join (
      select h.artifact_id, count(distinct h.name) c, min(h.name) nm
        from bf_hits h
        join bf_verdict v2 on v2.artifact_id = h.artifact_id and v2.state_abbr = h.st
       group by 1
    ) n on n.artifact_id = v.artifact_id;

-- ===========================================================================
-- §1 the corpus, and the number the whole report is conditional on
-- ===========================================================================
\echo '== §1 corpus =='
select (select count(*) from bf_lw)                                   as window_rows,
       (select count(*) from bf_headline)                             as headline_recovered,
       (select count(*) from bf_lw) - (select count(*) from bf_headline) as headline_unrecoverable,
       (select count(distinct split_part(split_part(source_url, '/rss/articles/', 2), '?', 1))
          from bf_lw)                                                 as distinct_gnews_tokens,
       (select count(distinct headline) from bf_headline)             as distinct_headlines,
       (select count(*) from bf_lw where source_url !~* '^https?://news\.google\.') as rows_not_on_news_google,
       -- ⚠️ ZERO today. Everything below is conditional on this becoming non-zero.
       (select count(*) from public.artifacts a
          join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
         where s.source_key like 'gsearch:loc-%'
           and a.crawl_metadata->>'publisher_url' is not null)        as publisher_url_today;

-- ===========================================================================
-- §2 what the three attribution rules settle, and what they refuse
-- ===========================================================================
\echo '== §2 outcomes =='
select coalesce(state_rule, 'REFUSED: ' || reason) as outcome,
       count(*)                                   as artifacts,
       round(100.0 * count(*) / nullif((select count(*) from bf_named), 0), 1) as pct,
       count(distinct state_abbr)                 as states
  from bf_named group by 1 order by 2 desc;

-- ===========================================================================
-- §3 BY STATE — the brief's deliverable
-- ===========================================================================
\echo '== §3 by state =='
select state_abbr,
       count(*)                            as press_items,
       count(*) filter (where is_candidate) as record_candidates,
       count(jurisdiction_name)            as with_jurisdiction_name,
       count(*) - count(jurisdiction_name) as state_only
  from bf_named
 where state_abbr is not null
 group by 1 order by 2 desc, 1;

\echo '== §3 totals =='
select count(*) filter (where state_abbr is not null)                        as press_items,
       count(*) filter (where state_abbr is not null and is_candidate)       as record_candidates,
       count(jurisdiction_name)                                             as with_jurisdiction_name,
       count(distinct state_abbr)                                           as states,
       count(*) filter (where state_abbr is null)                           as refused,
       count(*) filter (where reason in ('ambiguous_jurisdiction','ambiguous_state_named')) as ambiguous
  from bf_named;

-- ===========================================================================
-- §4 BY WEEKLY SLICE — oldest first, exactly the slices the script walks.
--    ⚠️ REFUSALS ARE A COLUMN HERE, NOT A FOOTNOTE.
-- ===========================================================================
\echo '== §4 by weekly slice =='
select slice_start,
       count(*)                                                       as rows_seen,
       count(state_abbr)                                              as press_items,
       count(*) filter (where is_candidate and state_abbr is not null) as record_candidates,
       count(*) filter (where state_abbr is null)                     as refused
  from bf_named group by 1 order by 1;

-- ===========================================================================
-- §5 the restriction volume, measured rather than quoted from the brief
-- ===========================================================================
\echo '== §5 restriction volume =='
select count(*) filter (where headline ~* '(moratori|\yban(s|ned|ning)?\y|\ypaus(e|es|ed|ing)\y|ordinance|rezon|prohibit)')
         as restriction_verb_any,
       count(*) filter (where is_candidate)                            as both_halves,
       count(distinct headline) filter (where is_candidate)            as distinct_restriction_headlines,
       count(*) filter (where is_candidate and state_abbr is not null) as proposed_as_candidates
  from bf_named;

-- ===========================================================================
-- §6 why the last slices are empty — the poller, not this lane
-- ===========================================================================
\echo '== §6 corpus recency =='
select max(a.published_at)  as max_published_at,
       max(a.discovered_at) as max_discovered_at,
       count(*) filter (where a.discovered_at >= now() - interval '30 days') as discovered_last_30d,
       count(*) filter (where a.published_at  >= now() - interval '30 days') as published_last_30d
  from public.artifacts a
  join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
 where s.source_key like 'gsearch:loc-%';

-- ===========================================================================
-- §7 guardrail 6: not one aggregator URL could reach Boundstone
-- ===========================================================================
\echo '== §7 aggregator urls =='
select count(*)                                                                as rows_in_window,
       count(*) filter (where source_url ~* '^https?://news\.google\.')         as source_url_on_news_google,
       count(*) filter (where source_url !~* '^https?://news\.google\.')        as source_url_elsewhere
  from bf_lw;
-- Every row's source_url is a Google News token, so EVERY forwarded URL must
-- come from FDY-90's resolver. decide() refuses an aggregator URL before a
-- payload exists and Boundstone's enforce_press_item() refuses again on insert.
