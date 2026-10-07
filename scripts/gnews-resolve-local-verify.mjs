#!/usr/bin/env node
// gnews-resolve-local-verify.mjs — FDY-90 storage-path proof on a LOCAL database.
//
// Runs the SQL half of migration 20261009220000 (everything except the pg_cron
// lines, which PGlite has no extension for) against a throwaway in-process
// Postgres, seeded with a faithful miniature of production: local-watch Google
// News artifacts, their source_registry feeds, and the lane row. It then asserts
// the properties the migration claims:
//
//   1. gnews_resolve_claim is a no-op while fetch_enabled OR
//      aggregator_robots_ack is false, and while the lane is leased.
//   2. the claim returns DISTINCT tokens, restriction keywords first.
//   3. gnews_resolve_record merges into crawl_metadata, fans out to every row
//      sharing a token, and refuses disallowed keys and aggregator URLs.
//   4. gnews_body_claim only ever offers publisher_url, never source_url.
//   5. gnews_body_record writes body_* only.
//   6. a full before/after column snapshot proves NO pre-existing column value
//      changed anywhere except the two the feature owns.
//
// Nothing here touches a remote database. Run:
//   npm i --prefix /tmp/pgl @electric-sql/pglite
//   node --experimental-strip-types scripts/gnews-resolve-local-verify.mjs
// (PGlite is deliberately NOT a package.json dependency: the Vercel build fails
// on a new dependency, and this script is a one-off proof, not part of `npm test`.)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const PGLITE_PREFIX = process.env.PGLITE_PREFIX ?? "/tmp/pgl";
let PGlite;
try {
  const require = createRequire(`${PGLITE_PREFIX}/package.json`);
  ({ PGlite } = await import(require.resolve("@electric-sql/pglite")));
} catch (e) {
  console.error(`PGlite not found under ${PGLITE_PREFIX}. Install it with:\n  npm i --prefix ${PGLITE_PREFIX} @electric-sql/pglite`);
  console.error(String(e));
  process.exit(2);
}

const MIGRATION = new URL("../supabase/migrations/20261009220000_gnews_resolve_schedule.sql", import.meta.url);

