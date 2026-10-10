#!/usr/bin/env node
// boundstone-local-backfill-pglite.mjs — FDY-92 storage-path proof on a LOCAL
// database.
//
// Applies migration 20261010110000 on top of FDY-90's 20261009220000 and
// FDY-91's 20261009230000 against a throwaway in-process Postgres seeded with a
// faithful miniature of production, then drives the WHOLE backfill — select a
// window, page it with a keyset cursor, attribute the headline in TypeScript,
// propose against a recording stub, ledger the result, resume — and asserts the
// properties the PR body stakes itself on.
//
// ---------------------------------------------------------------------------
// WHAT ONLY A DATABASE CAN PROVE
// ---------------------------------------------------------------------------
//   1. THE MIGRATION APPLIES AND ITS OWN GATES PASS. Six checks inside the file
//      raise on failure. Reading them proves nothing; running them does.
//   2. THE KEYSET WALK ENUMERATES EVERY ELIGIBLE ROW EXACTLY ONCE. This is the
//      one claim a unit test cannot make, because the ordering and the cursor
//      live in SQL. §5 walks the whole corpus with --batch 1, which is the
//      worst case, and compares the multiset against a single big call.
//   3. THE TWO SELECTORS AGREE. The migration's G3 gate is VACUOUS in
//      production, where both return 0 rows. Here the gate is opened and the
//      comparison becomes real — §4.
//   4. A LEDGERED ARTIFACT IS NEVER OFFERED AGAIN, AND A DEFERRED ONE ALWAYS
//      IS. That is the resume guarantee and the deferral decision, and both are
//      properties of the ledger plus the predicate, not of the script.
//   5. THE WEEKLY SLICES PARTITION THE CORPUS. §6 runs every slice and checks
//      the union is the whole window and the intersections are empty.
//   6. NOTHING TOUCHES public.artifacts. §8 diffs every column of every row.
//
// NO NETWORK, NO PRODUCTION. pg_cron, pg_net and vault are stubbed or absent;
// nothing here opens a connection to a Supabase project and no number below is
// read from one. The Boundstone side is a recording stub — this script never
// speaks to that project either, and `--apply` has never been run.
//
// ⚠️ NOT A DEPENDENCY OF `npm test`. The Vercel build fails on a new
// dependency, so PGlite is installed out of tree:
//
//     npm i --prefix /tmp/pgl @electric-sql/pglite
//     node --experimental-strip-types scripts/boundstone-local-backfill-pglite.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { buildGazetteer } from "../supabase/functions/boundstone-local-push/attribution-pure.ts";
import { decide, ledgerRow, proposePress } from "../supabase/functions/boundstone-local-push/push-pure.ts";
import {
  createPacer,
  mapRetrieval,
  newReport,
  outcomeForRefusal,
  recordDecision,
  renderReport,
  seedWeeks,
  sliceLabel,
  weeklySlices,
} from "./boundstone-local-backfill.ts";

const PGLITE_PREFIX = process.env.PGLITE_PREFIX ?? "/tmp/pgl";
let PGlite;
try {
  const require = createRequire(`${PGLITE_PREFIX}/package.json`);
  ({ PGlite } = await import(require.resolve("@electric-sql/pglite")));
} catch (e) {
  console.error(
    `PGlite not found under ${PGLITE_PREFIX}. Install it with:\n` +
      `  npm i --prefix ${PGLITE_PREFIX} @electric-sql/pglite`,
  );
  console.error(String(e));
  process.exit(2);
}

const url = (rel) => new URL(rel, import.meta.url);
const FDY90 = url("../supabase/migrations/20261009220000_gnews_resolve_schedule.sql");
const LEDGER = url("../supabase/migrations/20261009230000_boundstone_push_ledger.sql");
const BACKFILL = url("../supabase/migrations/20261010110000_boundstone_backfill_due.sql");

const db = await PGlite.create();
const q = async (sql, params) => (await db.query(sql, params)).rows;
let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
};

// ===========================================================================
// §1 the miniature schema
// ===========================================================================
console.log("\n== §1 miniature of the production schema ==");
await db.exec(`
create schema if not exists public;

create table public.source_registry (source_key text primary key, feed_url text);

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

create table public.jurisdictions (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  level      text,
  state_abbr character(2),
  fips_code  text
);

create table public.automation_health_log (
  id            bigserial primary key,
  automation_id text,
  status        text,
  detail        jsonb,
  created_at    timestamptz default now()
);

create role service_role;
create role supabase_read_only_user;
create role anon;
create role authenticated;
`);
console.log("      applied");

