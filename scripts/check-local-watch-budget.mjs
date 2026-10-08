#!/usr/bin/env node
// check-local-watch-budget.mjs — FDY-93 (L6).
//
// Does the county-complete local gov watch fit the poller's budget?
//
//   node scripts/check-local-watch-budget.mjs            # print the tables
//   node scripts/check-local-watch-budget.mjs --assert   # exit 1 if a claim in
//                                                        # the PR body is wrong
//
// Pure arithmetic. Reads no database, applies nothing. Every input is either a
// constant imported from the code that will enforce it, or a count measured
// read-only against production on 2026-10-07 and recorded in FLEET / EXPECTED.
//
// ---------------------------------------------------------------------------
// WHY THE DENOMINATOR IS THE SEGMENT FLOOR, NOT THE WHOLE CRON RATE
// ---------------------------------------------------------------------------
// FDY-89 measured that the fleet already demands ~3,156 fetches/day against the
// 1,920 the cron buys — 61% funded before this issue adds a single row. It is
// tempting to read that as "the local watch has no budget at all", but FDY-89
// also gave local_gov a per-run FLOOR of 25% of the slots, which it holds
// whenever it has due rows. That floor — ceil(limit * 0.25) per run, 24 runs a
// day — is this lane's real, guaranteed budget, and it is what the tiered
// cadence has to be sized against. Anything above the floor is spill the lane
// only gets if the rest of the fleet is caught up, and the rest of the fleet is
// not caught up.
import {
  CADENCE_MINUTES,
  SEGMENT_FLOORS,
} from "../supabase/functions/source-poller/poller-schedule.ts";
import {
  EXPECTED,
  TIER_CADENCE,
  TIER_CADENCE_SPEC,
} from "./gen-local-watch-county-complete.mjs";

/** The poller fleet as production holds it. Measured read-only on project
 * ycadmmngkdhvpcsrcuaq, 2026-10-07:
 *   select cadence, count(*) from public.source_registry
 *    where subsystem='poller' and status='active' and feed_url is not null
 *    group by 1;
 *   -> weekly 9027, daily 1305, hourly 7   (10,339 rows) */
export const FLEET = { hourly: 7, daily: 1305, weekly: 9027 };
export const FLEET_ROWS = 10339;

/** cron job 134, `source-poller-run`, schedule '12 * * * *' with a per-run limit
 * of 80 — i.e. 80 fetches/hour. Read read-only from cron.job on 2026-10-07. */
export const CRON = { jobId: 134, jobName: "source-poller-run", schedule: "12 * * * *", perRun: 80 };

/** The two rates FDY-89 asked Myke for, so this issue's ask is comparable. */
export const FDY89_ASKS = { "no segment past 2x cadence": 108, "full compliance (fleet as of L2)": 132 };

const MIN_PER_DAY = 1440;

/** Fetches/day a cohort of `rows` on `cadence` demands. */
export function demand(rows, cadence) {
  const minutes = CADENCE_MINUTES[cadence];
  if (!minutes) throw new Error(`unknown cadence ${cadence}`);
  return (rows * MIN_PER_DAY) / minutes;
}

/** The lane, tier by tier, under a given tier -> cadence map. */
export function laneRows() {
  return [
    ["t1", EXPECTED.t1Rows, "every Boundstone jurisdiction"],
    ["dc", EXPECTED.dcRowsAtGenerate, "counties with a data-center headline (90d)"],
    ["t2", EXPECTED.t2RowsAtGenerate, "the remaining county-equivalents"],
    ["t3", EXPECTED.t3Rows, "places + townships in Boundstone-record counties"],
    ["legacy", EXPECTED.legacyRows, "pre-existing small places outside T1-T3"],
  ];
}

export function laneDemand(cadenceByTier) {
  let total = 0;
  const rows = laneRows().map(([tier, n, what]) => {
    const cadence = cadenceByTier[tier];
    const d = demand(n, cadence);
    total += d;
    return { tier, rows: n, cadence, perDay: d, what };
  });
  return { rows, total };
}

/** What the rest of the fleet (everything that is not this lane) demands. */
export function restOfFleetDemand() {
  const all = Object.entries(FLEET).reduce((s, [c, n]) => s + demand(n, c), 0);
  const localToday = demand(EXPECTED.existingLocRows, "weekly");
  return { all, localToday, rest: all - localToday };
}

/** local_gov's guaranteed slots/day at a given per-run limit: the floor is
 * ceil(limit * share) per run, and the cron runs hourly. */
export function floorPerDay(perRun) {
  return Math.ceil(perRun * SEGMENT_FLOORS.local_gov) * 24;
}

export function capacityPerDay(perRun) {
  return perRun * 24;
}

/** The smallest hourly rate at which the WHOLE fleet, including this lane, is
 * fully funded — at which point the floor stops mattering because nothing is
 * starved. */
