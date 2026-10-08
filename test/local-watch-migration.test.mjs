// FDY-88 — tests for the generated local-gov query migration
// (supabase/migrations/20261009200000_local_watch_query_scoping.sql).
//
// Two layers:
//   1. PURE — always runs. The committed migration must be exactly what the
//      generator produces from the committed roster, must carry the UN-APPLIED
//      header, and must contain one tuple per live row whose query is
//      byte-identical to buildLocalQuery()'s output. This is what makes the
//      1,000-row rewrite auditable without a database.
//   2. LOCAL POSTGRES — runs the migration end to end against a throwaway
//      in-process Postgres (@electric-sql/pglite) seeded with v1-shaped rows,
//      and asserts the rewrite, the preserved query_v1, idempotency and the
//      roster guard. Skipped with a message when pglite is not installed, so
//      CI stays green without a new package.json dependency.
//
//      To run layer 2:
//        mkdir -p /tmp/pglite && cd /tmp/pglite && npm i @electric-sql/pglite
//        PGLITE_MODULE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js \
//          npm test
//
// NOTHING HERE TOUCHES PRODUCTION. The migration is UN-APPLIED; Myke applies it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPECTED_KINDS,
  EXPECTED_ROWS,
  MIGRATION,
  planRows,
  readEntities,
  renderMigration,
} from "../scripts/gen-local-watch-query-migration.mjs";
import {
  buildLocalQuery,
  buildLocalQueryV1,
  googleNewsFeedUrl,
  googleNewsSearchUrl,
  hasTopLevelBareOr,
  localJurisdictionFromEntity,
} from "../supabase/functions/source-poller/local-query.ts";

const SQL = readFileSync(MIGRATION, "utf8");
const ROWS = planRows(readEntities());

// ── layer 1: pure ────────────────────────────────────────────────────────────

test("the migration carries the UN-APPLIED header on its first line", () => {
  assert.equal(SQL.split("\n")[0], "-- UN-APPLIED — applied by Myke on merge");
});

test("the committed migration is exactly what the generator produces", () => {
  assert.equal(
    SQL,
    renderMigration(ROWS),
    "run: node scripts/gen-local-watch-query-migration.mjs",
  );
});

test("the roster plan matches the production roster measured on 2026-10-07", () => {
  assert.equal(ROWS.length, EXPECTED_ROWS);
  const kinds = {};
  for (const r of ROWS) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  assert.deepEqual(kinds, EXPECTED_KINDS);
});

/** Parse the migration's VALUES list back out of the SQL. */
function tuplesFromSql(sql) {
  const body = sql.split("insert into _fdy88_local_queries (source_key, new_query) values\n")[1];
  assert.ok(body, "VALUES block present");
  const list = body.split("\n\n")[0];
  const out = [];
  for (const line of list.split("\n")) {
    const m = /^ {2}\('([^']+)', '(.*)'\)[,;]$/.exec(line);
    assert.ok(m, `tuple line parses: ${line}`);
    out.push({ sourceKey: m[1], query: m[2].replace(/''/g, "'") });
  }
  return out;
}

test("the migration holds exactly one tuple per live source, matching the builder", () => {
  const tuples = tuplesFromSql(SQL);
  assert.equal(tuples.length, EXPECTED_ROWS);
  assert.equal(new Set(tuples.map((t) => t.sourceKey)).size, EXPECTED_ROWS);
  for (const [i, t] of tuples.entries()) {
    assert.equal(t.sourceKey, ROWS[i].sourceKey);
    assert.equal(t.query, ROWS[i].query);
    const j = localJurisdictionFromEntity(ROWS[i].entity);
    assert.equal(t.query, buildLocalQuery(j), `builder parity for ${ROWS[i].entity}`);
    assert.ok(!hasTopLevelBareOr(t.query), `no top-level bare OR: ${t.query}`);
  }
});

test("the UPDATE assigns only fetch_config, feed_url, url and updated_at", () => {
  // Everything that makes a source countable or published — source_key, scope,
  // countable, status, cadence, confidence_cap — must be untouched by a query
  // rewrite. Parse the SET clause rather than grepping the whole file, which
  // also contains `where sr.source_key = q.source_key`.
  const m = /\nupdate public\.source_registry sr\nset ([\s\S]*?)\nfrom _fdy88_local_queries q\n/.exec(SQL);
  assert.ok(m, "the UPDATE statement is where this test expects it");
  const assigned = [...m[1].matchAll(/(?:^|\n)\s{0,8}([a-z_]+)\s*=/g)].map((x) => x[1]);
  assert.deepEqual(assigned.sort(), ["feed_url", "fetch_config", "updated_at", "url"]);
  assert.equal((SQL.match(/\nupdate /g) ?? []).length, 1, "exactly one UPDATE");
  assert.ok(!/\ndelete |\ninsert into public\.|\ndrop |\nalter /.test(SQL), "no other DML/DDL");
});

// ── layer 2: against a real Postgres ─────────────────────────────────────────

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

/** Minimal source_registry + the production gsearch_seed_url(), seeded with the
 * v1 rows exactly as production holds them today. */
const SCHEMA = `
create table public.source_registry (
  source_key   text primary key,
  name         text,
  url          text,
  feed_url     text,
  access_method text,
  cadence      text,
  status       text,
  scope        text,
  countable    boolean,
  subsystem    text,
  fetcher      text,
  fetch_config jsonb not null,
  updated_at   timestamptz default now()
);
create or replace function public.gsearch_seed_url(q text) returns text
language sql immutable as $fn$
  select replace(replace(replace(replace(replace(replace(replace(replace(q,
    '%','%25'), '&','%26'), ' ','%20'), '"','%22'), '''','%27'), '(','%28'), ')','%29'), '/','%2F')
$fn$;
`;

