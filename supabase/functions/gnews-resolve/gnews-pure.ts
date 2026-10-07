// gnews-pure.ts — pure + injectable-fetch logic for resolving Google News RSS
// redirect URLs to the publisher's article URL (FDY-90).
//
// Deno-free (the ext-pure pattern used by body-pure.ts / poller-pure.ts) so the
// node tests under test/ import it directly with no Deno shim.
//
// WHY THIS EXISTS
// Faraday's local-watch feeds (source_registry.source_key like 'gsearch:loc-%')
// are Google News RSS searches. Every item's <link> is a Google redirect of the
// form https://news.google.com/rss/articles/<token>?oc=5 — an aggregator URL,
// never a publisher URL. Boundstone must never store an aggregator URL (decision
// D2), and an article body cannot be fetched from a redirect stub, so the token
// has to be resolved to the publisher URL first.
//
// THREE LAYERED STRATEGIES, cheapest first:
//   (a) 'offline_token'  — legacy tokens are base64url protobuf that CONTAIN the
//       URL as a length-delimited string field. Zero network.
//   (b) 'redirect'       — GET the article URL following redirects; if the final
//       response lands on a non-Google host, that is the publisher URL. Also
//       sniffs the interstitial HTML for an embedded non-Google URL.
//   (c) 'batchexecute'   — the documented Google News `Fbv4je`/`garturlreq` RPC.
//       The interstitial page carries the request signature in data-n-a-sg and
//       the timestamp in data-n-a-ts; posting those back returns 'garturlres'
//       with the publisher URL.
//
// (b) and (c) SHARE ONE GET: the same interstitial fetch supplies both the final
// URL for (b) and the signature for (c), so a full resolution costs at most two
// requests to news.google.com (1 GET + 1 POST).
//
// MEASURED ON PRODUCTION (2026-10-07, 50 distinct tokens from the relevant
// subset): 0/50 resolve offline — every token in the 54,211-row local-watch
// corpus is the newer opaque 'AU_yqL…' form, which carries no URL. (a) is kept
// because it is free, correct, and the only strategy that works without network.
//
// NEVER GUESS: if all three fail the caller leaves publisher_url NULL.

export const GNEWS_RESOLVER_VERSION = "gnews-resolve_v1.0";

/** Honest User-Agent (FDY-90 requirement 5). */
export const GNEWS_USER_AGENT =
  "Faraday/1.0 (+https://faraday-intelligence.ai; contact: signals@faraday-intelligence.ai)";

export const GNEWS_BATCHEXECUTE_URL =
  "https://news.google.com/_/DotsSplashUi/data/batchexecute";

/** Hosts that are never a publisher: the aggregator itself and Google infra. */
const GOOGLE_HOST =
  /(^|\.)(google|googleusercontent|gstatic|googleapis|goo\.gl|youtube|blogger|google\.[a-z.]+)\.[a-z.]+$|(^|\.)google\.com$|(^|\.)g\.co$/i;

export type ResolveMethod = "offline_token" | "redirect" | "batchexecute";

export interface GnewsResolveOk {
  publisher_url: string;
  publisher_domain: string;
  resolve_method: ResolveMethod;
  error?: undefined;
}

export interface GnewsResolveErr {
  publisher_url?: undefined;
  publisher_domain?: undefined;
  resolve_method?: undefined;
  error: string;
}

export type GnewsResolution = GnewsResolveOk | GnewsResolveErr;

export interface GnewsResolveDeps {
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
  /** Skip the network entirely (offline strategy only). */
  offlineOnly?: boolean;
}

// ---------------------------------------------------------------- url helpers

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

export function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return h === "google.com" || h === "news.google.com" || GOOGLE_HOST.test(h);
}

/** Registrable-ish domain for grouping/politeness: host minus a leading 'www.'. */
export function publisherDomain(url: string): string {
  return hostOf(url).replace(/^www\./, "");
}

export function isGoogleNewsUrl(url: string): boolean {
  return /^https?:\/\/news\.google\.com\/(rss\/)?articles\//i.test(url.trim());
}

