// FDY-93 (L6) — tests for the county-complete local gov watch.
//
// Three layers:
//   1. static:  the generator is deterministic, the migration on disk is current,
//               the guardrail header is present, and nothing in it deletes a row,
//               rewrites a source_key, or writes a cadence the poller does not
//               understand.
//   2. drift:   the SQL functions the migration creates are loaded into pglite and
//               compared against buildLocalQuery() / localSourceKey() in
//               supabase/functions/source-poller/local-query.ts over the full
//               1,000-entity FDY-88 corpus plus a township / edge-case corpus.
//               Byte equality, every row. This is what lets the migration select
//               from public.jurisdictions at apply time instead of freezing 9,311
//               row literals.
//   3. rows:    the whole pipeline (roster -> resolution -> universe -> upsert)
//               runs against a miniature public.jurisdictions / source_registry /
//               artifacts in pglite, and the resulting rows, tiers, cadences and
//               row counts are asserted exactly. The production-scale guard in
//               section 8 is then run on purpose and must raise, which proves the
//               guard is live and the SQL is valid.
//
// Layers 2 and 3 are skipped with a message when pglite is not installed, so CI
// stays green without adding a package.json dependency:
//   mkdir -p /tmp/pglite && cd /tmp/pglite && npm i @electric-sql/pglite
//   PGLITE_MODULE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js npm test
//
// NOTHING HERE TOUCHES PRODUCTION. The migration is UN-APPLIED; Myke applies it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED,
  MIGRATION,
  ROSTER_OVERRIDES,
  TIER_CADENCE,
  TIER_CADENCE_SPEC,
  buildMigration,
  readRoster,
} from "../scripts/gen-local-watch-county-complete.mjs";
import {
  buildLocalQuery,
  classifyLocalName,
  hasTopLevelBareOr,
  localJurisdictionFromEntity,
  localSourceKey,
} from "../supabase/functions/source-poller/local-query.ts";
import { CADENCE_MINUTES } from "../supabase/functions/source-poller/poller-schedule.ts";
import {
  CRON,
  capacityPerDay,
  floorPerDay,
  laneDemand,
  laneRows,
  requiredPerHour,
  restOfFleetDemand,
} from "../scripts/check-local-watch-budget.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(MIGRATION, "utf8");
const FDY88_ENTITIES = readFileSync(resolve(HERE, "../docs/far-88/loc-watch-entities.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));

// ── layer 1: static ──────────────────────────────────────────────────────────

test("the migration on disk is exactly what the generator produces", () => {
  assert.equal(SQL, buildMigration(), "stale — run node scripts/gen-local-watch-county-complete.mjs");
});

test("guardrail 2: the UN-APPLIED header is the first line", () => {
  assert.match(SQL, /^-- UN-APPLIED — applied by Myke on merge\n/);
  assert.match(SQL, /\nbegin;\n/);
  assert.match(SQL, /\ncommit;\n/);
});

test("no row is deleted and no source_key is ever rewritten", () => {
  assert.ok(!/\bdelete\s+from\b/i.test(SQL), "migration contains a DELETE");
  assert.ok(!/\btruncate\b/i.test(SQL), "migration contains a TRUNCATE");
  assert.ok(!/\bdrop\s+table\s+public\./i.test(SQL), "migration drops a production table");
  // the only UPDATE is the ON CONFLICT clause of the single upsert
  assert.equal((SQL.match(/\non conflict \(source_key\) do update\n/g) ?? []).length, 1);
  assert.equal((SQL.match(/\ninsert into public\./g) ?? []).length, 1, "exactly one write to public.*");
  // the conflict branch must not touch the query, the URLs, or the key
  const conflict = SQL.slice(SQL.indexOf("on conflict (source_key) do update"));
  const assigned = [...conflict.matchAll(/(?:^|\n)(?:set |    )([a-z_]+)\s*=/g)].map((m) => m[1]);
  assert.deepEqual(
    assigned.sort(),
    ["cadence", "fetch_config", "updated_at"],
    "the upsert's conflict branch must only re-tier an existing row",
  );
});

test("guardrail 5: every row is query_feed / countable=false", () => {
  assert.match(SQL, /\n  'query_feed',\n  false,\n/);
  // executable SQL only: the header comment is allowed to name what it cannot touch
  const code = SQL.replace(/^\s*--.*$/gm, "");
  assert.ok(!/confidence_grade|gradeMode/i.test(code));
  assert.ok(!/bs_counters|bs_state_counts|_provisional/i.test(code));
});

test("every cadence the migration writes is one poller_cadence_interval() knows", () => {
  const written = new Set(Object.values(TIER_CADENCE));
  for (const cadence of written) {
    assert.ok(
      cadence in CADENCE_MINUTES,
      `cadence '${cadence}' is not in CADENCE_MINUTES, so it would silently poll DAILY`,
    );
    assert.ok(SQL.includes(`then '${cadence}'`) || SQL.includes(`else '${cadence}'`));
  }
  // and the migration's own guard must list the same vocabulary
  const guard = SQL.match(/and r\.cadence not in \(([^)]+)\)/);
  assert.ok(guard, "the cadence guard is missing from section 8");
  const listed = guard[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort();
  assert.deepEqual(listed, Object.keys(CADENCE_MINUTES).sort());
});

test("the demotion ladder is applied, and it is the ladder the issue authorised", () => {
  // the spec, then both pre-authorised rungs: T3 -> biweekly, then T2 -> biweekly
  assert.equal(TIER_CADENCE_SPEC.t2, "weekly");
  assert.equal(TIER_CADENCE_SPEC.t3, "weekly");
  assert.equal(TIER_CADENCE.t3, "biweekly");
  assert.equal(TIER_CADENCE.t2, "biweekly");
  // the tiers the issue specifies as daily must stay daily
  assert.equal(TIER_CADENCE.t1, "daily");
  assert.equal(TIER_CADENCE.dc, "daily");
  // legacy rows drop, they are never deleted
  assert.equal(TIER_CADENCE.legacy, "monthly");
});

test("the Boundstone roster snapshot is well formed and fully embedded", () => {
  const roster = readRoster();
  assert.equal(roster.length, EXPECTED.rosterRows);
  const byType = {};
  for (const r of roster) byType[r.jtype] = (byType[r.jtype] ?? 0) + 1;
  assert.deepEqual(byType, {
    County: 180,
    City: 149,
    Township: 58,
    Town: 40,
    Village: 14,
    Tribal: 3,
    Other: 2,
    Parish: 1,
    "Utility-authority": 1,
    State: 1,
  });
  // every roster row reaches the migration, escaping intact
  const values = SQL.slice(
    SQL.indexOf("insert into _fdy93_bs (state, jurisdiction, jtype) values"),
  );
  for (const r of roster) {
    const lit = `('${r.state}', '${r.jurisdiction.replace(/'/g, "''")}', '${r.jtype}')`;
    assert.ok(values.includes(lit), `roster row missing from the migration: ${lit}`);
  }
  // the overrides name only roster rows that really exist
  for (const [st, juris] of ROSTER_OVERRIDES) {
    assert.ok(
      roster.some((r) => r.state === st && r.jurisdiction === juris),
      `override ${st} ${juris} is not in the roster`,
    );
  }
});

test("Boundstone is read only through its public anon snapshot", () => {
  // no Boundstone host, key or database object may appear in the migration
  assert.ok(!/fwnerwrtlgnchuprvfgl/.test(SQL));
  assert.ok(!/sb_publishable|service_role_key|SUPABASE_SERVICE/.test(SQL));
  assert.ok(!/\bbs_records\b/.test(SQL.replace(/^--.*$/gm, "")), "no runtime read of bs_records");
});

test("the budget arithmetic in the PR body is the arithmetic in the code", () => {
  // the lane's tiers must account for every universe row, or the budget is
  // computed over a different population than the migration writes
  assert.equal(
    laneRows().reduce((s, [, n]) => s + n, 0),
    EXPECTED.universeRows,
    "the budget's tier rows do not sum to the universe",
  );

  const spec = laneDemand(TIER_CADENCE_SPEC).total;
  const shipped = laneDemand(TIER_CADENCE).total;
  assert.ok(shipped < spec, "the demotion ladder must reduce demand");

  // the claim the PR makes: both rungs are spent and it STILL does not fit, so
  // the honest outcome is a Needs Myke, not a silently over-subscribed poller
  const guaranteed = floorPerDay(CRON.perRun);
  assert.equal(guaranteed, 480, "ceil(80 * 0.25) * 24");
  assert.ok(shipped > guaranteed, "if this ever fits, drop the Needs Myke line");

  // and the rate the PR asks for really does fund the whole fleet
  const needed = requiredPerHour();
  assert.ok(needed > 132, "FDY-89's larger ask is no longer enough");
  assert.ok(capacityPerDay(192) >= restOfFleetDemand().rest + shipped, "192/hour must fund it");
  assert.ok(192 >= needed);
});

// ── layer 2 + 3 helpers ──────────────────────────────────────────────────────

async function loadPglite() {
  const candidates = [process.env.PGLITE_MODULE, "@electric-sql/pglite"].filter(Boolean);
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      if (mod?.PGlite) return mod.PGlite;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Section 1 of the migration: the public.local_watch_* function definitions. */
const FUNCTIONS_SQL = (() => {
  const start = SQL.indexOf("create or replace function public.local_watch_state_name");
  const end = SQL.indexOf("-- 2. The Boundstone roster.");
  assert.ok(start > 0 && end > start, "could not slice section 1 out of the migration");
  // strip the grants: the role does not exist in a bare Postgres
  return SQL.slice(start, SQL.lastIndexOf("revoke all on function", end));
})();

/** Sections 2-7: everything except the production-scale verification block. */
const PIPELINE_SQL = (() => {
  const start = SQL.indexOf("-- 2. The Boundstone roster.");
  const end = SQL.indexOf("-- 8. Verification.");
  assert.ok(start > 0 && end > start);
  return SQL.slice(start, end);
})();

const VERIFY_SQL = (() => {
  const start = SQL.indexOf("do $verify$");
  const end = SQL.indexOf("$verify$;") + "$verify$;".length;
  assert.ok(start > 0 && end > start);
  return SQL.slice(start, end);
})();

/** gsearch_seed_url(), byte-identical to migration 0010 / the TS mirror. */
const SEED_URL_SQL = `
create or replace function public.gsearch_seed_url(q text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(
    q, '%', '%25'), '&', '%26'), ' ', '%20'), '"', '%22'),
    '''', '%27'), '(', '%28'), ')', '%29'), '/', '%2F')
$$;`;

const FIXTURE_SCHEMA = `
${SEED_URL_SQL}

create table public.jurisdictions (
  id                     text primary key,
  name                   text not null,
  level                  text not null,
  state_abbr             text,
  fips_code              text,
  containing_county_fips text[]
);

create table public.artifacts (
  artifact_id     text primary key,
  published_at    timestamptz,
  discovered_at   timestamptz,
  signal_envelope jsonb
);

create table public.source_registry (
  source_key                text primary key,
  name                      text not null,
  provider                  text,
  url                       text not null default '',
  feed_url                  text,
  access_method             text not null default 'json_api',
  cadence                   text not null,
  confidence_cap            text not null default 'SRC',
  license                   text not null default 'unreviewed',
  license_status            text not null default 'unreviewed',
  idf_domains               text[] not null default '{}',
  scope                     text,
  countable                 boolean not null default false,
  status                    text not null default 'registered',
  subsystem                 text,
  fetcher                   text not null default 'source-poller',
  fetch_config              jsonb not null default '{}',
  source_type               text not null default 'other',
  cost_model                text,
  cost_model_basis          text,
  cost_model_rule_id        int,
  cost_model_certainty      numeric,
  url_normalised            text,
  idf_subdomains            text[],
  idf_subdomains_method     text,
  idf_subdomains_confidence numeric,
  confidence_band           text not null default 'CF0',
  review_state              text not null default 'proposed_auto',
  freshness_basis           text,
  freshness_certainty       numeric,
  updated_at                timestamptz not null default now()
);
`;

/** A miniature universe that exercises every branch the real one does:
 *  a Boundstone county, a Boundstone place, a Boundstone charter township, a
 *  Boundstone township filed under two FIPS that must collapse to one row, an
 *  independent city filed at BOTH county and place level, a headline county, a
 *  non-Boundstone township that is T3, a place in a county with no Boundstone
 *  record that must NOT be watched, and a pre-existing legacy row that must
 *  survive untouched except for its cadence. */
const FIXTURE_DATA = `
insert into public.jurisdictions (id, name, level, state_abbr, fips_code, containing_county_fips) values
  ('j01', 'Cobb County',                 'county', 'GA', '13067', null),
  ('j02', 'Washington County',           'county', 'OH', '39167', null),
  ('j03', 'Richmond city',               'county', 'VA', '51760', null),
  ('j04', 'Carbon County',               'county', 'WY', '56007', null),
  ('j05', 'Ottawa County',               'county', 'MI', '26139', null),
  ('j06', 'Acworth city',                'place',  'GA', '1300388', array['13067']),
  ('j07', 'Marietta city',               'place',  'GA', '1349756', array['13067']),
  ('j08', 'Richmond city',               'place',  'VA', '5176000', array['51760']),
  ('j09', 'Allendale charter township',  'cousub', 'MI', '2613901140', array['26139']),
  ('j10', 'Washington township',         'cousub', 'MI', '2613999999', array['26139']),
  ('j11', 'Washington township',         'cousub', 'MI', '2613988888', array['26139']),
  ('j12', 'Warren CDP',                  'place',  'OH', '3980000', array['39167']),
  ('j19', 'Zeeland township',            'cousub', 'MI', '2613977777', array['26139']),
  ('j20', 'Chesapeake city',             'county', 'VA', '51550', null),
  ('j21', 'Chesapeake city',             'place',  'VA', '5116000', array['51550']),
  ('j13', 'Alaska',                      'state',  'AK', '02',    null),
  ('j14', 'Georgia',                     'state',  'GA', '13',    null),
  ('j15', 'Ohio',                        'state',  'OH', '39',    null),
  ('j16', 'Virginia',                    'state',  'VA', '51',    null),
  ('j17', 'Wyoming',                     'state',  'WY', '56',    null),
  ('j18', 'Michigan',                    'state',  'MI', '26',    null);

insert into public.artifacts (artifact_id, published_at, signal_envelope) values
  ('a1', now() - interval '3 days',
   jsonb_build_object('title', 'Carbon County weighs data center moratorium in Wyoming')),
  ('a2', now() - interval '400 days',
   jsonb_build_object('title', 'Cobb County data center rezoning in Georgia')),
  ('a3', now() - interval '2 days',
   jsonb_build_object('title', 'No jurisdiction named here, just a data centre somewhere'));

insert into public.source_registry
  (source_key, name, cadence, scope, countable, status, subsystem, fetch_config, url)
values
  ('gsearch:loc-adona-city-ar', 'Google News search: Adona city, AR (local gov watch)',
   'weekly', 'query_feed', false, 'active', 'poller',
   jsonb_build_object('entity', 'Adona city, AR', 'segment', 'local_gov',
                      'query', 'legacy v1 query', 'query_v1', 'legacy v1 query',
                      'query_rev', '2', 'wave', 6),
   'https://news.google.com/search?q=adona'),
  ('gsearch:loc-cobb-county-ga', 'Google News search: Cobb County, GA (local gov watch)',
   'weekly', 'query_feed', false, 'active', 'poller',
   jsonb_build_object('entity', 'Cobb County, GA', 'segment', 'local_gov',
                      'query', 'v2 cobb query', 'query_v1', 'v1 cobb query',
                      'query_rev', '2', 'wave', 6),
   'https://news.google.com/search?q=cobb');
`;

const PGlite = await loadPglite();

// ── layer 2: SQL vs TypeScript, byte for byte ────────────────────────────────

/** The corpus the drift guard runs. The 1,000 live FDY-88 entities cover city /
 * county / town / village / parish / municipio and the two alternate-name rows.
 * Townships, Alaska boroughs and census areas, Connecticut planning regions,
 * CDPs, consolidated governments and an unknown state abbreviation do not exist
 * in that roster yet — this migration is what creates them — so they are added
 * explicitly. */
const DRIFT_CORPUS = [
  ...FDY88_ENTITIES,
  "Allendale charter township, MI",
  "Washington township, OH",
  "Lyon Charter Township, MI",
  "Green charter township, MI",
  "Brunswick town, ME",
  "Dillsburg borough, PA",
  "Kodiak Island Borough, AK",
  "Yukon-Koyukuk Census Area, AK",
  "Hoonah-Angoon Census Area, AK",
  "Anchorage municipality, AK",
  "Capitol Region, CT",
  "Adjuntas Municipio, PR",
  "Carson City, NV",
  "District of Columbia, DC",
  "Prince George's County, MD",
  "St. Marys city, OH",
  "Athens-Clarke County unified government (balance), GA",
  "Warren CDP, OH",
  "Alvan (Alvin) village, IL",
  "Fredonia (Biscoe) town, AR",
  "Lake Township, MI",
  "Foo city, ZZ",
];

test("local_watch_query() in SQL == buildLocalQuery() in TypeScript, every row", async (t) => {
  if (!PGlite) {
    t.skip("@electric-sql/pglite not installed — see the header of this file");
    return;
  }
  const db = await PGlite.create();
  await db.exec(FUNCTIONS_SQL);

  const probes = DRIFT_CORPUS.map((entity) => {
    const j = localJurisdictionFromEntity(entity);
    assert.ok(j, `unparseable corpus entity ${JSON.stringify(entity)}`);
    return { entity, name: j.name, state: j.stateAbbr };
  });
  assert.ok(probes.length >= 1000, `corpus is only ${probes.length} rows`);

  // one round trip, not 1,022
  const res = await db.query(
    `select t.entity,
            public.local_watch_query(t.name, t.state)       as q,
            public.local_watch_classify(t.name)             as kind,
            public.local_watch_source_key(t.entity)         as sk
       from jsonb_to_recordset($1::jsonb) as t(entity text, name text, state text)`,
    [JSON.stringify(probes)],
  );
  assert.equal(res.rows.length, probes.length);

  const byEntity = new Map(probes.map((p) => [p.entity, p]));
  for (const row of res.rows) {
    const p = byEntity.get(row.entity);
    const j = { name: p.name, stateAbbr: p.state };
    assert.equal(row.kind, classifyLocalName(p.name), `classify drift for ${p.entity}`);
    assert.equal(row.q, buildLocalQuery(j), `query drift for ${p.entity}`);
    assert.equal(row.sk, localSourceKey(p.entity), `source_key drift for ${p.entity}`);
    assert.ok(!hasTopLevelBareOr(row.q), `top-level bare OR for ${p.entity}: ${row.q}`);
  }
});

// ── layer 3: the whole pipeline, with exact row counts ───────────────────────

test("the pipeline builds the right rows, tiers and cadences", async (t) => {
  if (!PGlite) {
    t.skip("@electric-sql/pglite not installed — see the header of this file");
    return;
  }
  const db = await PGlite.create();
  await db.exec(FIXTURE_SCHEMA);
  await db.exec(FIXTURE_DATA);
  await db.exec(FUNCTIONS_SQL);

  const before = await db.query(
    "select count(*)::int n from public.source_registry where source_key like 'gsearch:loc-%'",
  );
  assert.equal(before.rows[0].n, 2);

  await db.exec(`begin;\n${PIPELINE_SQL}\ncommit;`);

  const rows = (
    await db.query(
      `select source_key, cadence, status, scope, countable,
              fetch_config ->> 'tier'      as tier,
              fetch_config ->> 'entity'    as entity,
              fetch_config ->> 'query'     as query,
              fetch_config ->> 'query_v1'  as query_v1,
              fetch_config ->> 'query_rev' as query_rev,
              fetch_config -> 'fips'       as fips,
              fetch_config -> 'levels'     as levels,
              feed_url
         from public.source_registry
        where source_key like 'gsearch:loc-%'
        order by source_key`,
    )
  ).rows;

  const byKey = new Map(rows.map((r) => [r.source_key, r]));
  const tiers = {};
  for (const r of rows) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;

  // 15 Census rows collapse to 11 universe rows (the two Washington townships
  // share a (name, state) pair; Chesapeake city is filed at BOTH county and place
  // level; Warren CDP is in no Boundstone county so it is not watched at all),
  // plus the one legacy row that is in no tier.
  assert.deepEqual(
    tiers,
    { t1: 5, dc: 1, t2: 3, t3: 2, legacy: 1 },
    `unexpected tier histogram: ${JSON.stringify(tiers)}`,
  );
  assert.equal(rows.length, 12);

  // T1 is exactly the roster rows that resolve: Cobb County, Marietta, Allendale
  // charter township and Washington Township. Marietta, Allendale and Washington
  // are sub-county, which is what makes 13067 and 26139 "Boundstone-record
  // counties" for T3.
  assert.equal(byKey.get("gsearch:loc-cobb-county-ga").tier, "t1");
  assert.equal(byKey.get("gsearch:loc-marietta-city-ga").tier, "t1");
  assert.equal(byKey.get("gsearch:loc-allendale-charter-township-mi").tier, "t1");

  // the headline county is daily; the headline is 3 days old, Cobb's is 400 days
  // old (and Cobb is T1 anyway), and the third headline names no jurisdiction
  assert.equal(byKey.get("gsearch:loc-carbon-county-wy").tier, "dc");
  assert.equal(byKey.get("gsearch:loc-carbon-county-wy").cadence, "daily");

  // Independent cities (VA, MD, MO, NV) are county-equivalents, and Census files
  // them at BOTH county and place level. Chesapeake is one, and it is on the
  // Boundstone roster: the two Census rows become ONE watch carrying both FIPS,
  // tiered T1, not two rows racing each other for the same feed.
  const ches = byKey.get("gsearch:loc-chesapeake-city-va");
  assert.equal(ches.tier, "t1");
  assert.deepEqual(ches.levels, ["county", "place"]);
  assert.deepEqual(ches.fips, ["5116000", "51550"], "text-sorted, as array_agg(... order by fips) gives");

  // Richmond city VA is an independent city too, but it is not on the roster and
  // its county carries no Boundstone record, so only the county-equivalent row
  // exists — the place-level duplicate is not separately watched.
  assert.equal(byKey.get("gsearch:loc-richmond-city-va").tier, "t2");
  assert.deepEqual(byKey.get("gsearch:loc-richmond-city-va").levels, ["county"]);
  assert.deepEqual(byKey.get("gsearch:loc-richmond-city-va").fips, ["51760"]);

  // the two Ohio-style duplicate townships collapse to ONE row carrying both FIPS
  const twp = byKey.get("gsearch:loc-washington-township-mi");
  assert.equal(twp.tier, "t1", "the roster names MI Washington Township");
  assert.deepEqual(twp.fips, ["2613988888", "2613999999"]);
  assert.match(twp.query, /"Washington Township" OR "Washington Charter Township"/);
  assert.match(twp.query, /"township board"/);
  assert.match(twp.query, /"Michigan"$/);

  // a place in a Boundstone-record county is T3; a place in a county with no
  // Boundstone record is not watched at sub-county level at all
  assert.equal(byKey.get("gsearch:loc-acworth-city-ga").tier, "t3");
  assert.equal(byKey.get("gsearch:loc-zeeland-township-mi").tier, "t3");
  assert.equal(byKey.get("gsearch:loc-zeeland-township-mi").cadence, "biweekly");
  assert.equal(byKey.has("gsearch:loc-warren-cdp-oh"), false, "Warren CDP is in no Boundstone county");

  // cadence follows the tier, and nothing is outside the known vocabulary
  for (const r of rows) {
    assert.equal(r.cadence, TIER_CADENCE[r.tier], `${r.source_key} cadence`);
    assert.ok(r.cadence in CADENCE_MINUTES);
    assert.equal(r.status, "active");
    assert.equal(r.scope, "query_feed");
    assert.equal(r.countable, false);
  }

  // the legacy row survives: kept, re-tiered, dropped to monthly, query untouched
  const legacy = byKey.get("gsearch:loc-adona-city-ar");
  assert.equal(legacy.tier, "legacy");
  assert.equal(legacy.cadence, "monthly");
  assert.equal(legacy.query, "legacy v1 query", "FDY-88's query must not be rewritten");
  assert.equal(legacy.query_v1, "legacy v1 query", "FDY-88's rollback path must survive");

  // an existing row that IS in a tier keeps FDY-88's query and gains the tier
  const cobb = byKey.get("gsearch:loc-cobb-county-ga");
  assert.equal(cobb.query, "v2 cobb query");
  assert.equal(cobb.query_v1, "v1 cobb query");
  assert.equal(cobb.cadence, "daily");

  // new rows carry the v2 query and a Google News RSS feed built from it
  const acworth = byKey.get("gsearch:loc-acworth-city-ga");
  assert.equal(acworth.query_rev, "2");
  assert.equal(acworth.query_v1, null, "a new row has no v1 to preserve");
  assert.equal(acworth.query, buildLocalQuery({ name: "Acworth city", stateAbbr: "GA" }));
  assert.match(acworth.feed_url, /^https:\/\/news\.google\.com\/rss\/search\?q=/);
  assert.match(acworth.feed_url, /&hl=en-US&gl=US&ceid=US:en$/);

  // every county-equivalent in the fixture is watched — the issue, as an assertion
  const uncovered = await db.query(
    `select count(*)::int n from public.jurisdictions j
      where j.level = 'county'
        and not exists (select 1 from public.source_registry r
                        where r.source_key like 'gsearch:loc-%'
                          and r.fetch_config ->> 'entity' = j.name || ', ' || j.state_abbr)`,
  );
  assert.equal(uncovered.rows[0].n, 0);
});

test("the pipeline is idempotent: a second apply changes nothing", async (t) => {
  if (!PGlite) {
    t.skip("@electric-sql/pglite not installed — see the header of this file");
    return;
  }
  const db = await PGlite.create();
  await db.exec(FIXTURE_SCHEMA);
  await db.exec(FIXTURE_DATA);
  await db.exec(FUNCTIONS_SQL);

  const snapshot = async () =>
    (
      await db.query(
        `select source_key, cadence, status, feed_url, url,
                fetch_config - 'tier_rev' as fc
           from public.source_registry order by source_key`,
      )
    ).rows;

  await db.exec(`begin;\n${PIPELINE_SQL}\ncommit;`);
  const first = await snapshot();
  await db.exec(`begin;\n${PIPELINE_SQL}\ncommit;`);
  const second = await snapshot();

  assert.equal(first.length, 12);
  assert.deepEqual(second, first, "re-applying the migration must be a no-op");
});

test("section 8's production-scale guard is live SQL and fires when the universe is wrong", async (t) => {
  if (!PGlite) {
    t.skip("@electric-sql/pglite not installed — see the header of this file");
    return;
  }
  const db = await PGlite.create();
  await db.exec(FIXTURE_SCHEMA);
  await db.exec(FIXTURE_DATA);
  await db.exec(FUNCTIONS_SQL);

  // The verify block reads the temp tables the pipeline builds, so it has to run
  // in the same transaction. The fixture has 6 county-equivalents, not 3,222, so
  // the very first assertion must fire — which is the proof that the guard is
  // real SQL and that a drift in the universe stops the migration dead.
  await assert.rejects(
    db.exec(`begin;\n${PIPELINE_SQL}\n${VERIFY_SQL}\ncommit;`),
    (err) => {
      assert.match(
        String(err.message),
        new RegExp(`expected ${EXPECTED.countyEquivalents} county-equivalents, found 6`),
      );
      return true;
    },
  );
  await db.exec("rollback;").catch(() => {});
});

// ---------------------------------------------------------------- determinism

// A migration that raises on exact row counts must produce the same row set on
// every server. Before this was fixed, it did not: the T1 tie-break ended at
// `name`, which does not separate same-named jurisdictions (Ohio has 43
// 'Washington township' county subdivisions, 37 'Jackson township'), so the
// winner — and therefore _fdy93_bs_counties, T3 and the universe size — was
// chosen by the query plan. Three runs over identical inputs produced 349, 350
// and 352 Boundstone counties. These three assertions are what stop that
// recurring.
test("the T1 tie-break is a total order, and collation-independent", () => {
  const order = SQL.match(/order by pref, lvl, name[^\n)]*\)\s*as rn/);
  assert.ok(order, "could not find the T1 row_number() ordering");
  // fips is unique per jurisdiction, so ending on it makes the order total.
  assert.match(order[0], /fips\)\s*as rn$/, "the ordering must end on fips");
  // pinned collation, so the winner cannot depend on the server's lc_collate
  assert.match(order[0], /name collate "C"/, 'the name key must be collate "C"');
});

