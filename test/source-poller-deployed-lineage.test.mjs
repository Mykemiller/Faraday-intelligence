// FDY-97: behavioural pins for the v1.4–v1.8 fixes that once existed ONLY in the
// deployed source-poller (Edge Function version 35, source-poller_v1.8) and were
// ported into the repo by FDY-89 (PR #73). The string-marker check in
// source-poller-schedule.test.mjs proves the code is present; these prove the
// v1.5 parser behaves as deployed, and pin the v1.4 envelope keys by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractItemSource, parseFeed } from "../supabase/functions/source-poller/poller-pure.ts";

const INDEX = readFileSync(new URL("../supabase/functions/source-poller/index.ts", import.meta.url), "utf8");

const GNEWS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>County approves data center rezoning - Utility Dive</title>
<link>https://news.google.com/rss/articles/CBMiabc?oc=5</link>
<pubDate>Mon, 05 Oct 2026 14:00:00 GMT</pubDate>
<description>&lt;a href="x"&gt;County approves&lt;/a&gt;</description>
<source url="https://www.utilitydive.com">Utility Dive</source></item>
<item><title>No source element here</title><link>https://ex.com/b</link></item>
</channel></rss>`;

test("v1.5: parseFeed carries the item's own <source> as publisher + publisherHome", () => {
  const [a, b] = parseFeed(GNEWS);
  assert.equal(a.publisher, "Utility Dive");
  assert.equal(a.publisherHome, "https://www.utilitydive.com");
  // absent, never guessed from the title's " - Utility Dive" suffix
  assert.equal(b.publisher, null);
  assert.equal(b.publisherHome, null);
});

test("v1.5: extractItemSource decodes entities/CDATA and returns nulls when empty", () => {
  assert.deepEqual(extractItemSource('<item><source url="https://a.example"><![CDATA[A &amp; B]]></source></item>'), {
    publisher: "A & B",
    publisherHome: "https://a.example",
  });
  assert.deepEqual(extractItemSource('<item><source url="https://a.example"> </source></item>'), {
    publisher: null,
    publisherHome: "https://a.example",
  });
});

test("v1.4 + v1.5: the envelope writes title/summary/publisher/publisher_home, and query-lane `source` only from <source>", () => {
  for (const marker of [
    "...(it.title ? { title: it.title } : {})",
    "...(it.summary ? { summary: it.summary } : {})",
    "...(publisher ? { publisher } : {})",
    "...(publisherHome ? { publisher_home: publisherHome } : {})",
    '? (publisher ? { source: publisher } : {})',
    ": { source: publisher ?? src.name }",
  ]) {
    assert.ok(INDEX.includes(marker), `v1.4/v1.5 envelope key missing: ${marker}`);
  }
});

test("v1.7 + v1.8: one transient-status definition shared by both lanes", () => {
  assert.match(INDEX, /function isTransientStatus\(status: number\): boolean \{\s*return status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500;/);
  assert.match(INDEX, /const failCount = transient \? prevFail : prevFail \+ 1;/); // verify lane (v1.7)
  assert.match(INDEX, /status: !transient && fails >= 5 \? "error" : src\.status/); // run lane (v1.8)
});
