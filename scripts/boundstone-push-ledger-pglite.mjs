#!/usr/bin/env node
// boundstone-push-ledger-pglite.mjs — FDY-91 storage-path proof on a LOCAL
// database.
//
// Applies migration 20261009230000 on top of FDY-90's 20261009220000 against a
// throwaway in-process Postgres seeded with a faithful miniature of production,
// then drives the WHOLE lane end to end — resolve a token, become due, attribute
// the headline in TypeScript, propose against a recording stub, ledger the
// result — and asserts the properties the PR body stakes itself on.
//
// ---------------------------------------------------------------------------
// WHAT ONLY A DATABASE CAN PROVE
// ---------------------------------------------------------------------------
//   1. THE MIGRATION APPLIES, AND ITS OWN GATES PASS. Six `do $gate$` blocks
//      raise on failure. Reading them proves nothing; running them does.
//   2. boundstone_push_due IS EMPTY UNTIL FDY-90 RESOLVES. This is the claim the
//      entire dry-run is labelled conditional on, and §3 demonstrates the
//      transition rather than asserting it: 0 rows, then one gnews_resolve_record
//      call, then 1 row.
//   3. A LEDGERED ARTIFACT IS NEVER OFFERED AGAIN. The hourly cron depends on
//      it. §5 pushes, ledgers, and re-reads.
//   4. THE LEDGER REFUSES ARTICLE TEXT. §6 tries four shapes of smuggling.
//   5. THE WHOLE LANE IS WIRED CORRECTLY. §7 runs SQL → TypeScript → stub → SQL
//      for a real headline. A unit test cannot catch a column renamed in the
//      migration but not in DueRow; this can, and did.
//   6. NOTHING TOUCHES public.artifacts. §8 diffs every column of every row.
//
// NO NETWORK, NO PRODUCTION. pg_cron, pg_net and vault are stubbed; nothing
// here opens a connection to a Supabase project and no number below is read
// from one. The Boundstone side is a recording stub — this script never speaks
// to that project either.
//
// ⚠️ NOT A DEPENDENCY OF `npm test`. The Vercel build fails on a new
// dependency, so PGlite is installed out of tree:
//
//     npm i --prefix /tmp/pgl @electric-sql/pglite
//     node --experimental-strip-types scripts/boundstone-push-ledger-pglite.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { buildGazetteer } from "../supabase/functions/boundstone-local-push/attribution-pure.ts";
import {
  decide,
  FN_PRESS_PROPOSE,
  ledgerRow,
  proposePress,
} from "../supabase/functions/boundstone-local-push/push-pure.ts";

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
const SCHEDULE = url("../supabase/migrations/20261009230001_boundstone_push_schedule.sql");

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
// §1 the miniature schema — the same one FDY-90's harness builds, plus the
//    neighbours this migration references.
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

-- The attribution registry. Only the four columns the lane reads.
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
// §2 the two migrations
// ===========================================================================
console.log("\n== §2 migrations ==");

const fdy90 = readFileSync(FDY90, "utf8");
// PGlite has no pg_cron and no cron_http_post, so FDY-90's schedule block is
// cut at exactly the marker its own harness cuts at.
const fdy90Sql = fdy90.slice(0, fdy90.indexOf("-- ---------------------------------------------------------------- schedule"));
assert.ok(fdy90Sql.includes("gnews_resolve_measure"), "FDY-90 body truncated too early");
await db.exec(fdy90Sql.replace(/^set local lock_timeout.*$/m, ""));
console.log("      20261009220000 (FDY-90, schedule stripped) applied");

const ledgerSql = readFileSync(LEDGER, "utf8");

await check("line 1 says UN-APPLIED", () => {
  assert.equal(ledgerSql.split("\n")[0], "-- UN-APPLIED — applied by Myke on merge");
});

