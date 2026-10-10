/**
 * boundstone-local-backfill — FDY-92.
 *
 * The one-off backfill that walks 2026-07-01 → today in weekly slices and
 * pushes the local-gov-watch backlog to Boundstone through FDY-91's bridge.
 *
 * NO NETWORK AND NO DATABASE. Every production number quoted here was measured
 * read-only against ycadmmngkdhvpcsrcuaq / fwnerwrtlgnchuprvfgl on 2026-10-09
 * and is recorded as a comment, not fetched.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE FOR
 * ---------------------------------------------------------------------------
 * Five claims in the PR body cannot be checked by reading code:
 *
 *  1. THE SLICES TILE THE WINDOW. §1 proves [since, until) is covered with no
 *     gap, no overlap, and every artifact in exactly one slice — including the
 *     awkward cases: a window shorter than a week, a window that is an exact
 *     multiple of a week, until <= since, and a --since before the 2026-07-01
 *     floor, which is CLAMPED rather than honoured because the floor is a
 *     decision and not a default.
 *
 *  2. IT REFUSES TO PUSH WITHOUT ITS DEPENDENCIES, AND TODAY IT MUST. §3 drives
 *     preflight() through every failure, and pins the live fact that makes the
 *     refusal real rather than theoretical: Boundstone's bs_press_propose does
 *     not exist yet (PR #63 un-merged), so --apply fails closed.
 *
 *  3. THE RATE LIMIT IS A MINIMUM INTERVAL, NOT AN AVERAGE. §4 drives the pacer
 *     with a fake clock and asserts no two calls are closer than 500 ms —
 *     stricter than "2 per second", which a token bucket satisfies while still
 *     firing two calls in the same millisecond.
 *
 *  4. A TRANSIENT REFUSAL IS NOT LEDGERED. §5 is the one behavioural difference
 *     from the hourly lane, and the ledger's primary key is why it matters: a
 *     row is forever, so `not_retrieved` must not become one.
 *
 *  5. NOTHING WAS RE-DECIDED. §6 and §7 assert the backfill imports FDY-91's
 *     attribution, headline, restriction and payload rules rather than carrying
 *     a second copy, that the two SQL selectors share one predicate clause for
 *     clause, and that bs_record_candidate_propose is never called.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  AMBIGUOUS_REASONS,
  BOUNDSTONE_RPS,
  DEFERRED_REASONS,
  WINDOW_START_ISO,
  classifyProbe,
  createPacer,
  mapRetrieval,
  newReport,
  outcomeForRefusal,
  parseArgs,
  parseWhen,
  preflight,
  recordDecision,
  renderReport,
  seedWeeks,
  sliceLabel,
  weeklySlices,
} from "../scripts/boundstone-local-backfill.ts";

import { buildGazetteer } from "../supabase/functions/boundstone-local-push/attribution-pure.ts";
import {
  decide,
  FN_FORBIDDEN_DIRECT_CANDIDATE,
  FN_PRESS_PROPOSE,
  LEDGER_REASONS,
  ledgerRow,
  proposePress,
} from "../supabase/functions/boundstone-local-push/push-pure.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const tsv = (rel) =>
  read(rel).split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#")).map((l) => l.split("\t"));

const SCRIPT = "scripts/boundstone-local-backfill.ts";
const BACKFILL_MIG = "supabase/migrations/20261010110000_boundstone_backfill_due.sql";
const LEDGER_MIG = "supabase/migrations/20261009230000_boundstone_push_ledger.sql";

// The same 293-row gazetteer slice FDY-91's test uses, so the two test files
// cannot disagree about what "Bullitt County" resolves to.
const gaz = buildGazetteer(
  tsv("test/fixtures/local-watch-jurisdictions.tsv").map(([name, state_abbr, level]) => ({
    name,
    state_abbr,
    level,
  })),
  tsv("test/fixtures/local-watch-states.tsv").map(([name, state_abbr]) => ({ name, state_abbr })),
);

/** A selector row, as public.boundstone_backfill_due returns one. */
const row = (over = {}) => ({
  artifact_id: "11111111-1111-4111-8111-111111111111",
  published_at: "2026-07-15T12:00:00.000Z",
  publisher_url: "https://www.example-news.com/story",
  publisher_domain: "www.example-news.com",
  rss_line1: "Carlton County passes one-year moratorium on creation of data centers - Example News",
  rss_publisher: "Example News",
  body_fetch_status: "ok",
  body_fetched_at: "2026-07-16T03:04:05.000Z",
  ...over,
});

