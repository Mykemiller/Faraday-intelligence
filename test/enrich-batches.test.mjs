// Tests for the enrich-artifacts v20 pure logic (enrich-pure.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBatchRequests,
  chunkText,
  mentionName,
  parseBatchResults,
  parseEnrichmentText,
} from "../supabase/functions/enrich-artifacts/enrich-pure.ts";

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