// ⚠️ THE ORDERING GUARD, PROVED BY A SEPARATE DATABASE. Asserting the text says
// `to_regprocedure(...) is null` is not the same as watching it refuse.
await check("it REFUSES to apply before FDY-90, and leaves no aborted transaction", async () => {
  const probe = await PGlite.create();
  await probe.exec(`
    create table public.artifacts (artifact_id uuid primary key default gen_random_uuid());
    create table public.source_registry (source_key text primary key, feed_url text);
    create role service_role; create role anon; create role authenticated;
  `);
  let msg = "";
  try {
    await probe.exec(ledgerSql);
  } catch (e) {
    msg = e.message;
  }
  assert.match(msg, /cannot apply/, `it applied anyway: ${msg || "(no error)"}`);
  assert.match(msg, /gnews_resolve_measure/);
  assert.match(msg, /20261009220000/);
  // The guard runs BEFORE `begin;`, so an operator applying by hand is not left
  // at 25P02. This asserts it rather than trusting the file's ordering.
  const after = await probe.query("select 1 as one");
  assert.equal(after.rows[0].one, 1, "the refusal left an aborted transaction behind");
  // …and it refused before creating anything.
  const t = await probe.query(`select to_regclass('public.boundstone_push_ledger') r`);
  assert.equal(t.rows[0].r, null, "it created the ledger before refusing");
  await probe.close();
});

// ===========================================================================
// §3 seed, then apply — and the gates run as part of the apply
// ===========================================================================
console.log("\n== §3 seed: a faithful miniature of the relevant subset ==");

const FEED = "https://news.google.com/rss/search?q=%22St.+Croix+County%22+WI+data+center";
const OTHER_FEED = "https://example.com/not-a-local-watch.xml";
await q(`insert into public.source_registry values ('gsearch:loc-st-croix-wi', $1), ('rss:other', $2)`, [
  FEED,
  OTHER_FEED,
]);

// Real headlines from the corpus, in the real RSS shape: line 1 carries
// Google's " - <outlet>" suffix and the description repeats it after
// &nbsp;&nbsp;. Nothing here is a tidied-up version.
const rss = (headline, outlet) =>
  `${headline} - ${outlet}\n\n${headline}&nbsp;&nbsp;${outlet}`;

// ⚠️ public.gnews_resolve_record takes the ARTICLE URL, not the token — it
// derives the token itself with public.gnews_token(). Passing the bare token is
// a silent no-match in SQL and a confusing "no token in T1" at runtime; this
// helper exists so the harness cannot make that mistake twice.
const GN = (token) => `https://news.google.com/rss/articles/${token}?oc=5`;

