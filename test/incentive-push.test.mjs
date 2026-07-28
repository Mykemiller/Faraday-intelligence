// Tests for ingest-state-incentives-push pure logic (push-pure.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPushRow, contentHash, validatePushBody,
} from "../supabase/functions/ingest-state-incentives-push/push-pure.ts";

test("buildPushRow whitelists fields and forces source_key/state_abbr", () => {
  const r = buildPushRow({
    recipient_name: "  Acme Corp ", county_name: "Fairfax", award_value_usd: "$1,250,000",
    incentive_type: "grant", state_abbr: "XX", source_key: "spoofed", // per-row spoof ignored
    evil_column: "DROP TABLE", term_years: "5",
  }, "va_vedp_scrape", "va");
  assert.equal(r.state_abbr, "VA");                 // forced from param, uppercased
  assert.equal(r.source_key, "va_vedp_scrape");     // forced from param, not row
  assert.equal(r.recipient_name, "Acme Corp");      // trimmed
  assert.equal(r.county_name, "Fairfax");
  assert.equal(r.award_value_usd, 1250000);         // "$"/"," stripped
  assert.equal(r.term_years, 5);
  assert.equal(r.incentive_type, "grant");
  assert.equal("evil_column" in r, false);          // unknown key dropped
});

test("buildPushRow coerces blanks to null", () => {
  const r = buildPushRow({ recipient_name: "X", project_name: "   ", award_value_usd: "" }, "k", "CA");
  assert.equal(r.project_name, null);
  assert.equal(r.award_value_usd, null);
  assert.equal(r.statute_citation, null);
});

test("contentHash is stable and sensitive, and 64 hex chars", async () => {
  const base = buildPushRow({ recipient_name: "A", county_name: "Cook", award_value_usd: 100 }, "il_edge", "IL");
  const h1 = await contentHash(base);
  const h2 = await contentHash(buildPushRow({ recipient_name: "A", county_name: "Cook", award_value_usd: 100 }, "il_edge", "IL"));
  const h3 = await contentHash(buildPushRow({ recipient_name: "A", county_name: "Cook", award_value_usd: 200 }, "il_edge", "IL"));
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("validatePushBody enforces the contract", () => {
  assert.equal(validatePushBody({ source_key: "k", state_abbr: "CA", rows: [] }), null);
  assert.equal(validatePushBody({ state_abbr: "CA", rows: [] }), "source_key required");
  assert.equal(validatePushBody({ source_key: "k", state_abbr: "California", rows: [] }), "state_abbr must be a 2-letter code");
  assert.equal(validatePushBody({ source_key: "k", state_abbr: "CA", rows: {} }), "rows must be an array");
  assert.equal(validatePushBody({ source_key: "k", state_abbr: "CA", rows: new Array(50001) }), "rows exceeds 50000 per call");
});
