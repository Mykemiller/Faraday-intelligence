// Tests for the v1.3 relevance gate + cadence scheduling (poller-relevance.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDue, isRelevant } from "../supabase/functions/source-poller/poller-relevance.ts";

test("isRelevant passes infrastructure items and rejects noise", () => {
  assert.ok(isRelevant({ title: "Meta breaks ground on 500MW data center campus", link: null, published: null, summary: "" }));
  assert.ok(isRelevant({ title: "County approves rezoning for hyperscale project", link: null, published: null, summary: "" }));
  assert.ok(isRelevant({ title: "Quarterly results", link: null, published: null, summary: "GPU cluster expansion and liquid cooling retrofit drive capex" }));
  assert.ok(!isRelevant({ title: "Apple announces new iPhone colors for fall lineup", link: null, published: null, summary: "The refreshed lineup arrives in stores next month." }));
  assert.ok(!isRelevant({ title: "Spark joy: decluttering tips from the pros", link: null, published: null, summary: "" }));
  // word-boundary: 'notification' must not match a bare term fragment
  assert.ok(!isRelevant({ title: "Notification settings updated for all users today", link: null, published: null, summary: "" }));
});

test("isDue honors cadence intervals with slack", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
  assert.ok(isDue("daily", null, now), "never-fetched is always due");
  assert.ok(isDue("hourly", hoursAgo(1), now));
  assert.ok(!isDue("daily", hoursAgo(3), now));
  assert.ok(isDue("daily", hoursAgo(21), now));
  assert.ok(!isDue("weekly", hoursAgo(24 * 3), now));
  assert.ok(isDue("weekly", hoursAgo(24 * 7), now));
  assert.ok(!isDue("unknown-cadence", hoursAgo(3), now), "unknown treated as daily");
});
