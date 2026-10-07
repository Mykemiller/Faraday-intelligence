// Tests for the Google News redirect resolver (FDY-90).
//
// Every test is HERMETIC: the only network access is a stub `fetchFn` replaying
// bytes captured read-only from production and from Google on 2026-10-07. The
// fixture (test/fixtures/gnews-tokens.json) holds 50 real local-watch item
// tokens, 12 verbatim Google batchexecute responses, and one verbatim
// interstitial page carrying the real data-n-a-sg / data-n-a-ts attributes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  base64UrlToBytes,
  buildGarturlReqBody,
  decodeGnewsTokenOffline,
  extractBatchexecuteSignature,
  extractEmbeddedPublisherUrl,
  GNEWS_BATCHEXECUTE_URL,
  GNEWS_RESOLVER_VERSION,
  GNEWS_USER_AGENT,
  gnewsTokenFromUrl,
  hostOf,
  isGoogleHost,
  isGoogleNewsUrl,
  isPublisherUrl,
  parseGarturlRes,
  protobufStringFields,
  publisherDomain,
  resolveGnewsUrl,
} from "../supabase/functions/gnews-resolve/gnews-pure.ts";
import {
  GNEWS_LANE,
  GNEWS_METADATA_KEYS,
  GNEWS_RESTRICTION_RE,
  gnewsCrawlMetadataPatch,
  gnewsMetadataDelta,
  gnewsResolveBlocked,
  RESOLVE_MAX_ATTEMPTS,
} from "../supabase/functions/gnews-resolve/gnews-store.ts";

const FIX = JSON.parse(
  readFileSync(new URL("./fixtures/gnews-tokens.json", import.meta.url), "utf8"),
);

const tokenUrl = (t) => `https://news.google.com/rss/articles/${t}?oc=5`;