/* =========================================================================
   §1 weekly slices
   ========================================================================= */

test("§1 slices tile [since, until) with no gap and no overlap", () => {
  const since = "2026-07-01T00:00:00.000Z";
  const until = "2026-10-09T00:00:00.000Z";
  const s = weeklySlices(since, until);
  assert.ok(s.length >= 14, `expected ~14 weekly slices, got ${s.length}`);
  assert.equal(s[0].start, since, "the first slice starts at `since`, not at a calendar Monday");
  assert.equal(s[s.length - 1].end, until, "the last slice is clipped to `until`");
  for (let i = 1; i < s.length; i += 1) {
    assert.equal(s[i].start, s[i - 1].end, `slice ${i} must start where slice ${i - 1} ended`);
    assert.equal(s[i].index, i);
  }
  // Oldest first (brief §2).
  for (let i = 1; i < s.length; i += 1) {
    assert.ok(Date.parse(s[i].start) > Date.parse(s[i - 1].start), "slices must be oldest first");
  }
  // Every slice but the last is exactly seven days.
  for (let i = 0; i < s.length - 1; i += 1) {
    assert.equal(Date.parse(s[i].end) - Date.parse(s[i].start), 7 * 86400000);
  }
});

test("§1 every timestamp in the window lands in exactly one slice", () => {
  const s = weeklySlices("2026-07-01T00:00:00.000Z", "2026-08-05T00:00:00.000Z");
  const probes = [
    "2026-07-01T00:00:00.000Z", // the very first instant
    "2026-07-07T23:59:59.999Z", // the last instant of slice 0
    "2026-07-08T00:00:00.000Z", // the first instant of slice 1 — the boundary
    "2026-08-04T23:59:59.999Z", // the last instant of the window
  ];
  for (const p of probes) {
    const hits = s.filter((x) => Date.parse(p) >= Date.parse(x.start) && Date.parse(p) < Date.parse(x.end));
    assert.equal(hits.length, 1, `${p} landed in ${hits.length} slices`);
    assert.equal(sliceLabel(s, p), hits[0].start.slice(0, 10));
  }
  // `until` itself is EXCLUSIVE, so it is in no slice. A half-open window is
  // what makes two consecutive runs not re-push the boundary row.
  assert.equal(sliceLabel(s, "2026-08-05T00:00:00.000Z"), "out-of-window");
});

test("§1 degenerate windows produce no slices rather than one bad one", () => {
  assert.deepEqual(weeklySlices("2026-07-08T00:00:00.000Z", "2026-07-01T00:00:00.000Z"), []);
  assert.deepEqual(weeklySlices("2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"), []);
  assert.deepEqual(weeklySlices("not a date", "2026-07-01T00:00:00.000Z"), []);
  // A window shorter than a slice is ONE slice, clipped — not zero, and not a
  // full week that reaches past `until`.
  const s = weeklySlices("2026-07-01T00:00:00.000Z", "2026-07-03T00:00:00.000Z");
  assert.equal(s.length, 1);
  assert.equal(s[0].end, "2026-07-03T00:00:00.000Z");
  // An exact multiple of seven days must not produce a trailing empty slice.
  const t = weeklySlices("2026-07-01T00:00:00.000Z", "2026-07-15T00:00:00.000Z");
  assert.equal(t.length, 2);
  assert.equal(t[1].end, "2026-07-15T00:00:00.000Z");
});

