// FDY-89 — unit tests for the source-poller's fair due-selection
// (supabase/functions/source-poller/poller-schedule.ts) and a drift guard that
// ties the module's constants to migration 20261009210000's SQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CADENCE_MINUTES,
  cadenceMinutes,
  dueAtMs,
  hostDelayMs,
  hostOf,
  isDueRow,
  MIN_HOST_GAP_MS,
  NEVER_FETCHED_RATIO,
  overdueRatio,
  SEGMENT_FLOORS,
  segmentOf,
  selectDueFair,
} from "../supabase/functions/source-poller/poller-schedule.ts";
import { isDue } from "../supabase/functions/source-poller/poller-relevance.ts";

const MIGRATION = fileURLToPath(
  new URL("../supabase/migrations/20261009210000_poller_fair_scheduling.sql", import.meta.url),
);

const NOW = Date.parse("2026-10-07T20:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

function row(key, cadence, lastFetchAt, segment, createdAt = "2026-07-18T00:00:00Z") {
  return { source_key: key, cadence, last_fetch_at: lastFetchAt, segment, created_at: createdAt };
}

// ---------------------------------------------------------------- due_at / ratio

test("dueAtMs = last_fetch_at + interval(cadence); null when never fetched", () => {
  assert.equal(dueAtMs("weekly", null), null);
  assert.equal(dueAtMs("weekly", "not a date"), null);
  assert.equal(
    dueAtMs("daily", "2026-10-07T00:00:00Z"),
    Date.parse("2026-10-07T00:00:00Z") + 20 * 3600_000,
  );
  // unknown cadence falls back to daily, never to "skip"
  assert.equal(cadenceMinutes("made-up"), CADENCE_MINUTES.daily);
  assert.equal(cadenceMinutes(null), CADENCE_MINUTES.daily);
});

test("overdueRatio is cadence-relative, and never-fetched is the most overdue", () => {
  // weekly interval is 6.5 days; 38 days stale => (38 - 6.5)/6.5 = 4.846x late
  assert.equal(Math.round(overdueRatio("weekly", daysAgo(38), NOW) * 1000) / 1000, 4.846);
  // daily interval is 20h; 21h stale => 0.05x late
  assert.equal(Math.round(overdueRatio("daily", hoursAgo(21), NOW) * 1000) / 1000, 0.05);
  // not yet due is negative
  assert.ok(overdueRatio("daily", hoursAgo(3), NOW) < 0);
  assert.equal(overdueRatio("weekly", null, NOW), NEVER_FETCHED_RATIO);

  // THE BUG, stated as a test: absolute staleness ranks these the wrong way
  // round. 21h > wall-clock is not the question; cadence-relative lateness is.
  const dailyRow = row("d", "daily", hoursAgo(21), "dc_operators");
  const weeklyRow = row("w", "weekly", daysAgo(38), "local_gov");
  assert.ok(
    Date.parse(weeklyRow.last_fetch_at) < Date.parse(dailyRow.last_fetch_at),
    "the weekly row IS absolutely staler",
  );
  assert.ok(
    overdueRatio(weeklyRow.cadence, weeklyRow.last_fetch_at, NOW) >
      overdueRatio(dailyRow.cadence, dailyRow.last_fetch_at, NOW),
    "and it is also relatively later — so it must now outrank the daily row",
  );
});

test("isDueRow agrees with isDue() exactly (one cadence table, two call sites)", () => {
  for (const cadence of [...Object.keys(CADENCE_MINUTES), "unknown-cadence"]) {
    for (const h of [0, 0.5, 1, 20, 24, 24 * 7, 24 * 30, 24 * 400]) {
      const lf = hoursAgo(h);
      assert.equal(
        isDueRow(row("k", cadence, lf, null), NOW),
        isDue(cadence, lf, NOW),
        `${cadence} @ ${h}h`,
      );
    }
    assert.equal(isDueRow(row("k", cadence, null, null), NOW), isDue(cadence, null, NOW));
  }
});

test("segmentOf mirrors coalesce(fetch_config->>'segment','(none)')", () => {
  assert.equal(segmentOf(row("a", "daily", null, "local_gov")), "local_gov");
  assert.equal(segmentOf(row("a", "daily", null, null)), "(none)");
  assert.equal(segmentOf(row("a", "daily", null, undefined)), "(none)");
  assert.equal(segmentOf(row("a", "daily", null, "")), "(none)");
});

// ---------------------------------------------------------------- selection

test("selectDueFair ranks by overdue ratio and drops rows that are not due", () => {
  const rows = [
    row("a", "daily", hoursAgo(3), "dc_operators"), // not due
    row("b", "daily", hoursAgo(21), "dc_operators"), // 0.05x
    row("c", "weekly", daysAgo(10), "utilities"), // 0.54x
    row("d", "weekly", daysAgo(38), "utilities"), // 4.85x
    row("e", "hourly", hoursAgo(10), "(none)"), // 11x
  ];
  const { picked, dueTotal } = selectDueFair(rows, { limit: 10, nowMs: NOW, floors: {} });
  assert.equal(dueTotal, 4);
  assert.deepEqual(picked.map((r) => r.source_key), ["e", "d", "c", "b"]);
});

test("never-fetched rows lead, FIFO by created_at then source_key", () => {
  const rows = [
    row("z-new", "weekly", null, "utilities", "2026-09-01T00:00:00Z"),
    row("a-old", "weekly", null, "utilities", "2026-07-18T00:00:00Z"),
    row("m-old", "weekly", null, "utilities", "2026-07-18T00:00:00Z"),
    row("hot", "hourly", hoursAgo(500), "(none)"),
  ];
  const { picked } = selectDueFair(rows, { limit: 4, nowMs: NOW, floors: {} });
  assert.deepEqual(picked.map((r) => r.source_key), ["a-old", "m-old", "z-new", "hot"]);
});

test("local_gov holds a 25% floor of every run — the starvation fix", () => {
  // 500 daily rows all mildly overdue, 1000 local_gov rows all heavily overdue
  // but ranked below nothing: with the OLD absolute ordering the daily cohort
  // took everything, so this is the regression that must never come back.
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push(row(`dc-${i}`, "daily", hoursAgo(21), "dc_operators"));
  for (let i = 0; i < 1000; i++) rows.push(row(`loc-${i}`, "weekly", daysAgo(8), "local_gov"));

  const { picked, floorFilled } = selectDueFair(rows, { limit: 80, nowMs: NOW });
  assert.equal(picked.length, 80);
  assert.equal(floorFilled.local_gov, 20, "ceil(80 * 0.25)");
  const loc = picked.filter((r) => r.segment === "local_gov").length;
  assert.ok(loc >= 20, `local_gov got ${loc} of 80, floor is 20`);
});

test("the floor is a floor, not a cap: local_gov can win ordinary slots too", () => {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(row(`dc-${i}`, "daily", hoursAgo(21), "dc_operators"));
  for (let i = 0; i < 100; i++) rows.push(row(`loc-${i}`, "weekly", daysAgo(38), "local_gov"));
  const { picked, floorFilled, lanes } = selectDueFair(rows, { limit: 80, nowMs: NOW });
  const loc = picked.filter((r) => r.segment === "local_gov");
  // 100 local_gov rows at 4.85x outrank 40 daily rows at 0.05x, so local_gov
  // takes all 80: 20 via the floor and 60 on merit through the general lane.
  assert.equal(loc.length, 80);
  assert.equal(floorFilled.local_gov, 20);
  assert.equal(loc.filter((r) => lanes[r.source_key] === "overdue_rank").length, 60);
  assert.equal(picked.filter((r) => r.segment === "dc_operators").length, 0,
    "a mildly-overdue cohort does not get a floor just for being large");
});

test("unused floor spills to other segments", () => {
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push(row(`u-${i}`, "weekly", daysAgo(38), "utilities"));
  for (let i = 0; i < 5; i++) rows.push(row(`loc-${i}`, "weekly", daysAgo(8), "local_gov"));
  const { picked, floorFilled } = selectDueFair(rows, { limit: 80, nowMs: NOW });
  assert.equal(picked.length, 80, "all 80 slots filled — 15 of the 20 reserved spilled");
  assert.equal(floorFilled.local_gov, 5, "only 5 local_gov rows exist to claim the floor");
  assert.equal(picked.filter((r) => r.segment === "utilities").length, 75);
});

test("no due rows, limit 0, and empty input are all safe", () => {
  assert.deepEqual(selectDueFair([], { limit: 80, nowMs: NOW }).picked, []);
  assert.deepEqual(
    selectDueFair([row("a", "daily", hoursAgo(1), "x")], { limit: 80, nowMs: NOW }).picked,
    [],
  );
  assert.deepEqual(
    selectDueFair([row("a", "daily", null, "x")], { limit: 0, nowMs: NOW }).picked,
    [],
  );
});

test("selection is deterministic for a fixed (rows, limit, now)", () => {
  const rows = [];
  for (let i = 0; i < 300; i++) {
    rows.push(row(`k-${i}`, i % 3 === 0 ? "daily" : "weekly", daysAgo(1 + (i % 40)), `seg-${i % 7}`));
  }
  const a = selectDueFair(rows, { limit: 80, nowMs: NOW }).picked.map((r) => r.source_key);
  const b = selectDueFair(rows.slice().reverse(), { limit: 80, nowMs: NOW }).picked.map((r) => r.source_key);
  assert.deepEqual(a, b, "input order must not change the outcome");
});

test("every picked row carries a lane, and lanes are only the two we document", () => {
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(row(`u-${i}`, "weekly", daysAgo(38), "utilities"));
  for (let i = 0; i < 200; i++) rows.push(row(`loc-${i}`, "weekly", daysAgo(7), "local_gov"));
  const { picked, lanes } = selectDueFair(rows, { limit: 80, nowMs: NOW });
  for (const r of picked) {
    assert.ok(["floor:local_gov", "overdue_rank"].includes(lanes[r.source_key]), lanes[r.source_key]);
  }
});

// ---------------------------------------------------------------- politeness

test("hostDelayMs enforces at most 1 request/second per host", () => {
  const seen = new Map();
  assert.equal(MIN_HOST_GAP_MS, 1000);
  assert.equal(hostOf("https://news.google.com/rss/search?q=x"), "news.google.com");
  assert.equal(hostOf("HTTPS://News.Google.COM/rss"), "news.google.com");
  assert.equal(hostOf("not a url"), "");

  assert.equal(hostDelayMs(seen, "news.google.com", 1_000_000), 0, "first hit is free");
  seen.set("news.google.com", 1_000_000);
  assert.equal(hostDelayMs(seen, "news.google.com", 1_000_000), 1000);
  assert.equal(hostDelayMs(seen, "news.google.com", 1_000_400), 600);
  assert.equal(hostDelayMs(seen, "news.google.com", 1_001_000), 0);
  assert.equal(hostDelayMs(seen, "news.google.com", 1_009_000), 0, "never negative");
  assert.equal(hostDelayMs(seen, "www.cobbcounty.org", 1_000_000), 0, "a different host is unaffected");
});

test("every gsearch row is the same host, so the gate paces the whole query lane", () => {
  const seen = new Map();
  const urls = [
    "https://news.google.com/rss/search?q=%22Cobb+County%22",
    "https://news.google.com/rss/search?q=%22Fulton+County%22",
    "https://news.google.com/rss/search?q=%22DeKalb+County%22",
  ];
  let t = 0;
  for (const u of urls) {
    t += hostDelayMs(seen, hostOf(u), t);
    seen.set(hostOf(u), t);
  }
  assert.equal(t, 2000, "3 requests to one host take at least 2s of spacing");
});

// ---------------------------------------------------------------- drift guard

test("migration 20261009210000 mirrors the module's constants exactly", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  assert.match(sql, /^-- UN-APPLIED — applied by Myke on merge/, "guardrail 2 header");
  assert.match(sql, /create or replace function public\.poller_select_due\(p_limit integer default 80\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /create or replace view public\.v_poller_lag_by_segment/);

  // poller_cadence_interval must list the same minutes as CADENCE_MINUTES.
  const body = sql.slice(sql.indexOf("poller_cadence_interval(p_cadence text)"));
  const arms = [...body.matchAll(/when '([a-z_]+)'\s+then interval '(\d+) minutes'/g)];
  const fromSql = Object.fromEntries(arms.map(([, k, v]) => [k, Number(v)]));
  assert.deepEqual(fromSql, CADENCE_MINUTES, "SQL cadence table drifted from CADENCE_MINUTES");

  // the else arm must equal the documented default (daily)
  const elseArm = body.match(/else\s+interval '(\d+) minutes'/);
  assert.ok(elseArm, "no else arm");
  assert.equal(Number(elseArm[1]), CADENCE_MINUTES.daily, "unknown cadence must mean daily");

  // the local_gov floor must equal SEGMENT_FLOORS.local_gov
  const floor = sql.match(/([\d.]+)::numeric\s+as local_gov_floor/);
  assert.ok(floor, "no local_gov_floor in the SQL");
  assert.equal(Number(floor[1]), SEGMENT_FLOORS.local_gov);

  // the never-fetched sentinel must equal NEVER_FETCHED_RATIO
  const sentinel = sql.match(/when r\.last_fetch_at is null then (\d+)::numeric/);
  assert.ok(sentinel, "no never-fetched sentinel in the SQL");
  assert.equal(Number(sentinel[1]), NEVER_FETCHED_RATIO);

  // the SQL tie-break must match compareDecorated's
  assert.match(sql, /order by d\.overdue_ratio desc,\s*\n\s*coalesce\(d\.created_at, '-infinity'::timestamptz\),\s*\n\s*d\.source_key;/);

  // read-only: the migration must not write to source_registry
  assert.ok(!/\b(insert into|update\s+public\.source_registry|delete from)\b/i.test(sql),
    "migration must not contain DML");
});

// ---------------------------------------------------------------- wiring guard

test("the run lane uses the fair selector and no longer orders by absolute staleness", () => {
  const INDEX = fileURLToPath(
    new URL("../supabase/functions/source-poller/index.ts", import.meta.url),
  );
  const src = readFileSync(INDEX, "utf8");

  // Primary path is the SQL selector; the fallback is the same spec in TS.
  assert.match(src, /supabase\.rpc\(SELECT_DUE_RPC, \{ p_limit: limit \}\)/);
  assert.match(src, /const SELECT_DUE_RPC = "poller_select_due";/);
  assert.match(src, /selectDueFair\(candidates\.map\(toDueRow\), \{ limit, nowMs: Date\.now\(\) \}\)/);

  // The two shapes that produced the starvation must be gone: the run lane must
  // not re-filter with isDue() and must not slice an ordered window to `limit`.
  assert.ok(!/\.filter\(\(s\) => isDue\(/.test(src), "run lane still filters with isDue()");
  assert.ok(!/\.slice\(0, limit\)/.test(src), "run lane still slices an ordered window");
  assert.ok(!/PRIORITY_CADENCES/.test(src), "v1.6's priority-pool concatenation is still present");

  // Politeness is wired into the single fetch helper, not sprinkled per caller.
  assert.match(src, /async function fetchWithTimeout[\s\S]{0,200}await politeWait\(url\);/);

  // The v1.4-v1.8 production fixes this branch reconciled must all be present,
  // so merging cannot regress them on the next deploy.
  for (const marker of [
    "isTransientStatus",
    "src.scope === \"query_feed\" && src.feed_url",
    "publisher_home",
    "src.scope !== \"query_feed\") continue",
    "transient ? src.consecutive_failures : src.consecutive_failures + 1",
  ]) {
    assert.ok(src.includes(marker), `deployed fix missing from the repo: ${marker}`);
  }
});