// ===========================================================================
// §2 the three migrations, in order — and the ordering guard, proved
// ===========================================================================
console.log("\n== §2 migrations ==");

const fdy90 = readFileSync(FDY90, "utf8");
const fdy90Sql = fdy90.slice(0, fdy90.indexOf("-- ---------------------------------------------------------------- schedule"));
assert.ok(fdy90Sql.includes("gnews_resolve_measure"), "FDY-90 body truncated too early");
await db.exec(fdy90Sql.replace(/^set local lock_timeout.*$/m, ""));
console.log("      20261009220000 (FDY-90, schedule stripped) applied");

const backfillSql = readFileSync(BACKFILL, "utf8");

await check("line 1 says UN-APPLIED", () => {
  assert.equal(backfillSql.split("\n")[0], "-- UN-APPLIED — applied by Myke on merge");
});

// ⚠️ THE ORDERING GUARD, PROVED BY A SEPARATE DATABASE. Asserting that the text
// contains `to_regclass(...) is null` is not the same as watching it refuse.
await check("it REFUSES to apply before FDY-91, and leaves no aborted transaction", async () => {
  const probe = await PGlite.create();
  await probe.exec(`
    create table public.artifacts (artifact_id uuid primary key default gen_random_uuid());
    create table public.source_registry (source_key text primary key, feed_url text);
    create role service_role; create role anon; create role authenticated;
  `);
  let msg = "";
  try {
    await probe.exec(backfillSql);
  } catch (e) {
    msg = e.message;
  }
  assert.match(msg, /cannot apply/, `it applied anyway: ${msg || "(no error)"}`);
  assert.match(msg, /boundstone_push_ledger/);
  assert.match(msg, /20261009230000/);
  // The guard runs BEFORE `begin;`, so a hand-applying operator is not left at
  // 25P02 wondering why the next statement also failed.
  const after = await probe.query("select 1 as one");
  assert.equal(after.rows[0].one, 1, "the refusal left an aborted transaction behind");
  const t = await probe.query(`select to_regprocedure('public.boundstone_backfill_due(timestamptz,timestamptz,int,timestamptz,uuid)') r`);
  assert.equal(t.rows[0].r, null, "it created the selector before refusing");
  await probe.close();
});

await db.exec(readFileSync(LEDGER, "utf8"));
console.log("      20261009230000 (FDY-91) applied");

// ===========================================================================
// §3 seed: a faithful miniature, spread across the weekly slices
// ===========================================================================
console.log("\n== §3 seed ==");

const FEED = "https://news.google.com/rss/search?q=%22St.+Croix+County%22+WI+data+center";
const OTHER_FEED = "https://example.com/not-a-local-watch.xml";
await q(`insert into public.source_registry values ('gsearch:loc-st-croix-wi', $1), ('rss:other', $2)`, [
  FEED,
  OTHER_FEED,
]);

const rss = (headline, outlet) => `${headline} - ${outlet}\n\n${headline}&nbsp;&nbsp;${outlet}`;
const GN = (token) => `https://news.google.com/rss/articles/${token}?oc=5`;