/** Replays the fixture: GET -> captured interstitial, POST -> that token's body. */
function stubFetch(byToken, opts = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    if (String(url) === GNEWS_BATCHEXECUTE_URL) {
      const body = new URLSearchParams(init.body).get("f.req");
      const token = Object.keys(byToken).find((t) => body.includes(t));
      if (opts.batchStatus && opts.batchStatus !== 200) {
        return new Response("", { status: opts.batchStatus });
      }
      return new Response(byToken[token] ?? "", { status: 200 });
    }
    if (opts.getStatus && opts.getStatus !== 200) {
      return new Response("", { status: opts.getStatus });
    }
    const res = new Response(opts.html ?? FIX.interstitial_html, { status: 200 });
    // Response.url is read-only; the resolver reads it to detect a redirect off Google.
    Object.defineProperty(res, "url", { value: opts.finalUrl ?? String(url) });
    return res;
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------- url helpers

test("gnewsTokenFromUrl extracts the opaque id and ignores the query", () => {
  const t = FIX.verbatim_captures[0].token;
  assert.equal(gnewsTokenFromUrl(tokenUrl(t)), t);
  assert.equal(gnewsTokenFromUrl(`https://news.google.com/articles/${t}`), t);
  assert.equal(gnewsTokenFromUrl("https://news.google.com/rss/search?q=x"), null);
});

test("isGoogleNewsUrl recognises both /articles/ and /rss/articles/ forms", () => {
  assert.ok(isGoogleNewsUrl("https://news.google.com/rss/articles/CBMiabc?oc=5"));
  assert.ok(isGoogleNewsUrl("https://news.google.com/articles/CBMiabc"));
  assert.ok(!isGoogleNewsUrl("https://www.cincinnati.com/story/x"));
});

test("isPublisherUrl rejects every Google host and non-absolute input", () => {
  for (const bad of [
    "https://news.google.com/rss/articles/CBMiabc",
    "https://google.com/x",
    "https://www.google.co.uk/x",
    "https://lh3.googleusercontent.com/x",
    "https://www.youtube.com/watch?v=1",
    "/relative/path",
    "ftp://example.com/x",
    "https://localhost/x",
  ]) assert.equal(isPublisherUrl(bad), false, bad);
  for (const good of [
    "https://www.cincinnati.com/story/x",
    "https://www.lowellma.gov/m/NewsFlash/Home/Detail/1062",
    "http://example.co.uk/a",
  ]) assert.equal(isPublisherUrl(good), true, good);
});

test("publisherDomain strips www and lowercases", () => {
  assert.equal(publisherDomain("https://WWW.Cincinnati.com/story/x"), "cincinnati.com");
  assert.equal(publisherDomain("https://pirg.org/articles/a/"), "pirg.org");
  assert.equal(hostOf("not a url"), "");
  assert.ok(isGoogleHost("news.google.com"));
});

// ---------------------------------------------------------------- (a) offline decode

test("base64UrlToBytes handles unpadded base64url", () => {
  assert.deepEqual([...base64UrlToBytes("aGk")], [0x68, 0x69]);
  assert.deepEqual([...base64UrlToBytes("-_8")], [0xfb, 0xff]);
});

test("strategy (a) decodes a legacy URL-bearing token offline, zero network", async () => {
  const { token, expected_publisher_url } = FIX.legacy_token;
  assert.equal(decodeGnewsTokenOffline(token), expected_publisher_url);
  const fetchFn = stubFetch({});
  const r = await resolveGnewsUrl(tokenUrl(token), { fetchFn });
  assert.deepEqual(r, {
    publisher_url: expected_publisher_url,
    publisher_domain: "examplepublisher.com",
    resolve_method: "offline_token",
  });
  assert.equal(fetchFn.calls.length, 0, "offline strategy must make no request");
});

test("strategy (a) never returns a Google host even when the token embeds one", () => {
  assert.equal(decodeGnewsTokenOffline(FIX.legacy_token_google_host.token), null);
});

test("protobufStringFields tolerates garbage without throwing", () => {
  for (const s of ["", "AAAA", "////", "CBMi", "____----"]) {
    assert.ok(Array.isArray(protobufStringFields(base64UrlToBytes(s))));
    assert.equal(decodeGnewsTokenOffline(s), null);
  }
});

test("PRODUCTION FACT: no local-watch token is offline-decodable", () => {
  // Measured live: 0 of 54,211 local-watch artifacts carry a legacy URL token.
  assert.equal(FIX.live_measurement.offline_decodable, 0);
  for (const row of FIX.live_measurement.rows) {
    assert.equal(decodeGnewsTokenOffline(row.token), null, row.token);
  }
});

// ---------------------------------------------------------------- (b) redirect

test("strategy (b) uses the final URL when the GET leaves Google", async () => {
  const t = FIX.verbatim_captures[0].token;
  const fetchFn = stubFetch({}, { finalUrl: "https://www.cincinnati.com/story/news/x/" });
  const r = await resolveGnewsUrl(tokenUrl(t), { fetchFn });
  assert.equal(r.resolve_method, "redirect");
  assert.equal(r.publisher_domain, "cincinnati.com");
  assert.equal(fetchFn.calls.length, 1, "a redirect resolution costs one request");
});

test("strategy (b) also reads a destination embedded in the interstitial", async () => {
  const html = `<html><body><div data-n-au="https://www.example-news.org/a?x=1&amp;y=2"></div></body></html>`;
  assert.equal(
    extractEmbeddedPublisherUrl(html),
    "https://www.example-news.org/a?x=1&y=2",
  );
  assert.equal(extractEmbeddedPublisherUrl(`<div data-n-au="https://news.google.com/x">`), null);
  const fetchFn = stubFetch({}, { html });
  const r = await resolveGnewsUrl(tokenUrl(FIX.verbatim_captures[0].token), { fetchFn });
  assert.equal(r.resolve_method, "redirect");
  assert.equal(r.publisher_domain, "example-news.org");
});

// ---------------------------------------------------------------- (c) batchexecute

test("extractBatchexecuteSignature reads the real captured interstitial", () => {
  const sig = extractBatchexecuteSignature(FIX.interstitial_html);
  assert.ok(sig, "signature must be found in the verbatim capture");
  assert.match(sig.signature, /^[A-Za-z0-9_-]{10,}$/);
  assert.ok(sig.timestamp > 1_700_000_000);
  assert.equal(extractBatchexecuteSignature("<html></html>"), null);
  assert.equal(extractBatchexecuteSignature('<div data-n-a-sg="x" data-n-a-ts="nope">'), null);
});

test("buildGarturlReqBody carries token, timestamp and signature in f.req", () => {
  const body = buildGarturlReqBody("TOK123", { signature: "SIG456", timestamp: 1791402017 });
  const freq = new URLSearchParams(body).get("f.req");
  assert.ok(freq.includes("Fbv4je") && freq.includes("garturlreq"));
  const outer = JSON.parse(freq);
  const inner = JSON.parse(outer[0][0][1]);
  assert.equal(inner[0], "garturlreq");
  assert.equal(inner[2], "TOK123");
  assert.equal(inner[3], 1791402017);
  assert.equal(inner[4], "SIG456");
});

test("parseGarturlRes reads all 12 verbatim Google responses", () => {
  assert.equal(FIX.verbatim_captures.length, 12);
  for (const c of FIX.verbatim_captures) {
    assert.ok(c.batchexecute_response.startsWith(")]}'"), "verbatim body keeps the XSSI prefix");
    const url = parseGarturlRes(c.batchexecute_response);
    assert.equal(url, c.expected_publisher_url, c.token);
    assert.ok(isPublisherUrl(url));
  }
});

test("parseGarturlRes refuses junk rather than guessing", () => {
  for (const junk of [
    "",
    ")]}'\n\n[[\"wrb.fr\",\"Fbv4je\",null,null,null,null,\"generic\"]]",
    ")]}'\n\nnot json at all",
    ")]}'\n\n[[\"wrb.fr\",\"Fbv4je\",\"[\\\"garturlres\\\",\\\"https://news.google.com/x\\\",1]\"]]",
  ]) assert.equal(parseGarturlRes(junk), null, junk.slice(0, 40));
});

test("strategy (c) resolves end-to-end over the verbatim captures in two requests", async () => {
  const byToken = Object.fromEntries(
    FIX.verbatim_captures.map((c) => [c.token, c.batchexecute_response]),
  );
  for (const c of FIX.verbatim_captures) {
    const fetchFn = stubFetch(byToken);
    const r = await resolveGnewsUrl(tokenUrl(c.token), { fetchFn });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.publisher_url, c.expected_publisher_url);
    assert.equal(r.publisher_domain, publisherDomain(c.expected_publisher_url));
    assert.equal(r.resolve_method, "batchexecute");
    assert.equal(fetchFn.calls.length, 2, "one GET + one POST");
    assert.equal(fetchFn.calls[0].method, "GET");
    assert.equal(fetchFn.calls[1].url, GNEWS_BATCHEXECUTE_URL);
  }
});

