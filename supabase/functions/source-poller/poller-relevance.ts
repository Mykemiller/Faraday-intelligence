// poller-relevance.ts — pre-enrichment relevance gate (source-poller v8).
// Deno-free (ext-pure pattern). Runs BEFORE the enrichment LLM ever sees an
// item: query-lane artifacts that don't mention any infrastructure-relevant
// term are stored with enrich_status='skipped' (kept for audit, never billed).
// Curated feeds (non-query-lane) are always relevant — their editorial focus
// was vetted at registration.

import type { FeedItem } from "./poller-pure.ts";

/** Terms indicating data-center / AI-infrastructure relevance. Word-boundary
 * matched, case-insensitive (the 'tif' substring discipline). */
export const RELEVANCE_TERMS = [
  "data center", "data centers", "datacenter", "datacentre", "data centre",
  "ai infrastructure", "artificial intelligence", "hyperscale", "hyperscaler",
  "colocation", "colo facility", "server farm", "gpu", "gpus", "compute cluster",
  "supercomputer", "cloud region", "availability zone", "megawatt", "gigawatt",
  " mw ", " gw ", "substation", "transmission line", "interconnection",
  "power purchase", "ppa", "grid capacity", "load growth", "nuclear", "smr",
  "cooling", "liquid cooling", "immersion", "chiller", "water use", "water rights",
  "fiber", "fibre", "subsea cable", "dark fiber", "rezoning", "zoning",
  "moratorium", "tax abatement", "incentive", "land acquisition", "campus",
  "semiconductor", "chip fab", "foundry", "hbm", "inference", "training cluster",
  "energization", "backup generation", "microgrid", "utility-scale",
];

const PATTERNS = RELEVANCE_TERMS.map((t) => {
  const escaped = t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
});

/** True when the item text carries at least one relevance term. */
export function isRelevant(item: FeedItem): boolean {
  const text = `${item.title} ${item.summary}`;
  return PATTERNS.some((re) => re.test(text));
}

/** Cadence → minimum interval between polls (minutes), with slack so a run
 * that fires slightly early still picks the source up. Unknown cadences poll
 * daily. A never-fetched source is always due. */
const CADENCE_MINUTES: Record<string, number> = {
  hourly: 50,
  daily: 20 * 60,
  weekly: 6.5 * 24 * 60,
  event_driven: 20 * 60,
  archival_refresh: 27 * 24 * 60,
  one_time: 365 * 24 * 60,
};

export function isDue(cadence: string, lastFetchAt: string | null, nowMs: number): boolean {
  if (!lastFetchAt) return true;
  const mins = CADENCE_MINUTES[cadence] ?? CADENCE_MINUTES.daily;
  return nowMs - Date.parse(lastFetchAt) >= mins * 60_000;
}
