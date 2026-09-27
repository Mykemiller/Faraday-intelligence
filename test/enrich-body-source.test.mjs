// v2.5 (OCP Phase 3, D4): enrich-artifacts chunks a qualifying fetched body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyQualifies, chunkSource, chunkText, selectChunkSource } from "../supabase/functions/enrich-artifacts/enrich-pure.ts";

const raw = "Open Rack V3 — Module 2: Core Specifications. Frame, busbar and power shelf.";
const body = "Lesson 1. " + "The ORv3 frame carries a 48V busbar. ".repeat(200);

test("no body → raw_content exactly as before v2.5", () => {
  assert.deepEqual(selectChunkSource({ raw_content: raw }), { text: raw, fromBody: false });
});

test("body only used when fetch status is ok", () => {
  for (const s of [null, "failed", "blocked", "empty", "skipped"]) {
    assert.equal(selectChunkSource({ raw_content: raw, body_text: body, body_fetch_status: s }).fromBody, false);
  }
  assert.equal(selectChunkSource({ raw_content: raw, body_text: body, body_fetch_status: "ok" }).fromBody, true);
});

test("materiality rule mirrors artifact_body_embed_claim", () => {
  assert.equal(bodyQualifies(null, 100), false);
  assert.equal(bodyQualifies(599, 100), false); // < raw+500
  assert.equal(bodyQualifies(600, 100), true);
  assert.equal(bodyQualifies(1500, 1000), false); // < 2x raw
  const shallow = selectChunkSource({ raw_content: raw, body_text: raw + " x", body_fetch_status: "ok" });
  assert.equal(shallow.fromBody, false);
  assert.equal(shallow.text, raw);
});

test("capture leads chunk 0; not duplicated when body already starts with it", () => {
  const s = selectChunkSource({ raw_content: raw, body_text: body, body_fetch_status: "ok", body_char_count: body.length });
  assert.ok(s.text.startsWith(raw + "\n\n"));
  assert.equal(chunkSource(raw, raw + "\n\n" + body), raw + "\n\n" + body);
  const chunks = chunkText(s.text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].startsWith("Open Rack V3"));
});

test("null raw_content with a body still works", () => {
  const s = selectChunkSource({ raw_content: null, body_text: body, body_fetch_status: "ok" });
  assert.equal(s.fromBody, true);
  assert.equal(s.text, body);
});
