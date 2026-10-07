// poller-relevance.ts — pre-enrichment relevance gate (source-poller v8).
// Deno-free (ext-pure pattern). Runs BEFORE the enrichment LLM ever sees an
// item: query-lane artifacts that don't mention any infrastructure-relevant
// term are stored with enrich_status='skipped' (kept for audit, never billed).
// Curated feeds (non-query-lane) are always relevant — their editorial focus
// was vetted at registration.

import type { FeedItem } from "./poller-pure.ts";
import { cadenceMinutes } from "./poller-schedule.ts";

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

/** FDY-89: the cadence table moved to poller-schedule.ts so the due-FILTER here
 * and the due-ORDER there can never disagree. Re-exported for callers that
 * imported it from this module. */
export { CADENCE_MINUTES } from "./poller-schedule.ts";

/** True when `cadence` says this source may be polled again. A never-fetched
 * source is always due. NOTE: this FILTERS only — it has never ordered anything,
 * and relying on `last_fetch_at ASC` for the order is exactly what starved the
 * local-gov watch (see poller-schedule.ts). Use selectDueFair() to order. */
export function isDue(cadence: string, lastFetchAt: string | null, nowMs: number): boolean {
  if (!lastFetchAt) return true;
  return nowMs - Date.parse(lastFetchAt) >= cadenceMinutes(cadence) * 60_000;
}