/** The opaque id between /articles/ and the query string. */
export function gnewsTokenFromUrl(url: string): string | null {
  const m = /\/articles\/([^/?#]+)/.exec(url);
  if (!m) return null;
  const tok = m[1].trim();
  return tok.length > 0 ? tok : null;
}

/** A usable publisher URL: absolute http(s) and not a Google host. */
export function isPublisherUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const h = hostOf(url);
  if (!h || !h.includes(".")) return false;
  return !isGoogleHost(h);
}

// ---------------------------------------------------------------- (a) offline token decode

/** base64url (padding optional) → bytes, without relying on Buffer. */
export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readVarint(b: Uint8Array, at: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let i = at;
  while (i < b.length) {
    const byte = b[i++];
    value += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) return { value, next: i };
    shift += 7;
    if (shift > 56) return null;
  }
  return null;
}

/**
 * Every length-delimited (wire type 2) field at the top level of the token's
 * protobuf, decoded as UTF-8. Unknown/garbled fields are skipped, never thrown.
 */
export function protobufStringFields(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  const dec = new TextDecoder("utf-8", { fatal: false });
  while (i < bytes.length) {
    const key = readVarint(bytes, i);
    if (!key) break;
    i = key.next;
    const wire = key.value & 0x07;
    if (wire === 2) {
      const len = readVarint(bytes, i);
      if (!len) break;
      i = len.next;
      if (len.value < 0 || i + len.value > bytes.length) break;
      out.push(dec.decode(bytes.subarray(i, i + len.value)));
      i += len.value;
    } else if (wire === 0) {
      const v = readVarint(bytes, i);
      if (!v) break;
      i = v.next;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      break; // groups (3/4) and anything else: stop, do not guess
    }
  }
  return out;
}

/**
 * Strategy (a). Legacy Google News tokens are a protobuf whose string field IS
 * the article URL. Returns null for the newer opaque 'AU_yqL…' tokens, which
 * carry no URL at all.
 */
export function decodeGnewsTokenOffline(token: string): string | null {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(token);
  } catch {
    return null;
  }
  for (const field of protobufStringFields(bytes)) {
    // The URL may be the whole field, or prefixed by a short binary marker.
    const m = /https?:\/\/[^\s"'<>\\]+/.exec(field);
    if (m && isPublisherUrl(m[0])) return m[0];
  }
  return null;
}

// ---------------------------------------------------------------- (b)/(c) interstitial parsing

export interface BatchexecuteSignature {
  signature: string;
  timestamp: number;
}

/** The `Fbv4je` request signature Google embeds in the interstitial page. */
export function extractBatchexecuteSignature(html: string): BatchexecuteSignature | null {
  const sg = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
  const ts = /data-n-a-ts="([^"]+)"/.exec(html)?.[1];
  if (!sg || !ts) return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { signature: sg, timestamp: n };
}

/**
 * The interstitial sometimes carries the destination inline (data-n-au, a meta
 * refresh, or a plain anchor). Cheap to check since we already hold the HTML.
 */
export function extractEmbeddedPublisherUrl(html: string): string | null {
  const patterns = [
    /data-n-au="([^"]+)"/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'>\s]+)/i,
    /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*rel="[^"]*noopener/i,
  ];
  for (const re of patterns) {
    const v = re.exec(html)?.[1];
    if (v) {
      const url = decodeHtmlAmp(v);
      if (isPublisherUrl(url)) return url;
    }
  }
  return null;
}

function decodeHtmlAmp(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/");
}