// Real headlines from the corpus, in the real RSS shape, deliberately spread
// over several weekly slices and over every decision branch.
//  tag, token, headline, outlet, published, feed
const SEED = [
  ["WI-1", "T01", "St. Croix County Board of Supervisors unanimously approves data center moratorium", "Hudson Star-Observer", "2026-07-02", FEED],
  ["MN-1", "T02", "Carlton County passes one-year moratorium on creation of data centers", "Pine Journal", "2026-07-03", FEED],
  ["VA-1", "T03", "Prince William County board rejects data center proposal", "Prince William Times", "2026-07-10", FEED],
  ["FL-1", "T04", "Sarasota County bans data center applications for one year", "Herald-Tribune", "2026-07-11", FEED],
  ["VA-2", "T05", "Loudoun County considers pause on new data center builds", "Loudoun Now", "2026-07-21", FEED],
  ["IN-1", "T06", "Vermillion County Commissioners speak out on data centers", "Tribune-Star", "2026-07-22", FEED],
  ["MO-1", "T07", "Open house set next week with company that could bring data center to Callaway County", "Fulton Sun", "2026-08-04", FEED],
  ["TXs", "T08", "Texas Data Center Moratorium: Local Regulation & State Action", "Law Review", "2026-08-05", FEED],
  // The headline this whole module exists for: Michigan City is INDIANA, so the
  // honest answer is to DECLINE.
  ["DECLINE", "T09", "Michigan City Council to consider data center moratorium", "WSBT", "2026-08-18", FEED],
  // Resolved, but the body fetch failed → not_retrieved → DEFERRED, not ledgered.
  ["DEFER", "T10", "Manatee County moves toward data center moratorium", "Bradenton Herald", "2026-09-01", FEED],
  // Out of the window entirely.
  ["OLD", "T11", "Old data center story about a county board", "Gazette", "2026-06-01", FEED],
  // Not a local-watch feed.
  ["OFFFEED", "T12", "County approves data center moratorium", "Elsewhere", "2026-09-02", OTHER_FEED],
  // Not about data centres.
  ["OFFTOPIC", "T13", "Union County reviews its road budget", "Gazette", "2026-09-03", FEED],
];
for (const [tag, token, headline, outlet, pub, feed] of SEED) {
  await q(
    `insert into public.artifacts (source_type, source_url, raw_content, published_at, crawl_metadata, signal_envelope, content_hash)
     values ('web_news', $1::text, $2::text, $3::timestamptz,
             jsonb_build_object('mode','poller','feed_url',$4::text,'fetched_at','2026-09-05T19:12:21.977Z','tag',$5::text),
             jsonb_build_object('keep','me'), 'hash-' || $5::text)`,
    [GN(token), rss(headline, outlet), pub, feed, tag],
  );
}

const tsv = (rel) =>
  readFileSync(url(rel), "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#")).map((l) => l.split("\t"));
for (const [name, state, level] of tsv("../test/fixtures/local-watch-jurisdictions.tsv")) {
  await q(`insert into public.jurisdictions (name, level, state_abbr) values ($1,$2,$3)`, [name, level, state]);
}
for (const [name, state] of tsv("../test/fixtures/local-watch-states.tsv")) {
  await q(`insert into public.jurisdictions (name, level, state_abbr) values ($1,'state',$2)`, [name, state]);
}
const gaz = buildGazetteer(
  await q(`select name, state_abbr, level from public.jurisdictions where level in ('county','cousub','place')`),
  await q(`select name, state_abbr from public.jurisdictions where level = 'state'`),
);
console.log(`      ${SEED.length} artifacts, ${gaz.byName.size} gazetteer names, ${gaz.stateNames.size} states`);

/** Every column of every artifact, keyed by tag. §8's baseline. */
const snapshot = async () =>
  Object.fromEntries(
    (await q(`select crawl_metadata->>'tag' tag, to_jsonb(a) j from public.artifacts a order by 1`)).map((r) => [r.tag, r.j]),
  );
const artifactsBefore = await snapshot();
const artifactCountBefore = Number((await q(`select count(*) c from public.artifacts`))[0].c);

console.log("\n== §3b applying 20261010110000 — its gates run inside the apply ==");
await check("it applies clean, and every in-file gate passes", async () => {
  await db.exec(backfillSql);
});

await check("⚠️ the selector is EMPTY before FDY-90 resolves — publisher_url is NULL", async () => {
  const due = await q(`select * from public.boundstone_backfill_due(timestamptz '2026-07-01', null, 500, null, null)`);
  assert.equal(due.length, 0, `${due.length} rows eligible before anything was resolved`);
});

// ===========================================================================
// §4 open the gate, resolve, and compare the two selectors for real
// ===========================================================================
console.log("\n== §4 the transition, and selector equivalence that is not vacuous ==");

// ⚠️ MYKE'S PRODUCTION WRITE, PERFORMED HERE ON A THROWAWAY IN-PROCESS DATABASE
// AND NOWHERE ELSE. It is the statement the whole dry-run report is labelled
// conditional on, and the only honest way to show what follows it is to do it
// somewhere that does not matter.
await q(`update public.artifact_body_fetch_lanes
            set fetch_enabled = true, aggregator_robots_ack = true, fetch_lease_until = null
          where lane = 'gnews_local'`);