const SEED = [
  // tag, token, headline, outlet, published, feed, in scope?
  ["WI", "T1", "St. Croix County Board of Supervisors unanimously approves data center moratorium", "Hudson Star-Observer", "2026-08-14", FEED],
  ["MN", "T2", "Carlton County passes one-year moratorium on creation of data centers", "Pine Journal", "2026-08-02", FEED],
  ["DECLINE", "T3", "Michigan City Council to consider data center moratorium", "WSBT", "2026-09-02", FEED],
  ["OLD", "T4", "Old data center story about a county board", "Gazette", "2026-06-01", FEED],
  ["OFFFEED", "T5", "County approves data center moratorium", "Elsewhere", "2026-09-01", OTHER_FEED],
  ["OFFTOPIC", "T6", "Union County reviews its road budget", "Gazette", "2026-09-01", FEED],
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

// The gazetteer, from the same committed fixture the unit tests use, so the two
// cannot disagree about what Michigan City is.
const tsv = (rel) =>
  readFileSync(url(rel), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t"));
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
    (await q(`select crawl_metadata->>'tag' tag, to_jsonb(a) j from public.artifacts a order by 1`)).map(
      (r) => [r.tag, r.j],
    ),
  );
const artifactsBefore = await snapshot();
const artifactCountBefore = Number((await q(`select count(*) c from public.artifacts`))[0].c);

console.log("\n== §3b applying 20261009230000 — its six gates run inside the apply ==");
await check("it applies clean, and every in-file gate passes", async () => {
  await db.exec(ledgerSql);
});

await check("⚠️ boundstone_push_due is EMPTY — publisher_url is NULL on every row", async () => {
  const due = await q(`select * from public.boundstone_push_due(500)`);
  assert.equal(due.length, 0, `${due.length} rows are due before FDY-90 has resolved anything`);
  const resolved = await q(
    `select count(*) c from public.artifacts where crawl_metadata->>'publisher_url' is not null`,
  );
  assert.equal(Number(resolved[0].c), 0);
});

// ===========================================================================
// §4 the transition — the dry-run's entire conditionality, demonstrated
// ===========================================================================
console.log("\n== §4 open FDY-90's gate, resolve, and watch rows become due ==");

await check("the lane ships with BOTH gates closed", async () => {
  const lane = await q(
    `select fetch_enabled, aggregator_robots_ack from public.artifact_body_fetch_lanes where lane='gnews_local'`,
  );
  assert.equal(lane[0].fetch_enabled, false);
  assert.equal(lane[0].aggregator_robots_ack, false, "the robots gate must ship closed");
});

// ⚠️ THIS IS MYKE'S PRODUCTION WRITE, PERFORMED HERE ON A THROWAWAY IN-PROCESS
// DATABASE AND NOWHERE ELSE. It is the one statement the dry-run report is
// labelled conditional on, and the only honest way to show what happens after
// it is to do it somewhere that does not matter.
await q(`update public.artifact_body_fetch_lanes
            set fetch_enabled = true, aggregator_robots_ack = true, fetch_lease_until = null
          where lane = 'gnews_local'`);

await check("resolving one token makes exactly its rows due", async () => {
  const claimed = await q(`select * from public.gnews_resolve_claim(10)`);
  assert.ok(claimed.length > 0, "the claim returned nothing with both gates open");

  // Resolve the WI token to a real publisher URL, through FDY-90's own writer.
  await q(
    `select public.gnews_resolve_record($1::text, $2::jsonb)`,
    [
      GN("T1"),
      JSON.stringify({
        publisher_url: "https://www.hudsonstarobserver.com/news/2026/08/moratorium",
        publisher_domain: "hudsonstarobserver.com",
        resolve_method: "batchexecute",
      }),
    ],
  );

  const due = await q(`select * from public.boundstone_push_due(500)`);
  assert.equal(due.length, 1, `expected exactly the WI row, got ${due.length}`);
  assert.equal(due[0].publisher_domain, "hudsonstarobserver.com");
  // ⚠️ AND NOT raw_content. The contract is two short strings.
  assert.deepEqual(
    Object.keys(due[0]).sort(),
    ["artifact_id", "published_at", "publisher_domain", "publisher_url", "rss_line1", "rss_publisher"],
    "boundstone_push_due's shape changed; DueRow in push-pure.ts must match it",
  );
  assert.ok(!("raw_content" in due[0]), "the caller was handed an article body");
});

await check("an out-of-window or off-feed row never becomes due even once resolved", async () => {
  for (const token of ["T4", "T5", "T6"]) {
    await q(`select public.gnews_resolve_record($1::text, $2::jsonb)`, [
      GN(token),
      JSON.stringify({
        publisher_url: `https://example.com/${token}`,
        publisher_domain: "example.com",
        resolve_method: "batchexecute",
      }),
    ]);
  }
  const due = await q(`select l.tag from (
      select d.artifact_id, a.crawl_metadata->>'tag' tag
        from public.boundstone_push_due(500) d
        join public.artifacts a using (artifact_id)) l order by 1`);
  const tags = due.map((r) => r.tag).sort();
  // OFFTOPIC is in the window and on the feed, but does not match 'data ?cent',
  // so it is not due. OLD is out of the date window. OFFFEED is not local-watch.
  assert.deepEqual(tags, ["WI"], `due tags were ${JSON.stringify(tags)}`);
});

// ===========================================================================
// §5 the whole lane: SQL → TypeScript → stub → SQL
// ===========================================================================
console.log("\n== §5 end to end, on the real headline ==");

function recordingBoundstone(reply) {
  const calls = [];
  return {
    calls,
    rpc(fn, args) {
      calls.push({ method: "rpc", fn, args });
      return Promise.resolve(typeof reply === "function" ? reply(fn, args) : reply);
    },
    from(table) {
      calls.push({ method: "from", table });
      return { insert: () => Promise.resolve({ data: null, error: null }) };
    },
  };
}

let wiArtifact;
await check("decide() → propose → ledger, with Faraday's attribution intact", async () => {
  const due = await q(`select * from public.boundstone_push_due(500)`);
  const row = due[0];
  wiArtifact = row.artifact_id;

  const d = decide(row, gaz, { httpStatus: 200, retrievedAt: "2026-08-14T18:00:00.000Z" });
  assert.equal(d.send, true, `decide refused the row: ${d.send === false ? d.reason : ""}`);
  assert.equal(d.kind, "both", "a moratorium headline must also ask for a candidate");
  assert.equal(d.payload.state_abbr, "WI");
  assert.equal(d.payload.jurisdiction_name, "St. Croix County");
  assert.equal(d.payload.published_date, "2026-08-14");
  assert.deepEqual(d.payload.signal_reasons, ["moratori"]);
  // The headline is the publisher's, with Google's suffix gone.
  assert.equal(
    d.payload.headline,
    "St. Croix County Board of Supervisors unanimously approves data center moratorium",
  );
  assert.ok(!/Hudson Star-Observer/.test(d.payload.headline), "Google's suffix survived");

  const client = recordingBoundstone({
    data: { id: "55555555-5555-4555-8555-555555555555", status: "inserted", is_published: true },
    error: null,
  });
  const result = await proposePress(client, d.payload);
  assert.equal(result.ok, true);
  assert.deepEqual([...new Set(client.calls.map((c) => c.method))], ["rpc"], "a table call was made");
  assert.deepEqual([...new Set(client.calls.map((c) => c.fn))], [FN_PRESS_PROPOSE]);

  const ledger = ledgerRow(row.artifact_id, d, result);
  const rec = await q(`select public.boundstone_push_record($1::jsonb) r`, [JSON.stringify(ledger)]);
  assert.equal(rec[0].r.status, "inserted");

  const stored = await q(
    `select kind, reason, boundstone_id, response from public.boundstone_push_ledger where artifact_id = $1`,
    [row.artifact_id],
  );
  assert.equal(stored[0].kind, "both");
  assert.equal(stored[0].reason, null);
  assert.equal(stored[0].boundstone_id, "55555555-5555-4555-8555-555555555555");
});

await check("⚠️ a ledgered artifact is never offered again — the cron depends on it", async () => {
  const due = await q(`select * from public.boundstone_push_due(500)`);
  assert.equal(due.length, 0, "the pushed artifact is still due; the hourly job would re-send it");
});

await check("a second ledger write is a reported no-op that does not rewrite the verdict", async () => {
  const rec = await q(`select public.boundstone_push_record($1::jsonb) r`, [
    JSON.stringify({ artifact_id: wiArtifact, kind: "skipped", reason: "no_honest_state" }),
  ]);
  assert.equal(rec[0].r.status, "already_ledgered");
  const stored = await q(`select kind, reason from public.boundstone_push_ledger where artifact_id = $1`, [
    wiArtifact,
  ]);
  assert.equal(stored[0].kind, "both", "the second call overwrote the first verdict");
  assert.equal(stored[0].reason, null);
  assert.equal(Number((await q(`select count(*) c from public.boundstone_push_ledger`))[0].c), 1);
});

await check("the DECLINED row is skipped WITH a reason, not silently dropped", async () => {
  // Resolve the Michigan City token so it becomes due, then let the lane refuse it.
  await q(`select public.gnews_resolve_record($1::text, $2::jsonb)`, [
    GN("T3"),
    JSON.stringify({
      publisher_url: "https://wsbt.com/news/michigan-city-council",
      publisher_domain: "wsbt.com",
      resolve_method: "batchexecute",
    }),
  ]);
  const due = await q(`select * from public.boundstone_push_due(500)`);
  assert.equal(due.length, 1);
  const d = decide(due[0], gaz, { httpStatus: 200 });
  assert.equal(d.send, false, "Michigan City was attributed to a state");
  assert.equal(d.reason, "no_honest_state");

  await q(`select public.boundstone_push_record($1::jsonb) r`, [
    JSON.stringify(ledgerRow(due[0].artifact_id, d, null)),
  ]);
  const stored = await q(
    `select kind, reason from public.boundstone_push_ledger where artifact_id = $1`,
    [due[0].artifact_id],
  );
  assert.equal(stored[0].kind, "skipped");
  assert.equal(stored[0].reason, "no_honest_state");
  assert.equal((await q(`select * from public.boundstone_push_due(500)`)).length, 0);
});

// ===========================================================================
// §6 guardrail 7 — article text cannot enter the ledger
// ===========================================================================
console.log("\n== §6 guardrail 7 ==");

const refuses = async (name, payload, matcher) =>
  check(name, async () => {
    let msg = "";
    try {
      await q(`select public.boundstone_push_record($1::jsonb)`, [JSON.stringify(payload)]);
    } catch (e) {
      msg = e.message;
    }
    assert.match(msg, matcher, msg ? `wrong error: ${msg}` : "it was ACCEPTED");
  });

const FRESH = "66666666-6666-4666-8666-666666666666";
await refuses(
  "an `extract` key is refused",
  { artifact_id: FRESH, kind: "press", response: { id: "x", extract: "the article said" } },
  /article-text or scoring key/,
);
await refuses(
  "a `summary` key is refused",
  { artifact_id: FRESH, kind: "press", response: { id: "x", summary: "a summary" } },
  /article-text or scoring key/,
);
await refuses(
  "a `signal_score` key is refused — this lane has no opinion to record",
  { artifact_id: FRESH, kind: "press", response: { id: "x", signal_score: 0.9 } },
  /article-text or scoring key/,
);
await refuses(
  "a 4 kB response is refused even with innocent keys",
  { artifact_id: FRESH, kind: "press", response: { id: "x", note: "a".repeat(4100) } },
  /article text/,
);
await refuses(
  "a skip with no reason is refused by the CHECK",
  { artifact_id: FRESH, kind: "skipped" },
  /boundstone_push_ledger_reason_ck|violates check constraint/,
);
await refuses(
  "an unknown kind is refused by the CHECK",
  { artifact_id: FRESH, kind: "published" },
  /boundstone_push_ledger_kind_ck|violates check constraint/,
);

await check("none of the six refusals left a row behind", async () => {
  const n = Number((await q(`select count(*) c from public.boundstone_push_ledger`))[0].c);
  assert.equal(n, 2, `expected the 2 real rows, found ${n}`);
  assert.equal(
    Number((await q(`select count(*) c from public.boundstone_push_ledger where artifact_id = $1`, [FRESH]))[0].c),
    0,
  );
});

// ===========================================================================
// §7 the surface
// ===========================================================================
console.log("\n== §7 the surface ==");

await check("anon and authenticated reach none of the three functions", async () => {
  for (const fn of [
    "public.boundstone_push_due(int)",
    "public.boundstone_push_record(jsonb)",
    "public.boundstone_push_measure()",
  ]) {
    for (const role of ["anon", "authenticated"]) {
      const r = await q(`select has_function_privilege($1, $2, 'EXECUTE') p`, [role, fn]);
      assert.equal(r[0].p, false, `${role} can execute ${fn}`);
    }
  }
});

await check("the ledger is unreadable by anon and authenticated, and has RLS on", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const r = await q(`select has_table_privilege($1, 'public.boundstone_push_ledger', $2) p`, [role, priv]);
      assert.equal(r[0].p, false, `${role} has ${priv} on the ledger`);
    }
  }
  const rls = await q(`select relrowsecurity r from pg_class where oid = 'public.boundstone_push_ledger'::regclass`);
  assert.equal(rls[0].r, true);
  const pol = await q(`select count(*) c from pg_policies where tablename = 'boundstone_push_ledger'`);
  assert.equal(Number(pol[0].c), 0, "a policy exists; RLS with no policy is the intended deny-all");
});