// ---------------------------------------------------------------- failure handling

test("resolver reports, never guesses, when every strategy fails", async () => {
  const cases = [
    [{ getStatus: 404 }, /gone: HTTP 404/],
    [{ getStatus: 410 }, /gone: HTTP 410/],
    [{ getStatus: 403 }, /blocked: HTTP 403/],
    [{ getStatus: 429 }, /blocked: HTTP 429/],
    [{ getStatus: 500 }, /HTTP 500/],
    [{ html: "<html><body>no signature</body></html>" }, /no batchexecute signature/],
    [{ batchStatus: 429 }, /blocked: batchexecute HTTP 429/],
    [{ batchStatus: 500 }, /batchexecute HTTP 500/],
  ];
  for (const [opts, re] of cases) {
    const fetchFn = stubFetch({}, opts);
    const r = await resolveGnewsUrl(tokenUrl(FIX.verbatim_captures[0].token), { fetchFn });
    assert.equal(r.publisher_url, undefined);
    assert.match(r.error, re);
  }
});

test("resolver rejects a non-Google-News URL and a thrown fetch", async () => {
  assert.match((await resolveGnewsUrl("https://example.com/a")).error, /not a Google News/);
  const boom = async () => { throw new Error("ENOTFOUND"); };
  const r = await resolveGnewsUrl(tokenUrl("CBMiabc"), { fetchFn: boom });
  assert.match(r.error, /interstitial: .*ENOTFOUND/);
});

test("offlineOnly makes no request at all", async () => {
  const fetchFn = stubFetch({});
  const r = await resolveGnewsUrl(tokenUrl(FIX.verbatim_captures[0].token), { fetchFn, offlineOnly: true });
  assert.match(r.error, /opaque token/);
  assert.equal(fetchFn.calls.length, 0);
});

test("the honest User-Agent is sent on both requests", async () => {
  const seen = [];
  const byToken = { [FIX.verbatim_captures[0].token]: FIX.verbatim_captures[0].batchexecute_response };
  const base = stubFetch(byToken);
  const fetchFn = async (url, init = {}) => { seen.push(init.headers["User-Agent"]); return base(url, init); };
  await resolveGnewsUrl(tokenUrl(FIX.verbatim_captures[0].token), { fetchFn });
  assert.equal(seen.length, 2);
  for (const ua of seen) assert.equal(ua, GNEWS_USER_AGENT);
  assert.match(GNEWS_USER_AGENT, /^Faraday\/1\.0 \(\+https:\/\/.+contact: .+@.+\)$/);
});

// ---------------------------------------------------------------- measured rate (acceptance)

test("ACCEPTANCE: >=90% of the 50-token production fixture resolved live", () => {
  const m = FIX.live_measurement;
  assert.equal(m.tokens, 50);
  const rate = m.resolved / m.tokens;
  assert.ok(rate >= 0.9, `measured ${(100 * rate).toFixed(1)}%`);
  for (const row of m.rows) {
    assert.ok(isPublisherUrl(row.publisher_url), row.token);
    assert.equal(row.publisher_domain, publisherDomain(row.publisher_url));
    assert.ok(["offline_token", "redirect", "batchexecute"].includes(row.resolve_method));
  }
  // No aggregator URL may ever appear as a resolved publisher URL (decision D2).
  assert.equal(m.rows.filter((r) => /news\.google\.com/.test(r.publisher_url)).length, 0);
});

// ---------------------------------------------------------------- storage shape