/* =========================================================================
   §2 arguments
   ========================================================================= */

test("§2 dry run is the default and --apply must be asked for", () => {
  const a = parseArgs([], "2026-10-09T00:00:00.000Z");
  assert.equal(a.apply, false);
  assert.equal(a.since, WINDOW_START_ISO);
  assert.equal(a.until, "2026-10-09T00:00:00.000Z");
  assert.equal(parseArgs(["--apply"], "2026-10-09T00:00:00.000Z").apply, true);
  assert.equal(parseArgs(["--dry-run"], "2026-10-09T00:00:00.000Z").apply, false);
});

test("§2 --apply and --dry-run together is an error, not a precedence puzzle", () => {
  const r = parseArgs(["--apply", "--dry-run"], "2026-10-09T00:00:00.000Z");
  assert.ok(r.error, "both flags must be refused");
  assert.match(r.error, /mutually exclusive/);
});

test("§2 a --since below the 2026-07-01 floor is clamped and says so", () => {
  const a = parseArgs(["--since", "2026-01-01"], "2026-10-09T00:00:00.000Z");
  assert.equal(a.since, WINDOW_START_ISO);
  assert.equal(a.sinceClamped, true, "the clamp must be reported, not silent");
  const b = parseArgs(["--since", "2026-09-01"], "2026-10-09T00:00:00.000Z");
  assert.equal(b.since, "2026-09-01T00:00:00.000Z");
  assert.equal(b.sinceClamped, false);
});

test("§2 a bare date is midnight UTC, never a local midnight", () => {
  assert.equal(parseWhen("2026-09-01"), "2026-09-01T00:00:00.000Z");
  assert.equal(parseWhen("2026-09-01T06:30:00Z"), "2026-09-01T06:30:00.000Z");
  assert.equal(parseWhen("tuesday"), null);
  assert.equal(parseWhen(""), null);
});

test("§2 bad numbers are refused rather than coerced", () => {
  for (const bad of [["--limit", "0"], ["--limit", "-3"], ["--limit", "ten"], ["--batch", "501"], ["--batch", "0"]]) {
    assert.ok(parseArgs(bad, "2026-10-09T00:00:00.000Z").error, `${bad.join(" ")} must be refused`);
  }
  assert.equal(parseArgs(["--limit", "50"], "2026-10-09T00:00:00.000Z").limit, 50);
  assert.ok(parseArgs(["--frobnicate"], "2026-10-09T00:00:00.000Z").error);
});

/* =========================================================================
   §3 the refusal (brief §5) — and why it fires today
   ========================================================================= */

test("§3 a dry run needs only the selector, and never touches Boundstone", () => {
  const ok = preflight({
    apply: false,
    credential: false,
    selectorExists: true,
    ledgerTableExists: false,
    probe: null,
  });
  assert.equal(ok.ok, true, "a dry run must not require a credential or a ledger table");
  assert.match(ok.detail, /Boundstone is not contacted/);
});

test("§3 without the selector even a dry run refuses", () => {
  const r = preflight({ apply: false, credential: true, selectorExists: false, ledgerTableExists: true, probe: "healthy" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "disabled");
  assert.match(r.detail, /20261010110000/);
});

test("§3 --apply refuses on each missing dependency, with the ledger's own vocabulary", () => {
  const base = { apply: true, credential: true, selectorExists: true, ledgerTableExists: true, probe: "healthy" };
  assert.equal(preflight(base).ok, true);

  const noLedger = preflight({ ...base, ledgerTableExists: false });
  assert.equal(noLedger.ok, false);
  assert.equal(noLedger.reason, "disabled");

  const noCred = preflight({ ...base, credential: false });
  assert.equal(noCred.ok, false);
  assert.equal(noCred.reason, "no_credential");

  const missing = preflight({ ...base, probe: "missing" });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /PR #63/);

  const forbidden = preflight({ ...base, probe: "forbidden" });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.reason, "no_credential");

  assert.equal(preflight({ ...base, probe: "unreachable" }).ok, false);
  assert.equal(preflight({ ...base, probe: null }).ok, false);

  // Every reason this script reports is a reason the ledger can also hold, so
  // an operator reading stderr and reading the ledger sees one vocabulary.
  for (const s of [noLedger, noCred, missing, forbidden]) {
    assert.ok(LEDGER_REASONS.includes(s.reason), `${s.reason} is not a ledger reason`);
  }
});

