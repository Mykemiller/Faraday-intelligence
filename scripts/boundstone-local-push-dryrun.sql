-- boundstone-local-push-dryrun.sql — FDY-91.
--
-- READ-ONLY. Answers "if the bridge ran today, what would it forward, and to
-- which states?" without writing a byte. Run it against Faraday
-- (ycadmmngkdhvpcsrcuaq) exactly as it is:
--
--   psql "$FARADAY_DB_URL" -f scripts/boundstone-local-push-dryrun.sql
--
-- The first statement is `set default_transaction_read_only = on`, so the file
-- cannot write even by accident.
--
-- ===========================================================================
-- ⚠️ WHY THIS FILE EXISTS, AND WHY ITS ANSWER IS CONDITIONAL
-- ===========================================================================
-- The bridge forwards a row only when crawl_metadata->>'publisher_url' is not
-- null. Measured live 2026-10-07: that key is present on ZERO of the 54,211
-- local-watch artifacts, because FDY-90's resolver is shipped but UN-APPLIED
-- and its lane ships disabled. So "how many rows are eligible today?" has the
-- literal answer 0, and that number tells you nothing about the bridge.
--
-- What this file measures instead is the part that does NOT depend on the
-- resolver: of the rows FDY-90 will resolve, how many can this bridge honestly
-- attribute to a state, and which states. That is the bridge's own ceiling, and
-- the resolver's success rate (50/50 on a live sample, FDY-90) sets how much of
-- it arrives. Every number below is therefore labelled CONDITIONAL on Myke
--
--   (1) applying supabase/migrations/20261009220000_gnews_resolve_schedule.sql,
--   (2) opening the gate:
--         update public.artifact_body_fetch_lanes
--            set fetch_enabled = true, aggregator_robots_ack = true
--          where lane = 'gnews_local';
--       (Myke's decision D5, FDY-98 resolved as Option 1 — not performed here.)
--
-- ===========================================================================
-- ⚠️ THIS SQL IS A MIRROR OF attribution-pure.ts, NOT THE IMPLEMENTATION
-- ===========================================================================
-- The bridge attributes states in TypeScript. This file re-implements the same
-- three rules in SQL so the question can be asked of all 6,157 rows at once
-- without moving the corpus off the database.
--
-- Two implementations of one rule is a real hazard, so it is pinned rather than
-- hoped: §6 emits 40 real headlines with this file's verdict for each, and those
-- 40 rows are committed as test/fixtures/local-watch-attribution.tsv. The test
-- `test/boundstone-local-push.test.mjs` runs attribution-pure.ts over them and
-- asserts it agrees with this file, row for row. If the two ever drift, that
-- test goes red and this file's totals stop being quotable.
-- ===========================================================================

set default_transaction_read_only = on;

create temporary view dryrun_lw as
  select a.artifact_id, a.published_at, a.raw_content, a.source_url
    from public.artifacts a
    join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
   where s.source_key like 'gsearch:loc-%'
     and a.raw_content ~* 'data ?cent'
     and a.published_at >= '2026-07-01';

-- headline-pure.ts extractHeadline(), in SQL. `pub` is everything after the
-- LAST '&nbsp;&nbsp;'; line 1 must end in ' - ' || pub or the row is declined.
create temporary view dryrun_headline as
  select artifact_id, published_at, source_url, pub,
         btrim(left(l1, length(l1) - length(' - ' || pub))) as headline
    from (
      select artifact_id, published_at, source_url,
             btrim(split_part(raw_content, E'\n', 1)) as l1,
             btrim(reverse(split_part(reverse(raw_content), reverse('&nbsp;&nbsp;'), 1))) as pub
        from dryrun_lw
    ) x
   where coalesce(pub, '') <> ''
     and l1 like '% - ' || pub
     and btrim(left(l1, length(l1) - length(' - ' || pub))) <> '';

-- normalizeJurisdiction() / foldHeadline(), in SQL.
create temporary view dryrun_folded as
  select artifact_id, published_at, headline,
         ' ' || btrim(regexp_replace(lower(translate(headline, U&'\2018\2019\02BC\2013\2014', '''''''--')),
                                     '\s+', ' ', 'g')) || ' ' as folded
    from dryrun_headline;

create temporary view dryrun_gaz as
  select name,
         upper(btrim(state_abbr)) as st,
         level::text as lvl,
         btrim(regexp_replace(
           regexp_replace(lower(translate(name, U&'\2018\2019\02BC', '''''')), '\s+', ' ', 'g'),
           '\s+(county|parish|city and borough|borough|city|town|village|township|municipality|plantation|gore|district|reservation)$',
           '')) as norm
    from public.jurisdictions
   where level::text in ('county', 'cousub', 'place')
     and btrim(coalesce(state_abbr, '')) ~ '^[A-Za-z]{2}$'
     and btrim(coalesce(name, '')) <> '';

create temporary view dryrun_gazf as
  select * from dryrun_gaz where length(norm) >= 4;

create temporary view dryrun_states as
  select distinct lower(btrim(name)) as nm, upper(btrim(state_abbr)) as ab
    from public.jurisdictions
   where level::text = 'state'
     and btrim(coalesce(state_abbr, '')) ~ '^[A-Za-z]{2}$'
     and btrim(coalesce(name, '')) <> '';

-- extractPhrases(). The three forms, with the same 1-3 word NAME and the same
-- lower-case connective continuation (Lac qui Parle County).
create temporary view dryrun_phrases as
  select distinct f.artifact_id, m.kind,
         btrim(regexp_replace(
           regexp_replace(lower(translate(m.txt, U&'\2018\2019\02BC', '''''')), '\s+', ' ', 'g'),
           '\s+(county|parish|city and borough|borough|city|town|village|township|municipality|plantation|gore|district|reservation)$',
           '')) as text
    from dryrun_folded f
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

create temporary view dryrun_phrasesf as
  select * from dryrun_phrases where length(text) >= 4;

-- kindsFor(): a "X Township" headline matches a county SUBDIVISION, never a
-- place called X. This is what stops "Center Township" matching every Center.
create temporary view dryrun_hits as
  select p.artifact_id, g.st, g.name, p.kind
    from dryrun_phrasesf p
    join dryrun_gazf g on g.norm = p.text
   where (p.kind = 'county'   and g.lvl = 'county')
      or (p.kind = 'township' and g.lvl = 'cousub')
      or (p.kind = 'cityof'   and g.lvl in ('place', 'cousub'));

-- S1, with the "Michigan City" guard: drop a bare state-name match when the
-- state name plus the following word is itself a gazetteer key.
create temporary view dryrun_s1 as
  select distinct f.artifact_id, s.ab
    from dryrun_folded f
    join dryrun_states s on position(' ' || s.nm || ' ' in f.folded) > 0
   where not exists (
     select 1 from dryrun_gazf g
      where g.norm = s.nm || ' ' || regexp_replace(
              split_part(substr(f.folded, position(' ' || s.nm || ' ' in f.folded) + length(s.nm) + 2), ' ', 1),
              '[^a-z'']', '', 'g')
   );

create temporary view dryrun_verdict as
  select f.artifact_id, f.published_at, f.headline,
         case
           when s1.n = 1 then s1.ab
           when hs.n = 1 then hs.st
           when hs.n > 1 and s3.n = 1 then s3.code
         end as state_abbr,
         case
           when s1.n = 1 then 's1_state_name'
           when hs.n = 1 then 's2_unique_jurisdiction'
           when hs.n > 1 and s3.n = 1 then 's3_abbr_agrees'
         end as state_rule,
         case
           when s1.n = 1 or hs.n = 1 or (hs.n > 1 and s3.n = 1) then null
           when coalesce(s1.n, 0) > 1 then 'ambiguous_state_named'
           when coalesce(hs.n, 0) > 1 then 'ambiguous_jurisdiction'
           else 'no_honest_state'
         end as reason
    from dryrun_folded f
    left join (select artifact_id, count(*) n, min(ab) ab from dryrun_s1 group by 1) s1
           on s1.artifact_id = f.artifact_id
    left join (select artifact_id, count(distinct st) n, min(st) st from dryrun_hits group by 1) hs
           on hs.artifact_id = f.artifact_id
    left join (
      -- S3: an unambiguous USPS code that AGREES with a jurisdiction present in
      -- the headline. Refused on a SHOUTY headline, where every word is upper
      -- case and a two-letter token carries no signal.
      select f2.artifact_id, count(distinct c.code) n, min(c.code) code
        from dryrun_folded f2
        cross join lateral (
          select mm[1] as code from regexp_matches(f2.headline, '\y([A-Z]{2})\y', 'g') mm
        ) c
       where c.code in (select ab from dryrun_states)
         and c.code in (select st from dryrun_hits h where h.artifact_id = f2.artifact_id)
         and length(regexp_replace(f2.headline, '[^A-Za-z]', '', 'g')) >= 12
         and length(regexp_replace(f2.headline, '[^A-Z]', '', 'g'))::numeric
             / length(regexp_replace(f2.headline, '[^A-Za-z]', '', 'g')) <= 0.6
       group by 1
    ) s3 on s3.artifact_id = f.artifact_id;

-- nameWithin(): exactly one distinct jurisdictions.name inside the resolved
-- state, or null. Never a guess and never a concatenation.
create temporary view dryrun_named as
  select v.artifact_id, v.state_abbr, v.state_rule, v.reason, v.headline, v.published_at,
         case when n.c = 1 then n.nm end as jurisdiction_name,
         -- The restriction test, applied to the HEADLINE, both halves required:
         -- a restriction verb AND a local-government noun.
         (v.headline ~* '(moratori|\yban\y|\ybans\y|\ybanned\y|\ypause|ordinance|rezon|prohibit)'
          and v.headline ~* '(count(y|ies)|parish|township|city|town|village|borough|board|commission|council|supervisor|trustee|zoning|planning|aldermen|selectmen)')
           as is_candidate
    from dryrun_verdict v
    left join (
      select h.artifact_id, count(distinct h.name) c, min(h.name) nm
        from dryrun_hits h
        join dryrun_verdict v2 on v2.artifact_id = h.artifact_id and v2.state_abbr = h.st
       group by 1
    ) n on n.artifact_id = v.artifact_id;

-- ===========================================================================
-- §1 the corpus
-- ===========================================================================
\echo '== §1 corpus =='
select (select count(*) from dryrun_lw)                as relevant_window,
       (select count(*) from dryrun_headline)          as headline_recovered,
       (select count(*) from dryrun_lw)
         - (select count(*) from dryrun_headline)      as headline_unrecoverable,
       (select count(distinct split_part(split_part(source_url, '/rss/articles/', 2), '?', 1))
          from dryrun_lw)                              as distinct_gnews_tokens,
       (select count(*) from public.artifacts a
          join public.source_registry s on s.feed_url = a.crawl_metadata->>'feed_url'
         where s.source_key like 'gsearch:loc-%'
           and a.crawl_metadata->>'publisher_url' is not null) as publisher_url_today;

-- ===========================================================================
-- §2 what the three rules settle
-- ===========================================================================
\echo '== §2 attribution rules =='
select coalesce(state_rule, 'DECLINED: ' || reason) as outcome,
       count(*) as artifacts,
       count(distinct state_abbr) as states
  from dryrun_named group by 1 order by 2 desc;

-- ===========================================================================
-- §3 press items and candidates, BY STATE — the brief's deliverable
-- ===========================================================================
\echo '== §3 by state =='
select state_abbr,
       count(*)                                        as press_items,
       count(*) filter (where is_candidate)            as record_candidates,
       count(jurisdiction_name)                        as with_jurisdiction_name,
       count(*) - count(jurisdiction_name)             as state_only
  from dryrun_named
 where state_abbr is not null
 group by 1 order by 2 desc, 1;

\echo '== §3 totals =='
select count(*)                                        as press_items,
       count(*) filter (where is_candidate)            as record_candidates,
       count(jurisdiction_name)                        as with_jurisdiction_name,
       count(distinct state_abbr)                      as states
  from dryrun_named where state_abbr is not null;

-- ===========================================================================
-- §4 the cost of honesty — what is declined, and why
-- ===========================================================================
\echo '== §4 declined =='
select reason, count(*) as artifacts from dryrun_named
 where state_abbr is null group by 1 order by 2 desc;

-- ===========================================================================
-- §5 guardrail 6: not one aggregator URL could reach Boundstone
-- ===========================================================================
\echo '== §5 aggregator urls in the corpus =='
select count(*) as rows_on_news_google,
       count(*) filter (where source_url !~* '^https?://news\.google\.') as rows_not_on_news_google
  from dryrun_lw;

-- ===========================================================================
-- §6 the 40-row fixture this file and the TypeScript are pinned against
-- ===========================================================================
\echo '== §6 fixture rows (tab-separated; paste into test/fixtures/local-watch-attribution.tsv) =='
select headline || E'\t' || coalesce(state_abbr, '') || E'\t'
    || coalesce(jurisdiction_name, '') || E'\t'
    || coalesce(state_rule, '') || E'\t' || coalesce(reason, '')
  from dryrun_named
 order by md5(artifact_id::text)
 limit 40;