test("an ambiguous T1 match never seeds a T3 county", () => {
  const block = SQL.slice(
    SQL.indexOf("create temporary table _fdy93_bs_counties"),
    SQL.indexOf("create temporary table _fdy93_dc"),
  );
  assert.match(block, /not t\.ambiguous/,
    "_fdy93_bs_counties must exclude ambiguous matches: picking 1 of 43 same-named " +
    "townships by tie-break is not evidence that a Boundstone record concerns that county");
});

test("T1 membership is unconditional, never gated on the T3 county set", () => {
  const sel = SQL.slice(
    SQL.indexOf("create temporary table _fdy93_sel"),
    SQL.indexOf("create temporary table _fdy93_universe"),
  )
    // comments here NAME both tables; compare the executable SQL only
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  // the T1 arm must sit OUTSIDE the ccf && bs_counties arm, or an ambiguous T1
  // township would drop out of the watch altogether
  const t1Arm = sel.indexOf("or exists (select 1 from _fdy93_t1");
  const t3Arm = sel.indexOf("_fdy93_bs_counties");
  assert.ok(t1Arm > 0, "no unconditional T1 arm in _fdy93_sel");
  assert.ok(t1Arm < t3Arm, "the T1 arm must be independent of the bs_counties arm");
});

test("ambiguity is asserted at apply time, so it cannot drift silently", () => {
  assert.match(SQL, /into n_ambiguous from _fdy93_t1 where ambiguous/);
  assert.match(
    SQL,
    new RegExp(`expected ${EXPECTED.ambiguousT1} ambiguous`),
    "the ambiguity count must be pinned to EXPECTED.ambiguousT1",
  );
});