test("crawl_metadata patch adds only the new keys and never touches source_url", () => {
  const existing = {
    mode: "poller",
    feed_url: "https://news.google.com/rss/search?q=x",
    fetched_at: "2026-09-05T19:12:21.977Z",
  };
  const patch = gnewsCrawlMetadataPatch(existing, {
    publisher_url: "https://www.cincinnati.com/story/x/",
    publisher_domain: "cincinnati.com",
    resolve_method: "batchexecute",
  }, { attempts: 1, at: "2026-10-09T22:00:00.000Z" });
  // Pre-existing keys survive byte-for-byte.
  for (const k of Object.keys(existing)) assert.equal(patch[k], existing[k]);
  assert.equal(patch.publisher_url, "https://www.cincinnati.com/story/x/");
  assert.equal(patch.publisher_domain, "cincinnati.com");
  assert.equal(patch.resolve_method, "batchexecute");
  assert.equal(patch.resolve_attempts, 1);
  assert.equal(patch.resolved_at, "2026-10-09T22:00:00.000Z");
  assert.equal(patch.resolve_error, null);
  assert.ok(!("source_url" in patch), "the resolver never writes source_url");
  assert.ok(!("raw_content" in patch), "the resolver never writes raw_content");
  assert.ok(!("body_text" in patch));
  assert.deepEqual(
    Object.keys(patch).filter((k) => !(k in existing)).sort(),
    ["publisher_domain", "publisher_url", "resolve_attempts", "resolve_error", "resolved_at", "resolve_method"].sort(),
  );
});

test("a failed resolution records the error and leaves publisher_url absent", () => {
  const patch = gnewsCrawlMetadataPatch({ feed_url: "f" }, { error: "batchexecute HTTP 500" },
    { attempts: 2, at: "2026-10-09T22:00:00.000Z" });
  assert.equal(patch.publisher_url, undefined);
  assert.equal(patch.publisher_domain, undefined);
  assert.equal(patch.resolve_method, undefined);
  assert.equal(patch.resolve_error, "batchexecute HTTP 500");
  assert.equal(patch.resolve_attempts, 2);
  assert.equal(patch.feed_url, "f");
});

test("resolution is never retried more than three times", () => {
  assert.equal(RESOLVE_MAX_ATTEMPTS, 3);
  assert.equal(gnewsResolveBlocked({ resolve_attempts: 2 }), false);
  assert.equal(gnewsResolveBlocked({ resolve_attempts: 3 }), true);
  assert.equal(gnewsResolveBlocked({ resolve_attempts: 9 }), true);
  assert.equal(gnewsResolveBlocked({}), false);
});

test("the delta carries ONLY the six allowed keys, and the patch is that merge", () => {
  const existing = { mode: "poller", feed_url: "f", fetched_at: "t" };
  const ctx = { attempts: 1, at: "2026-10-09T22:00:00.000Z" };
  for (const resolution of [
    { publisher_url: "https://a.example/x", publisher_domain: "a.example", resolve_method: "redirect" },
    { error: "boom" },
    {},
  ]) {
    const delta = gnewsMetadataDelta(resolution, ctx);
    for (const k of Object.keys(delta)) {
      assert.ok(GNEWS_METADATA_KEYS.includes(k), `delta key ${k} is not allowed`);
    }
    // Exactly what the SQL `crawl_metadata || p_delta` produces.
    assert.deepEqual(gnewsCrawlMetadataPatch(existing, resolution, ctx), { ...existing, ...delta });
  }
  assert.equal(gnewsMetadataDelta({}, ctx).resolve_error, "unresolved");
  assert.equal(gnewsMetadataDelta({ publisher_url: "https://a.example/x" }, ctx).publisher_url, undefined,
    "a partial resolution is treated as a failure, never half-written");
  assert.equal(gnewsMetadataDelta({}, { attempts: 99, at: "t" }).resolve_attempts, RESOLVE_MAX_ATTEMPTS);
});

test("the restriction-keyword ordering matches the issue's keyword list", () => {
  assert.equal(GNEWS_LANE, "gnews_local");
  for (const hit of [
    "County weighs a moratorium",
    "Council votes to ban data centers",
    "Board approves a pause",
    "New data center ordinance adopted",
    "Commission to rezone the parcel",
    "Zoning change advances",
    "MORATORIUMS everywhere",
  ]) assert.ok(GNEWS_RESTRICTION_RE.test(hit), hit);
  for (const miss of [
    "GoPro pivots into data centers as shares skyrocket",
    "Google invests in Arkansas solar",
  ]) assert.equal(GNEWS_RESTRICTION_RE.test(miss), false, miss);
});

test("the resolver version string is stable and recorded", () => {
  assert.equal(GNEWS_RESOLVER_VERSION, "gnews-resolve_v1.0");
});
