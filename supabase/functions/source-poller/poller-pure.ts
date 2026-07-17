// poller-pure.ts — pure feed-discovery/parsing logic for the source-poller
// edge function (CC-SOURCE-SCALE-500 Wave 1, AUTO-199). Deno-free so tests can
// import it directly (ext-pure pattern).

export interface FeedItem {
  title: string;
  link: string | null;
  published: string | null; // raw date string as found
  summary: string;
}

/** Common feed-path suffixes probed during verification, in priority order. */
export const FEED_SUFFIXES = [
  "/feed/",
  "/feed",
  "/rss",
  "/rss/",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/blog/feed/",
  "/news/feed/",
  "/history.rss", // statuspage.io convention
  "/?feed=rss2",
];

/** Build the ordered candidate list for a source. Registered feed_url first,
 * then suffix probes on the page path (if any) and on the origin. */
export function discoverCandidates(homepage: string, feedUrl: string | null): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  if (feedUrl) push(feedUrl);
  let origin = "";
  let pathBase = "";
  try {
    const u = new URL(homepage);
    origin = u.origin;
    pathBase = u.pathname.replace(/\/+$/, "");
  } catch {
    return out;
  }
  for (const s of FEED_SUFFIXES) {
    if (pathBase && pathBase !== "") push(origin + pathBase + s);
  }
  for (const s of FEED_SUFFIXES) push(origin + s);
  return out;
}

/** Extract <link rel="alternate" type="application/rss+xml|atom+xml"> hrefs
 * from an HTML page (feed autodiscovery). Returns absolute URLs. */
export function extractAlternateLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (!/rel=["']?alternate["']?/i.test(tag)) continue;
    if (!/application\/(rss|atom)\+xml|application\/feed\+json/i.test(tag)) continue;
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m) continue;
    try {
      out.push(new URL(m[1], baseUrl).toString());
    } catch {
      /* skip bad href */
    }
  }
  return out;
}

/** Classify a fetched body as a feed. Returns 'rss' | 'atom' | 'json' | null. */
export function classifyFeed(contentType: string | null, body: string): "rss" | "atom" | "json" | null {
  const head = body.slice(0, 2000);
  if (/<rss[\s>]/i.test(head) || /<rdf:RDF/i.test(head)) return "rss";
  if (/<feed[\s>][^>]*/i.test(head) && /atom/i.test(head)) return "atom";
  if (/<feed[\s>]/i.test(head)) return "atom";
  const ct = (contentType ?? "").toLowerCase();
  // Trust a JSON content-type without parsing — callers may pass a TRUNCATED
  // body (multi-MB payloads like CISA KEV), which a full parse would reject.
  if (ct.includes("json")) return "json";
  if (head.trimStart().startsWith("{") || head.trimStart().startsWith("[")) {
    try {
      JSON.parse(body);
      return "json";
    } catch {
      return null;
    }
  }
  return null;
}

function textBetween(block: string, tag: string): string | null {
  // Handles <tag>, <tag attr=...>, CDATA, and namespaced closing tags.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return decodeEntities(stripCdata(m[1]).trim());
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse RSS 2.0 / RSS 1.0 / Atom into a flat item list (regex-based — edge
 * runtime has no XML DOMParser). Caps at `max` items. */
export function parseFeed(body: string, max = 50): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = body.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const entries = blocks.length ? blocks : body.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const isAtom = blocks.length === 0;
  for (const block of entries.slice(0, max)) {
    const title = textBetween(block, "title") ?? "";
    let link: string | null = null;
    if (isAtom) {
      // Atom: <link href="..."/>; prefer rel="alternate" or no rel
      const linkTags = block.match(/<link\b[^>]*\/?>/gi) ?? [];
      for (const tag of linkTags) {
        const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1] ?? "alternate";
        if (rel !== "alternate") continue;
        link = tag.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
        if (link) break;
      }
      if (!link) link = linkTags[0]?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
    } else {
      link = textBetween(block, "link") ?? textBetween(block, "guid");
    }
    const published =
      textBetween(block, "pubDate") ??
      textBetween(block, "published") ??
      textBetween(block, "updated") ??
      textBetween(block, "dc:date");
    const summaryRaw =
      textBetween(block, "description") ??
      textBetween(block, "summary") ??
      textBetween(block, "content") ??
      "";
    if (!title && !link) continue;
    items.push({
      title: stripTags(title),
      link: link ? decodeEntities(link.trim()) : null,
      published,
      summary: stripTags(summaryRaw).slice(0, 4000),
    });
  }
  return items;
}

/** Parse a published date string to ISO, or null when unparseable. */
export function toIso(published: string | null): string | null {
  if (!published) return null;
  const d = new Date(published);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