test("§3 --apply fails closed TODAY: bs_press_propose does not exist in Boundstone", () => {
  // Measured read-only on fwnerwrtlgnchuprvfgl, 2026-10-09 20:27 CT:
  //   to_regprocedure('public.bs_press_propose(jsonb)')            -> NULL
  //   to_regprocedure('public.bs_record_candidate_propose(jsonb)') -> exists
  //   pg_roles where rolname = 'boundstone_faraday_push'           -> 0 rows
  // Boundstone PR #63 carries the migration that creates both the function and
  // the role, and it is still open. So the probe PostgREST would return is
  // PGRST202, and the only correct behaviour is to refuse before reading an
  // artifact. This test is the live fact, pinned.
  assert.equal(classifyProbe({ status: 404, code: "PGRST202", message: "Could not find the function public.bs_press_propose(p) in the schema cache" }), "missing");
  const r = preflight({ apply: true, credential: true, selectorExists: true, ledgerTableExists: true, probe: "missing" });
  assert.equal(r.ok, false);
});

test("§3 the probe classifies a raise as healthy — it proves reachability and writes nothing", () => {
  // bs_press_propose has no dry_run key, so the probe sends {} and the function
  // raises on the first required key. A raise means: routed, executable, wrote
  // nothing. That is the health signal.
  assert.equal(classifyProbe({ status: 400, code: "P0001", message: "bs_press_propose: headline is required." }), "healthy");
  assert.equal(classifyProbe({ status: 400, code: "22023", message: "invalid argument" }), "healthy");
  assert.equal(classifyProbe({ status: 403, code: "42501", message: "permission denied for function bs_press_propose" }), "forbidden");
  assert.equal(classifyProbe({ status: 401, code: null, message: "JWT expired" }), "forbidden");
  assert.equal(classifyProbe({ status: 500, code: null, message: "" }), "unreachable");
  assert.equal(classifyProbe({ status: 0, code: null, message: "" }), "unreachable");
  assert.equal(classifyProbe({ status: 404, code: null, message: "Not Found" }), "missing");
});

/* =========================================================================
   §4 the rate limit (brief §4)
   ========================================================================= */

test("§4 no two Boundstone calls are closer than 500 ms", async () => {
  let t = 1_000_000;
  const slept = [];
  const clock = {
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  };
  const pacer = createPacer(BOUNDSTONE_RPS, clock);
  assert.equal(pacer.intervalMs, 500);

  const at = [];
  for (let i = 0; i < 6; i += 1) {
    await pacer.take();
    at.push(t);
  }
  // The first call is immediate; every later one is exactly 500 ms after its
  // predecessor. MINIMUM INTERVAL, not an average: a 2-token bucket would let
  // at[0] === at[1] and still call itself "2 per second".
  assert.equal(at[0], 1_000_000);
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] - at[i - 1] >= 500, `calls ${i - 1} and ${i} were ${at[i] - at[i - 1]} ms apart`);
  }
  // Six calls therefore take at least 2.5 s of wall clock, which is the point.
  assert.ok(at[5] - at[0] >= 2500, `six calls took ${at[5] - at[0]} ms`);
  assert.equal(slept.length, 5, "the first call must not sleep");
});

