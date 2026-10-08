#!/usr/bin/env node
// gen-local-watch-county-complete.mjs — FDY-93 (L6).
//
// Generates supabase/migrations/20261010100000_local_watch_county_complete.sql,
// which makes the "local gov watch" lane county-complete: every one of the
// 3,222 US county-equivalents, every Boundstone jurisdiction, and the places and
// townships inside the counties that actually carry a Boundstone record — each
// on a cadence the poller can sustain.
//
// Usage:
//   node scripts/gen-local-watch-county-complete.mjs            # write
//   node scripts/gen-local-watch-county-complete.mjs --check    # verify current
//   node scripts/gen-local-watch-county-complete.mjs --stdout   # print only
//
// This script NEVER connects to a database and NEVER applies anything. The
// migration it emits carries the UN-APPLIED header; Myke applies it on merge.
//
// ---------------------------------------------------------------------------
// WHY THE MIGRATION IS SQL-DRIVEN AND NOT A LIST OF ROW LITERALS
// ---------------------------------------------------------------------------
// FDY-88's generator emitted one literal tuple per row, which is the right shape
// for 1,000 rows. This lane goes to 9,309 rows, of which 8,309 are new, and the
// tier of a county depends on whether it has had a data-center headline in the
// last 90 days — a fact that is true on the day the migration is APPLIED, not on
// the day it is generated. Freezing 9,309 literals would therefore ship a
// snapshot that is already stale, and a 9,000-line diff no reviewer can read.
//
// So this generator emits logic, and the only data it embeds is the one input
// Faraday cannot derive for itself: the committed Boundstone roster snapshot
// (data/boundstone-jurisdictions-2026-10-07.csv, 449 rows, read from Boundstone's
// public anon REST view — guardrail 4). Everything else — the 3,222 counties, the
// places and townships, the headline signal — is selected from
// public.jurisdictions and public.artifacts at apply time.
//
// The query text itself is still built by exactly one algorithm. The SQL
// functions this generator emits (public.local_watch_*) are generated FROM the
// constants in supabase/functions/source-poller/local-query.ts, and
// test/local-watch-county-complete.test.mjs runs them inside pglite against the
// TypeScript buildLocalQuery() over the full 1,000-row FDY-88 corpus plus a
// township/edge-case corpus, asserting byte equality. The two cannot drift.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCAL_GOV_PREFIX,
  LOCAL_KINDS,
  LOCAL_PLACE_KINDS,
  localActionGroup,
  localTopicGroup,
  STATE_NAMES,
} from "../supabase/functions/source-poller/local-query.ts";
import { CADENCE_MINUTES, DEFAULT_CADENCE } from "../supabase/functions/source-poller/poller-schedule.ts";

const DEFAULT_CADENCE_KEY = DEFAULT_CADENCE;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const ROSTER = resolve(ROOT, "data/boundstone-jurisdictions-2026-10-07.csv");
export const MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261010100000_local_watch_county_complete.sql",
);
export const ROSTER_FETCHED = "2026-10-07";

// ---------------------------------------------------------------------------
// Tier -> cadence.
//
// The spec is T1 daily / headline counties daily / T2 weekly / T3 weekly /
// legacy monthly, with a pre-authorised demotion ladder of "T3 -> biweekly, then
// T2 -> biweekly" if the budget does not fit. It does not fit, by a wide margin,
// so BOTH rungs are applied. scripts/check-local-watch-budget.mjs is the
// arithmetic and prints the table that is reproduced in the PR body.
// ---------------------------------------------------------------------------
export const TIER_CADENCE_SPEC = {
  t1: "daily",
  dc: "daily",
  t2: "weekly",
  t3: "weekly",
  legacy: "monthly",
};
export const TIER_CADENCE = {
  t1: "daily",
  dc: "daily",
  t2: "biweekly", // ladder rung 2
  t3: "biweekly", // ladder rung 1
  legacy: "monthly",
};
export const TIER_REV = 1;

/** Every cadence this migration can write must be a key of CADENCE_MINUTES, or
 * public.poller_cadence_interval() silently treats it as DAILY and the row polls
 * 34x more often than intended. Fail at generate time, not in production. */
