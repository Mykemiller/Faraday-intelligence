// CC-BOUNDSTONE-INGEST-1.1 §4 (FAR-418) — dedupe.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  canonicalizeUrl,
  cadenceWindowHours,
  isStaleIndexItem,
  isTrackingParam,
  looksLikeRedirectWrapper,
  normalizeDocument,
  unwrapQueryRedirect,
} from "../supabase/functions/source-poller/poller-canonical.ts";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
/** Mirrors source-poller itemRawHash(). */
const rawHash = (canonical, text) =>
  canonical ? sha256(`url:${canonical}`) : sha256(`txt:${normalizeDocument(text)}`);

test("§4.1 tracking parameters are stripped, real ones survive in stable order", () => {
  assert.equal(
    canonicalizeUrl("https://Example.COM/news/a?utm_source=x&id=7&utm_medium=y&fbclid=z"),
    "https://example.com/news/a?id=7",
  );
  // Parameter ORDER must not create two identities for one document.
  assert.equal(
    canonicalizeUrl("https://example.com/a?b=2&a=1"),
    canonicalizeUrl("https://example.com/a?a=1&b=2"),
  );
  assert.ok(isTrackingParam("utm_campaign"));
  assert.ok(isTrackingParam("mc_eid"));
  assert.ok(!isTrackingParam("docket"));
});

test("§4.1 fragment, trailing slash and default port collapse", () => {
  const want = "https://example.com/news/a";
  for (
    const u of [
      "https://example.com/news/a#section-2",
      "https://example.com/news/a/",
      "https://example.com:443/news/a",
    ]
  ) {
    assert.equal(canonicalizeUrl(u), want, u);
  }
  // A bare origin must not lose its path entirely.
  assert.equal(canonicalizeUrl("https://example.com/"), "https://example.com/");
});

test("§4.1 a malformed URL is data, not an error", () => {
  assert.equal(canonicalizeUrl("not a url"), "not a url");
  assert.equal(canonicalizeUrl(null), "");
  assert.equal(canonicalizeUrl(undefined), "");
});

test("§4.1 feed redirect wrappers are recognised structurally, not by vendor", () => {
  assert.ok(looksLikeRedirectWrapper("https://feeds.publisher.example/link/12345/9876/slug"));
  assert.ok(looksLikeRedirectWrapper("https://news.example.com/rss/articles/abc123"));
  assert.ok(looksLikeRedirectWrapper("https://feedproxy.example.net/~r/somefeed/~3/xyz/"));
  assert.ok(!looksLikeRedirectWrapper("https://www.commission.example.gov/orders/2026-14.pdf"));
  // Query-carried destinations unwrap without a network hop.
  assert.equal(
    unwrapQueryRedirect("https://example.com/out?url=https%3A%2F%2Freal.example.gov%2Fdoc"),
    "https://real.example.gov/doc",
  );
});

test("§4.2 normalizeDocument strips chrome and is stable across re-fetches", () => {
  const a = `<html><head><style>.x{color:red}</style></head><body>
    <nav>Home About Subscribe</nav>
    <p>The commission suspended large load interconnection.</p>
    <footer>(c) 2026 · promo of the day: 41</footer>
    <script>analytics(1)</script></body></html>`;
  // Same document, different rotating promo and whitespace.
  const b = `<html><head><style>.x{color:blue}</style></head><body>
    <nav>Home   About Subscribe</nav>
    <p>The commission suspended large load interconnection.</p>
    <footer>(c) 2026 · promo of the day: 92</footer>
    <script>analytics(2)</script></body></html>`;
  assert.equal(normalizeDocument(a), normalizeDocument(b));
  assert.equal(normalizeDocument(a), "The commission suspended large load interconnection.");
  // A genuine content change must change the hash.
  const c = a.replace("suspended", "approved");
  assert.notEqual(normalizeDocument(a), normalizeDocument(c));
});

test("§4.4 index-poll items older than the cadence window are seen, not new", () => {
  const lastArtifact = "2026-08-06T00:00:00Z";
  // Published 10 days before the last artifact, on a daily source → stale.
  assert.equal(isStaleIndexItem("2026-07-27T00:00:00Z", lastArtifact, "daily"), true);
  // Published today → new.
  assert.equal(isStaleIndexItem("2026-08-06T00:00:00Z", lastArtifact, "daily"), false);
  // A weekly source gets a wider window.
  assert.equal(isStaleIndexItem("2026-08-02T00:00:00Z", lastArtifact, "weekly"), false);
  assert.equal(cadenceWindowHours("weekly"), 168);
  // An UNDATED item is never suppressed — most commission portals omit dates,
  // and suppressing them is the failure this CC exists to end.
  assert.equal(isStaleIndexItem(null, lastArtifact, "daily"), false);
  // Nor is anything suppressed on a source that has never produced.
  assert.equal(isStaleIndexItem("2020-01-01T00:00:00Z", null, "daily"), false);
});

test("§11 the repeat-ingestion fixture collapses to ONE row, at its true date", () => {
  // Appendix A.1 item 2: one market-operator protocol revision, published once,
  // re-emitted across 25 days AND arriving through many query lanes at once.
  // Each replay row is the same document reached by a different route.
  const published = "2026-06-18T14:00:00Z";
  const replays = [
    { source_key: "gsearch:op-alpha", link: "https://www.market.example.com/notices/rev-1102" },
    { source_key: "gsearch:op-beta", link: "https://www.market.example.com/notices/rev-1102?utm_source=news" },
    { source_key: "gsearch:op-gamma", link: "https://www.market.example.com/notices/rev-1102/" },
    { source_key: "feed:trade-press", link: "https://www.market.example.com/notices/rev-1102#summary" },
    { source_key: "gsearch:op-delta", link: "https://WWW.MARKET.EXAMPLE.COM/notices/rev-1102" },
  ];

  // OLD key: sha256(source_key|link) — what production used. Every lane is new.
  const oldKeys = new Set(replays.map((r) => sha256(`${r.source_key}|${r.link}`)));
  assert.equal(oldKeys.size, 5, "the old key could not collapse these — that is the bug");

  // NEW key: document identity, scoped to the crawler, source_key ABSENT.
  const newKeys = new Set(replays.map((r) => rawHash(canonicalizeUrl(r.link), "")));
  assert.equal(newKeys.size, 1, "one document must produce exactly one row");

  // And it keeps its true publication date rather than the discovery date.
  assert.equal(new Date(published).toISOString(), "2026-06-18T14:00:00.000Z");
});

test("§4.3 an item with no link falls back to normalized text, not to collapsing", () => {
  // Two DIFFERENT untitled blurbs must not collide just because both lack links.
  const a = rawHash("", "Commission suspends large load interconnection");
  const b = rawHash("", "Commission approves large load interconnection");
  assert.notEqual(a, b);
  // The same blurb with different whitespace must collide.
  const c = rawHash("", "Commission   suspends\nlarge load interconnection");
  assert.equal(a, c);
});
