// FDY-154 — tests for supabase/migrations/20261107043000_local_watch_publication_freshness.sql
//
// Two layers (same pattern as local-watch-migration.test.mjs):
//   1. TEXT — always runs. Asserts the UN-APPLIED header, the FDY-154 citation,
//      security_invoker, the revoke/grant posture, the flag thresholds, the
//      local-watch membership predicate, and that nothing but the view is created.
//   2. LOCAL POSTGRES — runs the migration in an in-process Postgres
//      (@electric-sql/pglite) against minimal stand-ins for public.artifacts and
//      public.source_registry (only the columns the view reads), then checks the
//      flag logic on seeded weeks and the grants. Skipped with a message when
//      pglite is not installed — it is deliberately NOT a package.json dependency.
//
//        mkdir -p /tmp/pglite && cd /tmp/pglite && npm i @electric-sql/pglite
//        PGLITE_MODULE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js npm test
//
// NOTHING HERE TOUCHES PRODUCTION. The migration is UN-APPLIED; Myke applies it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  import.meta.dirname,
  "../supabase/migrations/20261107043000_local_watch_publication_freshness.sql",
);
const SQL = readFileSync(MIGRATION, "utf8");
// Strip comments so assertions see only executable SQL.
const CODE = SQL.split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");
const VIEW = "public.v_local_watch_publication_freshness";

// ── layer 1: text ────────────────────────────────────────────────────────────

test("first line is the UN-APPLIED header and the header cites FDY-154", () => {
  assert.match(SQL.split("\n")[0], /^-- UN-APPLIED/);
  assert.match(SQL.split("\n").slice(0, 5).join("\n"), /FDY-154/);
});

test("the view is security_invoker", () => {
  assert.match(CODE, new RegExp(`create or replace view ${VIEW.replace(".", "\\.")}\\s+with \\(security_invoker = true\\)`));
});

test("revokes all from public, anon and authenticated; grants select to service_role only", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(CODE, new RegExp(`revoke all on ${VIEW.replace(".", "\\.")} from ${role};`), role);
  }
  const grants = [...CODE.matchAll(/^\s*grant\s+(.+?)\s+on\s+(\S+)\s+to\s+(\S+?);/gim)];
  assert.equal(grants.length, 1, "exactly one grant");
  assert.deepEqual(
    [grants[0][1].toLowerCase(), grants[0][2], grants[0][3]],
    ["select", VIEW, "service_role"],
  );
});

test("flag thresholds: LAG when lag_days > 7, NULLS when null_share > 0.2, else ok", () => {
  assert.match(CODE, /when \(max_discovered_at::date - max_published_at::date\) > 7\s+then 'LAG'/);
  assert.match(CODE, /when null_share > 0\.2\s+then 'NULLS'/);
  assert.match(CODE, /else 'ok'/);
  assert.ok(CODE.indexOf("'LAG'") < CODE.indexOf("'NULLS'"), "LAG is evaluated before NULLS");
});

test("local-watch membership uses the = any(array(select …)) form over gsearch:loc-%", () => {
  assert.match(CODE, /crawl_metadata->>'feed_url' = any \(\s*array\(select sr\.feed_url/);
  assert.match(CODE, /source_key like 'gsearch:loc-%'/);
  assert.doesNotMatch(CODE, /\bexists\s*\(/i);
});

test("creates only the view — no tables, functions, cron or data writes", () => {
  const creates = [...CODE.matchAll(/\bcreate\s+(?:or\s+replace\s+)?(\w+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(creates, ["view"]);
  assert.doesNotMatch(CODE, /\b(insert|update|delete|truncate|alter\s+table|drop)\b/i);
  assert.doesNotMatch(CODE, /cron\./i);
});

// ── layer 2: local Postgres ──────────────────────────────────────────────────

async function loadPGlite() {
  for (const spec of [process.env.PGLITE_MODULE, "@electric-sql/pglite"].filter(Boolean)) {
    try {
      const mod = await import(spec);
      if (mod?.PGlite) return mod.PGlite;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

test("PGlite: flags, null handling, non-local exclusion and grants", async (t) => {
  const PGlite = await loadPGlite();
  if (!PGlite) {
    t.skip("pglite not installed — set PGLITE_MODULE to run (see header)");
    return;
  }
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.source_registry (source_key text, feed_url text);
    create table public.artifacts (
      crawl_metadata jsonb, discovered_at timestamptz, published_at timestamptz);
    insert into public.source_registry values
      ('gsearch:loc-a', 'https://news.google.com/rss/search?q=a'),
      ('gsearch:loc-b', null),
      ('other:x',       'https://example.com/feed');
  `);
  await db.exec(SQL);

  const loc = `'{"feed_url":"https://news.google.com/rss/search?q=a"}'::jsonb`;
  const other = `'{"feed_url":"https://example.com/feed"}'::jsonb`;
  // Weeks are anchored on the current ISO week so they fall inside the 12-week window.
  await db.exec(`
    -- week -3: healthy
    insert into public.artifacts
      select ${loc}, date_trunc('week', now()) - interval '3 weeks' + interval '2 days',
                     date_trunc('week', now()) - interval '3 weeks' + interval '1 day'
        from generate_series(1, 10);
    -- week -2: discovered rows only carry month-old publication dates → LAG
    insert into public.artifacts
      select ${loc}, date_trunc('week', now()) - interval '2 weeks' + interval '2 days',
                     date_trunc('week', now()) - interval '6 weeks'
        from generate_series(1, 5);
    -- week -1: 3 of 10 undated → NULLS
    insert into public.artifacts
      select ${loc}, date_trunc('week', now()) - interval '1 week' + interval '1 day',
             case when g <= 3 then null
                  else date_trunc('week', now()) - interval '1 week' end
        from generate_series(1, 10) g;
    -- week -4: every row undated → NULLS (lag_days is null)
    insert into public.artifacts
      select ${loc}, date_trunc('week', now()) - interval '4 weeks' + interval '1 day', null
        from generate_series(1, 4);
    -- week -3 non-local noise that would make it NULLS if it leaked in
    insert into public.artifacts
      select ${other}, date_trunc('week', now()) - interval '3 weeks' + interval '2 days', null
        from generate_series(1, 50);
    -- outside the 12-week window: must not appear
    insert into public.artifacts
      values (${loc}, date_trunc('week', now()) - interval '20 weeks', null);
  `);

  const { rows } = await db.query(
    `select week, rows_discovered::int as n, null_published_at::int as nulls,
            null_share::float as share, lag_days, flag
       from ${VIEW} order by week`,
  );
  assert.deepEqual(
    rows.map((r) => [r.n, r.nulls, r.flag]),
    [
      [4, 4, "NULLS"],
      [10, 0, "ok"],
      [5, 0, "LAG"],
      [10, 3, "NULLS"],
    ],
  );
  assert.equal(rows[0].lag_days, null);
  assert.equal(rows[3].share, 0.3);
  assert.ok(rows[2].lag_days > 7);

  const { rows: priv } = await db.query(`
    select r as role, has_table_privilege(r, '${VIEW}', 'select') as can_select
      from unnest(array['anon','authenticated','service_role']) r order by r`);
  assert.deepEqual(
    Object.fromEntries(priv.map((p) => [p.role, p.can_select])),
    { anon: false, authenticated: false, service_role: true },
  );

  const { rows: opts } = await db.query(
    `select reloptions from pg_class where oid = '${VIEW}'::regclass`,
  );
  assert.deepEqual(opts[0].reloptions, ["security_invoker=true"]);
  await db.close();
});