// Resolve every seeded token to a publisher URL through FDY-90's own writer, so
// the keys are exactly the keys production will carry.
const claimed = await q(`select * from public.gnews_resolve_claim(50)`);
assert.ok(claimed.length > 0, "the claim returned nothing with both gates open");
let resolvedN = 0;
for (const c of claimed) {
  const tag = (await q(`select crawl_metadata->>'tag' t from public.artifacts where artifact_id = $1`, [c.artifact_id]))[0].t;
  const host = `www.${tag.toLowerCase().replace(/[^a-z0-9]/g, "")}-news.com`;
  await q(`select public.gnews_resolve_record($1::text, $2::jsonb)`, [
    c.source_url,
    JSON.stringify({ publisher_url: `https://${host}/story/${tag}`, publisher_domain: host, resolve_method: "harness" }),
  ]);
  resolvedN += 1;
}
console.log(`      resolved ${resolvedN} tokens`);

// FDY-90's body step, as production will record it: 'ok' everywhere except the
// row seeded to prove the deferral.
await q(`update public.artifacts
            set body_fetch_status = case when crawl_metadata->>'tag' = 'DEFER' then 'failed' else 'ok' end,
                body_fetched_at   = case when crawl_metadata->>'tag' = 'DEFER' then null
                                         else published_at + interval '14 hours' end`);

await check("the two selectors agree row for row — the gate G3 that is vacuous in production", async () => {
  const a = (await q(`select artifact_id from public.boundstone_push_due(500) order by 1`)).map((r) => r.artifact_id);
  const b = (
    await q(`select artifact_id from public.boundstone_backfill_due(timestamptz '2026-07-01', null, 500, null, null) order by 1`)
  ).map((r) => r.artifact_id);
  assert.ok(a.length > 0, "nothing is eligible, so the comparison would be vacuous again");
  assert.deepEqual(b, a, `push_due returned ${a.length}, backfill_due returned ${b.length}`);
  console.log(`         (${a.length} eligible artifacts, compared for real)`);
});

await check("the eligibility predicate excludes exactly what it should", async () => {
  const tags = (
    await q(`select a.crawl_metadata->>'tag' tag
               from public.boundstone_backfill_due(timestamptz '2026-07-01', null, 500, null, null) d
               join public.artifacts a on a.artifact_id = d.artifact_id order by 1`)
  ).map((r) => r.tag);
  assert.ok(!tags.includes("OLD"), "a June article is outside the window");
  assert.ok(!tags.includes("OFFFEED"), "a non-local-watch feed is out of scope");
  assert.ok(!tags.includes("OFFTOPIC"), "an article that does not match 'data ?cent' is out of scope");
  assert.ok(tags.includes("DECLINE"), "an article that will be DECLINED is still eligible to be considered");
  assert.ok(tags.includes("DEFER"), "a failed body fetch does not make a row ineligible — it makes it deferred");
});

await check("the 2026-07-01 floor cannot be widened from the command line", async () => {
  const rows = await q(`select published_at from public.boundstone_backfill_due(timestamptz '2020-01-01', null, 500, null, null)`);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(new Date(r.published_at) >= new Date("2026-07-01T00:00:00Z"), `${r.published_at} is before the floor`);
  }
});

await check("the selector returns no article text, and the headline source it does return is usable", async () => {
  const cols = (
    await q(`select unnest(proargnames) n from pg_proc
              where oid = 'public.boundstone_backfill_due(timestamptz,timestamptz,int,timestamptz,uuid)'::regprocedure`)
  ).map((r) => r.n);
  for (const forbidden of ["raw_content", "body", "body_text", "extract", "excerpt", "summary"]) {
    assert.ok(!cols.includes(forbidden), `the selector returns ${forbidden}`);
  }
  const [one] = await q(`select * from public.boundstone_backfill_due(timestamptz '2026-07-01', null, 1, null, null)`);
  assert.ok(one.rss_line1.endsWith(` - ${one.rss_publisher}`), "line 1 must end in ' - ' || publisher");
  assert.ok(!one.rss_line1.includes("&nbsp;"), "line 1 is line 1, not the description");
});

// ===========================================================================
// §5 the keyset walk — the claim no unit test can make
// ===========================================================================
console.log("\n== §5 the keyset walk enumerates every eligible row exactly once ==");

