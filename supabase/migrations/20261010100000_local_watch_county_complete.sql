-- UN-APPLIED — applied by Myke on merge
-- 20261010100000_local_watch_county_complete.sql — FDY-93 (L6)
--
-- Makes the "local gov watch" lane county-complete.
--
-- GENERATED FILE. Do not hand-edit. Regenerate with:
--   node scripts/gen-local-watch-county-complete.mjs
-- Inputs: data/boundstone-jurisdictions-2026-10-07.csv (449 rows, read from
-- Boundstone's public anon REST view on 2026-10-07) and the constants in
-- supabase/functions/source-poller/local-query.ts.
--
-- WHAT IT FIXES (measured read-only on project ycadmmngkdhvpcsrcuaq, 2026-10-07)
--   The lane is 1,000 rows and it is skewed, not sampled: 317 Arkansas and 163
--   North Dakota places out of 1,000. It reaches 301 of 3,222 county-equivalents
--   (9.3%) and 0 county subdivisions, so no Michigan, Ohio or Pennsylvania
--   township is watched at all — and those three states carry more Boundstone
--   records than anywhere else.
--
-- AFTER
--   9,106 rows (8,106 new, 1,000 re-tiered, 0 deleted):
--     t1       440  every Boundstone jurisdiction (444/444 resolved)        daily
--     dc       113  counties with a data-center headline in the last 90d    daily
--     t2     2,925  the remaining county-equivalents                        biweekly
--     t3     5,060  places + townships in the 340 Boundstone-record counties biweekly
--     legacy   568  pre-existing small places outside T1-T3 (kept, not cut) monthly
--   3,222 / 3,222 county-equivalents covered (9.3% -> 100%), including the 78
--   Puerto Rico municipios, the 41 independent cities, the 17 Alaska boroughs,
--   the 11 Alaska census areas, the 9 Connecticut planning regions and DC.
--   dc and t2 are the apply-time split of a fixed 3,038; everything else is pinned.
--
-- BUDGET
--   T2 and T3 are at 'biweekly', not the spec's 'weekly': both rungs of the
--   pre-authorised demotion ladder are applied, and it still does not fit at
--   today's 80 fetches/hour. See "Needs Myke" in the PR and
--   node scripts/check-local-watch-budget.mjs for the arithmetic.
--
-- SAFETY
--   * No row is ever deleted and no source_key is ever rewritten.
--   * Idempotent on source_key. An existing row has only its cadence and its
--     tier metadata set; fetch_config.query / query_v1 / query_rev, feed_url and
--     url are left exactly as FDY-88 wrote them.
--   * Every row is scope='query_feed', countable=false, so this migration cannot
--     change a published count, a confidence_grade, or which records publish.
--   * Reads Boundstone only through the committed snapshot of its public anon
--     REST view. No Faraday -> Boundstone or Boundstone -> Faraday join exists.
--
-- DEPENDS ON
--   20261009200000_local_watch_query_scoping.sql  (FDY-88, query_rev = 2)
--   20261009210000_poller_fair_scheduling.sql     (FDY-89, poller_cadence_interval
--                                                  incl. the 'biweekly' and
--                                                  'monthly' arms this needs)
--   public.gsearch_seed_url(text)                 (migration 0010)

begin;

-- ---------------------------------------------------------------------------
-- 0. public.poller_cadence_interval — re-asserted, see the note in
--    scripts/gen-local-watch-county-complete.mjs. Identical to the definition in
--    20261009210000_poller_fair_scheduling.sql; generated from CADENCE_MINUTES
--    in supabase/functions/source-poller/poller-schedule.ts.
-- ---------------------------------------------------------------------------

create or replace function public.poller_cadence_interval(p_cadence text)
returns interval
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case p_cadence
    when 'hourly' then interval '50 minutes'
    when 'daily' then interval '1200 minutes'
    when 'weekly' then interval '9360 minutes'
    when 'biweekly' then interval '18720 minutes'
    when 'monthly' then interval '40320 minutes'
    when 'event_driven' then interval '1200 minutes'
    when 'archival_refresh' then interval '38880 minutes'
    when 'one_time' then interval '525600 minutes'
    else interval '1200 minutes'
  end
$$;

comment on function public.poller_cadence_interval(text) is
  'cadence -> interval. Mirrors CADENCE_MINUTES in poller-schedule.ts. Unknown/NULL cadence is treated as daily, never as skip. Re-asserted by FDY-93 so that this migration is correct under any apply order.';

-- ---------------------------------------------------------------------------
-- 1. public.local_watch_* — the SQL mirror of
--    supabase/functions/source-poller/local-query.ts.
--
--    GENERATED from that module's exported constants. The topic groups, action
--    groups, governing prefixes, place-kind set and state names below are the
--    TypeScript strings verbatim, so they cannot be mistyped here.
--    test/local-watch-county-complete.test.mjs loads this file into pglite and
--    asserts local_watch_query() == buildLocalQuery() byte-for-byte over the
--    1,000-entity FDY-88 corpus plus a township / edge-case corpus.
--
--    All of them are IMMUTABLE and read nothing. They write nothing.
-- ---------------------------------------------------------------------------

create or replace function public.local_watch_state_name(p_state_abbr text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case p_state_abbr
    when 'AK' then 'Alaska'
    when 'AL' then 'Alabama'
    when 'AR' then 'Arkansas'
    when 'AZ' then 'Arizona'
    when 'CA' then 'California'
    when 'CO' then 'Colorado'
    when 'CT' then 'Connecticut'
    when 'DC' then 'District of Columbia'
    when 'DE' then 'Delaware'
    when 'FL' then 'Florida'
    when 'GA' then 'Georgia'
    when 'HI' then 'Hawaii'
    when 'IA' then 'Iowa'
    when 'ID' then 'Idaho'
    when 'IL' then 'Illinois'
    when 'IN' then 'Indiana'
    when 'KS' then 'Kansas'
    when 'KY' then 'Kentucky'
    when 'LA' then 'Louisiana'
    when 'MA' then 'Massachusetts'
    when 'MD' then 'Maryland'
    when 'ME' then 'Maine'
    when 'MI' then 'Michigan'
    when 'MN' then 'Minnesota'
    when 'MO' then 'Missouri'
    when 'MS' then 'Mississippi'
    when 'MT' then 'Montana'
    when 'NC' then 'North Carolina'
    when 'ND' then 'North Dakota'
    when 'NE' then 'Nebraska'
    when 'NH' then 'New Hampshire'
    when 'NJ' then 'New Jersey'
    when 'NM' then 'New Mexico'
    when 'NV' then 'Nevada'
    when 'NY' then 'New York'
    when 'OH' then 'Ohio'
    when 'OK' then 'Oklahoma'
    when 'OR' then 'Oregon'
    when 'PA' then 'Pennsylvania'
    when 'PR' then 'Puerto Rico'
    when 'RI' then 'Rhode Island'
    when 'SC' then 'South Carolina'
    when 'SD' then 'South Dakota'
    when 'TN' then 'Tennessee'
    when 'TX' then 'Texas'
    when 'UT' then 'Utah'
    when 'VA' then 'Virginia'
    when 'VT' then 'Vermont'
    when 'WA' then 'Washington'
    when 'WI' then 'Wisconsin'
    when 'WV' then 'West Virginia'
    when 'WY' then 'Wyoming'
    else null
  end
$$;

comment on function public.local_watch_state_name(text) is 'FDY-93: two-letter state/territory abbreviation -> full name. Mirror of STATE_NAMES in local-query.ts. NULL for an unknown abbreviation, which local_watch_query() then omits rather than interpolating bare (a bare OR / IN would be read as a Google operator).';

create or replace function public.local_watch_topic_group(p_kind text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case p_kind
    when 'city' then '("data center" OR "data centers" OR "data centre")'
    when 'town' then '("data center" OR "data centers" OR "data centre")'
    when 'village' then '("data center" OR "data centers" OR "data centre")'
    when 'borough' then '("data center" OR "data centers" OR "data centre")'
    when 'cdp' then '("data center" OR "data centers" OR "data centre")'
    when 'municipality' then '("data center" OR "data centers" OR "data centre")'
    when 'county' then '("data center" OR "data centers")'
    when 'parish' then '("data center" OR "data centers")'
    when 'municipio' then '("data center" OR "data centers")'
    when 'borough_county' then '("data center" OR "data centers")'
    when 'township' then '("data center" OR "data centers")'
    when 'other' then '("data center" OR "data centers")'
    else '("data center" OR "data centers")'
  end
$$;

comment on function public.local_watch_topic_group(text) is 'FDY-93: jurisdiction kind -> parenthesised topic group. Mirror of topicGroup() in local-query.ts.';

create or replace function public.local_watch_action_group(p_kind text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case p_kind
    when 'city' then '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council")'
    when 'town' then '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council" OR "town council")'
    when 'village' then '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council" OR "village board")'
    when 'borough' then '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council" OR "borough council")'
    when 'cdp' then '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council")'
    when 'municipality' then '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council")'
    when 'county' then '(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)'
    when 'parish' then '(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)'
    when 'municipio' then '(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)'
    when 'borough_county' then '(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)'
    when 'township' then '(moratorium OR rezoning OR zoning OR ordinance OR "township board")'
    when 'other' then '(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)'
    else '(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)'
  end
$$;

comment on function public.local_watch_action_group(text) is 'FDY-93: jurisdiction kind -> parenthesised action group. Mirror of actionGroup() in local-query.ts.';

create or replace function public.local_watch_gov_prefix(p_kind text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case p_kind
    when 'city' then 'City of'
    when 'town' then 'Town of'
    when 'village' then 'Village of'
    when 'borough' then 'Borough of'
    when 'municipality' then 'Municipality of'
    else null
  end
$$;

comment on function public.local_watch_gov_prefix(text) is 'FDY-93: jurisdiction kind -> governing prefix used in the name group ("City of Acworth"). Mirror of GOV_PREFIX in local-query.ts. NULL means no prefix (cdp, and every non-place kind).';

create or replace function public.local_watch_place_kinds()
returns text[]
language sql
immutable
parallel safe
as $$ select array['city', 'town', 'village', 'borough', 'cdp', 'municipality']::text[] $$;

comment on function public.local_watch_place_kinds() is
  'FDY-93: the kinds treated as incorporated places. Mirror of PLACE_KINDS in local-query.ts.';

-- classifyLocalName(). Case matters for "borough": Census writes place LSADs in
-- lower case ("Dillsburg borough", PA) and county-equivalents capitalised
-- ("Kodiak Island Borough", AK), so the capitalisation is the signal.
create or replace function public.local_watch_classify(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when btrim(p_name, E' \t\n\r') ~* '\s(charter\s+)?township$' then 'township'
    else case (regexp_match(btrim(p_name, E' \t\n\r'), '(\S+)$'))[1]
      when 'city'         then 'city'
      when 'town'         then 'town'
      when 'village'      then 'village'
      when 'borough'      then 'borough'
      when 'CDP'          then 'cdp'
      when 'municipality' then 'municipality'
      when 'County'       then 'county'
      when 'Parish'       then 'parish'
      when 'Municipio'    then 'municipio'
      when 'Borough'      then 'borough_county'
      else 'other'
    end
  end
$$;

comment on function public.local_watch_classify(text) is
  'FDY-93: Census name -> local kind. Mirror of classifyLocalName() in local-query.ts.';

-- stripKindSuffix(). "Acworth city" -> "Acworth"; "Cobb County" -> "Cobb";
-- "Allendale charter township" -> "Allendale"; kind 'other' is left alone.
create or replace function public.local_watch_strip_kind(p_name text, p_kind text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_kind = 'township' then
      regexp_replace(btrim(p_name, E' \t\n\r'), '\s+(charter\s+)?township$', '', 'i')
    when p_kind = 'other' then btrim(p_name, E' \t\n\r')
    else regexp_replace(btrim(p_name, E' \t\n\r'), '\s+\S+$', '')
  end
$$;

comment on function public.local_watch_strip_kind(text, text) is
  'FDY-93: strip the trailing Census LSAD word. Mirror of stripKindSuffix() in local-query.ts.';

-- baseVariants(). Census carries alternate names in parentheses
-- ("Alvan (Alvin) village"); both the primary and the alternate are returned,
-- primary first, empties dropped.
create or replace function public.local_watch_variants(p_name text, p_kind text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
declare
  v_stem text := public.local_watch_strip_kind(p_name, p_kind);
  v_alt  text;
  v_pri  text;
  v_out  text[] := '{}'::text[];
begin
  v_alt := btrim(coalesce((regexp_match(v_stem, '\(([^)]+)\)'))[1], ''), E' \t\n\r');
  v_pri := btrim(
    regexp_replace(regexp_replace(v_stem, '\s*\([^)]*\)\s*', ' ', 'g'), '\s+', ' ', 'g'),
    E' \t\n\r');
  if length(v_pri) > 0 then
    v_out := v_out || v_pri;
  end if;
  if v_alt <> '' and v_alt <> v_pri then
    v_out := v_out || v_alt;
  end if;
  return v_out;
end
$fn$;

comment on function public.local_watch_variants(text, text) is
  'FDY-93: news-language variants of a Census name. Mirror of baseVariants() in local-query.ts.';

-- buildLocalQuery(). Shape: <name group> <topic group> <action group> "<State>",
-- four fully parenthesised / quoted parts, so the result can never contain a
-- bare top-level OR and the state can never be read as an operator.
create or replace function public.local_watch_query(p_name text, p_state_abbr text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
declare
  v_kind   text := public.local_watch_classify(p_name);
  v_vars   text[] := public.local_watch_variants(p_name, public.local_watch_classify(p_name));
  v_full   text := btrim(p_name, E' \t\n\r');
  v_prefix text;
  v_terms  text[] := '{}'::text[];
  v_parts  text[];
  v_state  text;
  v        text;
begin
  if v_kind = any (public.local_watch_place_kinds()) then
    v_prefix := public.local_watch_gov_prefix(v_kind);
    foreach v in array v_vars loop
      v_terms := v_terms || ('"' || v || '"');
      if v_prefix is not null then
        v_terms := v_terms || ('"' || v_prefix || ' ' || v || '"');
      end if;
    end loop;
  elsif v_kind = 'township' then
    foreach v in array v_vars loop
      v_terms := v_terms || ('"' || v || ' Township"') || ('"' || v || ' Charter Township"');
    end loop;
  elsif v_kind = 'municipio' then
    v_terms := array['"' || v_full || '"'];
    foreach v in array v_vars loop
      v_terms := v_terms || ('"Municipio de ' || v || '"');
    end loop;
  else
    -- county / parish / borough_county / other: the Census name already carries
    -- the governing word, and the bare stem alone would be far too loose.
    v_terms := array['"' || v_full || '"'];
  end if;

  v_parts := array['(' || array_to_string(v_terms, ' OR ') || ')'];
  v_parts := v_parts || public.local_watch_topic_group(v_kind);
  v_parts := v_parts || public.local_watch_action_group(v_kind);
  v_state := public.local_watch_state_name(upper(btrim(coalesce(p_state_abbr, ''), E' \t\n\r')));
  if v_state is not null then
    v_parts := v_parts || ('"' || v_state || '"');
  end if;
  return array_to_string(v_parts, ' ');
end
$fn$;

comment on function public.local_watch_query(text, text) is
  'FDY-93: scoped Google News query for a local-gov jurisdiction. Mirror of buildLocalQuery() in supabase/functions/source-poller/local-query.ts; the pglite drift test asserts they are byte-identical.';

-- localSourceKey(). Verified against production 2026-10-07: all 1,000 live
-- gsearch:loc-% keys round-trip exactly, and the 9,309-row universe this
-- migration builds yields 9,309 distinct keys (no 52-char truncation clash).
create or replace function public.local_watch_source_key(p_entity text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select 'gsearch:loc-'
      || left(regexp_replace(lower(replace(p_entity, ', ', '-')), '[^a-z0-9]+', '-', 'g'), 52)
$$;

comment on function public.local_watch_source_key(text) is
  'FDY-93: entity ("Cobb County, GA") -> source_registry.source_key. Mirror of localSourceKey() in local-query.ts.';

revoke all on function public.local_watch_query(text, text) from public;
grant execute on function public.local_watch_query(text, text) to service_role;
grant execute on function public.local_watch_source_key(text) to service_role;
grant execute on function public.local_watch_classify(text) to service_role;
grant execute on function public.local_watch_strip_kind(text, text) to service_role;
grant execute on function public.local_watch_variants(text, text) to service_role;
grant execute on function public.local_watch_state_name(text) to service_role;
grant execute on function public.local_watch_topic_group(text) to service_role;
grant execute on function public.local_watch_action_group(text) to service_role;
grant execute on function public.local_watch_gov_prefix(text) to service_role;
grant execute on function public.local_watch_place_kinds() to service_role;

-- ---------------------------------------------------------------------------
-- 2. The Boundstone roster.
--
--    449 distinct (state, jurisdiction, jtype), snapshotted 2026-10-07 from
--    Boundstone's PUBLIC ANON REST VIEW `bs_records` — the only sanctioned read
--    path (guardrail 4: Faraday never reads Boundstone's database, and nothing
--    ever flows the other way except through the two FDY-91 RPCs).
--    Source of truth: data/boundstone-jurisdictions-2026-10-07.csv
--    (+ .PROVENANCE.md for the exact request and the counts measured at fetch).
--
--    Composition: County 180 · City 149 · Township 58 · Town 40 · Village 14 · Tribal 3 · Other 2 · Parish 1 · Utility-authority 1 · State 1
--
--    NOTE the live view's column names are `state, jurisdiction, jtype`, not the
--    `state_abbr, jurisdiction_name, jurisdiction_type` the issue text predicted;
--    asking for the issue's names returns 400 / 42703.
-- ---------------------------------------------------------------------------

create temporary table _fdy93_bs (
  state        text not null,
  jurisdiction text not null,
  jtype        text not null
) on commit drop;

insert into _fdy93_bs (state, jurisdiction, jtype) values
  ('AL', 'Birmingham', 'City'),
  ('AL', 'Cullman', 'City'),
  ('AL', 'Fairfield', 'City'),
  ('AL', 'Fort Payne', 'City'),
  ('AL', 'Homewood', 'City'),
  ('AL', 'Hueytown', 'City'),
  ('AL', 'Leeds', 'City'),
  ('AL', 'Morgan County', 'County'),
  ('AL', 'Prichard', 'City'),
  ('AL', 'Somerville', 'Town'),
  ('AR', 'Carroll County', 'County'),
  ('AR', 'Harrison', 'City'),
  ('AR', 'Russellville', 'City'),
  ('AR', 'Union County', 'County'),
  ('CA', 'Calipatria', 'City'),
  ('CA', 'Coachella', 'City'),
  ('CA', 'Desert Hot Springs', 'City'),
  ('CA', 'El Monte', 'City'),
  ('CA', 'Imperial', 'City'),
  ('CA', 'Imperial County', 'County'),
  ('CA', 'Indio', 'City'),
  ('CA', 'Irwindale', 'City'),
  ('CA', 'Montebello', 'City'),
  ('CA', 'Monterey Park', 'City'),
  ('CA', 'Oakley', 'City'),
  ('CO', 'Archuleta County', 'County'),
  ('CO', 'Boulder County', 'County'),
  ('CO', 'Broomfield', 'City'),
  ('CO', 'Buena Vista', 'Town'),
  ('CO', 'Delta County', 'County'),
  ('CO', 'Denver', 'City'),
  ('CO', 'Hudson', 'Town'),
  ('CO', 'Jefferson County', 'County'),
  ('CO', 'Larimer County', 'County'),
  ('CO', 'Logan County', 'County'),
  ('CO', 'Monument', 'Town'),
  ('CO', 'South Fork', 'Town'),
  ('CO', 'Woodland Park', 'City'),
  ('CT', 'Groton', 'Town'),
  ('CT', 'Morris', 'Town'),
  ('CT', 'New Haven', 'City'),
  ('CT', 'West Haven', 'City'),
  ('FL', 'Citrus County', 'County'),
  ('FL', 'Clay County', 'County'),
  ('FL', 'Hernando County', 'County'),
  ('FL', 'Lakeland', 'City'),
  ('FL', 'Lynn Haven', 'City'),
  ('FL', 'Madison County', 'County'),
  ('FL', 'Nassau County', 'County'),
  ('FL', 'Palm Beach County', 'County'),
  ('FL', 'Pasco County', 'County'),
  ('FL', 'Pensacola', 'City'),
  ('FL', 'Pinellas Park', 'City'),
  ('FL', 'Santa Rosa County', 'County'),
  ('FL', 'Sarasota County', 'County'),
  ('FL', 'Zephyrhills', 'City'),
  ('GA', 'Adel (Cook County)', 'City'),
  ('GA', 'Albany', 'City'),
  ('GA', 'Augusta-Richmond County', 'County'),
  ('GA', 'Brooks County', 'County'),
  ('GA', 'Bulloch County', 'County'),
  ('GA', 'Calhoun (Gordon County)', 'City'),
  ('GA', 'Camden County', 'County'),
  ('GA', 'Carroll County', 'County'),
  ('GA', 'Cedartown', 'City'),
  ('GA', 'Cherokee County', 'County'),
  ('GA', 'Clayton County', 'County'),
  ('GA', 'Cobb County', 'County'),
  ('GA', 'Covington', 'City'),
  ('GA', 'Coweta County', 'County'),
  ('GA', 'DeKalb County', 'County'),
  ('GA', 'Decatur County', 'County'),
  ('GA', 'Dougherty County', 'County'),
  ('GA', 'Douglas County', 'County'),
  ('GA', 'East Point (Fulton County)', 'City'),
  ('GA', 'Floyd County', 'County'),
  ('GA', 'Garden City (Chatham County)', 'City'),
  ('GA', 'Gordon County', 'County'),
  ('GA', 'Griffin', 'City'),
  ('GA', 'Hall County', 'County'),
  ('GA', 'Hart County', 'County'),
  ('GA', 'Jones County', 'County'),
  ('GA', 'Kingsland (Camden County)', 'City'),
  ('GA', 'LaGrange', 'City'),
  ('GA', 'Lamar County', 'County'),
  ('GA', 'Lee County', 'County'),
  ('GA', 'Marietta', 'City'),
  ('GA', 'Milton (Fulton County)', 'City'),
  ('GA', 'Monroe County', 'County'),
  ('GA', 'Paulding County', 'County'),
  ('GA', 'Pike County', 'County'),
  ('GA', 'Polk County', 'County'),
  ('GA', 'Rockdale County', 'County'),
  ('GA', 'Roswell', 'City'),
  ('GA', 'Social Circle', 'City'),
  ('GA', 'South Fulton', 'City'),
  ('GA', 'Stephens County', 'County'),
  ('GA', 'Thomas County', 'County'),
  ('GA', 'Troup County', 'County'),
  ('GA', 'Walker County', 'County'),
  ('IA', 'Adair County', 'County'),
  ('IA', 'Audubon County', 'County'),
  ('IA', 'Cedar County', 'County'),
  ('IA', 'City of Peosta', 'City'),
  ('IA', 'Clarke County', 'County'),
  ('IA', 'Des Moines County', 'County'),
  ('IA', 'Dickinson County', 'County'),
  ('IA', 'Dubuque County', 'County'),
  ('IA', 'Franklin County', 'County'),
  ('IA', 'Ida County', 'County'),
  ('IA', 'Jackson County', 'County'),
  ('IA', 'Johnson County', 'County'),
  ('IA', 'Lee County', 'County'),
  ('IA', 'Linn County', 'County'),
  ('IA', 'Madison County', 'County'),
  ('IA', 'Mitchell County', 'County'),
  ('IA', 'Palo Alto County', 'County'),
  ('IA', 'Plymouth County', 'County'),
  ('IA', 'Shelby County', 'County'),
  ('IA', 'Sioux County', 'County'),
  ('IA', 'Story County', 'County'),
  ('IA', 'Tama County', 'County'),
  ('IA', 'Taylor County', 'County'),
  ('IA', 'Union County', 'County'),
  ('IA', 'Woodbury County', 'County'),
  ('ID', 'Kootenai County', 'County'),
  ('IL', 'Champaign County', 'County'),
  ('IL', 'City of Bloomington', 'City'),
  ('IL', 'City of Carbondale', 'City'),
  ('IL', 'City of Collinsville', 'City'),
  ('IL', 'City of Effingham', 'City'),
  ('IL', 'City of Troy', 'City'),
  ('IL', 'City of West Chicago', 'City'),
  ('IL', 'La Salle County', 'County'),
  ('IL', 'Morgan County', 'County'),
  ('IL', 'Town of Normal', 'Town'),
  ('IN', 'Boone County', 'County'),
  ('IN', 'Fayette County', 'County'),
  ('IN', 'Franklin County', 'County'),
  ('IN', 'Indianapolis (Marion County)', 'City'),
  ('IN', 'Madison County', 'County'),
  ('IN', 'Merrillville (Lake County)', 'Town'),
  ('IN', 'Miami County', 'County'),
  ('IN', 'New Albany (Floyd County)', 'City'),
  ('IN', 'Valparaiso (Porter County)', 'City'),
  ('IN', 'Warrick County', 'County'),
  ('KS', 'Geary County', 'County'),
  ('KS', 'Lyon County', 'County'),
  ('KS', 'Marion County', 'County'),
  ('KS', 'McPherson County', 'County'),
  ('KS', 'Riley County', 'County'),
  ('KS', 'Saline County', 'County'),
  ('KS', 'Sedgwick County', 'County'),
  ('KY', 'Ashland', 'City'),
  ('KY', 'Bell County', 'County'),
  ('KY', 'Boyle County', 'County'),
  ('KY', 'Bullitt County', 'County'),
  ('KY', 'Cave City', 'City'),
  ('KY', 'City of La Grange', 'City'),
  ('KY', 'Daviess County', 'County'),
  ('KY', 'Edmonson County', 'County'),
  ('KY', 'Lexington-Fayette', 'Other'),
  ('KY', 'Mercer County Fiscal Court', 'County'),
  ('KY', 'Nelson County', 'County'),
  ('KY', 'Oldham County Fiscal Court', 'County'),
  ('KY', 'Versailles', 'City'),
  ('LA', 'New Orleans', 'City'),
  ('LA', 'St. Charles Parish', 'Parish'),
  ('MA', 'Everett (restriction proposal, not moratorium)', 'City'),
  ('MA', 'Lowell', 'City'),
  ('MA', 'Malden', 'City'),
  ('MA', 'Shutesbury', 'Town'),
  ('MA', 'Westfield', 'City'),
  ('MD', 'Baltimore City', 'City'),
  ('MD', 'Frederick County', 'County'),
  ('MD', 'Howard County', 'County'),
  ('MD', 'Montgomery County', 'County'),
  ('MD', 'Prince George''s County', 'County'),
  ('MD', 'Washington County', 'County'),
  ('MD', 'Worcester County', 'County'),
  ('ME', 'Bangor', 'City'),
  ('ME', 'Brunswick', 'Town'),
  ('ME', 'Gorham', 'Town'),
  ('ME', 'Sanford', 'City'),
  ('ME', 'Scarborough', 'Town'),
  ('ME', 'Westbrook', 'City'),
  ('MI', 'Allendale Township', 'Township'),
  ('MI', 'Armada Township', 'Township'),
  ('MI', 'Bruce Township', 'Township'),
  ('MI', 'Caledonia Township', 'Township'),
  ('MI', 'Chesaning Township', 'Township'),
  ('MI', 'City of Flint', 'City'),
  ('MI', 'Delta County', 'County'),
  ('MI', 'Detroit (requested)', 'City'),
  ('MI', 'Dundee Township', 'Township'),
  ('MI', 'Fenton Township', 'Township'),
  ('MI', 'Filer Township', 'Township'),
  ('MI', 'Forsyth Township', 'Township'),
  ('MI', 'Grand Blanc Township', 'Township'),
  ('MI', 'Green Charter Township', 'Township'),
  ('MI', 'Hagar Township', 'Township'),
  ('MI', 'Haring Township', 'Township'),
  ('MI', 'Hart', 'City'),
  ('MI', 'Houghton', 'City'),
  ('MI', 'Howell Township', 'Township'),
  ('MI', 'Huron County', 'County'),
  ('MI', 'Lake Township', 'Township'),
  ('MI', 'Lansing', 'City'),
  ('MI', 'Lenox Township', 'Township'),
  ('MI', 'Lincoln Township', 'Township'),
  ('MI', 'Lowell Township (proposed)', 'Township'),
  ('MI', 'Lyndon Township', 'Township'),
  ('MI', 'Lyon Charter Township (Oakland County)', 'Township'),
  ('MI', 'Lyon Township', 'Township'),
  ('MI', 'Manchester Township', 'Township'),
  ('MI', 'Mason', 'City'),
  ('MI', 'Mason Township', 'Township'),
  ('MI', 'Meridian Township', 'Township'),
  ('MI', 'Orion Township', 'Township'),
  ('MI', 'Park Township', 'Township'),
  ('MI', 'Pine Grove Township', 'Township'),
  ('MI', 'Pittsfield Township', 'Township'),
  ('MI', 'Porter Township', 'Township'),
  ('MI', 'Saginaw', 'City'),
  ('MI', 'Saline Township', 'Township'),
  ('MI', 'Saugatuck Township', 'Township'),
  ('MI', 'Sault Ste. Marie Tribe of Chippewa Indians', 'Tribal'),
  ('MI', 'Sherman Township', 'Township'),
  ('MI', 'South Lyon', 'City'),
  ('MI', 'Springfield Township', 'Township'),
  ('MI', 'Sylvan Township', 'Township'),
  ('MI', 'Taylor', 'City'),
  ('MI', 'Texas Township', 'Township'),
  ('MI', 'Tyrone Township', 'Township'),
  ('MI', 'Village of Romeo', 'Village'),
  ('MI', 'Washington Township', 'Township'),
  ('MI', 'Watertown Township', 'Township'),
  ('MI', 'York Township', 'Township'),
  ('MI', 'Ypsilanti Community Utilities Authority', 'Utility-authority'),
  ('MN', 'City of Apple Valley', 'City'),
  ('MN', 'City of Elko New Market', 'City'),
  ('MN', 'Eagan', 'City'),
  ('MN', 'Inver Grove Heights', 'City'),
  ('MN', 'Le Sueur County', 'County'),
  ('MN', 'Mankato', 'City'),
  ('MN', 'Minneapolis', 'City'),
  ('MN', 'Otsego', 'City'),
  ('MN', 'Rosemount', 'City'),
  ('MN', 'Waite Park', 'City'),
  ('MN', 'Wright County', 'County'),
  ('MO', 'City of Camdenton', 'City'),
  ('MO', 'City of Columbia', 'City'),
  ('MO', 'City of Independence', 'City'),
  ('MO', 'City of Neosho', 'City'),
  ('MO', 'City of Peculiar', 'City'),
  ('MO', 'City of Springfield', 'City'),
  ('MO', 'City of St. Charles', 'City'),
  ('MO', 'City of St. Joseph', 'City'),
  ('MO', 'City of St. Peters', 'City'),
  ('MO', 'Jackson County', 'County'),
  ('MO', 'Marion County', 'County'),
  ('MO', 'Nodaway County', 'County'),
  ('MO', 'St. Charles County', 'County'),
  ('MO', 'Webster County', 'County'),
  ('MS', 'City of Jackson', 'City'),
  ('MT', 'Missoula County', 'County'),
  ('NC', 'Charlotte', 'City'),
  ('NC', 'Chatham County', 'County'),
  ('NC', 'City of Asheville', 'City'),
  ('NC', 'City of Boiling Spring Lakes', 'City'),
  ('NC', 'City of Brevard', 'City'),
  ('NC', 'City of Hendersonville', 'City'),
  ('NC', 'City of Mount Airy', 'City'),
  ('NC', 'City of Wilson', 'City'),
  ('NC', 'Clay County (permanent restriction after earlier crypto moratorium)', 'County'),
  ('NC', 'Cumberland County', 'County'),
  ('NC', 'Davie County', 'County'),
  ('NC', 'Durham', 'City'),
  ('NC', 'Durham County', 'County'),
  ('NC', 'Eastern Band of Cherokee Indians (tribal and trust lands)', 'Tribal'),
  ('NC', 'Gates County', 'County'),
  ('NC', 'Harnett County', 'County'),
  ('NC', 'McDowell County (cryptocurrency mining; data-center-adjacent)', 'County'),
  ('NC', 'Northampton County', 'County'),
  ('NC', 'Pasquotank County', 'County'),
  ('NC', 'Surry County', 'County'),
  ('NC', 'Town of Bailey', 'Town'),
  ('NC', 'Town of Franklin', 'Town'),
  ('NC', 'Town of Hillsborough', 'Town'),
  ('NC', 'Town of Holly Springs', 'Town'),
  ('NC', 'Town of Spring Hope', 'Town'),
  ('NC', 'Town of Woodfin', 'Town'),
  ('NC', 'Watauga County', 'County'),
  ('ND', 'Barnes County', 'County'),
  ('ND', 'Dunn County', 'County'),
  ('ND', 'Oliver County (Phase 1)', 'County'),
  ('ND', 'Oliver County (Phase 2)', 'County'),
  ('ND', 'Oliver County (Phase 3)', 'County'),
  ('ND', 'Williams County', 'County'),
  ('NE', 'Cherry County', 'County'),
  ('NE', 'Hitchcock County', 'County'),
  ('NE', 'Logan County', 'County'),
  ('NE', 'Otoe County', 'County'),
  ('NE', 'Red Willow County', 'County'),
  ('NE', 'Seward County', 'County'),
  ('NH', 'Town of Nottingham', 'Town'),
  ('NJ', 'Galloway Township', 'Township'),
  ('NJ', 'Sayreville', 'Town'),
  ('NM', 'Santa Fe County', 'County'),
  ('NM', 'Sierra County', 'County'),
  ('NM', 'Socorro County', 'County'),
  ('NV', 'Humboldt County', 'County'),
  ('NV', 'Nye County', 'County'),
  ('NV', 'Reno', 'City'),
  ('NY', 'Manlius', 'Town'),
  ('NY', 'State of New York (Executive Order, not a local-government action)', 'State'),
  ('NY', 'Town of Brookhaven', 'Town'),
  ('NY', 'Town of Clifton Park', 'Town'),
  ('NY', 'Town of Dryden (Tompkins County)', 'Town'),
  ('NY', 'Town of East Fishkill', 'Town'),
  ('NY', 'Town of Highland', 'Town'),
  ('NY', 'Town of Lansing (Tompkins County) - proposed, not enacted', 'Town'),
  ('NY', 'Town of Lewiston (Niagara County) - proposed, public hearing held', 'Town'),
  ('NY', 'Town of Lysander (Onondaga County) - drafting authorized', 'Town'),
  ('NY', 'Town of Oneonta (Otsego County) - proposed, pending', 'Town'),
  ('NY', 'Town of Salina', 'Town'),
  ('NY', 'Town of Southeast', 'Town'),
  ('NY', 'Town of Thurston', 'Town'),
  ('NY', 'Town of Van Buren', 'Town'),
  ('OH', 'Alliance', 'City'),
  ('OH', 'Archbold', 'Village'),
  ('OH', 'Avon', 'City'),
  ('OH', 'Berea', 'City'),
  ('OH', 'Blanchester', 'Village'),
  ('OH', 'Braceville Township', 'Township'),
  ('OH', 'Butler County', 'County'),
  ('OH', 'Canton Township', 'Township'),
  ('OH', 'Cincinnati', 'City'),
  ('OH', 'City of Hubbard', 'City'),
  ('OH', 'City of Norton', 'City'),
  ('OH', 'City of Waterville', 'City'),
  ('OH', 'Cleveland', 'City'),
  ('OH', 'Cortland', 'City'),
  ('OH', 'Defiance', 'City'),
  ('OH', 'Findlay', 'City'),
  ('OH', 'Girard', 'City'),
  ('OH', 'Grafton', 'Village'),
  ('OH', 'Grove City', 'City'),
  ('OH', 'Howland Township', 'Township'),
  ('OH', 'Jackson Township (Franklin County)', 'Township'),
  ('OH', 'Jerome Township', 'Township'),
  ('OH', 'Lake Township', 'Township'),
  ('OH', 'Maumee', 'City'),
  ('OH', 'Monclova Township', 'Township'),
  ('OH', 'Montgomery Township', 'Township'),
  ('OH', 'Plain City', 'Village'),
  ('OH', 'Richfield Township', 'Township'),
  ('OH', 'South Bloomfield', 'Village'),
  ('OH', 'Spencer Township', 'Township'),
  ('OH', 'Springfield', 'City'),
  ('OH', 'St. Marys', 'City'),
  ('OH', 'Tallmadge', 'City'),
  ('OH', 'Village of Ashville', 'Village'),
  ('OH', 'Village of Lordstown', 'Village'),
  ('OH', 'Washington Township', 'Township'),
  ('OH', 'Waterville Township', 'Township'),
  ('OH', 'Williamsburg', 'Village'),
  ('OH', 'Yellow Springs', 'Village'),
  ('OK', 'Broken Arrow', 'City'),
  ('OK', 'Edmond', 'City'),
  ('OK', 'Luther', 'Town'),
  ('OK', 'Norman', 'City'),
  ('OK', 'Oklahoma City', 'City'),
  ('OK', 'Seminole Nation of Oklahoma', 'Tribal'),
  ('OK', 'Tulsa', 'City'),
  ('OR', 'City of Hillsboro', 'City'),
  ('PA', 'Bensalem Township', 'Township'),
  ('PA', 'Brookville Borough', 'Other'),
  ('PA', 'Butler Township', 'Township'),
  ('PA', 'Center Township', 'Township'),
  ('PA', 'Hazle Township', 'Township'),
  ('PA', 'Lycoming County', 'County'),
  ('PA', 'Montour County', 'County'),
  ('PA', 'Muncy Township', 'Township'),
  ('PA', 'Warrington Township', 'Township'),
  ('SC', 'Chester County', 'County'),
  ('SC', 'Chesterfield County', 'County'),
  ('SC', 'Colleton County', 'County'),
  ('SC', 'Greenwood County', 'County'),
  ('SC', 'Newberry County', 'County'),
  ('SC', 'York County', 'County'),
  ('SD', 'Yankton County', 'County'),
  ('TN', 'Anderson County', 'County'),
  ('TN', 'Bristol', 'City'),
  ('TN', 'Cedar Hill', 'Town'),
  ('TN', 'Clinton', 'City'),
  ('TN', 'Coffee County', 'County'),
  ('TN', 'Crossville', 'City'),
  ('TN', 'Cumberland County', 'County'),
  ('TN', 'Grundy County', 'County'),
  ('TN', 'Jonesborough', 'Town'),
  ('TN', 'Knox County', 'County'),
  ('TN', 'Knoxville', 'City'),
  ('TN', 'Loudon County', 'County'),
  ('TN', 'McMinnville', 'City'),
  ('TN', 'Morgan County', 'County'),
  ('TN', 'Nashville-Davidson County', 'City'),
  ('TN', 'Shelbyville', 'City'),
  ('TN', 'Smithville', 'City'),
  ('TN', 'Sullivan County', 'County'),
  ('TN', 'Unincorporated Hamilton County', 'County'),
  ('TN', 'Warren County', 'County'),
  ('TN', 'White County', 'County'),
  ('TX', 'Austin County', 'County'),
  ('TX', 'Harlingen', 'City'),
  ('TX', 'Hill County', 'County'),
  ('UT', 'Box Elder County', 'County'),
  ('UT', 'Cache County', 'County'),
  ('UT', 'Grand County', 'County'),
  ('UT', 'Iron County', 'County'),
  ('UT', 'Logan', 'City'),
  ('UT', 'Wayne County', 'County'),
  ('VA', 'City of Chesapeake', 'City'),
  ('WA', 'Burien', 'City'),
  ('WA', 'City of Ephrata', 'City'),
  ('WA', 'City of Seattle', 'City'),
  ('WA', 'Federal Way', 'City'),
  ('WA', 'Marysville', 'City'),
  ('WA', 'Pasco', 'City'),
  ('WA', 'Seattle', 'City'),
  ('WA', 'Skagit County', 'County'),
  ('WA', 'Snohomish County', 'County'),
  ('WA', 'Spokane', 'City'),
  ('WA', 'Town of Waterville', 'Town'),
  ('WI', 'City of Sheboygan', 'City'),
  ('WI', 'City of Superior', 'City'),
  ('WI', 'Dane County', 'County'),
  ('WI', 'Door County', 'County'),
  ('WI', 'Grant County', 'County'),
  ('WI', 'Green County', 'County'),
  ('WI', 'La Crosse County', 'County'),
  ('WI', 'Manitowoc County', 'County'),
  ('WI', 'Monroe County', 'County'),
  ('WI', 'Shawano County', 'County'),
  ('WI', 'Town of New Denmark', 'Town'),
  ('WI', 'Village of Ashwaubenon', 'Village'),
  ('WI', 'Village of Cottage Grove', 'Village'),
  ('WI', 'Village of Hobart', 'Village'),
  ('WI', 'Village of Wrightstown', 'Village');

-- Consolidated city-counties Census files under a different name, so no
-- normaliser can reach them. Hand-verified against public.jurisdictions on
-- 2026-10-07. An override that matches nothing is an error, asserted below.
create temporary table _fdy93_bs_override (
  state        text not null,
  jurisdiction text not null,
  lvl          text not null,
  census_name  text not null
) on commit drop;

insert into _fdy93_bs_override (state, jurisdiction, lvl, census_name) values
  ('GA', 'Augusta-Richmond County', 'county', 'Richmond County'),
  ('IN', 'Indianapolis (Marion County)', 'county', 'Marion County'),
  ('KY', 'Lexington-Fayette', 'county', 'Fayette County'),
  ('TN', 'Nashville-Davidson County', 'county', 'Davidson County'),
  ('MD', 'Baltimore City', 'county', 'Baltimore city'),
  ('PA', 'Brookville Borough', 'place', 'Brookville borough');

-- ---------------------------------------------------------------------------
-- 3. Resolve the roster to public.jurisdictions (T1).
--
--    Boundstone names are written for humans: "Green Charter Township",
--    "City of St. Charles", "Mercer County Fiscal Court", "Town of Lansing
--    (Tompkins County) - proposed, not enacted", "Unincorporated Hamilton
--    County". Census names carry an LSAD suffix: "Acworth city", "Cobb County",
--    "Allendale charter township". Both sides are reduced to a comparable key.
--
--    The trailing governing word is stripped from the Boundstone side ONLY for
--    County / Parish / Township, whose names carry one. City / Town / Village /
--    Other names are bare, and several legitimately END in "City" — Garden City,
--    Cave City, Grove City, Oklahoma City, Plain City — so stripping it there
--    turned four real jurisdictions into non-matches.
-- ---------------------------------------------------------------------------

create temporary table _fdy93_bs_norm on commit drop as
with punct as (
  select b.state, b.jurisdiction, b.jtype,
         btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(lower(b.jurisdiction), '\(.*', ' '),
                 ' - .*', ' '),
               '^(city|town|village|charter township|township|borough|municipality) of +', ''),
             '^unincorporated +', ''),
           ' fiscal court$', ''),
         '[^a-z0-9]+', ' ', 'g'), ' ') as n
  from _fdy93_bs b
)
select state, jurisdiction, jtype, n,
       case when jtype in ('County', 'Parish', 'Township')
            then btrim(regexp_replace(n, ' (charter )?(township|county|parish)$', ''), ' ')
            else n end as nb,
       -- The county Boundstone names in parentheses, where it gives one:
       -- "Jackson Township (Franklin County)" -> 'franklin'. n and nb throw the
       -- parenthetical away, which is right for matching the NAME and wrong for
       -- choosing WHICH same-named township is meant. Ohio has 43 Washington
       -- townships and 37 Jackson townships; without this hint the pick among
       -- them is made by the planner, not by the data.
       nullif(btrim(regexp_replace(
         btrim(regexp_replace(lower(coalesce(
           (regexp_match(jurisdiction, '\(([^)]*[Cc]ounty)\)'))[1], '')),
           '[^a-z0-9]+', ' ', 'g'), ' '),
         ' county$', ''), ' '), '') as county_hint
from punct;

create temporary table _fdy93_jur on commit drop as
with strip_parens as (
  select j.level::text as lvl, j.name, j.state_abbr::text as st, j.fips_code as fips,
         j.containing_county_fips as ccf,
         (regexp_match(j.name, '(\S+)$'))[1] as csuf,
         lower(regexp_replace(j.name, '\s*\([^)]*\)\s*', ' ', 'g')) as x
  from public.jurisdictions j
  where j.level in ('county', 'place', 'cousub')
),
punct as (
  select lvl, name, st, fips, ccf, csuf,
         btrim(regexp_replace(x, '[^a-z0-9]+', ' ', 'g'), ' ') as y
  from strip_parens
)
select lvl, name, st, fips, ccf, csuf,
       btrim(regexp_replace(y,
         ' (charter )?(township|town|city|village|borough|cdp|municipality|county|parish|municipio|plantation)$',
         ''), ' ') as nb
from punct;

create index on _fdy93_jur (st, nb);
create index on _fdy93_jur (lvl, fips);

-- Candidate matches, with a preference order. Lower wins.
create temporary table _fdy93_bs_cand on commit drop as
select b.state, b.jurisdiction, b.jtype, j.lvl, j.name, j.fips, j.ccf,
       -- 0 = Boundstone named a county and this candidate is in it; 1 = no hint
       -- given; 2 = a hint was given and this candidate contradicts it.
       case
         when b.county_hint is null then 1
         when exists (
           select 1 from _fdy93_jur c
           where c.lvl = 'county' and c.st = b.state and c.nb = b.county_hint
             and (c.fips = j.fips or c.fips = any (coalesce(j.ccf, array[]::text[])))
         ) then 0
         else 2
       end as hint_rank,
       case
         -- the intended level for each Boundstone type
         when b.jtype in ('County', 'Parish') and j.lvl = 'county'
              and j.csuf in ('County','Parish','Borough','Municipio','Area','Region','Municipality','Columbia') then 1
         when b.jtype = 'Township' and j.lvl = 'cousub' and j.name ~ '[Tt]ownship$' then 1
         when b.jtype = 'City'    and j.lvl = 'place'  and j.csuf = 'city'    then 1
         when b.jtype = 'Town'    and j.lvl = 'place'  and j.csuf = 'town'    then 1
         when b.jtype = 'Village' and j.lvl = 'place'  and j.csuf = 'village' then 1
         when b.jtype = 'Other'   and j.lvl = 'place'  then 1
         -- independent cities (VA, MD, MO, NV) are county-equivalents, per the
         -- issue's pre-made decision, and Census files them at BOTH levels
         when b.jtype in ('City','Town','Other') and j.lvl = 'county' and j.csuf in ('city','City') then 2
         -- New England towns are county subdivisions as well as places
         when b.jtype = 'Town' and j.lvl = 'cousub' and j.csuf = 'town' then 2
         when b.jtype = 'Other' and j.lvl = 'county' then 2
         when b.jtype in ('City','Town','Village') and j.lvl = 'place'  then 3
         when b.jtype = 'Township' and j.lvl = 'place' then 3
         when b.jtype in ('City','Town','Village','Other') and j.lvl = 'cousub' then 4
         else null
       end as pref
from _fdy93_bs_norm b
join _fdy93_jur j
  on j.st = b.state
 and (j.nb = b.nb or replace(j.nb, ' ', '') = replace(b.nb, ' ', ''))
-- Tribal nations, the one State-level executive order and the one utility
-- authority are not Census jurisdictions and are reported as unmatched.
where b.jtype not in ('Tribal', 'State', 'Utility-authority');

-- The winner must be a function of the DATA, not of the query plan.
--
-- "order by ... pref, lvl, name" does not disambiguate same-named jurisdictions,
-- and same-named jurisdictions are the normal case for the township states this
-- issue exists to cover: Ohio has 43 'Washington township' county subdivisions,
-- 37 'Jackson township', Michigan 9 'Sherman township'. For 16 of the 449 roster
-- rows the old ordering left the choice to the planner, so _fdy93_bs_counties,
-- T3 and the universe size all moved between runs (349 / 350 / 352 Boundstone
-- counties were observed for the same inputs). Two changes fix that:
--   * the ordering is EXTENDED, not reordered: pref, lvl, name are still the
--     leading keys, so no match that was already decided moves. hint_rank and
--     fips are appended, and only decide what the original keys left tied.
--     fips is unique per jurisdiction, so the order is now total. The name key
--     is pinned to collate "C" so the winner does not depend on the server's
--     lc_collate: a migration that asserts exact row counts must not produce a
--     different row set on a different database.
--   * ambiguous — true when the winner was still tied with a same-named
--     jurisdiction after every key above. The T1 watch is still created (the
--     Google News query is a function of (name, state) only, so one feed covers
--     every Washington township in Ohio), but an arbitrary FIPS is NOT allowed
--     to seed T3 in section 4: picking one of 43 counties by tie-break is not
--     evidence that a Boundstone record concerns it.
create temporary table _fdy93_t1 on commit drop as
with ranked as (
  select state, jurisdiction, jtype, lvl, name, fips, ccf,
         row_number() over (
           partition by state, jurisdiction, jtype
           order by pref, lvl, name collate "C", hint_rank, fips) as rn,
         count(*) over (
           partition by state, jurisdiction, jtype,
                        pref, lvl, name, hint_rank) as tied
  from _fdy93_bs_cand
  where pref is not null
),
chosen as (
  select state, jurisdiction, jtype, lvl, name, fips, ccf, (tied > 1) as ambiguous
  from ranked
  where rn = 1
),
overridden as (
  select o.state, o.jurisdiction, b.jtype, j.lvl, j.name, j.fips, j.ccf, false as ambiguous
  from _fdy93_bs_override o
  join _fdy93_bs b on b.state = o.state and b.jurisdiction = o.jurisdiction
  join _fdy93_jur j on j.st = o.state and j.lvl = o.lvl and j.name = o.census_name
)
select * from overridden
union
select c.* from chosen c
where not exists (
  select 1 from _fdy93_bs_override o
  where o.state = c.state and o.jurisdiction = c.jurisdiction
);

-- ---------------------------------------------------------------------------
-- 4. The counties that actually carry a Boundstone record: the T1 counties
--    themselves, plus the counties containing a T1 city / town / village /
--    township. These, and only these, get their sub-county governments watched.
--
--    The issue's T3 also admitted "counties where a local-watch candidate
--    exists". That widened the set from 343 counties to 741 and T3 from 5,758
--    rows to 11,459 — and a legacy local-watch row is not evidence of anything:
--    480 of the 1,000 are small Arkansas and North Dakota places, which is the
--    exact skew this issue exists to correct. A Boundstone record IS evidence.
--    So T3 is scoped to Boundstone-record counties. Stated in the PR body.
-- ---------------------------------------------------------------------------

create temporary table _fdy93_bs_counties on commit drop as
select fips as f from _fdy93_t1 where lvl = 'county' and fips is not null
union
select cf from _fdy93_t1 t, unnest(coalesce(t.ccf, array[]::text[])) cf
where t.lvl <> 'county' and cf is not null
  and not t.ambiguous;  -- see the note on ambiguity in section 3

-- ---------------------------------------------------------------------------
-- 5. Counties with a data-center headline in the last 90 days -> daily.
--
--    public.artifact_jurisdictions cannot answer this: it holds 332 county-level
--    tags covering 11 distinct counties in total (measured 2026-10-07), so the
--    join returns 5 counties and the signal is effectively empty. The headline
--    text can answer it. A county matches when a data-center headline from the
--    last 90 days contains the Census county name AND also names the state
--    (full name or abbreviation) — the state term is what disambiguates the 30
--    Washington Counties. 131 counties matched at generate time; this is
--    recomputed at apply time, which is the point of a 90-day window.
-- ---------------------------------------------------------------------------

create temporary table _fdy93_dc on commit drop as
with headlines as (
  select a.signal_envelope ->> 'title' as ttl
  from public.artifacts a
  where coalesce(a.published_at, a.discovered_at) >= now() - interval '90 days'
    and coalesce(a.signal_envelope ->> 'title', '') ~* 'data cent'
),
states as (
  select state_abbr::text as abbr, name as state_name
  from public.jurisdictions where level = 'state'
)
select distinct c.fips_code as f
from headlines h
join public.jurisdictions c on c.level = 'county' and h.ttl like '%' || c.name || '%'
join states s on s.abbr = c.state_abbr
where h.ttl ~ ('(^|[^A-Za-z])' || s.state_name || '([^A-Za-z]|$)')
   or h.ttl ~ ('(^|[^A-Za-z])' || s.abbr || '([^A-Za-z]|$)');

-- ---------------------------------------------------------------------------
-- 6. The universe, one row per (Census name, state).
--
--    Keyed on (name, state) and NOT on FIPS, because the query is a function of
--    (name, state) only: 3,186 of the 16,147 Census county subdivisions share a
--    (name, state) pair — Ohio alone has a dozen Washington townships — and one
--    row per FIPS would have created a dozen rows all polling the identical
--    Google News feed, with colliding source_keys. fetch_config.fips keeps every
--    FIPS the row stands for, so nothing is lost.
--
--    Tier precedence: T1 > headline county > T2 > T3 > legacy.
-- ---------------------------------------------------------------------------

create temporary table _fdy93_sel on commit drop as
select j.lvl, j.name, j.st, j.fips,
       case
         when exists (select 1 from _fdy93_t1 t where t.lvl = j.lvl and t.fips = j.fips) then 't1'
         when j.lvl = 'county' and exists (select 1 from _fdy93_dc d where d.f = j.fips) then 'dc'
         when j.lvl = 'county' then 't2'
         else 't3'
       end as tier
from _fdy93_jur j
-- Every county-equivalent (T2), every T1 jurisdiction UNCONDITIONALLY, and the
-- places / townships of the Boundstone-record counties (T3).
--
-- T1 must not be filtered through _fdy93_bs_counties. A T1 township whose match
-- was ambiguous deliberately does NOT seed a T3 county (section 4), and if T1
-- membership were also gated on that set those jurisdictions would silently
-- vanish from the watch altogether — which is the opposite of T1's purpose.
where j.lvl = 'county'
   or exists (select 1 from _fdy93_t1 t where t.lvl = j.lvl and t.fips = j.fips)
   or (
        (j.lvl = 'place'
         or (j.lvl = 'cousub' and (j.name ~ '[Tt]ownship$' or j.name ~ ' town$')))
        and j.ccf && array(select f from _fdy93_bs_counties)
      );

create temporary table _fdy93_universe (
  source_key text primary key,
  entity     text not null,
  name       text not null,
  state_abbr text not null,
  tier       text not null,
  cadence    text not null,
  levels     text[] not null,
  fips       text[] not null,
  query      text not null,
  is_new     boolean not null
) on commit drop;

insert into _fdy93_universe (source_key, entity, name, state_abbr, tier, cadence, levels, fips, query, is_new)
with grouped as (
  select name, st,
         min(case tier when 't1' then 1 when 'dc' then 2 when 't2' then 3 else 4 end) as pri,
         array_agg(distinct lvl order by lvl)   as levels,
         array_agg(distinct fips order by fips) as fips
  from _fdy93_sel
  group by name, st
),
existing as (
  select r.source_key,
         btrim(split_part(r.fetch_config ->> 'entity', ',', 1))        as name,
         upper(btrim(split_part(r.fetch_config ->> 'entity', ',', 2))) as st
  from public.source_registry r
  where r.source_key like 'gsearch:loc-%'
),
rows as (
  select public.local_watch_source_key(g.name || ', ' || g.st) as source_key,
         g.name, g.st,
         case g.pri when 1 then 't1' when 2 then 'dc' when 3 then 't2' else 't3' end as tier,
         g.levels, g.fips
  from grouped g
  union all
  -- Existing rows outside T1-T3 are NEVER deleted (pre-made decision); they drop
  -- to monthly and are tagged tier='legacy' so the skew is visible.
  select e.source_key, e.name, e.st, 'legacy', array['legacy']::text[], array[]::text[]
  from existing e
  where not exists (select 1 from grouped g where g.name = e.name and g.st = e.st)
)
select r.source_key,
       r.name || ', ' || r.st,
       r.name, r.st, r.tier,
       case r.tier
         when 't1'  then 'daily'
         when 'dc'  then 'daily'
         when 't2'  then 'biweekly'
         when 't3'  then 'biweekly'
         else 'monthly'
       end,
       r.levels, r.fips,
       public.local_watch_query(r.name, r.st),
       not exists (select 1 from public.source_registry s where s.source_key = r.source_key)
from rows r;

-- ---------------------------------------------------------------------------
-- 7. Upsert. Idempotent on source_key.
--
--    A row that already exists has its cadence and its tier metadata set and
--    NOTHING ELSE touched — in particular fetch_config.query, query_v1,
--    query_rev, feed_url and url stay exactly as FDY-88 left them. New rows get
--    the v2 query (query_rev = 2, no query_v1: there is no v1 to preserve).
--
--    Every row is scope='query_feed', countable=false, which is why this
--    migration cannot move a published count or a confidence grade.
-- ---------------------------------------------------------------------------

insert into public.source_registry (
  source_key, name, provider, url, feed_url, access_method, cadence,
  confidence_cap, license, license_status, idf_domains, scope, countable, status,
  subsystem, fetcher, fetch_config, source_type, cost_model, cost_model_basis,
  cost_model_rule_id, cost_model_certainty, url_normalised, idf_subdomains,
  idf_subdomains_method, idf_subdomains_confidence, confidence_band, review_state,
  freshness_basis, freshness_certainty
)
select
  u.source_key,
  'Google News search: ' || u.entity || ' (local gov watch)',
  'Google News RSS',
  'https://news.google.com/search?q=' || public.gsearch_seed_url(u.query),
  'https://news.google.com/rss/search?q=' || public.gsearch_seed_url(u.query)
    || '&hl=en-US&gl=US&ceid=US:en',
  'rss',
  u.cadence,
  'SRC',
  'google-news-rss (aggregator; items link to underlying publishers)',
  'attribution_required',
  array['D13', 'D18']::text[],
  'query_feed',
  false,
  'active',
  'poller',
  'source-poller',
  jsonb_build_object(
    'entity',      u.entity,
    'query',       u.query,
    'query_rev',   2,
    'segment',     'local_gov',
    'gov_level',   'local',
    'gov_region',  'US',
    'country',     'US',
    'entity_kind', 'government',
    'wave',        'fdy93',
    'tier',        u.tier,
    'tier_rev',    1,
    'levels',      to_jsonb(u.levels),
    'fips',        to_jsonb(u.fips)
  ),
  'search_query',
  'free',
  'rule_derived',
  30,
  0.99,
  lower('news.google.com/search?q=' || public.gsearch_seed_url(u.query)),
  array['D5.1']::text[],
  'proposed_auto',
  0.60,
  'CF0',
  'proposed_auto',
  'ingest_path',
  0.5
from _fdy93_universe u
on conflict (source_key) do update
set cadence      = excluded.cadence,
    fetch_config = public.source_registry.fetch_config
                   || jsonb_build_object(
                        'tier',     excluded.fetch_config ->> 'tier',
                        'tier_rev', (excluded.fetch_config -> 'tier_rev'),
                        'levels',   (excluded.fetch_config -> 'levels'),
                        'fips',     (excluded.fetch_config -> 'fips')
                      ),
    updated_at   = now();

-- ---------------------------------------------------------------------------
-- 8. Verification. Every number below was measured read-only against production
--    on 2026-10-07; a mismatch means the universe really changed and has to be
--    re-verified, not papered over.
--
--    The 90-day headline window is the only moving part, so `dc` is bounded and
--    `dc + t2` is pinned instead of each separately. Everything else — the
--    universe size, T1, T3, legacy, and 100% county coverage — is exact.
-- ---------------------------------------------------------------------------

do $verify$
declare
  n_counties     int;
  n_universe     int;
  n_keys         int;
  n_loc          int;
  n_uncovered    int;
  n_bad_cadence  int;
  n_bad_or       int;
  n_lost_v1      int;
  n_override     int;
  n_unmatched    int;
  n_ambiguous  int;
  n_bs_counties  int;
  n_t1           int;
  n_t2           int;
  n_t3           int;
  n_dc           int;
  n_legacy       int;
  n_new          int;
  n_pr           int;
begin
  select count(*) into n_counties from public.jurisdictions where level = 'county';
  if n_counties <> 3222 then
    raise exception 'FDY-93: expected 3222 county-equivalents, found %', n_counties;
  end if;

  select count(*) into n_pr from public.jurisdictions where level = 'county' and name like '%Municipio';
  if n_pr <> 78 then
    raise exception 'FDY-93: expected 78 Puerto Rico municipios at county level, found %', n_pr;
  end if;

  -- every override must resolve, or a consolidated city-county silently drops out
  select count(*) into n_override
  from _fdy93_bs_override o
  where not exists (select 1 from _fdy93_t1 t
                    where t.state = o.state and t.jurisdiction = o.jurisdiction);
  if n_override <> 0 then
    raise exception 'FDY-93: % roster override(s) resolved to nothing', n_override;
  end if;

  -- and every Boundstone jurisdiction that CAN resolve must have resolved. The
  -- five that cannot are 3 tribal nations, 1 state executive order and 1 utility
  -- authority: none of them is a Census jurisdiction.
  select count(*) into n_unmatched
  from _fdy93_bs b
  where b.jtype not in ('Tribal', 'State', 'Utility-authority')
    and not exists (select 1 from _fdy93_t1 t
                    where t.state = b.state and t.jurisdiction = b.jurisdiction
                      and t.jtype = b.jtype);
  if n_unmatched <> 0 then
    raise exception 'FDY-93: % of 444 matchable Boundstone jurisdictions did not resolve to Census', n_unmatched;
  end if;

  -- The tie-break is a total order, so the number of still-ambiguous matches is
  -- a property of the DATA and must not drift. If this moves, the roster or the
  -- Census name set changed and the 15 listed in the PR need re-reviewing.
  select count(*) into n_ambiguous from _fdy93_t1 where ambiguous;
  if n_ambiguous <> 15 then
    raise exception 'FDY-93: expected 15 ambiguous (same-named) Boundstone matches, found %', n_ambiguous;
  end if;

  select count(*) into n_bs_counties from _fdy93_bs_counties;
  if n_bs_counties <> 340 then
    raise exception 'FDY-93: expected 340 Boundstone-record counties, found %', n_bs_counties;
  end if;

  select count(*), count(distinct source_key) into n_universe, n_keys from _fdy93_universe;
  if n_universe <> n_keys then
    raise exception 'FDY-93: % universe rows collapse to % source_keys (52-char truncation clash)',
      n_universe, n_keys;
  end if;
  if n_universe <> 9106 then
    raise exception 'FDY-93: expected 9106 universe rows, built %', n_universe;
  end if;

  select count(*) filter (where tier = 't1'),
         count(*) filter (where tier = 'dc'),
         count(*) filter (where tier = 't2'),
         count(*) filter (where tier = 't3'),
         count(*) filter (where tier = 'legacy'),
         count(*) filter (where is_new)
    into n_t1, n_dc, n_t2, n_t3, n_legacy, n_new
  from _fdy93_universe;

  raise notice 'FDY-93 tiers: t1=% dc=% t2=% t3=% legacy=% (new rows %)',
    n_t1, n_dc, n_t2, n_t3, n_legacy, n_new;

  if n_t1 <> 440 then
    raise exception 'FDY-93: expected 440 T1 (Boundstone) rows, built %', n_t1;
  end if;
  if n_t3 <> 5060 then
    raise exception 'FDY-93: expected 5060 T3 rows, built %', n_t3;
  end if;
  if n_legacy <> 568 then
    raise exception 'FDY-93: expected 568 legacy rows, built %', n_legacy;
  end if;
  if n_new <> 8106 then
    raise exception 'FDY-93: expected 8106 new rows, built %', n_new;
  end if;
  -- the headline window moves, so pin the sum and bound the part
  -- (113 dc + 2925 t2 at generate time, 2026-10-07)
  if n_dc + n_t2 <> 3038 then
    raise exception 'FDY-93: dc + t2 = %, expected 3038', n_dc + n_t2;
  end if;
  if n_dc < 1 or n_dc > 600 then
    raise exception 'FDY-93: % headline counties is outside the sane band 1..600', n_dc;
  end if;

  -- every county-equivalent is watched. This is the issue, stated as an assertion.
  select count(*) into n_uncovered
  from public.jurisdictions j
  where j.level = 'county'
    and not exists (
      select 1 from public.source_registry r
      where r.source_key like 'gsearch:loc-%'
        and r.fetch_config ->> 'entity' = j.name || ', ' || j.state_abbr
    );
  if n_uncovered <> 0 then
    raise exception 'FDY-93: % county-equivalents still have no local watch', n_uncovered;
  end if;

  -- every cadence written must be one public.poller_cadence_interval() knows, or
  -- the row polls every 20 hours by default instead of on its tier
  select count(*) into n_bad_cadence
  from public.source_registry r
  where r.source_key like 'gsearch:loc-%'
    and r.cadence not in ('hourly', 'daily', 'weekly', 'biweekly', 'monthly', 'event_driven', 'archival_refresh', 'one_time');
  if n_bad_cadence <> 0 then
    raise exception 'FDY-93: % local-watch rows carry a cadence poller_cadence_interval() does not know', n_bad_cadence;
  end if;

  -- no generated query may contain an unparenthesised top-level OR (the FDY-88
  -- defect). Strip every (...) group, then look for a surviving bare OR.
  select count(*) into n_bad_or
  from public.source_registry r
  where r.source_key like 'gsearch:loc-%'
    and regexp_replace(r.fetch_config ->> 'query', '\([^()]*\)', ' ', 'g')
        ~ '(^|[^A-Za-z])OR([^A-Za-z]|$)';
  if n_bad_or <> 0 then
    raise exception 'FDY-93: % local-watch queries contain an unparenthesised OR', n_bad_or;
  end if;

  -- FDY-88's rollback path must survive: every row it rewrote still has query_v1
  select count(*) into n_lost_v1
  from public.source_registry r
  where r.source_key like 'gsearch:loc-%'
    and (r.fetch_config ->> 'wave') is distinct from 'fdy93'
    and r.fetch_config ->> 'query_rev' = '2'
    and not (r.fetch_config ? 'query_v1');
  if n_lost_v1 <> 0 then
    raise exception 'FDY-93: % pre-existing rows lost fetch_config.query_v1', n_lost_v1;
  end if;

  select count(*) into n_loc from public.source_registry where source_key like 'gsearch:loc-%';
  raise notice 'FDY-93: local watch is now % rows (was 1000); all % county-equivalents are covered',
    n_loc, n_counties;
end
$verify$;

commit;