await check("boundstone_push_due and _measure are STABLE, so they cannot write", async () => {
  for (const fn of ["public.boundstone_push_due(int)", "public.boundstone_push_measure()"]) {
    const r = await q(`select provolatile v from pg_proc where oid = $1::regprocedure`, [fn]);
    assert.equal(r[0].v, "s", `${fn} is not STABLE`);
  }
});

await check("boundstone_push_measure reports honestly, including FDY-90's 0", async () => {
  const m = (await q(`select public.boundstone_push_measure() m`))[0].m;
  assert.equal(m.ledgered, 2);
  assert.equal(m.due_now, 0);
  assert.deepEqual(m.by_kind, { both: 1, skipped: 1 });
  assert.deepEqual(m.by_reason, { no_honest_state: 1 });
  // The one number that must never move off zero.
  assert.equal(Number(m.aggregator_urls_stored_as_publisher), 0);
});

// ===========================================================================
// §8 nothing touched the corpus
// ===========================================================================
console.log("\n== §8 public.artifacts ==");

await check("the row count did not move", async () => {
  assert.equal(Number((await q(`select count(*) c from public.artifacts`))[0].c), artifactCountBefore);
});

await check("⚠️ no column of any artifact changed, except crawl_metadata, which FDY-90 owns", async () => {
  const after = await snapshot();
  assert.deepEqual(Object.keys(after).sort(), Object.keys(artifactsBefore).sort());
  for (const tag of Object.keys(artifactsBefore)) {
    const b = artifactsBefore[tag], a = after[tag];
    for (const col of Object.keys(b)) {
      if (col === "crawl_metadata") continue; // FDY-90's six keys; not this lane's
      assert.deepEqual(a[col], b[col], `${tag}.${col} changed: ${JSON.stringify(b[col])} -> ${JSON.stringify(a[col])}`);
    }
    // And even inside crawl_metadata, only FDY-90's keys appear — nothing here
    // added one.
    const added = Object.keys(a.crawl_metadata).filter((k) => !(k in b.crawl_metadata));
    for (const k of added) {
      assert.ok(
        ["publisher_url", "publisher_domain", "resolve_method", "resolved_at", "resolve_attempts", "resolve_error"].includes(k),
        `${tag}.crawl_metadata gained ${k}, which is not one of FDY-90's six keys`,
      );
    }
  }
});