export function requiredPerHour(cadenceByTier = TIER_CADENCE) {
  const { rest } = restOfFleetDemand();
  return Math.ceil((rest + laneDemand(cadenceByTier).total) / 24);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const f1 = (x) => x.toFixed(1).padStart(8);
const i = (x) => x.toLocaleString("en-US").padStart(7);

export function report() {
  const out = [];
  const spec = laneDemand(TIER_CADENCE_SPEC);
  const shipped = laneDemand(TIER_CADENCE);
  const fleet = restOfFleetDemand();

  out.push("FDY-93 budget check — fetches/day, local gov watch");
  out.push("");
  out.push("Cadence intervals (CADENCE_MINUTES / poller_cadence_interval):");
  for (const [c, m] of Object.entries(CADENCE_MINUTES)) {
    out.push(`  ${c.padEnd(17)} ${String(m).padStart(7)} min  = ${(m / MIN_PER_DAY).toFixed(2)} days`);
  }
  out.push("");
  out.push("1. The lane AS SPECIFIED (T1/headline daily, T2 weekly, T3 weekly, legacy monthly)");
  out.push("   tier     rows  cadence     /day   what");
  for (const r of spec.rows) {
    out.push(`   ${r.tier.padEnd(7)}${i(r.rows)}  ${r.cadence.padEnd(10)}${f1(r.perDay)}   ${r.what}`);
  }
  out.push(`   ${"TOTAL".padEnd(7)}${i(spec.rows.reduce((s, r) => s + r.rows, 0))}  ${"".padEnd(10)}${f1(spec.total)}`);
  out.push("");
  out.push("2. The pre-authorised demotion ladder");
  let running = spec.total;
  const rung = (label, tier, from, to) => {
    const before = demand(laneRows().find(([t]) => t === tier)[1], from);
    const after = demand(laneRows().find(([t]) => t === tier)[1], to);
    running = running - before + after;
    out.push(`   ${label.padEnd(28)} ${from} -> ${to.padEnd(9)} saves ${f1(before - after)}  -> ${f1(running)}/day`);
  };
  rung("rung 1: T3 -> biweekly", "t3", TIER_CADENCE_SPEC.t3, TIER_CADENCE.t3);
  rung("rung 2: T2 -> biweekly", "t2", TIER_CADENCE_SPEC.t2, TIER_CADENCE.t2);
  out.push(`   SHIPPED${" ".repeat(22)}${" ".repeat(22)}${f1(shipped.total)}/day`);
  out.push("");
  out.push("3. Capacity");
  out.push(`   cron job ${CRON.jobId} (${CRON.jobName}) '${CRON.schedule}', ${CRON.perRun}/run = ${CRON.perRun}/hour`);
  out.push(`   whole fleet, ${FLEET_ROWS.toLocaleString("en-US")} rows, demands  ${f1(fleet.all)}/day  (of which this lane, today, ${fleet.localToday.toFixed(1)})`);
  out.push(`   everything that is NOT this lane demands ${f1(fleet.rest)}/day`);
  out.push("");
  out.push("   rate/h   bought/day   local_gov floor/day   lane funded   fleet funded");
  for (const perRun of [CRON.perRun, ...Object.values(FDY89_ASKS), requiredPerHour(), 192]) {
    const cap = capacityPerDay(perRun);
    const fl = floorPerDay(perRun);
    const laneFunded = Math.min(1, Math.max(fl, cap - fleet.rest) / shipped.total);
    const fleetFunded = Math.min(1, cap / (fleet.rest + shipped.total));
    out.push(
      `   ${String(perRun).padStart(6)}   ${i(cap)}      ${i(fl)}          ${(laneFunded * 100).toFixed(1).padStart(5)}%         ${(fleetFunded * 100).toFixed(1).padStart(5)}%`,
    );
  }
  out.push("");
  out.push(`   The floor is the lane's guaranteed share: ceil(limit * ${SEGMENT_FLOORS.local_gov}) per run x 24 runs.`);
  out.push("   It is also effectively the lane's CEILING today, because the rest of the");
  out.push(`   fleet alone (${fleet.rest.toFixed(0)}/day) already exceeds the non-floor slots at every rate`);
  out.push("   below full compliance, so no spill reaches local_gov.");
  out.push("");
  out.push("4. Verdict");
  const atToday = floorPerDay(CRON.perRun);
  out.push(
    `   At today's ${CRON.perRun}/hour the lane is guaranteed ${atToday}/day against a demand of ` +
      `${shipped.total.toFixed(1)}/day:`,
  );
  out.push(
    `   ${((atToday / shipped.total) * 100).toFixed(1)}% funded, so every promised cadence stretches by about ` +
      `${(shipped.total / atToday).toFixed(2)}x.`,
  );
  out.push(
    `   Both rungs of the ladder are already spent. FULL COMPLIANCE NEEDS ${requiredPerHour()}/hour.`,
  );
  out.push(
    `   Recommended: 192/hour as 48 per run every 15 minutes. One run of ${requiredPerHour()} would need`,
  );
  out.push(
    `   ${requiredPerHour()}s of news.google.com pacing alone (MIN_HOST_GAP_MS = 1000, one host for the`,
  );
  out.push("   whole gsearch lane); 48 needs 48s, comfortably inside an edge-function run.");
  return out.join("\n");
}

function main(argv) {
  console.log(report());
  if (!argv.includes("--assert")) return 0;

  const shipped = laneDemand(TIER_CADENCE).total;
  const spec = laneDemand(TIER_CADENCE_SPEC).total;
  const checks = [
    ["the ladder actually reduces demand", shipped < spec],
    ["the shipped lane still does not fit today's floor", shipped > floorPerDay(CRON.perRun)],
    ["full compliance needs more than FDY-89's larger ask", requiredPerHour() > FDY89_ASKS["full compliance (fleet as of L2)"]],
    ["192/hour funds the whole fleet", capacityPerDay(192) >= restOfFleetDemand().rest + shipped],
    ["the lane row counts sum to the universe", laneRows().reduce((s, [, n]) => s + n, 0) === EXPECTED.universeRows],
  ];
  let bad = 0;
  console.log("");
  for (const [what, ok] of checks) {
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) bad++;
  }
  return bad === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
