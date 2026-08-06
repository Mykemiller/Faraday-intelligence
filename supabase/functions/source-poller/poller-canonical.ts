// poller-canonical.ts — CC-BOUNDSTONE-INGEST-1.1 §4 (FAR-418).
// URL canonicalization + pre-enrichment document hashing for the source-poller.
// Deno-free (ext-pure pattern) so tests import it directly.
//
// THE BUG THIS FIXES
// `artifacts.content_hash` was sha256(`${source_key}|${link}`) at the poller,
// but the *effective* novelty check downstream ran over LLM summary text that
// re-words itself on every run. An index-polled landing page therefore re-emits
// its whole contents as novel on every poll: one press release was observed at
// 20+ artifact rows over 25 days, burying live items under weeks-old ones.
//
// The fix has three independent parts, and all three must hold:
//   1. canonicalizeUrl  — two URLs for the same document must collapse to one
//                         string BEFORE anything is hashed or compared.
//   2. normalizeDocument — hash the fetched DOCUMENT, stripped of the chrome
//                         that changes between requests, never a summary.
//   3. isStaleIndexItem — an index poller re-reads the same landing page every
//                         run; an item older than the source's own cadence
//                         window is `seen`, not `new`.

/** Query parameters that never identify a different document. Exact names plus
 * the `utm_*` family. Order matters only for readability. */
export const TRACKING_PARAMS = [
  "_sp",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
];

/** True for a parameter that carries campaign/attribution noise rather than
 * document identity. */
export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("utm_") || TRACKING_PARAMS.includes(n);
}

/** Hosts/paths that syndicate a publisher's item under a redirect wrapper.
 * A wrapper URL will never match the canonical URL a human cites, so the same
 * document enters the corpus twice and neither copy matches a correction.
 * Detection is structural, not a vendor list — see §6.7: no proper nouns. */
export function looksLikeRedirectWrapper(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  // `feeds.<publisher>/link/<id>/<slug>` and the `/~r/<feed>/~3/<id>/` shape
  // used by the common feed-proxy conventions.
  if (host.startsWith("feeds.") || host.startsWith("feedproxy.")) return true;
  if (/\/~r\/|\/~3\//.test(path)) return true;
  if (/^\/(rss|feed)\/articles\//i.test(path)) return true;
  if (/^\/link\/\d+\//.test(path)) return true;
  // A URL whose only job is to carry a destination in a query parameter.
  if (u.searchParams.has("url") && /\/(out|away|redirect|r)\b/i.test(path)) return true;
  return false;
}

/** If a wrapper carries its destination in a query parameter, return it. This
 * is the zero-network half of wrapper resolution; the network hop lives in the
 * caller so this module stays pure. */
export function unwrapQueryRedirect(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  for (const key of ["url", "u", "target", "redirect"]) {
    const v = u.searchParams.get(key);
    if (v && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

/**
 * Canonicalize a URL for identity comparison.
 *   - lowercase scheme + host, drop a default port
 *   - strip every tracking parameter, keep the rest in stable (sorted) order
 *   - strip the fragment
 *   - strip a trailing slash (but never reduce the path to empty)
 * Returns the input unchanged when it does not parse — a malformed URL is data,
 * not an error, and must not crash a poll.
 */
export function canonicalizeUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!isTrackingParam(k)) kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  // Rebuild rather than mutate: deleting while iterating searchParams skips entries.
  const qs = new URLSearchParams();
  for (const [k, v] of kept) qs.append(k, v);
  u.search = qs.toString() ? `?${qs.toString()}` : "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
    if (u.pathname === "") u.pathname = "/";
  }
  return u.toString();
}

/**
 * Reduce fetched bytes to the stable text of the document.
 * Strips: script/style/noscript bodies, HTML comments, and the nav/header/
 * footer/aside boilerplate that carries rotating promo content; then strips
 * remaining tags and collapses whitespace.
 *
 * The point is a hash that is identical across two fetches of an unchanged
 * document and different when the document itself changes. It is deliberately
 * NOT a readability extractor — a lossy-but-deterministic reduction is exactly
 * what an identity hash wants.
 */
export function normalizeDocument(body: string): string {
  if (!body) return "";
  let s = body;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Cadence → the window, in hours, within which an index-polled item is still
 * plausibly "new". Mirrors poller-relevance.ts CADENCE_MINUTES; unknown
 * cadences are treated as daily. */
const CADENCE_HOURS: Record<string, number> = {
  hourly: 1,
  daily: 24,
  weekly: 7 * 24,
  event_driven: 24,
  archival_refresh: 27 * 24,
  one_time: 365 * 24,
};

export function cadenceWindowHours(cadence: string): number {
  return CADENCE_HOURS[cadence] ?? CADENCE_HOURS.daily;
}

/**
 * §4.4 — an index poller re-reads the same landing page on every run. An item
 * whose published_at predates the source's last_artifact_at by more than its
 * cadence window has already had its chance to be new.
 *
 * Deliberately conservative: an item with NO published_at is never suppressed.
 * Suppressing an undated item would silently drop live coverage from every
 * portal that omits dates, which is most commission portals — the exact
 * failure this CC exists to end. Undated items fall through to the raw_hash
 * check instead, which is the correct gate for them.
 */
export function isStaleIndexItem(
  publishedAt: string | null,
  lastArtifactAt: string | null,
  cadence: string,
): boolean {
  if (!publishedAt || !lastArtifactAt) return false;
  const pub = Date.parse(publishedAt);
  const last = Date.parse(lastArtifactAt);
  if (isNaN(pub) || isNaN(last)) return false;
  return last - pub > cadenceWindowHours(cadence) * 3600_000;
}