test("§4 a slow caller is never charged for time it already spent", async () => {
  // If the work between calls already took longer than the interval, take()
  // must return immediately rather than adding another 500 ms.
  let t = 0;
  const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  const pacer = createPacer(2, clock);
  await pacer.take();
  t += 5000; // a slow RPC
  const before = t;
  await pacer.take();
  assert.equal(t, before, "take() must not sleep when the interval has already elapsed");
});

/* =========================================================================
   §5 resume, and the deferral that is not a ledger row
   ========================================================================= */

test("§5 `not_retrieved` is DEFERRED, every other refusal is ledgered", () => {
  assert.deepEqual([...DEFERRED_REASONS], ["not_retrieved"]);
  assert.equal(outcomeForRefusal("not_retrieved"), "deferred");
  for (const r of LEDGER_REASONS) {
    if (r === "not_retrieved") continue;
    assert.equal(outcomeForRefusal(r), "skipped", `${r} must be ledgered, not deferred`);
  }
});

test("§5 retrieval evidence is transcribed from FDY-90, never stamped as now()", () => {
  const ok = mapRetrieval(row());
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.retrievedAt, "2026-07-16T03:04:05.000Z", "retrieved_at is body_fetched_at, verbatim");

  // Anything other than 'ok' is no proof at all — including a successful-looking
  // status with no timestamp, which would otherwise become now().
  for (const over of [
    { body_fetch_status: "failed" },
    { body_fetch_status: null },
    { body_fetch_status: "ok", body_fetched_at: null },
    { body_fetch_status: "ok", body_fetched_at: "" },
  ]) {
    const m = mapRetrieval(row(over));
    assert.equal(m.httpStatus, null, JSON.stringify(over));
    assert.equal(m.retrievedAt, null, JSON.stringify(over));
  }
});

test("§5 a row with no successful body fetch is refused `not_retrieved` and deferred", () => {
  const r = row({ body_fetch_status: "failed" });
  const { httpStatus, retrievedAt } = mapRetrieval(r);
  const d = decide(r, gaz, { httpStatus, retrievedAt });
  assert.equal(d.send, false);
  assert.equal(d.reason, "not_retrieved");
  assert.equal(outcomeForRefusal(d.reason), "deferred");
  // ⚠️ THE POINT: ledgerRow() would happily produce a row for it. The script's
  // job is not to call ledgerRow at all in this case, because the ledger's
  // primary key makes the row permanent and this fact is not.
  const would = ledgerRow(r.artifact_id, d, null);
  assert.equal(would.kind, "skipped");
  assert.equal(would.reason, "not_retrieved");
});