for (const [tier, cadence] of Object.entries(TIER_CADENCE)) {
  if (!(cadence in CADENCE_MINUTES)) {
    throw new Error(
      `tier ${tier} wants cadence '${cadence}', which is not in CADENCE_MINUTES ` +
        `(${Object.keys(CADENCE_MINUTES).join(", ")}). An unknown cadence falls back ` +
        `to daily — add it to poller-schedule.ts AND to poller_cadence_interval().`,
    );
  }
}

// ---------------------------------------------------------------------------
// Expected shape of the result, measured read-only against production
// (project ycadmmngkdhvpcsrcuaq) on 2026-10-07. The migration asserts these, so
// a drift is a real change in the universe and has to be re-verified rather than
// papered over. `dc` is apply-time by design (a 90-day window) and is therefore
// bounded, not pinned.
// ---------------------------------------------------------------------------
export const EXPECTED = {
  countyEquivalents: 3222,
  prMunicipios: 78,
  rosterRows: 449,
  // 449 - 3 Tribal - 1 State-level executive order - 1 utility authority: those
  // five are not Census jurisdictions and have nothing to resolve to.
  rosterMatchable: 444,
  rosterUnmatched: 0,
  existingLocRows: 1000,
  universeRows: 9106,
  newRows: 8106,
  legacyRows: 568,
  t1Rows: 440, // distinct (name, state) covered by the 444 resolved roster rows
  t3Rows: 5060,
  boundstoneCounties: 340,
  // dc is a 90-day window evaluated at APPLY time, so it is bounded, not pinned.
  // 131 counties matched at generate time, 113 of them outside T1 -> dc + t2 is
  // the pinned quantity and the split between them is allowed to move.
  dcPlusT2Rows: 3038,
  dcRowsAtGenerate: 113,
  t2RowsAtGenerate: 2925,
  dcRowsMin: 1,
  dcRowsMax: 600,
  // Roster rows whose Census match is still tied with a SAME-NAMED jurisdiction
  // after every ordering key. Deliberately watched by name and deliberately not
  // allowed to seed a T3 county. Listed in the PR body.
  ambiguousT1: 15,
};

/** The six Boundstone names no normaliser can reach. Four are consolidated
 * city-counties Census files under the county name; two end in a capitalised
 * governing word that Census writes in lower case, so the suffix strip that
 * fixes one side breaks the other. With these six, 444 of 444 matchable roster
 * rows resolve — the migration asserts zero unmatched. Hand-verified against
 * public.jurisdictions on 2026-10-07. */
