// Tests for the source-poller pure logic (poller-pure.ts).
// Run: npm test (node --test with type stripping; no extra deps).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFeed,
  decodeEntities,
  discoverCandidates,
  extractAlternateLinks,
  parseFeed,
  toIso,
} from "../supabase/functions/source-poller/poller-pure.ts";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Chan</title>
<item><title>First &amp; foremost</title><link>https://ex.com/a</link>
<pubDate>Wed, 16 Jul 2026 09:00:00 GMT</pubDate>
<description><![CDATA[<p>Body <b>text</b> here</p>]]></description></item>
<item><title>Second</title><link>https://ex.com/b</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom entry</title>
<link rel="self" href="https://ex.com/self.xml"/>
<link rel="alternate" href="https://ex.com/entry-1"/>
<updated>2026-07-15T12:00:00Z</updated>
<summary>Sum</summary></entry></feed>`;

test("classifyFeed detects rss / atom / json / html", () => {
  assert.equal(classifyFeed("text/xml", RSS), "rss");
  assert.equal(classifyFeed("application/atom+xml", ATOM), "atom");
  assert.equal(classifyFeed("application/json", '{"a":1}'), "json");
  assert.equal(classifyFeed("text/html", "<html><body>hi</body></html>"), null);
  assert.equal(classifyFeed("application/json", "{broken"), null);
});

test("parseFeed extracts RSS items with CDATA + entities + tag stripping", () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "First & foremost");
  assert.equal(items[0].link, "https://ex.com/a");
  assert.equal(items[0].summary, "Body text here");
  assert.equal(toIso(items[0].published), "2026-07-16T09:00:00.000Z");
  assert.equal(items[1].link, "https://ex.com/b");
});

test("parseFeed picks the rel=alternate link on Atom entries", () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://ex.com/entry-1");
  assert.equal(toIso(items[0].published), "2026-07-15T12:00:00.000Z");
});

test("discoverCandidates orders registered feed_url first, path probes before origin", () => {
  const c = discoverCandidates("https://ex.com/blog/", "https://ex.com/known.xml");
  assert.equal(c[0], "https://ex.com/known.xml");
  assert.ok(c.indexOf("https://ex.com/blog/feed/") < c.indexOf("https://ex.com/feed/"));
  assert.ok(!c.some((u, i) => c.indexOf(u) !== i), "no duplicates");
});

test("extractAlternateLinks resolves relative hrefs and filters non-feed links", () => {
  const html = `<html><head>
    <link rel="alternate" type="application/rss+xml" href="/found/feed.xml">
    <link rel="stylesheet" href="/x.css">
    <link rel="alternate" type="text/html" href="/mobile">
  </head></html>`;
  assert.deepEqual(extractAlternateLinks(html, "https://ex.com/page"), ["https://ex.com/found/feed.xml"]);
});

test("toIso returns null on garbage; decodeEntities handles numeric refs", () => {
  assert.equal(toIso("not a date"), null);
  assert.equal(toIso(null), null);
  assert.equal(decodeEntities("A &#38; B &#x26; C"), "A & B & C");
});