await check("raw_content is byte-identical everywhere — a press item is never an edit", async () => {
  for (const tag of Object.keys(artifactsBefore)) {
    const after = await snapshot();
    assert.equal(after[tag].raw_content, artifactsBefore[tag].raw_content, tag);
    assert.deepEqual(after[tag].signal_envelope, artifactsBefore[tag].signal_envelope, tag);
    assert.equal(after[tag].content_hash, artifactsBefore[tag].content_hash, tag);
  }
});

// ===========================================================================
// §9 the schedule migration
// ===========================================================================
console.log("\n== §9 the schedule migration ==");
await check("it is un-applied, hourly at :40, and carries no credential", () => {
  const sql = readFileSync(SCHEDULE, "utf8");
  assert.equal(sql.split("\n")[0], "-- UN-APPLIED — applied by Myke on merge");
  assert.match(sql, /cron\.schedule\('boundstone-local-push-hourly', '40 \* \* \* \*'/);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(sql), "a JWT literal is committed");
  // Not executed here: PGlite has no pg_cron. test/boundstone-local-push.test.mjs
  // §7 pins its text, and the migration's own $gate$ runs on apply.
});

console.log(
  `\n${process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"} — ${passed} checks\n` +
    "Nothing in this run touched a Supabase project, and nothing was pushed to Boundstone.",
);
await db.close();