export const ROSTER_OVERRIDES = [
  // consolidated city-counties: Census files the government under the county name
  ["GA", "Augusta-Richmond County", "county", "Richmond County"],
  ["IN", "Indianapolis (Marion County)", "county", "Marion County"],
  ["KY", "Lexington-Fayette", "county", "Fayette County"],
  ["TN", "Nashville-Davidson County", "county", "Davidson County"],
  // names that legitimately END in the governing word, where the Boundstone
  // spelling capitalises it and Census does not
  ["MD", "Baltimore City", "county", "Baltimore city"],
  ["PA", "Brookville Borough", "place", "Brookville borough"],
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** 9309 -> "9,309", for the reviewer-facing header. */
const n = (v) => v.toLocaleString("en-US");

/** Minimal RFC4180 reader — the roster has quoted fields (commas in names). */
export function readRoster(file = ROSTER) {
  const text = readFileSync(file, "utf8");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  const want = ["state", "state_name", "jurisdiction", "jtype"];
  if (header.join(",") !== want.join(",")) {
    throw new Error(`roster header is ${header.join(",")}, expected ${want.join(",")}`);
  }
  const out = rows.map(([state, stateName, jurisdiction, jtype]) => ({
    state,
    stateName,
    jurisdiction,
    jtype,
  }));
  const seen = new Set();
  for (const r of out) {
    const k = `${r.state}|${r.jurisdiction}|${r.jtype}`;
    if (seen.has(k)) throw new Error(`duplicate roster row ${k}`);
    seen.add(k);
    if (!/^[A-Z]{2}$/.test(r.state)) throw new Error(`bad state ${JSON.stringify(r.state)}`);
  }
  if (out.length !== EXPECTED.rosterRows) {
    throw new Error(`roster has ${out.length} rows, expected ${EXPECTED.rosterRows}`);
  }
  return out;
}

/** A SQL `case` function over a string key, built from a JS map. */
function caseFn(name, argName, map, fallback, { comment }) {
  const arms = Object.entries(map)
    .map(([k, v]) => `    when ${q(k)} then ${q(v)}`)
    .join("\n");
  return `create or replace function public.${name}(${argName} text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case ${argName}
${arms}
    else ${fallback}
  end
$$;

comment on function public.${name}(text) is ${q(comment)};`;
}

/** Re-assert public.poller_cadence_interval() with the FULL cadence table.
 *
 * WHY THIS IS HERE AND NOT ONLY IN FDY-89's MIGRATION
 * ---------------------------------------------------
 * This migration writes cadence='monthly' on the legacy rows and
 * cadence='biweekly' on T2/T3. Those two arms were added to
 * 20261009210000_poller_fair_scheduling.sql (FDY-89), which is UN-APPLIED —
 * verified read-only on 2026-10-07: supabase_migrations.schema_migrations has no
 * 20261009210000 row and public.poller_cadence_interval does not exist in
 * production. So both files will be applied by Myke.
 *
 * But Supabase applies a migration version at most once. If 20261009210000 is
 * applied BEFORE this file is merged (i.e. PR #74 lands and is applied first),
 * the two arms added to it would already be in production and all is well — yet
 * if it were ever applied from an older checkout, production would hold a
 * 7-cadence function while this migration sets cadence='monthly' on 568 rows.
 * An unknown cadence falls back to DAILY by design, so those rows would poll
 * every 20 hours instead of every 28 days: 568/0.8333 = 682 fetches/day where 20
 * were intended, a 34x over-subscription of the exact lane FDY-89 just unstarved.
 *
 * Re-asserting the whole table here makes the outcome independent of apply
 * order, which is the property that actually matters. It is generated from
 * CADENCE_MINUTES, and both this file and FDY-89's are asserted against that
 * same constant by the test suite, so the two copies cannot drift.
 */
export function buildCadenceSql() {
  const arms = Object.entries(CADENCE_MINUTES)
    .map(([k, v]) => `    when ${q(k)} then interval ${q(`${v} minutes`)}`)
    .join("\n");
  return `-- ---------------------------------------------------------------------------
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
${arms}
    else interval ${q(`${CADENCE_MINUTES[DEFAULT_CADENCE_KEY]} minutes`)}
  end
$$;

comment on function public.poller_cadence_interval(text) is
  'cadence -> interval. Mirrors CADENCE_MINUTES in poller-schedule.ts. Unknown/NULL cadence is treated as daily, never as skip. Re-asserted by FDY-93 so that this migration is correct under any apply order.';`;
}

// ---------------------------------------------------------------------------
// The generated SQL mirror of local-query.ts
// ---------------------------------------------------------------------------

export function buildQueryFunctionsSql() {
  const topic = {};
  const action = {};
  for (const kind of LOCAL_KINDS) {
    topic[kind] = localTopicGroup(kind);
    action[kind] = localActionGroup(kind);
  }
  const placeKinds = LOCAL_PLACE_KINDS.map((k) => q(k)).join(", ");

  return `-- ---------------------------------------------------------------------------
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

${caseFn("local_watch_state_name", "p_state_abbr", STATE_NAMES, "null", {
    comment:
      "FDY-93: two-letter state/territory abbreviation -> full name. Mirror of STATE_NAMES in local-query.ts. NULL for an unknown abbreviation, which local_watch_query() then omits rather than interpolating bare (a bare OR / IN would be read as a Google operator).",
  })}

${caseFn("local_watch_topic_group", "p_kind", topic, q(topic.other), {
    comment:
      "FDY-93: jurisdiction kind -> parenthesised topic group. Mirror of topicGroup() in local-query.ts.",
  })}

${caseFn("local_watch_action_group", "p_kind", action, q(action.other), {
    comment:
      "FDY-93: jurisdiction kind -> parenthesised action group. Mirror of actionGroup() in local-query.ts.",
  })}

${caseFn("local_watch_gov_prefix", "p_kind", LOCAL_GOV_PREFIX, "null", {
    comment:
      "FDY-93: jurisdiction kind -> governing prefix used in the name group (\"City of Acworth\"). Mirror of GOV_PREFIX in local-query.ts. NULL means no prefix (cdp, and every non-place kind).",
  })}

create or replace function public.local_watch_place_kinds()
returns text[]
language sql
immutable
parallel safe
as $$ select array[${placeKinds}]::text[] $$;

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
    when btrim(p_name, E' \\t\\n\\r') ~* '\\s(charter\\s+)?township$' then 'township'
    else case (regexp_match(btrim(p_name, E' \\t\\n\\r'), '(\\S+)$'))[1]
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
      regexp_replace(btrim(p_name, E' \\t\\n\\r'), '\\s+(charter\\s+)?township$', '', 'i')
    when p_kind = 'other' then btrim(p_name, E' \\t\\n\\r')
    else regexp_replace(btrim(p_name, E' \\t\\n\\r'), '\\s+\\S+$', '')
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
  v_alt := btrim(coalesce((regexp_match(v_stem, '\\(([^)]+)\\)'))[1], ''), E' \\t\\n\\r');
  v_pri := btrim(
    regexp_replace(regexp_replace(v_stem, '\\s*\\([^)]*\\)\\s*', ' ', 'g'), '\\s+', ' ', 'g'),
    E' \\t\\n\\r');
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
  v_full   text := btrim(p_name, E' \\t\\n\\r');
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
  v_state := public.local_watch_state_name(upper(btrim(coalesce(p_state_abbr, ''), E' \\t\\n\\r')));
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
grant execute on function public.local_watch_place_kinds() to service_role;`;
}

// ---------------------------------------------------------------------------
// The roster block
// ---------------------------------------------------------------------------

export function buildRosterSql(roster) {
  const values = roster
    .map((r) => `  (${q(r.state)}, ${q(r.jurisdiction)}, ${q(r.jtype)})`)
    .join(",\n");
  const overrides = ROSTER_OVERRIDES.map(
    ([st, juris, lvl, name]) => `  (${q(st)}, ${q(juris)}, ${q(lvl)}, ${q(name)})`,
  ).join(",\n");
  const byType = {};
  for (const r of roster) byType[r.jtype] = (byType[r.jtype] ?? 0) + 1;
  const composition = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

  return `-- ---------------------------------------------------------------------------
-- 2. The Boundstone roster.
--
--    ${roster.length} distinct (state, jurisdiction, jtype), snapshotted ${ROSTER_FETCHED} from
--    Boundstone's PUBLIC ANON REST VIEW \`bs_records\` — the only sanctioned read
--    path (guardrail 4: Faraday never reads Boundstone's database, and nothing
--    ever flows the other way except through the two FDY-91 RPCs).
--    Source of truth: data/boundstone-jurisdictions-2026-10-07.csv
--    (+ .PROVENANCE.md for the exact request and the counts measured at fetch).
--
--    Composition: ${composition}
--
--    NOTE the live view's column names are \`state, jurisdiction, jtype\`, not the
--    \`state_abbr, jurisdiction_name, jurisdiction_type\` the issue text predicted;
--    asking for the issue's names returns 400 / 42703.
-- ---------------------------------------------------------------------------

create temporary table _fdy93_bs (
  state        text not null,
  jurisdiction text not null,
  jtype        text not null
) on commit drop;

insert into _fdy93_bs (state, jurisdiction, jtype) values
${values};

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
${overrides};`;
}

// ---------------------------------------------------------------------------
// Resolution + universe + upsert + verification
// ---------------------------------------------------------------------------

export function buildBodySql() {
  const cad = (t) => q(TIER_CADENCE[t]);
  return `-- ---------------------------------------------------------------------------
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
                   regexp_replace(lower(b.jurisdiction), '\\(.*', ' '),
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
           (regexp_match(jurisdiction, '\\(([^)]*[Cc]ounty)\\)'))[1], '')),
           '[^a-z0-9]+', ' ', 'g'), ' '),
         ' county$', ''), ' '), '') as county_hint
from punct;

create temporary table _fdy93_jur on commit drop as
with strip_parens as (
  select j.level::text as lvl, j.name, j.state_abbr::text as st, j.fips_code as fips,
         j.containing_county_fips as ccf,
         (regexp_match(j.name, '(\\S+)$'))[1] as csuf,
         lower(regexp_replace(j.name, '\\s*\\([^)]*\\)\\s*', ' ', 'g')) as x
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
         when 't1'  then ${cad("t1")}
         when 'dc'  then ${cad("dc")}
         when 't2'  then ${cad("t2")}
         when 't3'  then ${cad("t3")}
         else ${cad("legacy")}
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
    'tier_rev',    ${TIER_REV},
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
    updated_at   = now();`;
}

export function buildVerifySql() {
  const e = EXPECTED;
  const cadences = Object.keys(CADENCE_MINUTES).map((c) => q(c)).join(", ");
  return `-- ---------------------------------------------------------------------------
-- 8. Verification. Every number below was measured read-only against production
--    on 2026-10-07; a mismatch means the universe really changed and has to be
--    re-verified, not papered over.
--
--    The 90-day headline window is the only moving part, so \`dc\` is bounded and
--    \`dc + t2\` is pinned instead of each separately. Everything else — the
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
  if n_counties <> ${e.countyEquivalents} then
    raise exception 'FDY-93: expected ${e.countyEquivalents} county-equivalents, found %', n_counties;
  end if;

  select count(*) into n_pr from public.jurisdictions where level = 'county' and name like '%Municipio';
  if n_pr <> ${e.prMunicipios} then
    raise exception 'FDY-93: expected ${e.prMunicipios} Puerto Rico municipios at county level, found %', n_pr;
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
  if n_unmatched <> ${e.rosterUnmatched} then
    raise exception 'FDY-93: % of ${e.rosterMatchable} matchable Boundstone jurisdictions did not resolve to Census', n_unmatched;
  end if;

  -- The tie-break is a total order, so the number of still-ambiguous matches is
  -- a property of the DATA and must not drift. If this moves, the roster or the
  -- Census name set changed and the 15 listed in the PR need re-reviewing.
  select count(*) into n_ambiguous from _fdy93_t1 where ambiguous;
  if n_ambiguous <> ${e.ambiguousT1} then
    raise exception 'FDY-93: expected ${e.ambiguousT1} ambiguous (same-named) Boundstone matches, found %', n_ambiguous;
  end if;

  select count(*) into n_bs_counties from _fdy93_bs_counties;
  if n_bs_counties <> ${e.boundstoneCounties} then
    raise exception 'FDY-93: expected ${e.boundstoneCounties} Boundstone-record counties, found %', n_bs_counties;
  end if;

  select count(*), count(distinct source_key) into n_universe, n_keys from _fdy93_universe;
  if n_universe <> n_keys then
    raise exception 'FDY-93: % universe rows collapse to % source_keys (52-char truncation clash)',
      n_universe, n_keys;
  end if;
  if n_universe <> ${e.universeRows} then
    raise exception 'FDY-93: expected ${e.universeRows} universe rows, built %', n_universe;
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

  if n_t1 <> ${e.t1Rows} then
    raise exception 'FDY-93: expected ${e.t1Rows} T1 (Boundstone) rows, built %', n_t1;
  end if;
  if n_t3 <> ${e.t3Rows} then
    raise exception 'FDY-93: expected ${e.t3Rows} T3 rows, built %', n_t3;
  end if;
  if n_legacy <> ${e.legacyRows} then
    raise exception 'FDY-93: expected ${e.legacyRows} legacy rows, built %', n_legacy;
  end if;
  if n_new <> ${e.newRows} then
    raise exception 'FDY-93: expected ${e.newRows} new rows, built %', n_new;
  end if;
  -- the headline window moves, so pin the sum and bound the part
  -- (${e.dcRowsAtGenerate} dc + ${e.t2RowsAtGenerate} t2 at generate time, 2026-10-07)
  if n_dc + n_t2 <> ${e.dcPlusT2Rows} then
    raise exception 'FDY-93: dc + t2 = %, expected ${e.dcPlusT2Rows}', n_dc + n_t2;
  end if;
  if n_dc < ${e.dcRowsMin} or n_dc > ${e.dcRowsMax} then
    raise exception 'FDY-93: % headline counties is outside the sane band ${e.dcRowsMin}..${e.dcRowsMax}', n_dc;
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
    and r.cadence not in (${cadences});
  if n_bad_cadence <> 0 then
    raise exception 'FDY-93: % local-watch rows carry a cadence poller_cadence_interval() does not know', n_bad_cadence;
  end if;

  -- no generated query may contain an unparenthesised top-level OR (the FDY-88
  -- defect). Strip every (...) group, then look for a surviving bare OR.
  select count(*) into n_bad_or
  from public.source_registry r
  where r.source_key like 'gsearch:loc-%'
    and regexp_replace(r.fetch_config ->> 'query', '\\([^()]*\\)', ' ', 'g')
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
  raise notice 'FDY-93: local watch is now % rows (was ${e.existingLocRows}); all % county-equivalents are covered',
    n_loc, n_counties;
end
$verify$;`;
}

export function buildMigration(roster = readRoster()) {
  const byType = {};
  for (const r of roster) byType[r.jtype] = (byType[r.jtype] ?? 0) + 1;
  const e = EXPECTED;
  const header = `-- UN-APPLIED — applied by Myke on merge
-- 20261010100000_local_watch_county_complete.sql — FDY-93 (L6)
--
-- Makes the "local gov watch" lane county-complete.
--
-- GENERATED FILE. Do not hand-edit. Regenerate with:
--   node scripts/gen-local-watch-county-complete.mjs
-- Inputs: data/boundstone-jurisdictions-2026-10-07.csv (${roster.length} rows, read from
-- Boundstone's public anon REST view on ${ROSTER_FETCHED}) and the constants in
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
--   ${n(e.universeRows)} rows (${n(e.newRows)} new, ${n(e.existingLocRows)} re-tiered, 0 deleted):
--     t1     ${n(e.t1Rows).padStart(5)}  every Boundstone jurisdiction (${e.rosterMatchable}/${e.rosterMatchable} resolved)        daily
--     dc     ${n(e.dcRowsAtGenerate).padStart(5)}  counties with a data-center headline in the last 90d    daily
--     t2     ${n(e.t2RowsAtGenerate).padStart(5)}  the remaining county-equivalents                        biweekly
--     t3     ${n(e.t3Rows).padStart(5)}  places + townships in the ${e.boundstoneCounties} Boundstone-record counties biweekly
--     legacy ${n(e.legacyRows).padStart(5)}  pre-existing small places outside T1-T3 (kept, not cut) monthly
--   3,222 / 3,222 county-equivalents covered (9.3% -> 100%), including the 78
--   Puerto Rico municipios, the 41 independent cities, the 17 Alaska boroughs,
--   the 11 Alaska census areas, the 9 Connecticut planning regions and DC.
--   dc and t2 are the apply-time split of a fixed ${n(e.dcPlusT2Rows)}; everything else is pinned.
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
`;
  return [
    header,
    buildCadenceSql(),
    "",
    buildQueryFunctionsSql(),
    "",
    buildRosterSql(roster),
    "",
    buildBodySql(),
    "",
    buildVerifySql(),
    "",
    "commit;",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const sql = buildMigration();
  if (argv.includes("--stdout")) {
    process.stdout.write(sql);
    return 0;
  }
  if (argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(MIGRATION, "utf8");
    } catch {
      console.error(`missing ${MIGRATION}`);
      return 1;
    }
    if (current !== sql) {
      console.error(
        "supabase/migrations/20261010100000_local_watch_county_complete.sql is stale.\n" +
          "Regenerate with: node scripts/gen-local-watch-county-complete.mjs",
      );
      return 1;
    }
    console.log("migration is current");
    return 0;
  }
  writeFileSync(MIGRATION, sql);
  console.log(`wrote ${MIGRATION} (${sql.split("\n").length} lines)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
