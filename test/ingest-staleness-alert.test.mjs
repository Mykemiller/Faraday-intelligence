// Tests for ingest-staleness-healthcheck pure logic (alert-pure.ts).
// Fixtures are real rows returned by fn_ingest_staleness_check() against live prod
// on 2026-08-08 (run in BEGIN..ROLLBACK), not invented shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breachedOnly, buildAlertHtml, buildSubject, escapeHtml, groupByLane,
} from "../supabase/functions/ingest-staleness-healthcheck/alert-pure.ts";

const row = (watch_key, check_mode, breached, detail) => ({
  watch_key, label: watch_key, check_mode, expected_cadence: "weekly",
  threshold: "10 days 12:00:00", last_event_at: "2026-07-08T18:11:37Z",
  age: "30 days", breached, detail,
});

// The real 2026-08-08 evaluation: 24 watches, 14 breached.
const LIVE = [
  row("state_incentives:md_commerce_finance_tracker", "poll", true, "poll stale: last attempt was 1 mon 1 day ago (threshold 10 days 12:00:00)"),
  row("state_incentives:de_eeif_grants", "poll", true, "poll stale: last attempt was 1 mon 1 day ago (threshold 10 days 12:00:00)"),
  row("state_incentives:or_ez_parta_2024", "poll", true, "poll stale"),
  row("intl:ember", "poll", true, "poll stale: last attempt was 13 days ago (threshold 10 days 12:00:00)"),
  row("intl:rsf-pfi", "poll", true, "poll stale: last attempt was 13 days ago"),
  row("ncsl:error", "error", true, "latest run reported: Error: wayback CDX → 504"),
  row("shovels:permits:error", "error", true, "latest run reported: shovels 402 [credits_exhausted]"),
  // Correctly quiet — must never appear in an alert.
  row("eia:860:poll", "poll", false, null),
  row("state_incentives:ny_esd_dei", "poll", false, null),
  row("intl:worldbank-wdi", "poll", false, null),
];

test("breachedOnly keeps only breaches", () => {
  const b = breachedOnly(LIVE);
  assert.equal(b.length, 7);
  assert.ok(b.every((r) => r.breached));
});

test("the healthy annual EIA source is never alerted on (D4)", () => {
  const keys = breachedOnly(LIVE).map((r) => r.watch_key);
  assert.ok(!keys.includes("eia:860:poll"));
  assert.ok(!buildSubject(breachedOnly(LIVE)).includes("eia"));
});

test("groupByLane collapses a lane's sources into one group, largest first", () => {
  const lanes = groupByLane(breachedOnly(LIVE));
  assert.deepEqual(lanes.map((l) => l.lane), ["state_incentives", "intl", "ncsl", "shovels"]);
  assert.equal(lanes[0].items.length, 3);
  assert.equal(lanes[1].items.length, 2);
});

test("groupByLane handles a watch key with no colon", () => {
  const lanes = groupByLane([row("orphan", "poll", true, "x")]);
  assert.deepEqual(lanes.map((l) => l.lane), ["orphan"]);
});

test("subject names the count and the affected lanes", () => {
  const s = buildSubject(breachedOnly(LIVE));
  assert.ok(s.includes("7 stale/failing sources"));
  assert.ok(s.includes("state_incentives"));
  assert.ok(s.includes("shovels"));
});

test("subject is singular for exactly one breach", () => {
  const s = buildSubject([row("ncsl:error", "error", true, "boom")]);
  assert.ok(s.includes("1 stale/failing source ("), `got: ${s}`);
  assert.ok(!s.includes("sources"));
});

test("escapeHtml neutralises markup from upstream error text", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">&'),
    "&lt;img src=x onerror=\"alert(1)\"&gt;&amp;");
});

test("alert html escapes an error detail carrying markup", () => {
  const html = buildAlertHtml({
    breaches: [row("x:err", "error", true, "<script>alert(1)</script>")],
    totalWatches: 24, now: "2026-08-08T18:00:00Z",
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("alert html reports the breach count against the total watch count", () => {
  const b = breachedOnly(LIVE);
  const html = buildAlertHtml({ breaches: b, totalWatches: 24, now: "2026-08-08T18:00:00Z" });
  assert.ok(html.includes("7 of 24 watched sources"));
  // The pg_cron caveat is the whole point of the alert — it must be in the body.
  assert.ok(html.includes("cron_http_post"));
});
