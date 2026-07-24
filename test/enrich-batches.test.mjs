// Tests for the enrich-artifacts v20 pure logic (enrich-pure.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchRunSucceeded,
  buildBatchRequests,
  chunkText,
  mentionName,
  parseBatchResults,
  parseEnrichmentText,
} from "../supabase/functions/enrich-artifacts/enrich-pure.ts";

const VALID_BODY = '{"summary":"s","category_tags":[],"relevance_score":0.1,"priority_flag":false,"prediction_signals":{},"entity_mentions":[]}';

test("buildBatchRequests maps artifacts onto custom_id requests, capped at 6000 chars", () => {
  const reqs = buildBatchRequests([{
    artifact_id: "a-1", raw_content: "x".repeat(9000), source_type: "web_news",
    source_url: "https://e/1", ifs_domains: ["D2"],
  }]);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].custom_id, "a-1");
  assert.equal(reqs[0].params.max_tokens, 512);
  assert.ok(reqs[0].params.messages[0].content.length < 6200);
  assert.ok(reqs[0].params.messages[0].content.includes("Domains: D2"));
});

test("parseBatchResults handles succeeded, errored, fenced JSON, and junk lines", () => {
  const jsonl = [
    JSON.stringify({ custom_id: "ok-1", result: { type: "succeeded", message: { content: [{ text: '{"summary":"s","category_tags":[],"relevance_score":0.5,"priority_flag":false,"prediction_signals":{},"entity_mentions":["Vantage"]}' }] } } }),
    JSON.stringify({ custom_id: "fence", result: { type: "succeeded", message: { content: [{ text: '```json\n{"summary":"f","category_tags":[],"relevance_score":0.1,"priority_flag":false,"prediction_signals":{},"entity_mentions":[]}\n```' }] } } }),
    JSON.stringify({ custom_id: "bad-json", result: { type: "succeeded", message: { content: [{ text: "not json at all" }] } } }),
    JSON.stringify({ custom_id: "err-1", result: { type: "errored" } }),
    "{malformed line",
    "",
  ].join("\n");
  const lines = parseBatchResults(jsonl);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((l) => l.ok), [true, true, false, false]);
  assert.equal(lines[0].enrichment.entity_mentions[0], "Vantage");
  assert.equal(lines[1].enrichment.summary, "f");
  assert.match(lines[2].error, /unparseable/);
  assert.equal(lines[3].error, "errored");
});

test("mentionName coerces strings and objects; chunkText overlaps and filters shorts", () => {
  assert.equal(mentionName("NVIDIA"), "NVIDIA");
  assert.equal(mentionName({ name: "Equinix" }), "Equinix");
  assert.equal(mentionName({ entity: "KKR" }), "KKR");
  assert.equal(mentionName(42), null);
  const chunks = chunkText("y".repeat(5000));
  assert.equal(chunks.length, 3);
  assert.equal(parseEnrichmentText('```json{"summary":"z","category_tags":[],"relevance_score":0,"priority_flag":false,"prediction_signals":{},"entity_mentions":[]}```').summary, "z");
});

// CC-FAR-OPS-RESTORE-1.0 Fix 3 — robust fence stripping (parser-side only)
test("parseEnrichmentText strips fence variants, whitespace, and surrounding prose", () => {
  // bare ```json fence with newlines
  assert.equal(parseEnrichmentText("```json\n" + VALID_BODY + "\n```").summary, "s");
  // bare ``` fence (no language tag)
  assert.equal(parseEnrichmentText("```\n" + VALID_BODY + "\n```").summary, "s");
  // uppercase language tag — the old /```json/ regex was case-sensitive and left it in
  assert.equal(parseEnrichmentText("```JSON\n" + VALID_BODY + "\n```").summary, "s");
  // leading prose before a fenced object — object-extraction fallback recovers it
  assert.equal(parseEnrichmentText("Here is the JSON:\n```json\n" + VALID_BODY + "\n```").summary, "s");
  // surrounding whitespace / no fence
  assert.equal(parseEnrichmentText("   \n" + VALID_BODY + "  \n ").summary, "s");
});

// Replay of the two known-bad artifacts (evidence: automation_health_log).
// 7442b2b7 was an Anthropic-side "errored" result — no JSON exists to parse;
// 4452a4a7's body carried an UNESCAPED inner quote (`"..."​.gn"..."`) — malformed
// JSON that no fence-stripping can repair. Both must therefore remain per-item
// failures (recorded in errors), and the threshold below keeps them from
// flipping the whole batch to failed.
test("known-bad 4452a4a7 shape (unescaped inner quote) still throws — content not repaired", () => {
  const bad = '```json\n{\n  "summary": "Guinea has launched its national domain ".gn" and unveiled a Tier III data center."}';
  assert.throws(() => parseEnrichmentText(bad));
});

test('known-bad 7442b2b7 shape (Anthropic "errored") is a non-parse per-item failure', () => {
  const jsonl = JSON.stringify({ custom_id: "7442b2b7", result: { type: "errored" } });
  const lines = parseBatchResults(jsonl);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].ok, false);
  assert.equal(lines[0].error, "errored");
});

// CC-FAR-OPS-RESTORE-1.0 Fix 3 — batch success threshold (no false alarms)
test("batchRunSucceeded tolerates <=5% per-item failures but flags systemic errors", () => {
  assert.equal(batchRunSucceeded(118, 2, 0), true);   // 2/120 ~ 1.7% — the real-world false-alarm case
  assert.equal(batchRunSucceeded(119, 1, 0), true);   // 1/120 ~ 0.8%
  assert.equal(batchRunSucceeded(114, 6, 0), true);   // 6/120 = 0.05 exactly — at tolerance, still ok
  assert.equal(batchRunSucceeded(113, 7, 0), false);  // 7/120 ~ 5.8% — over tolerance
  assert.equal(batchRunSucceeded(0, 0, 0), true);     // healthy no-op run
  assert.equal(batchRunSucceeded(0, 0, 1), false);    // submit / systemic failure with nothing processed
  assert.equal(batchRunSucceeded(120, 0, 1), false);  // a batch-fetch error alongside a clean drain still alarms
});