// ---------------------------------------------------- cadence table, twice over

// This migration re-asserts public.poller_cadence_interval() so that writing
// cadence='monthly' is correct no matter which order Myke applies the two
// migrations in. Two copies of a table is a drift risk, so both are pinned to
// the single TypeScript constant — the same constant FDY-89's own drift guard in
// test/source-poller-schedule.test.mjs compares its copy against.
test("FDY-93's copy of poller_cadence_interval matches CADENCE_MINUTES exactly", () => {
  const i = SQL.indexOf("create or replace function public.poller_cadence_interval");
  assert.ok(i > 0, "FDY-93 must re-assert poller_cadence_interval");
  const body = SQL.slice(i, SQL.indexOf("$$;", i));
  const arms = [...body.matchAll(/when '([a-z_]+)' then interval '(\d+) minutes'/g)];
  assert.deepEqual(
    Object.fromEntries(arms.map(([, k, v]) => [k, Number(v)])),
    CADENCE_MINUTES,
    "FDY-93's cadence table drifted from CADENCE_MINUTES",
  );
  const elseArm = body.match(/else interval '(\d+) minutes'/);
  assert.ok(elseArm, "no else arm");
  assert.equal(Number(elseArm[1]), CADENCE_MINUTES.daily, "unknown cadence must mean daily");
});

test("every cadence this migration writes is defined in both SQL copies", () => {
  const mine = SQL.slice(SQL.indexOf("create or replace function public.poller_cadence_interval"));
  const theirs = readFileSync(
    resolve(HERE, "../supabase/migrations/20261009210000_poller_fair_scheduling.sql"),
    "utf8",
  );
  for (const cadence of new Set(Object.values(TIER_CADENCE))) {
    assert.match(mine, new RegExp(`when '${cadence}' then interval`),
      `${cadence} missing from FDY-93's cadence table`);
    assert.match(theirs, new RegExp(`when '${cadence}'\\s+then interval`),
      `${cadence} missing from FDY-89's cadence table`);
  }
});