/** Walk a window with a keyset cursor, exactly as the script's loop does. */
async function walk(since, until, batch) {
  const seen = [];
  let afterPublished = null;
  let afterId = null;
  for (;;) {
    const page = await q(
      `select * from public.boundstone_backfill_due($1::timestamptz, $2::timestamptz, $3::int, $4::timestamptz, $5::uuid)`,
      [since, until, batch, afterPublished, afterId],
    );
    if (page.length === 0) break;
    seen.push(...page);
    const last = page[page.length - 1];
    afterPublished = last.published_at;
    afterId = last.artifact_id;
    if (page.length < batch) break;
  }
  return seen;
}

await check("--batch 1 (the worst case) sees the same multiset as one big call", async () => {
  const big = (await q(`select artifact_id from public.boundstone_backfill_due(timestamptz '2026-07-01', null, 500, null, null)`)).map((r) => r.artifact_id);
  const one = (await walk("2026-07-01", null, 1)).map((r) => r.artifact_id);
  assert.equal(one.length, big.length, `batch=1 saw ${one.length}, one call saw ${big.length}`);
  assert.equal(new Set(one).size, one.length, "the keyset walk returned a duplicate");
  assert.deepEqual([...one].sort(), [...big].sort());
  // …and in the same order, oldest first, which is what "oldest first" means
  // for a resumable job.
  assert.deepEqual(one, big, "the walk reordered the corpus");
});

await check("every batch size reaches the same set", async () => {
  const expected = (await walk("2026-07-01", null, 500)).map((r) => r.artifact_id).sort();
  for (const b of [1, 2, 3, 7, 500]) {
    const got = (await walk("2026-07-01", null, b)).map((r) => r.artifact_id).sort();
    assert.deepEqual(got, expected, `batch=${b} disagreed`);
  }
});

// ===========================================================================
// §6 the weekly slices partition the window
// ===========================================================================
console.log("\n== §6 weekly slices partition the corpus — no gap, no double push ==");

const SINCE = "2026-07-01T00:00:00.000Z";
const UNTIL = "2026-10-01T00:00:00.000Z";
const slices = weeklySlices(SINCE, UNTIL);

await check(`${slices.length} slices tile the window, and every row is in exactly one`, async () => {
  const whole = (await walk(SINCE, UNTIL, 500)).map((r) => r.artifact_id);
  const perSlice = [];
  for (const s of slices) perSlice.push((await walk(s.start, s.end, 500)).map((r) => r.artifact_id));
  const union = perSlice.flat();
  assert.equal(new Set(union).size, union.length, "an artifact appeared in two slices — it would be pushed twice");
  assert.deepEqual([...union].sort(), [...whole].sort(), "the slices do not cover the window");
  // And the slice a row lands in is the one the report labels it with.
  for (let i = 0; i < slices.length; i += 1) {
    for (const id of perSlice[i]) {
      const [r] = await q(`select published_at from public.artifacts where artifact_id = $1`, [id]);
      assert.equal(sliceLabel(slices, new Date(r.published_at).toISOString()), slices[i].start.slice(0, 10));
    }
  }
});

// ===========================================================================
// §7 the whole backfill, end to end, against a recording stub
// ===========================================================================
console.log("\n== §7 the lane, driven end to end: SQL -> TypeScript -> stub -> SQL ==");

const stub = {
  calls: [],
  async rpc(fn, args) {
    this.calls.push([fn, structuredClone(args)]);
    return {
      data: { id: `00000000-0000-4000-8000-${String(this.calls.length).padStart(12, "0")}`, status: "inserted", is_published: true },
      error: null,
    };
  },
};

// A fake clock, so the ≤2/s pacing is exercised without the run taking minutes.
let fakeNow = 0;
const pacer = createPacer(2, { now: () => fakeNow, sleep: async (ms) => { fakeNow += ms; } });
const callTimes = [];

const report = newReport("apply", SINCE, UNTIL, new Date("2026-10-09T00:00:00Z").toISOString());
report.slices = slices.length;
seedWeeks(report, slices);