test("§5 a push the ledger has already recorded is not re-offered — the predicate says so", () => {
  // The resume guarantee is a SQL clause, not script state, so it is asserted
  // against the migration text. scripts/boundstone-local-backfill-pglite.mjs
  // proves it by running it.
  const mig = read(BACKFILL_MIG);
  assert.match(
    mig,
    /not exists\s*\(\s*select 1 from public\.boundstone_push_ledger l where l\.artifact_id = a\.artifact_id\s*\)/,
    "the selector must exclude anything already in the ledger",
  );
  // And the cursor is a keyset, not an OFFSET — OFFSET skips rows as ledgered
  // rows drop out from under a running apply.
  assert.match(mig, /\(a\.published_at, a\.artifact_id\) > \(p_after_published,/);
  assert.ok(!/\boffset\b/i.test(mig.replace(/--.*$/gm, "")), "no OFFSET paging in the selector");
});

test("§5 a duplicate reply is a success, not a failure to retry", async () => {
  const r = row();
  const d = decide(r, gaz, mapRetrieval(r));
  assert.equal(d.send, true);
  const client = {
    calls: [],
    async rpc(fn, args) {
      this.calls.push([fn, args]);
      return { data: { id: "aaaaaaaa-0000-4000-8000-000000000001", status: "duplicate" }, error: null };
    },
  };
  const res = await proposePress(client, d.payload);
  assert.equal(res.ok, true, "`duplicate` is the no-op the unique index guarantees");
  assert.equal(res.status, "duplicate");
  // Ledgered as the kind it WOULD have been, with the id of the row that exists.
  const lr = ledgerRow(r.artifact_id, d, res);
  assert.notEqual(lr.kind, "skipped");
  assert.equal(lr.boundstone_id, "aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(client.calls.length, 1, "one call per article");
  assert.equal(client.calls[0][0], FN_PRESS_PROPOSE);
});

/* =========================================================================
   §6 the report
   ========================================================================= */

test("§6 the report counts press items, candidates, refusals and deferrals separately", () => {
  const slices = weeklySlices("2026-07-01T00:00:00.000Z", "2026-07-22T00:00:00.000Z");
  const rep = newReport("dry-run", "2026-07-01T00:00:00.000Z", "2026-07-22T00:00:00.000Z", "2026-10-09T00:00:00.000Z");
  rep.slices = slices.length;
  seedWeeks(rep, slices);

  // A restriction-shaped, attributable row → press item AND candidate.
  const a = row();
  const da = decide(a, gaz, mapRetrieval(a));
  assert.equal(da.send, true);
  assert.equal(da.payload.propose_candidate, true, "a moratorium + county headline is restriction-shaped");
  recordDecision(rep, sliceLabel(slices, a.published_at), da, "pushed");

  // An attributable row that is NOT restriction-shaped → press item only.
  const b = row({
    artifact_id: "22222222-2222-4222-8222-222222222222",
    published_at: "2026-07-09T00:00:00.000Z",
    rss_line1: "Carlton County residents attend a data center open house - Example News",
  });
  const db = decide(b, gaz, mapRetrieval(b));
  assert.equal(db.send, true);
  assert.equal(db.payload.propose_candidate, false);
  recordDecision(rep, sliceLabel(slices, b.published_at), db, "pushed");

  // A refusal, and a deferral.
  const c = row({ artifact_id: "33333333-3333-4333-8333-333333333333", rss_line1: "Data center plans advance - Example News" });
  const dc = decide(c, gaz, mapRetrieval(c));
  assert.equal(dc.send, false);
  recordDecision(rep, sliceLabel(slices, c.published_at), dc, outcomeForRefusal(dc.reason));

  const e = row({ artifact_id: "44444444-4444-4444-8444-444444444444", body_fetch_status: "failed" });
  const de = decide(e, gaz, mapRetrieval(e));
  recordDecision(rep, sliceLabel(slices, e.published_at), de, outcomeForRefusal(de.reason));

  assert.equal(rep.totals.considered, 4);
  assert.equal(rep.totals.press_items, 2);
  assert.equal(rep.totals.record_candidates, 1);
  assert.equal(rep.totals.skipped, 1);
  assert.equal(rep.totals.deferred, 1, "the deferral is counted but is not a skip");
  assert.equal(rep.by_state.MN.press, 2);
  assert.equal(rep.by_state.MN.candidates, 1);
  assert.equal(rep.by_week["2026-07-15"].press, 1);
  assert.equal(rep.by_week["2026-07-08"].press, 1);
  assert.equal(rep.by_week["2026-07-15"].deferred, 1);
  // A week in which nothing happened is a LINE OF ZEROES, not a missing row.
  assert.deepEqual(rep.by_week["2026-07-01"], { considered: 0, press: 0, candidates: 0, declined: 0, deferred: 0 });
  assert.equal(rep.by_reason.not_retrieved, 1);

  // ⚠️ REFUSALS ARE A COLUMN, NOT A FOOTNOTE. 4,650 of 6,157 rows are refused
  // on purpose (FDY-91, measured 2026-10-08); a report that printed only the
  // 1,507 would read as a bug.
  const text = renderReport(rep);
  assert.match(text, /REFUSED \(ledgered with a reason\)/);
  assert.match(text, /DEFERRED \(not ledgered\)/);
  assert.match(text, /== by state \(1\) ==/);
  assert.match(text, /== by week \(slice start, 3\) ==/);
  assert.match(text, /awaiting publisher_url/, "the brief's no-publisher_url count must appear");
  assert.match(text, /NOTHING WAS WRITTEN/);
  // A dry run must not print apply-only lines that would read as having pushed.
  assert.ok(!/ledger rows written/.test(text));
});

test("§6 the ambiguous reasons the report separates are the ones attribution emits", () => {
  for (const r of AMBIGUOUS_REASONS) {
    assert.ok(LEDGER_REASONS.includes(r), `${r} is not a ledger reason`);
  }
  assert.deepEqual([...AMBIGUOUS_REASONS].sort(), ["ambiguous_jurisdiction", "ambiguous_state_named"]);
});

test("§6 the two SQL selectors share one predicate, clause for clause", () => {
  const mine = read(BACKFILL_MIG);
  const theirs = read(LEDGER_MIG);
  // The same fragments gate G2 checks inside the database at apply time. Here
  // they are checked in CI, where nobody has a database.
  const clauses = [
    "s.source_key like 'gsearch:loc-%'",
    "a.crawl_metadata->>'publisher_url' is not null",
    "a.raw_content ~* 'data ?cent'",
    "a.published_at >= timestamptz '2026-07-01 00:00:00+00'",
    "btrim(split_part(a.raw_content, E'\\n', 1))",
    "btrim(reverse(split_part(reverse(a.raw_content), reverse('&nbsp;&nbsp;'), 1)))",
  ];
  for (const c of clauses) {
    assert.ok(mine.includes(c), `20261010110000 lost the clause: ${c}`);
    assert.ok(theirs.includes(c), `20261009230000 no longer has the clause: ${c}`);
  }
  // Neither selector may return the article body.
  assert.ok(!/returns table \([^)]*raw_content/is.test(mine), "the selector must not return raw_content");
  assert.match(mine, /body_fetch_status text/, "it must return FDY-90's retrieval evidence");
  assert.match(mine, /body_fetched_at   timestamptz|body_fetched_at\s+timestamptz/);
});

test("§6 the migration is un-applied, uniquely versioned, and gated", () => {
  const mig = read(BACKFILL_MIG);
  assert.match(mig.split("\n")[0], /^-- UN-APPLIED — applied by Myke on merge$/);
  assert.match(mig, /do \$ordering\$/, "it must refuse without FDY-91's objects rather than half-apply");
  assert.match(mig, /do \$gate\$/, "it must prove its own claims at apply time");
  assert.match(mig, /create or replace function public\.boundstone_backfill_due/);
  assert.match(mig, /^\s*stable$/m, "a selector that is not STABLE could write");
  assert.match(mig, /grant execute on function public\.boundstone_backfill_due/);
  assert.match(mig, /revoke all on function public\.boundstone_backfill_due/);
  // It must contain no DML at all. Comments are stripped first so the prose may
  // discuss inserts without failing the test.
  const code = mig.replace(/--.*$/gm, "");
  for (const dml of [/\binsert\s+into\b/i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i, /\btruncate\b/i]) {
    assert.ok(!dml.test(code), `the migration must contain no DML: ${dml}`);
  }
});

/* =========================================================================
   §7 nothing was re-decided, and the forbidden call is absent
   ========================================================================= */

test("§7 the backfill imports FDY-91's rules instead of carrying a second copy", () => {
  const src = read(SCRIPT);
  assert.match(src, /from "\.\.\/supabase\/functions\/boundstone-local-push\/attribution-pure\.ts"/);
  assert.match(src, /from "\.\.\/supabase\/functions\/boundstone-local-push\/push-pure\.ts"/);
  // The four things a second copy would show up as. Each of these identifiers
  // exists exactly once in FDY-91's modules and must not be redefined here.
  for (const forbidden of [
    /function attributeHeadline/,
    /function extractPhrases/,
    /function restrictionKeywords/,
    /function buildPressPayload/,
    /RESTRICTION_PATTERNS\s*=/,
    /LOCAL_GOVERNMENT_NOUN\s*=/,
    /PAYLOAD_KEYS\s*=/,
    /moratori/,
    /gsearch:loc-/,
  ]) {
    assert.ok(!forbidden.test(src), `${forbidden} is re-declared in the backfill script`);
  }
  // And it never passes the feed to the attribution: `decide` takes a row and a
  // gazetteer, and that is the only verdict in the file.
  assert.match(src, /decide\(row, gaz, \{ httpStatus, retrievedAt \}\)/);
});

test("§7 bs_record_candidate_propose is never called", () => {
  const src = read(SCRIPT);
  // The name appears only inside comments explaining why it is not called.
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !code.includes(FN_FORBIDDEN_DIRECT_CANDIDATE),
    `${FN_FORBIDDEN_DIRECT_CANDIDATE} appears in executable code`,
  );
  assert.ok(!code.includes("FN_FORBIDDEN_DIRECT_CANDIDATE"), "the forbidden constant is not even imported");
  assert.ok(!/sha256|createHash|md5/.test(code), "no candidate hash is computed here; FDY-77 owns that key");
  // One push function, named once, imported from push-pure.
  assert.match(src, /FN_PRESS_PROPOSE/);
  assert.equal(FN_PRESS_PROPOSE, "bs_press_propose");
});

test("§7 the script cannot express a table write against Boundstone", () => {
  const src = read(SCRIPT);
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The Boundstone client is an object with `rpc` and nothing else — guardrail 4
  // as a type. If a `from` ever appears on it, this goes red.
  assert.match(code, /function boundstoneClient\(jwt: string\): RpcClientLike/);
  const client = code.slice(code.indexOf("function boundstoneClient"), code.indexOf("async function probeBoundstone"));
  assert.ok(!/\bfrom\s*\(/.test(client), "the Boundstone client must have no `from`");
  // Only ever POSTs to /rest/v1/rpc/ on the Boundstone host.
  for (const m of code.matchAll(/\$\{BOUNDSTONE_URL\}([^`]*)`/g)) {
    assert.match(m[1], /^\/rest\/v1\/rpc\//, `Boundstone was reached at ${m[1]}`);
  }
});

test("§7 the secret is never printed and the script never writes a file", () => {
  const src = read(SCRIPT);
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The JWT is read into a local and handed to the client. It is never
  // interpolated into stdout, stderr, the report or a ledger row.
  assert.ok(!/write\([^)]*jwt/i.test(code), "the JWT must never reach a write()");
  assert.ok(!/console\.log/.test(code), "use process.stdout so a secret cannot be console-dumped by habit");
  assert.ok(!/writeFileSync|mkdirSync|appendFileSync/.test(code), "a one-off report goes to stdout, not to disk");
  // Guardrail 2: the only env var that can turn on a write is the explicit one.
  assert.match(code, /BOUNDSTONE_BACKFILL_CONFIRM !== "1"/);
});

test("§7 the window floor is the same literal in the script and in the SQL", () => {
  assert.equal(WINDOW_START_ISO, "2026-07-01T00:00:00.000Z");
  const mig = read(BACKFILL_MIG);
  assert.ok(mig.includes("timestamptz '2026-07-01 00:00:00+00'"));
  // p_since may narrow but never widen; the SQL applies BOTH floors.
  assert.match(mig, /and a\.published_at >= timestamptz '2026-07-01 00:00:00\+00'\s*\n\s*and a\.published_at >= coalesce\(p_since/);
});