async function seed(db, rows) {
  await db.exec(SCHEMA);
  for (const r of rows) {
    const j = localJurisdictionFromEntity(r.entity);
    const v1 = buildLocalQueryV1(j);
    await db.query(
      `insert into public.source_registry
        (source_key,name,url,feed_url,access_method,cadence,status,scope,countable,subsystem,fetcher,fetch_config)
       values ($1,$2,$3,$4,'rss','weekly','active','query_feed',false,'poller','source-poller',$5)`,
      [
        r.sourceKey,
        `Google News search: ${r.entity} (local gov watch)`,
        googleNewsSearchUrl(`"${j.name}" ${j.stateAbbr}`),
        googleNewsFeedUrl(v1),
        JSON.stringify({
          wave: 6,
          query: v1,
          entity: r.entity,
          country: "US",
          segment: "local_gov",
          gov_level: "local",
          gov_region: "US",
          entity_kind: "government",
          verify_kind: "rss",
          verify_fail_count: 0,
        }),
      ],
    );
  }
}

const PGlite = await loadPglite();

test("migration rewrites all 1,000 rows against a local Postgres copy", async (t) => {
  if (!PGlite) {
    t.skip("@electric-sql/pglite not installed — see the header of this file");
    return;
  }
  const db = await PGlite.create();
  await seed(db, ROWS);

  const before = await db.query(
    `select count(*)::int n,
            count(*) filter (where fetch_config ? 'query_v1')::int v1,
            count(*) filter (where countable)::int countable
       from public.source_registry where source_key like 'gsearch:loc-%'`,
  );
  assert.deepEqual(before.rows[0], { n: 1000, v1: 0, countable: 0 });

  await db.exec(SQL);

  const after = await db.query(
    `select count(*)::int n,
            count(*) filter (where fetch_config ->> 'query_rev' = '2')::int rev2,
            count(*) filter (where fetch_config ? 'query_v1')::int v1,
            count(*) filter (where countable)::int countable,
            count(*) filter (where scope = 'query_feed')::int scoped,
            count(*) filter (where cadence = 'weekly')::int weekly,
            count(*) filter (where status = 'active')::int active
       from public.source_registry where source_key like 'gsearch:loc-%'`,
  );
  assert.deepEqual(after.rows[0], {
    n: 1000,
    rev2: 1000,
    v1: 1000,
    countable: 0,
    scoped: 1000,
    weekly: 1000,
    active: 1000,
  });

  // Every row: new query == builder output, old query preserved verbatim,
  // feed_url and url rebuilt from the new query.
  const rows = await db.query(
    `select source_key, fetch_config ->> 'query' q, fetch_config ->> 'query_v1' q1,
            fetch_config ->> 'entity' entity, feed_url, url
       from public.source_registry where source_key like 'gsearch:loc-%' order by source_key`,
  );
  assert.equal(rows.rows.length, 1000);
  const byKey = new Map(ROWS.map((r) => [r.sourceKey, r]));
  for (const row of rows.rows) {
    const planned = byKey.get(row.source_key);
    assert.ok(planned, `unexpected source_key ${row.source_key}`);
    const j = localJurisdictionFromEntity(row.entity);
    assert.equal(row.q, planned.query);
    assert.equal(row.q1, buildLocalQueryV1(j), `query_v1 preserved for ${row.entity}`);
    assert.equal(row.feed_url, googleNewsFeedUrl(planned.query));
    assert.equal(row.url, googleNewsSearchUrl(planned.query));
    assert.ok(!hasTopLevelBareOr(row.q));
  }

  // Idempotent: a second application must not overwrite query_v1 with v2.
  await db.exec(SQL);
  const again = await db.query(
    `select count(*)::int n from public.source_registry
      where source_key like 'gsearch:loc-%'
        and fetch_config ->> 'query_v1' like '%OR rezoning OR zoning OR moratorium'`,
  );
  assert.equal(again.rows[0].n, 1000, "query_v1 still holds the v1 string after a re-run");
  await db.close();
});

test("the migration's guard refuses to run against a drifted roster", async (t) => {
  if (!PGlite) {
    t.skip("@electric-sql/pglite not installed — see the header of this file");
    return;
  }
  const db = await PGlite.create();
  await seed(db, ROWS);
  await db.query(`delete from public.source_registry where source_key = $1`, [ROWS[0].sourceKey]);
  await assert.rejects(
    () => db.exec(SQL),
    /FDY-88/,
    "a missing source_key must abort the migration, not silently skip it",
  );
  // The failed statement left the session inside the migration's transaction.
  await db.exec("rollback");
  const n = await db.query(
    `select count(*)::int n from public.source_registry
      where source_key like 'gsearch:loc-%' and fetch_config ? 'query_v1'`,
  );
  assert.equal(n.rows[0].n, 0, "nothing was written when the guard fired");
  await db.close();
});

test("docs/far-88/rollback.sql restores every row byte-for-byte", async (t) => {
  if (!PGlite) {
    t.skip("@electric-sql/pglite not installed — see the header of this file");
    return;
  }
  const rollback = readFileSync(resolve(MIGRATION, "../../../docs/far-88/rollback.sql"), "utf8");
  const db = await PGlite.create();
  await seed(db, ROWS);
  const cols = `select source_key, fetch_config ->> 'query' q, feed_url, url,
                       fetch_config ? 'query_v1' hv1, fetch_config ? 'query_rev' hrev
                  from public.source_registry order by source_key`;
  const before = (await db.query(cols)).rows;
  await db.exec(SQL);
  await db.exec(rollback);
  const after = (await db.query(cols)).rows;
  assert.equal(after.length, 1000);
  assert.deepEqual(after, before, "forward then rollback is the identity on all 1,000 rows");
  await db.close();
});