const ledgered = [];
const deferred = [];
for (const s of slices) {
  for (const row of await walk(s.start, s.end, 500)) {
    const r = { ...row, published_at: new Date(row.published_at).toISOString(),
                body_fetched_at: row.body_fetched_at ? new Date(row.body_fetched_at).toISOString() : null };
    const { httpStatus, retrievedAt } = mapRetrieval(r);
    const d = decide(r, gaz, { httpStatus, retrievedAt });
    const label = s.start.slice(0, 10);

    let result = null;
    let outcome;
    if (d.send) {
      await pacer.take();
      callTimes.push(fakeNow);
      report.totals.boundstone_calls += 1;
      result = await proposePress(stub, d.payload);
      outcome = result.ok ? (result.status === "duplicate" ? "duplicate" : "pushed") : "failed";
    } else {
      outcome = outcomeForRefusal(d.reason);
    }
    recordDecision(report, label, d, outcome);
    if (outcome === "deferred") {
      deferred.push(r.artifact_id);
      continue;
    }
    const lr = ledgerRow(r.artifact_id, d, result);
    await q(`select public.boundstone_push_record($1::jsonb)`, [JSON.stringify(lr)]);
    ledgered.push(r.artifact_id);
    report.totals.ledger_rows_written += 1;
  }
}

await check("one RPC call per article, and it is always bs_press_propose", () => {
  assert.equal(stub.calls.length, report.totals.press_items, "a call without a press item, or the reverse");
  for (const [fn] of stub.calls) assert.equal(fn, "bs_press_propose");
  // The forbidden second call, by name.
  assert.ok(!stub.calls.some(([fn]) => fn === "bs_record_candidate_propose"), "the lane called the forbidden RPC");
});

await check("no two Boundstone calls were closer than 500 ms", () => {
  for (let i = 1; i < callTimes.length; i += 1) {
    assert.ok(callTimes[i] - callTimes[i - 1] >= 500, `calls ${i - 1}/${i} were ${callTimes[i] - callTimes[i - 1]} ms apart`);
  }
  assert.ok(callTimes.length > 1, "too few calls to prove pacing");
});

await check("no payload carried article text, a score, or an aggregator URL", () => {
  const banned = ["body", "raw_content", "extract", "excerpt", "summary", "snippet", "abstract", "text",
                  "content", "sentiment", "relevance", "score", "signal_score", "rank", "record_slug"];
  for (const [, args] of stub.calls) {
    const p = args.p;
    for (const k of banned) assert.ok(!(k in p), `payload carried ${k}`);
    assert.ok(!/news\.google\./i.test(p.url), `payload carried an aggregator URL: ${p.url}`);
    assert.match(p.state_abbr, /^[A-Z]{2}$/);
    assert.match(p.published_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(p.signal_reasons));
  }
});

await check("retrieved_at is FDY-90's measurement, NOT the time of the push", () => {
  for (const [, args] of stub.calls) {
    const p = args.p;
    // Every seeded body_fetched_at is published_at + 14h, so retrieved_at must
    // be within a day of the article and nowhere near "now".
    const gap = Date.parse(p.retrieved_at) - Date.parse(`${p.published_date}T00:00:00Z`);
    assert.ok(gap >= 0 && gap < 48 * 3600_000, `retrieved_at ${p.retrieved_at} is not near published_date ${p.published_date}`);
    assert.equal(p.http_status, 200);
  }
});

await check("the DEFERRED row was NOT ledgered, and is still offered", async () => {
  assert.equal(deferred.length, 1, `expected exactly one deferral, got ${deferred.length}`);
  const [tag] = (await q(`select crawl_metadata->>'tag' t from public.artifacts where artifact_id = $1`, [deferred[0]])).map((r) => r.t);
  assert.equal(tag, "DEFER");
  const n = Number((await q(`select count(*) c from public.boundstone_push_ledger where artifact_id = $1`, [deferred[0]]))[0].c);
  assert.equal(n, 0, "a transient refusal became a permanent ledger row");
  const still = await q(
    `select 1 from public.boundstone_backfill_due(timestamptz '2026-07-01', null, 500, null, null) d where d.artifact_id = $1`,
    [deferred[0]],
  );
  assert.equal(still.length, 1, "the deferred row is no longer offered, so the hourly lane will never see it");
});

await check("the DECLINED headline was ledgered with a reason and never sent", async () => {
  const [r] = await q(
    `select l.kind, l.reason from public.boundstone_push_ledger l
       join public.artifacts a on a.artifact_id = l.artifact_id
      where a.crawl_metadata->>'tag' = 'DECLINE'`,
  );
  assert.ok(r, "Michigan City was not ledgered at all");
  assert.equal(r.kind, "skipped");
  // Michigan City is INDIANA; the headline alone does not prove it, so the
  // honest answer is a refusal with a named reason.
  assert.ok(["no_honest_state", "ambiguous_jurisdiction", "ambiguous_state_named"].includes(r.reason), r.reason);
  assert.ok(!stub.calls.some(([, a]) => /Michigan City/.test(a.p.headline)), "Michigan City reached Boundstone");
});

