// FDY-89 — deterministic simulation of the source-poller run lane.
//
// 10,400 synthetic sources carrying today's measured segment/cadence mix and
// today's measured lag distribution, polled at `limit` rows/hour for 14
// simulated days. No network, no database, no clock: every number below is a
// pure function of the fixture, so this test either passes identically on every
// machine or the scheduler changed.
//
// What it proves:
//   1. The OLD selection (priority-cadence pool concatenated ahead of the
//      general pool, ordered by absolute last_fetch_at) starves local_gov to
//      ~0% of slots. This is the regression guard.
//   2. The NEW selection (overdue-ratio ranking + a 25% local_gov floor) polls
//      every weekly local_gov source within 7 days at today's 80/hour.
//   3. At 80/hour the FLEET as a whole still cannot hold 2x cadence, because
//      total demand is ~1.64x capacity. The test solves for the minimum hourly
//      limit at which "no segment's oldest fetch exceeds 2x its cadence after
//      14 days" holds, and pins that number so the PR's "Needs Myke" figure
//      cannot drift.
//
// MIX measured read-only on project ycadmmngkdhvpcsrcuaq at 2026-10-07 14:40 CT
// over source_registry WHERE subsystem='poller' AND status='active' AND
// feed_url IS NOT NULL (10,339 rows; the orchestrator's 10,439 figure counts all
// active rows across every subsystem).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cadenceMinutes,
  isDueRow,
  overdueRatio,
  segmentOf,
  selectDueFair,
} from "../supabase/functions/source-poller/poller-schedule.ts";