const db = await PGlite.create();
const q = async (sql, params) => (await db.query(sql, params)).rows;
let passed = 0;
const check = (name, fn) => {
  try {
    const r = fn();
    return Promise.resolve(r).then(
      () => { passed++; console.log(`  ok  ${name}`); },
      (e) => { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; },
    );
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
};

// ---------------------------------------------------------------- schema

console.log("\n[1/5] miniature of the production schema");
await db.exec(`
create schema if not exists public;

create table public.source_registry (
  source_key text primary key,
  feed_url   text
);

-- Only the columns this feature reads or writes, plus neighbours that MUST stay
-- untouched so the snapshot can prove it.
create table public.artifacts (
  artifact_id       uuid primary key default gen_random_uuid(),
  source_type       text,
  source_url        text,
  raw_content       text,
  published_at      timestamptz,
  discovered_at     timestamptz default now(),
  crawl_metadata    jsonb,
  signal_envelope   jsonb,
  content_hash      text,
  body_text         text,
  body_char_count   integer,
  body_fetched_at   timestamptz,
  body_fetch_status text,
  body_fetch_error  text,
  body_attempts     integer not null default 0,
  body_meta         jsonb
);

create table public.artifact_body_fetch_lanes (
  lane                   text primary key,
  fetch_enabled          boolean not null default false,
  embed_enabled          boolean not null default false,
  user_agent             text not null,
  min_interval_ms        integer not null default 250,
  per_host_interval_ms   integer not null default 1000,
  batch_limit            integer not null default 200,
  form_priority          text[],
  backoff_until          timestamptz,
  consecutive_blocks     integer not null default 0,
  block_events           integer not null default 0,
  max_consecutive_blocks integer not null default 3,
  failure_rate_stop      numeric not null default 0.20,
  failure_window_since   timestamptz,
  fetch_lease_until      timestamptz,
  embed_lease_until      timestamptz,
  disabled_reason        text,
  updated_at             timestamptz not null default now()
);

create table public.artifact_body_fetch_runs (
  run_id      uuid primary key default gen_random_uuid(),
  lane        text not null,
  mode        text not null constraint artifact_body_fetch_runs_mode_check check (mode in ('fetch','embed')),
  started_at  timestamptz not null default now(),
  attempted   integer not null default 0,
  ok          integer not null default 0,
  failed      integer not null default 0,
  empty       integer not null default 0,
  stop_reason text
);

create role service_role;
create role supabase_read_only_user;
create role anon;
create role authenticated;
`);

// ---------------------------------------------------------------- migration

console.log("[2/5] applying migration 20261009220000 (pg_cron lines stripped)");
const raw = readFileSync(MIGRATION, "utf8");
// Drop the schedule block: PGlite has no pg_cron and no cron_http_post.
const sqlOnly = raw.slice(0, raw.indexOf("-- ---------------------------------------------------------------- schedule"));
assert.ok(sqlOnly.includes("gnews_resolve_measure"), "migration body truncated too early");
assert.ok(raw.includes("-- UN-APPLIED — applied by Myke on merge"), "migration is missing the UN-APPLIED header");
await db.exec(sqlOnly.replace(/^set local lock_timeout.*$/m, ""));
console.log("      applied clean");

// ---------------------------------------------------------------- seed

console.log("[3/5] seeding a faithful miniature of the relevant subset");
const FEED = "https://news.google.com/rss/search?q=%22Walker%20County%22%20GA%20data%20center&hl=en-US&gl=US&ceid=US:en";
const OTHER_FEED = "https://example.com/not-a-local-watch.xml";
await q(`insert into public.source_registry values ('gsearch:loc-walker-ga', $1), ('rss:other', $2)`, [FEED, OTHER_FEED]);

const U = (t) => `https://news.google.com/rss/articles/${t}?oc=5`;
// Two rows share token T1 (production has 6,157 rows over 3,714 tokens) so the
// fan-out is exercised. T2 is restriction-shaped. T3 is out of scope by date,
// T4 by feed, T5 by subject, T6 has exhausted its retries.
const seed = [
  ["T1a", U("T1"), "Walker County weighs rules for data center growth", "2026-09-05", FEED],
  ["T1b", U("T1"), "Walker County weighs rules for data center growth", "2026-09-05", FEED],
  ["T2a", U("T2"), "County adopts a data center moratorium after rezoning fight", "2026-08-01", FEED],
  ["T3a", U("T3"), "Old data center story", "2026-06-01", FEED],
  ["T4a", U("T4"), "Data center story on another feed", "2026-09-01", OTHER_FEED],
  ["T5a", U("T5"), "Unrelated county budget story", "2026-09-01", FEED],
  ["T6a", U("T6"), "Data center zoning item already retried out", "2026-09-02", FEED],
];
for (const [tag, url, title, pub, feed] of seed) {
  await q(
    `insert into public.artifacts (source_type, source_url, raw_content, published_at, crawl_metadata, signal_envelope, content_hash)
     values ('web_news', $1::text, $2::text, $3::timestamptz,
             jsonb_build_object('mode','poller','feed_url',$4::text,'fetched_at','2026-09-05T19:12:21.977Z','tag',$5::text),
             jsonb_build_object('keep','me'), 'hash-' || $5::text)`,
    [url, title, pub, feed, tag],
  );
}
await q(`update public.artifacts set crawl_metadata = crawl_metadata || '{"resolve_attempts":3,"resolve_error":"batchexecute HTTP 500"}'::jsonb
          where crawl_metadata->>'tag' = 'T6a'`);
await q(`insert into public.artifact_body_fetch_lanes (lane, user_agent) values ('puc_gov','x') on conflict do nothing`);

/** Full-table snapshot of every column, keyed by tag. */
const snapshot = async () =>
  Object.fromEntries(
    (await q(`select crawl_metadata->>'tag' tag, to_jsonb(a) j from public.artifacts a order by 1`))
      .map((r) => [r.tag, r.j]),
  );
const before = await snapshot();

// ---------------------------------------------------------------- assertions

console.log("[4/5] behaviour");

await check("claim is a no-op while fetch_enabled is false", async () => {
  assert.equal((await q(`select * from public.gnews_resolve_claim(10)`)).length, 0);
});

await check("claim is a no-op while aggregator_robots_ack is false", async () => {
  await q(`update public.artifact_body_fetch_lanes set fetch_enabled = true where lane='gnews_local'`);
  assert.equal((await q(`select * from public.gnews_resolve_claim(10)`)).length, 0);
  const ack = await q(`select aggregator_robots_ack from public.artifact_body_fetch_lanes where lane='gnews_local'`);
  assert.equal(ack[0].aggregator_robots_ack, false, "the lane must ship with the robots gate closed");
});

await check("both gates open ⇒ DISTINCT tokens, restriction keywords first", async () => {
  await q(`update public.artifact_body_fetch_lanes set aggregator_robots_ack = true, fetch_lease_until = null where lane='gnews_local'`);
  const rows = await q(`select * from public.gnews_resolve_claim(10)`);
  const tokens = rows.map((r) => r.source_url.match(/articles\/([^?]+)/)[1]);
  // T3 (pre-July), T4 (not a local-watch feed), T5 (no data-centre match) and
  // T6 (retries exhausted) are all correctly out of scope.
  assert.deepEqual(tokens, ["T2", "T1"], `got ${JSON.stringify(tokens)}`);
  assert.equal(new Set(tokens).size, tokens.length, "a token must be claimed at most once");
});

await check("the lease blocks a second concurrent worker", async () => {
  assert.equal((await q(`select * from public.gnews_resolve_claim(10)`)).length, 0);
  await q(`update public.artifact_body_fetch_lanes set fetch_lease_until = null where lane='gnews_local'`);
});

await check("record merges, preserves every pre-existing key, and fans out by token", async () => {
  const n = await q(
    `select public.gnews_resolve_record($1, $2::jsonb) n`,
    [U("T1"), JSON.stringify({
      publisher_url: "https://www.northwestgeorgianews.com/catoosa_walker_news/article_83ce.html",
      publisher_domain: "northwestgeorgianews.com",
      resolve_method: "batchexecute",
      resolved_at: "2026-10-09T22:00:00.000Z",
      resolve_attempts: 1,
      resolve_error: null,
    })],
  );
  assert.equal(Number(n[0].n), 2, "both rows carrying token T1 must be updated");
  for (const tag of ["T1a", "T1b"]) {
    const [r] = await q(`select crawl_metadata m, source_url, raw_content from public.artifacts where crawl_metadata->>'tag' = $1`, [tag]);
    assert.equal(r.m.publisher_domain, "northwestgeorgianews.com");
    assert.equal(r.m.resolve_method, "batchexecute");
    assert.equal(r.m.resolve_error, null);
    // Pre-existing keys survive byte-for-byte.
    assert.equal(r.m.mode, "poller");
    assert.equal(r.m.feed_url, FEED);
    assert.equal(r.m.fetched_at, "2026-09-05T19:12:21.977Z");
    // source_url is still the aggregator redirect — never overwritten.
    assert.equal(r.source_url, U("T1"));
    assert.match(r.raw_content, /^Walker County weighs/);
  }
});

await check("record refuses a disallowed key", async () => {
  await assert.rejects(
    () => q(`select public.gnews_resolve_record($1, '{"source_url":"https://evil.example/"}'::jsonb)`, [U("T2")]),
    /disallowed key/,
  );
});

await check("record refuses an aggregator URL as publisher_url (decision D2)", async () => {
  for (const bad of [
    "https://news.google.com/rss/articles/T2",
    "https://google.com/x",
    "https://www.google.co.uk/x",
  ]) {
    await assert.rejects(
      () => q(`select public.gnews_resolve_record($1, jsonb_build_object('publisher_url',$2::text,'resolve_method','redirect'))`, [U("T2"), bad]),
      /aggregator URL/,
      bad,
    );
  }
});

await check("a failed resolution records the error and never invents publisher_url", async () => {
  await q(`select public.gnews_resolve_record($1, '{"resolve_attempts":1,"resolve_error":"batchexecute HTTP 500"}'::jsonb)`, [U("T2")]);
  const [r] = await q(`select crawl_metadata m from public.artifacts where crawl_metadata->>'tag' = 'T2a'`);
  assert.equal(r.m.publisher_url, undefined);
  assert.equal(r.m.resolve_error, "batchexecute HTTP 500");
  assert.equal(r.m.resolve_attempts, 1);
});

await check("a resolved row becomes claimable for a body, unresolved rows do not", async () => {
  const rows = await q(`select * from public.gnews_body_claim(10)`);
  assert.equal(rows.length, 2, "both T1 rows are resolved and pending a body");
  for (const r of rows) {
    assert.match(r.publisher_url, /^https:\/\/www\.northwestgeorgianews\.com\//);
    assert.equal(r.publisher_domain, "northwestgeorgianews.com");
    assert.ok(!/news\.google\.com/.test(r.publisher_url), "the body fetch never receives an aggregator URL");
  }
  await q(`update public.artifact_body_fetch_lanes set fetch_lease_until = null where lane='gnews_local'`);
});

await check("body_record writes body_* only, and ok requires text", async () => {
  const [{ artifact_id }] = await q(`select artifact_id from public.artifacts where crawl_metadata->>'tag' = 'T1a'`);
  await q(`select public.gnews_body_charge_attempt($1)`, [artifact_id]);
  await q(
    `select public.gnews_body_record($1, 'ok', $2, null, '{"http_status":200,"format":"html"}'::jsonb, false)`,
    [artifact_id, "Walker County commissioners voted ".repeat(20)],
  );
  const [r] = await q(`select * from public.artifacts where artifact_id = $1`, [artifact_id]);
  assert.equal(r.body_fetch_status, "ok");
  assert.equal(r.body_char_count, r.body_text.length);
  assert.equal(r.body_attempts, 1);
  assert.equal(r.source_url, U("T1"));
  assert.match(r.raw_content, /^Walker County weighs/);
  assert.deepEqual(r.signal_envelope, { keep: "me" });
  assert.equal(r.content_hash, "hash-T1a");
  await assert.rejects(() => q(`select public.gnews_body_record($1,'ok',null)`, [artifact_id]), /requires body_text/);
  await assert.rejects(() => q(`select public.gnews_body_record($1,'weird')`, [artifact_id]), /bad status/);
});

await check("404 exhausts the retry budget outright", async () => {
  const [{ artifact_id }] = await q(`select artifact_id from public.artifacts where crawl_metadata->>'tag' = 'T1b'`);
  await q(`select public.gnews_body_record($1, 'skipped', null, 'gone: HTTP 404', '{"http_status":404}'::jsonb, true)`, [artifact_id]);
  const [r] = await q(`select body_attempts, body_fetch_status, body_text from public.artifacts where artifact_id = $1`, [artifact_id]);
  assert.equal(r.body_attempts, 3);
  assert.equal(r.body_fetch_status, "skipped");
  assert.equal(r.body_text, null);
  assert.equal((await q(`select * from public.gnews_body_claim(10)`)).length, 0, "an exhausted row is never re-claimed");
});

await check("the measurement reports zero aggregator URLs stored as publisher URLs", async () => {
  const [{ m }] = await q(`select public.gnews_resolve_measure() m`);
  assert.equal(m.lane, "gnews_local");
  assert.equal(m.aggregator_urls_stored_as_publisher, 0);
  assert.equal(m.rows, 4, `in-scope rows: ${m.rows}`); // T1a T1b T2a T6a
  assert.equal(m.distinct_tokens, 3);
  assert.equal(m.resolved, 2);
  assert.equal(m.resolved_tokens, 1);
  assert.equal(m.by_body_status.ok, 1);
});

await check("'resolve' is now an accepted run mode", async () => {
  await q(`insert into public.artifact_body_fetch_runs (lane, mode) values ('gnews_local','resolve')`);
  await assert.rejects(() => q(`insert into public.artifact_body_fetch_runs (lane, mode) values ('gnews_local','nope')`), /mode_check/);
});

// ---------------------------------------------------------------- snapshot diff

console.log("[5/5] before/after column snapshot");
const after = await snapshot();
const OWNED = new Set([
  "crawl_metadata", "body_text", "body_char_count", "body_fetched_at",
  "body_fetch_status", "body_fetch_error", "body_attempts", "body_meta",
]);
const changed = [];
for (const tag of Object.keys(before)) {
  for (const col of Object.keys(before[tag])) {
    const a = JSON.stringify(before[tag][col]);
    const b = JSON.stringify(after[tag][col]);
    if (a !== b) changed.push(`${tag}.${col}`);
  }
}
const trespass = changed.filter((c) => !OWNED.has(c.split(".")[1]));
await check("no column outside the feature's own set changed", () => {
  assert.deepEqual(trespass, [], `trespass: ${trespass.join(", ")}`);
});
console.log(`      columns changed (all expected): ${changed.join(", ") || "none"}`);

// Only the keys the contract names were added to crawl_metadata.
const ALLOWED_KEYS = new Set([
  "publisher_url", "publisher_domain", "resolve_method",
  "resolved_at", "resolve_attempts", "resolve_error",
]);
await check("crawl_metadata gained only the six contract keys", () => {
  for (const tag of Object.keys(before)) {
    const b = new Set(Object.keys(before[tag].crawl_metadata ?? {}));
    for (const k of Object.keys(after[tag].crawl_metadata ?? {})) {
      if (!b.has(k)) assert.ok(ALLOWED_KEYS.has(k), `${tag} gained unexpected key ${k}`);
    }
    for (const k of b) assert.ok(k in (after[tag].crawl_metadata ?? {}), `${tag} lost key ${k}`);
  }
});

await db.close();
console.log(`\n${process.exitCode ? "FAILED" : "PASS"} — ${passed} checks\n`);