await check("RESUME: a second run pushes nothing new and makes no call", async () => {
  const before = stub.calls.length;
  const again = await walk(SINCE, UNTIL, 500);
  // Everything ledgered has dropped out; only the deferral remains, and a
  // second run defers it again rather than pushing it.
  assert.deepEqual(again.map((r) => r.artifact_id), deferred, "a ledgered artifact was offered a second time");
  for (const row of again) {
    const r = { ...row, published_at: new Date(row.published_at).toISOString(), body_fetched_at: null };
    const d = decide(r, gaz, mapRetrieval(r));
    assert.equal(d.send, false);
    assert.equal(outcomeForRefusal(d.reason), "deferred");
  }
  assert.equal(stub.calls.length, before, "the resume run made an RPC call");
});

await check("the ledger holds exactly one row per decided artifact, and no article text", async () => {
  const rows = await q(`select artifact_id, kind, reason, response from public.boundstone_push_ledger order by artifact_id`);
  assert.equal(rows.length, ledgered.length);
  assert.equal(new Set(rows.map((r) => r.artifact_id)).size, rows.length);
  for (const r of rows) {
    if (r.response) {
      for (const k of Object.keys(r.response)) {
        assert.ok(!["body", "extract", "excerpt", "summary", "text", "content", "score"].includes(k), `ledger response carried ${k}`);
      }
    }
    assert.equal(r.kind === "skipped", r.reason !== null, "a skip without a reason, or a push with one");
  }
});

// ===========================================================================
// §8 nothing touched the corpus
// ===========================================================================
console.log("\n== §8 the corpus ==");

await check("public.artifacts has the same row count", async () => {
  assert.equal(Number((await q(`select count(*) c from public.artifacts`))[0].c), artifactCountBefore);
});

await check("the only artifact columns that changed are FDY-90's own", async () => {
  // FDY-90's resolver and body step legitimately write publisher_url,
  // publisher_domain, resolve_method, body_fetch_status and body_fetched_at —
  // this harness performed both. NOTHING the backfill did may change anything
  // else, and in particular raw_content, published_at and signal_envelope must
  // be byte-identical.
  const after = await snapshot();
  assert.deepEqual(Object.keys(after).sort(), Object.keys(artifactsBefore).sort());
  const allowed = new Set(["crawl_metadata", "body_fetch_status", "body_fetched_at", "body_attempts", "body_meta"]);
  for (const tag of Object.keys(after)) {
    for (const col of Object.keys(artifactsBefore[tag])) {
      if (allowed.has(col)) continue;
      assert.deepEqual(after[tag][col], artifactsBefore[tag][col], `${tag}.${col} changed`);
    }
    // And inside crawl_metadata, only FDY-90's three keys may be new.
    const b = artifactsBefore[tag].crawl_metadata ?? {};
    const a = after[tag].crawl_metadata ?? {};
    for (const k of Object.keys(b)) assert.deepEqual(a[k], b[k], `${tag}.crawl_metadata.${k} changed`);
    for (const k of Object.keys(a)) {
      if (k in b) continue;
      assert.ok(["publisher_url", "publisher_domain", "resolve_method", "resolve_attempts", "resolved_at", "resolve_error"].includes(k),
        `${tag}.crawl_metadata gained ${k}`);
    }
  }
});

await check("public.boundstone_push_measure() reports the run honestly", async () => {
  const m = (await q(`select public.boundstone_push_measure() m`))[0].m;
  assert.equal(Number(m.ledgered), ledgered.length);
  assert.equal(Number(m.due_now), deferred.length, "due_now must be exactly the deferrals");
  assert.equal(Number(m.aggregator_urls_stored_as_publisher), 0, "an aggregator URL is stored as a publisher URL");
});

// ===========================================================================
// the report the script would print
// ===========================================================================
console.log(`\n${renderReport(report)}\n`);

console.log(`\n${passed} checks passed${process.exitCode ? " — WITH FAILURES ABOVE" : ""}.`);
await db.close();