/** The `f.req` payload for the garturlreq RPC. */
export function buildGarturlReqBody(token: string, sig: BatchexecuteSignature): string {
  const inner = JSON.stringify([
    "garturlreq",
    [
      ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
      "X",
      "X",
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    token,
    sig.timestamp,
    sig.signature,
  ]);
  const freq = JSON.stringify([[["Fbv4je", inner, null, "generic"]]]);
  return new URLSearchParams({ "f.req": freq }).toString();
}

/**
 * Pull the publisher URL out of a batchexecute response. The body is the
 * anti-JSON-hijack prefix `)]}'` followed by nested JSON whose Fbv4je payload is
 * itself a JSON string: ["garturlres","<url>",1].
 */
export function parseGarturlRes(responseText: string): string | null {
  const body = responseText.replace(/^\)\]\}'/, "").trim();
  // The payload string is escaped inside the outer JSON, so match either form.
  const direct = /\\"garturlres\\",\\"(https?:(?:\\\/|\/)[^\\"]+)\\"/.exec(body)
    ?? /"garturlres","(https?:(?:\\\/|\/)[^"]+)"/.exec(body);
  if (direct) {
    const url = direct[1].replace(/\\\//g, "/");
    if (isPublisherUrl(url)) return url;
  }
  // Fallback: walk the structure properly.
  try {
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("[")) continue;
      const outer = JSON.parse(t);
      for (const entry of flatten(outer)) {
        if (typeof entry !== "string" || !entry.includes("garturlres")) continue;
        const inner = JSON.parse(entry);
        if (Array.isArray(inner) && typeof inner[1] === "string" && isPublisherUrl(inner[1])) {
          return inner[1];
        }
      }
    }
  } catch { /* unparseable ⇒ no URL, never a guess */ }
  return null;
}

function flatten(v: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) for (const x of v) flatten(x, out);
  else out.push(v);
  return out;
}

export function resolutionOf(url: string, method: ResolveMethod): GnewsResolveOk {
  return { publisher_url: url, publisher_domain: publisherDomain(url), resolve_method: method };
}

// ---------------------------------------------------------------- the resolver

/**
 * Resolve one Google News redirect URL to its publisher URL.
 *
 * Returns {publisher_url, publisher_domain, resolve_method} on success and
 * {error} on failure. NEVER returns a Google host as the publisher.
 *
 * At most two requests to news.google.com: one GET of the interstitial (which
 * serves strategy (b) and supplies the signature) and one POST to batchexecute.
 * The caller owns pacing.
 */
export async function resolveGnewsUrl(
  tokenUrl: string,
  deps: GnewsResolveDeps = {},
): Promise<GnewsResolution> {
  const token = gnewsTokenFromUrl(tokenUrl);
  if (!token) return { error: "not a Google News /articles/ URL" };

  // (a) offline
  const offline = decodeGnewsTokenOffline(token);
  if (offline) return resolutionOf(offline, "offline_token");
  if (deps.offlineOnly) return { error: "offline decode failed (opaque token)" };

  const doFetch = deps.fetchFn ?? fetch;
  const ua = deps.userAgent ?? GNEWS_USER_AGENT;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const headers = {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  };

  let html = "";
  try {
    const res = await doFetch(tokenUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // (b) redirect: the final URL left Google.
    const finalUrl = res.url ?? "";
    if (finalUrl && isPublisherUrl(finalUrl)) {
      // Drain so the connection is not left half-open.
      try { await res.text(); } catch { /* ignore */ }
      return resolutionOf(finalUrl, "redirect");
    }
    if (res.status === 404 || res.status === 410) return { error: `gone: HTTP ${res.status}` };
    if (res.status === 403 || res.status === 429) return { error: `blocked: HTTP ${res.status}` };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    html = await res.text();
  } catch (e) {
    return { error: `interstitial: ${String(e).slice(0, 200)}` };
  }

  // (b, continued) the destination is sometimes embedded in the page.
  const embedded = extractEmbeddedPublisherUrl(html);
  if (embedded) return resolutionOf(embedded, "redirect");

  // (c) batchexecute
  const sig = extractBatchexecuteSignature(html);
  if (!sig) return { error: "no batchexecute signature in interstitial" };
  try {
    const res = await doFetch(GNEWS_BATCHEXECUTE_URL, {
      method: "POST",
      headers: {
        "User-Agent": ua,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: buildGarturlReqBody(token, sig),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 403 || res.status === 429) return { error: `blocked: batchexecute HTTP ${res.status}` };
    if (!res.ok) return { error: `batchexecute HTTP ${res.status}` };
    const url = parseGarturlRes(await res.text());
    if (url) return resolutionOf(url, "batchexecute");
    return { error: "batchexecute returned no publisher URL" };
  } catch (e) {
    return { error: `batchexecute: ${String(e).slice(0, 200)}` };
  }
}
