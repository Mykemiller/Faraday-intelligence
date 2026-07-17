// Tests for the Wave-3 index-poll extractor (poller-index.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractIndexItems } from "../supabase/functions/source-poller/poller-index.ts";

const PAGE = `<html><body>
<nav><a href="/about">About us and our whole company story</a>
<a href="/contact">Contact our team for any questions here</a></nav>
<main>
  <a href="/news/2026/07/grid-expansion-approved-for-region">Grid expansion approved for west region substations</a>
  <a href="/news/2026/07/grid-expansion-approved-for-region#comments">Grid expansion approved for west region substations</a>
  <a href="/news/2026/06/new-interconnection-rules"><span>New interconnection rules take effect next month</span></a>
  <a href="https://other-site.com/news/2026/07/external-story">External syndicated story about power markets</a>
  <a href="/newsletter">Sign up for our newsletter today please</a>
  <a href="/news/short">Too short</a>
  <a href="/tag/energy">Energy coverage tagged archive listing page</a>
  <a href="/media/annual-report.pdf">Download our annual report as a PDF file</a>
</main></body></html>`;

test("extractIndexItems keeps article links, drops nav/junk/offsite/short/dupes", () => {
  const items = extractIndexItems(PAGE, "https://ex.com/news");
  assert.deepEqual(items.map((i) => i.link), [
    "https://ex.com/news/2026/07/grid-expansion-approved-for-region",
    "https://ex.com/news/2026/06/new-interconnection-rules",
  ]);
  assert.equal(items[0].title, "Grid expansion approved for west region substations");
  assert.equal(items[0].published, null);
});

test("config overrides: include pattern, min_text, same_host off", () => {
  const offsite = extractIndexItems(PAGE, "https://ex.com/news", { same_host: false });
  assert.ok(offsite.some((i) => i.link.startsWith("https://other-site.com/")));
  const strict = extractIndexItems(PAGE, "https://ex.com/news", { include: "interconnection" });
  assert.equal(strict.length, 1);
  const loose = extractIndexItems(PAGE, "https://ex.com/news", { min_text: 5 });
  assert.ok(loose.some((i) => i.link === "https://ex.com/news/short"));
});

test("bad base URL and empty html are safe", () => {
  assert.deepEqual(extractIndexItems(PAGE, "not a url"), []);
  assert.deepEqual(extractIndexItems("", "https://ex.com"), []);
});
