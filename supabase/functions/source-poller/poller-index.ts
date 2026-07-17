// poller-index.ts — generic HTML index-poll adapter for the source-poller
// (CC-SOURCE-SCALE-500 Wave 3). Deno-free (ext-pure pattern).
//
// For sources with no RSS/Atom/JSON feed, we poll their news-index page and
// extract article links heuristically. A source row can override the defaults
// via fetch_config.index_poll = { include, exclude, min_text, min_items,
// same_host } — config is data, tune without a redeploy.

import type { FeedItem } from "./poller-pure.ts";
import { decodeEntities } from "./poller-pure.ts";

export interface IndexPollConfig {
  include?: string; // regex an article URL must match (defaults to article-ish paths)
  exclude?: string; // regex that disqualifies a URL (extends the built-in junk list)
  min_text?: number; // minimum link-text length (default 25 — filters nav links)
  min_items?: number; // links needed for verify to activate (default 8)
  same_host?: boolean; // restrict to the index page's host (default true)
}

/** Article-ish URL shapes: dated paths, news/press/blog sections, long slugs. */
const DEFAULT_INCLUDE =
  /\/20\d\d[\/-]|\/(news|press|blog|article|articles|story|stories|release|releases|insights|newsroom|media|announcements|posts?)\/[^\/]|[a-z0-9]-[a-z0-9-]{20,}/i;

/** Chrome/junk that never counts as an article. */
const DEFAULT_EXCLUDE =
  /\/(tag|tags|category|categories|author|authors|page|search|login|signin|signup|subscribe|newsletter|account|privacy|terms|cookie|contact|about|careers|jobs|events?|advertis|sitemap|feed|rss)([\/?#]|$)|\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml|zip)([?#]|$)|mailto:|javascript:|^#/i;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Extract candidate article links from an index page. Returns FeedItems with
 * null published dates (discovery time is the artifact's timeline anchor). */
export function extractIndexItems(html: string, baseUrl: string, cfg: IndexPollConfig = {}, max = 30): FeedItem[] {
  const include = cfg.include ? new RegExp(cfg.include, "i") : DEFAULT_INCLUDE;
  const exclude = cfg.exclude ? new RegExp(cfg.exclude, "i") : null;
  const minText = cfg.min_text ?? 25;
  const sameHost = cfg.same_host ?? true;
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).host.replace(/^www\./, "");
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const items: FeedItem[] = [];
  // Anchor tags with their inner content (non-greedy; tolerates nested markup).
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && items.length < max) {
    const href = m[1].match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const text = decodeEntities(stripTags(m[2]));
    if (text.length < minText) continue;
    let abs: URL;
    try {
      abs = new URL(decodeEntities(href), baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (sameHost && abs.host.replace(/^www\./, "") !== baseHost) continue;
    const pathAndQuery = abs.pathname + abs.search;
    if (DEFAULT_EXCLUDE.test(pathAndQuery)) continue;
    if (exclude && exclude.test(pathAndQuery)) continue;
    if (!include.test(pathAndQuery)) continue;
    abs.hash = "";
    const key = abs.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ title: text.slice(0, 300), link: key, published: null, summary: "" });
  }
  return items;
}
