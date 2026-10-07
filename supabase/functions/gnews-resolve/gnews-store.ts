// gnews-store.ts — the storage contract for FDY-90. Deno-free so node tests
// import it directly.
//
// WHAT IS WRITTEN, AND WHAT IS NOT
// The resolver is additive. It writes exactly six keys inside
// artifacts.crawl_metadata and nothing else:
//
//   publisher_url      text  — the resolved article URL on the publisher's host
//   publisher_domain   text  — that host minus a leading 'www.'
//   resolve_method     text  — 'offline_token' | 'redirect' | 'batchexecute'
//   resolved_at        text  — ISO timestamp of the successful resolution
//   resolve_attempts   int   — capped at RESOLVE_MAX_ATTEMPTS
//   resolve_error      text  — the failure text, or null on success
//
// It NEVER writes artifacts.source_url (the Google News redirect stays as the
// row's provenance), raw_content, signal_envelope, or any body_* column. Body
// text is written only by the body-fetch path, from publisher_url, and exists
// for matching/extraction inside Faraday — it is never forwarded to Boundstone.
//
// DOWNSTREAM (FDY-91): the Faraday→Boundstone bridge reads
// crawl_metadata->>'publisher_url' and crawl_metadata->>'publisher_domain'.
// A row whose publisher_url is null is not eligible to be forwarded: an
// aggregator URL is never stored in Boundstone (decision D2).

/** Lane name in artifact_body_fetch_lanes for the local-watch Google News slice. */
export const GNEWS_LANE = "gnews_local";

/** FDY-90 requirement 5: never retry a row more than three times. */
export const RESOLVE_MAX_ATTEMPTS = 3;

/**
 * Priority ordering from the issue: restriction-shaped items resolve first.
 * Deliberately the same keyword list as the issue text, nothing added — this is
 * a work ORDER, not a relevance score, and it never changes what publishes.
 */
export const GNEWS_RESTRICTION_RE = /moratori|\bban(?:s|ned|ning)?\b|\bpause[sd]?\b|ordinance|rezon|zoning/i;

export interface ResolutionLike {
  publisher_url?: string;
  publisher_domain?: string;
  resolve_method?: string;
  error?: string;
}

export interface PatchContext {
  attempts: number;
  at: string;
}

/** The exact set of crawl_metadata keys this feature is allowed to write. */
export const GNEWS_METADATA_KEYS = [
  "publisher_url",
  "publisher_domain",
  "resolve_method",
  "resolved_at",
  "resolve_attempts",
  "resolve_error",
] as const;

/**
 * The delta sent to gnews_resolve_record(p_source_url, p_delta), which merges it
 * server-side with jsonb `||` and fans it out to every row sharing the token.
 * On failure the publisher_* keys are omitted entirely rather than written null,
 * so only a later successful attempt can introduce them.
 */
export function gnewsMetadataDelta(
  resolution: ResolutionLike,
  ctx: PatchContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    resolve_attempts: Math.min(ctx.attempts, RESOLVE_MAX_ATTEMPTS),
  };
  if (resolution.publisher_url && resolution.publisher_domain && resolution.resolve_method) {
    out.publisher_url = resolution.publisher_url;
    out.publisher_domain = resolution.publisher_domain;
    out.resolve_method = resolution.resolve_method;
    out.resolved_at = ctx.at;
    out.resolve_error = null;
  } else {
    out.resolve_error = resolution.error ?? "unresolved";
  }
  return out;
}

/**
 * The resulting crawl_metadata, i.e. exactly what jsonb `||` produces in
 * gnews_resolve_record. Kept so the merge semantics are asserted in the test
 * suite: pre-existing keys survive, and source_url / raw_content / body_* are
 * never part of the write.
 */
export function gnewsCrawlMetadataPatch(
  existing: Record<string, unknown> | null,
  resolution: ResolutionLike,
  ctx: PatchContext,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...gnewsMetadataDelta(resolution, ctx) };
}

/** True once a row has burned its retry budget. */
export function gnewsResolveBlocked(meta: Record<string, unknown> | null): boolean {
  const n = Number((meta ?? {}).resolve_attempts ?? 0);
  return Number.isFinite(n) && n >= RESOLVE_MAX_ATTEMPTS;
}