/** [segment, cadence, live_total, live_never_fetched, avg_age_in_cadences, max_age_in_cadences] */
const LIVE_MIX = [
  ["utilities", "weekly", 2895, 927, 2.55, 5.85],
  ["public_companies", "weekly", 1127, 7, 5.34, 5.85],
  ["supply_chain", "weekly", 1103, 36, 5.19, 5.86],
  ["startups", "weekly", 1039, 4, 5.33, 5.84],
  ["local_gov", "weekly", 1000, 134, 4.73, 5.84],
  ["intl_gov", "weekly", 666, 18, 5.04, 5.86],
  ["dc_operators", "daily", 641, 0, 0.81, 1.19],
  ["industry_orgs", "weekly", 550, 20, 5.65, 5.86],
  ["(none)", "daily", 508, 0, 0.45, 0.99],
  ["investors", "weekly", 398, 0, 5.43, 5.86],
  ["state_gov", "weekly", 208, 0, 5.3, 5.69],
  ["hyperscalers", "daily", 111, 0, 0.53, 1.19],
  ["federal_gov", "daily", 45, 0, 0.29, 1.19],
  ["hyperscalers", "weekly", 29, 1, 5.82, 5.84],
  ["dc_operators", "weekly", 12, 0, 5.38, 5.84],
  ["(none)", "hourly", 7, 0, 10.03, 16.4],
];
const LIVE_TOTAL = LIVE_MIX.reduce((a, m) => a + m[2], 0); // 10339
const TARGET = 10_400; // the issue's simulation size
const T0 = Date.parse("2026-10-07T20:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Build the fleet. Deterministic: ages are placed on a fixed ramp capped at the
 * segment's measured oldest row, which reproduces both the measured mean and the
 * pile-up at the wall (e.g. public_companies, where 1,120 of 1,127 rows sit at
 * >2x and the oldest is 38 days). No PRNG — nothing to seed, nothing to drift. */
function buildFleet() {
  const rows = [];
  // Scale the live mix to exactly TARGET, putting the rounding remainder on the
  // largest group so the total is exact.
  const scaled = LIVE_MIX.map((m) => Math.round((m[2] * TARGET) / LIVE_TOTAL));
  const drift = TARGET - scaled.reduce((a, b) => a + b, 0);
  scaled[0] += drift;

  LIVE_MIX.forEach(([segment, cadence, , liveNever, avgAge, maxAge], gi) => {
    const n = scaled[gi];
    const never = Math.min(n, Math.round((liveNever * TARGET) / LIVE_TOTAL));
    const intervalMs = cadenceMinutes(cadence) * 60_000;
    for (let i = 0; i < n; i++) {
      const key = `gsearch:${segment}-${cadence}-${String(i).padStart(5, "0")}`;
      // created_at: one stable timestamp per group, mirroring the 2026-07-18
      // source-expansion seed, so the never-fetched FIFO tie-break is defined.
      const created_at = new Date(Date.parse("2026-07-18T00:00:00Z") + gi * 60_000).toISOString();
      if (i < never) {
        rows.push({ source_key: key, cadence, last_fetch_at: null, segment, created_at });
        continue;
      }
      const spread = n - never;
      const frac = spread <= 1 ? 0.5 : (i - never + 0.5) / spread;
      const ageCadences = Math.min(2 * avgAge * frac, maxAge);
      // age is measured from due_at, so last_fetch = now - (1 + age) * interval
      const lastFetch = T0 - (1 + ageCadences) * intervalMs;
      rows.push({
        source_key: key,
        cadence,
        last_fetch_at: new Date(lastFetch).toISOString(),
        segment,
        created_at,
      });
    }
  });
  return rows;
}

/** The OLD (<= v1.8) selection, reproduced exactly: a 4x over-fetch window
 * ordered by absolute last_fetch_at ASC NULLS FIRST, with the priority-cadence
 * pool concatenated ahead of the general pool, then filter-to-due, then slice. */
const PRIORITY_CADENCES = ["hourly", "daily", "event_driven"];
function selectLegacy(rows, limit, nowMs) {
  const win = Math.min(limit * 4, 400);
  const byAbsoluteStaleness = (a, b) => {
    const ta = a.last_fetch_at === null ? -Infinity : Date.parse(a.last_fetch_at);
    const tb = b.last_fetch_at === null ? -Infinity : Date.parse(b.last_fetch_at);
    if (ta !== tb) return ta - tb;
    return a.source_key < b.source_key ? -1 : 1;
  };
  const prio = rows.filter((r) => PRIORITY_CADENCES.includes(r.cadence))
    .sort(byAbsoluteStaleness).slice(0, win);
  const rest = rows.slice().sort(byAbsoluteStaleness).slice(0, win);
  const seen = new Set();
  const merged = [];
  for (const r of [...prio, ...rest]) {
    if (seen.has(r.source_key)) continue;
    seen.add(r.source_key);
    merged.push(r);
  }
  return merged.filter((r) => isDueRow(r, nowMs)).slice(0, limit);
}

/** Run `days` simulated days at `limit` fetches/hour. Every selected row is
 * assumed to be fetched successfully (the capacity model the issue specifies).
 * Returns per-segment outcomes. */
function simulate({ select, limit, days, rows }) {
  const fleet = rows.map((r) => ({ ...r }));
  const byKey = new Map(fleet.map((r) => [r.source_key, r]));
  const slotsBySegment = new Map();
  const slotsByCadence = new Map();
  const slotsBySegCad = new Map();
  const everFetched = new Set();
  /** source_key -> last simulated fetch time (ms), for the within-7-days check */
  const lastFetchMs = new Map();
  /** max gap seen per source after its first simulated fetch */
  const maxGapMs = new Map();

  /** Runs where local_gov had at least ceil(limit*0.25) due rows but got fewer
   * slots than that — i.e. the floor was not honoured. Must stay empty. */
  const floorViolations = [];

  for (let hour = 0; hour < days * 24; hour++) {
    const nowMs = T0 + hour * HOUR;
    const picked = select(fleet, limit, nowMs);
    const want = Math.ceil(limit * 0.25);
    const locDue = fleet.filter((r) => segmentOf(r) === "local_gov" && isDueRow(r, nowMs)).length;
    const locGot = picked.filter((r) => segmentOf(r) === "local_gov").length;
    if (locGot < Math.min(want, locDue)) {
      floorViolations.push({ hour, locDue, locGot, want });
    }
    for (const row of picked) {
      const live = byKey.get(row.source_key);
      live.last_fetch_at = new Date(nowMs).toISOString();
      const seg = segmentOf(live);
      slotsBySegment.set(seg, (slotsBySegment.get(seg) ?? 0) + 1);
      slotsByCadence.set(live.cadence, (slotsByCadence.get(live.cadence) ?? 0) + 1);
      const sk = `${seg}|${live.cadence}`;
      slotsBySegCad.set(sk, (slotsBySegCad.get(sk) ?? 0) + 1);
      const prev = lastFetchMs.get(row.source_key);
      if (prev !== undefined) {
        maxGapMs.set(row.source_key, Math.max(maxGapMs.get(row.source_key) ?? 0, nowMs - prev));
      }
      lastFetchMs.set(row.source_key, nowMs);
      everFetched.add(row.source_key);
    }
  }

  const endMs = T0 + days * 24 * HOUR;
  const segments = new Map();
  for (const r of fleet) {
    const seg = segmentOf(r);
    let s = segments.get(seg);
    if (!s) {
      s = { segment: seg, cadence: r.cadence, total: 0, unfetched: 0, worstRatio: -Infinity, worstGapMs: 0 };
      segments.set(seg, s);
    }
    s.total++;
    if (!everFetched.has(r.source_key)) s.unfetched++;
    // "oldest fetch exceeds 2x its cadence" == overdue_ratio > 1 (ratio is
    // measured from due_at, so age = (1 + ratio) * interval)
    s.worstRatio = Math.max(s.worstRatio, overdueRatio(r.cadence, r.last_fetch_at, endMs));
    s.worstGapMs = Math.max(s.worstGapMs, maxGapMs.get(r.source_key) ?? 0);
  }
  return {
    segments: [...segments.values()],
    slotsBySegment,
    slotsByCadence,
    slotsBySegCad,
    floorViolations,
    totalSlots: [...slotsBySegment.values()].reduce((a, b) => a + b, 0),
  };
}

const FLEET = buildFleet();

test("the synthetic fleet is 10,400 rows carrying today's measured mix", () => {
  assert.equal(FLEET.length, TARGET);
  const weekly = FLEET.filter((r) => r.cadence === "weekly").length;
  const daily = FLEET.filter((r) => r.cadence === "daily").length;
  const hourly = FLEET.filter((r) => r.cadence === "hourly").length;
  assert.equal(weekly + daily + hourly, TARGET);
  // live: 9,027 weekly / 1,305 daily / 7 hourly of 10,339
  assert.equal(weekly, 9080);
  assert.equal(daily, 1313);
  assert.equal(hourly, 7);
  assert.equal(FLEET.filter((r) => segmentOf(r) === "local_gov").length, 1006);
  assert.equal(FLEET.filter((r) => r.last_fetch_at === null).length, 1153);
});

test("REGRESSION GUARD: the old selection starves local_gov to ~0% of slots", () => {
  const { segments, slotsBySegment, slotsByCadence, totalSlots } = simulate({
    select: selectLegacy,
    limit: 80,
    days: 14,
    rows: FLEET,
  });
  const loc = slotsBySegment.get("local_gov") ?? 0;
  const share = loc / totalSlots;
  // Measured on the real registry the same way: 0 of 80 slots to any weekly
  // segment, and 105 of 1,000 local_gov rows polled in a whole week. The
  // simulation reproduces the starvation: ~2% of slots against the ~6.5% that
  // local_gov's own cadence entitles it to, and the fair selection below moves
  // that to ~9%.
  assert.ok(share < 0.03, `old selection gave local_gov ${(share * 100).toFixed(2)}% of slots`);
  // The weekly cohort is 87% of the fleet and 44% of the daily demand, and gets
  // under a fifth of the slots. (The simulation is in fact KINDER to the legacy
  // algorithm than production: replaying it against the real registry on
  // 2026-10-07 gave the weekly cohort 0 of 80 slots, because real daily rows sit
  // staler in absolute terms than the fixture's.)
  const weeklyShare = (slotsByCadence.get("weekly") ?? 0) / totalSlots;
  assert.ok(weeklyShare < 0.2, `old selection gave the weekly cohort ${(weeklyShare * 100).toFixed(2)}%`);

  // Consequence: after 14 simulated days thousands of weekly sources have still
  // never been polled even once, local_gov among them.
  const unfetched = segments.reduce((a, x) => a + x.unfetched, 0);
  assert.ok(unfetched > 1000, `only ${unfetched} sources went unpolled for 14 days`);
  assert.ok(
    segments.find((x) => x.segment === "local_gov").unfetched > 0,
    "local_gov should still have unpolled rows under the old selection",
  );
});

test("FAIR selection polls every weekly local_gov source within 7 days at 80/hour", () => {
  const { segments, slotsBySegment, totalSlots, floorViolations } = simulate({
    select: (rows, limit, nowMs) => selectDueFair(rows, { limit, nowMs }).picked,
    limit: 80,
    days: 14,
    rows: FLEET,
  });
  const loc = segments.find((s) => s.segment === "local_gov");

  assert.equal(loc.unfetched, 0, "every local_gov source was polled at least once");
  // Every local_gov source is fetched at least once per 7 days: its worst
  // observed gap between consecutive fetches, and its final staleness, both stay
  // inside 7 days. The weekly interval is 6.5 days, so ratio <= 7/6.5 - 1.
  assert.ok(
    loc.worstGapMs <= 7 * DAY,
    `worst local_gov gap was ${(loc.worstGapMs / DAY).toFixed(2)} days`,
  );
  assert.ok(
    loc.worstRatio <= 7 / 6.5 - 1,
    `worst local_gov staleness at day 14 was ${((1 + loc.worstRatio) * 6.5).toFixed(2)} days`,
  );

  // The floor is honoured in every one of the 336 runs: whenever local_gov had
  // >= 20 due rows it got >= 20 of the 80 slots.
  assert.deepEqual(floorViolations, [], "the 25% local_gov floor was breached");

  // Its SHARE over 14 days settles near its own need, not at 25%, because the
  // floor is a floor and unused reservation spills: 1,006 rows on a 6.5-day
  // cadence need 155 fetches/day = 8.1% of the 1,920 slots/day. Anything in that
  // neighbourhood is correct; ~2% (the old behaviour) is not.
  const share = (slotsBySegment.get("local_gov") ?? 0) / totalSlots;
  assert.ok(share > 0.08 && share < 0.25, `local_gov share was ${(share * 100).toFixed(1)}%`);
});

test("no segment's oldest fetch exceeds 2x its cadence after 14 days — at the capacity that allows it", () => {
  const run = (limit) =>
    simulate({
      select: (rows, l, nowMs) => selectDueFair(rows, { limit: l, nowMs }).picked,
      limit,
      days: 14,
      rows: FLEET,
    });
  // "oldest fetch <= 2x its cadence" == overdue_ratio <= 1.
  const holds2x = (limit) =>
    run(limit).segments.every((s) => s.unfetched === 0 && s.worstRatio <= 1);
  const solve = (pred, lo0, hi0, label) => {
    let lo = lo0, hi = hi0;
    assert.ok(pred(hi), `${label}: ${hi}/hour must be sufficient or the search bound is wrong`);
    assert.ok(!pred(lo), `${label}: ${lo}/hour must be insufficient or the search bound is wrong`);
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (pred(mid)) hi = mid; else lo = mid;
    }
    return hi;
  };

  // Today's cron (80/hour) cannot hold either invariant fleet-wide: steady-state
  // demand is ~3,156 fetches/day against 1,920 slots/day.
  assert.equal(holds2x(80), false, "80/hour is expected to be short — see Needs Myke in the PR");

  const MIN_LIMIT_2X = solve(holds2x, 80, 220, "2x cadence");

  // Pinned so the PR's "Needs Myke" figure cannot drift from the simulation.
  // (Full cadence compliance — every row inside 1x its cadence rather than 2x —
  // needs 132/hour; that is pure arithmetic and is asserted in the last test.)
  assert.equal(MIN_LIMIT_2X, 108, "minimum limit for 'no segment past 2x its cadence'");

  // At MIN_LIMIT_2X the issue's invariant holds for every segment, local_gov
  // included, and nothing is left unpolled.
  for (const s of run(MIN_LIMIT_2X).segments) {
    assert.equal(s.unfetched, 0, `${s.segment}: ${s.unfetched} never polled`);
    assert.ok(
      s.worstRatio <= 1,
      `${s.segment}/${s.cadence}: oldest fetch is ${(1 + s.worstRatio).toFixed(2)}x its cadence`,
    );
  }
});

test("steady-state demand arithmetic matches the shortfall reported in the PR", () => {
  const perDay = (cadence, n) => (n * 24 * 60) / cadenceMinutes(cadence);
  const demand = LIVE_MIX.reduce((a, [, cadence, total]) => a + perDay(cadence, total), 0);
  assert.equal(Math.round(demand), 3156, "fetches/day the registry's own cadences promise");
  assert.equal(80 * 24, 1920, "fetches/day today's cron buys");
  assert.equal(Math.ceil(demand / 24), 132, "hourly limit that covers steady-state demand");
  assert.equal(Math.round((80 * 24 * 100) / demand), 61, "today's cron buys 61% of that demand");
});
