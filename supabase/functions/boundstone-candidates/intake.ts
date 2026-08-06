// intake.ts — CC-BOUNDSTONE-INGEST-1.1 §6.1 + §5.1 (FAR-418).
// The candidate classifier's intake query, isolated so it can be INSPECTED.
// Deno-free (ext-pure pattern).
//
// WHY THIS IS ITS OWN MODULE
// §11 requires proof that boundstone-candidates "selects with no reference to
// ifs_domains or ifs_subdomains anywhere in its query path — assert with a test
// that inspects the compiled query, not by code review." A grep over index.ts
// would be code review wearing a test's clothes. Extracting the query lets
// test/far418-no-idf-dependency.test.mjs drive it with a recording stub and
// assert against the calls that were actually made.
//
// Decision 2, restated: Boundstone is DOMAIN-AGNOSTIC. It classifies on
// instrument signature over the ENTIRE artifact stream. A restriction is a
// restriction whether its feed filed it under D3, D13, D18 or nothing.
// Pre-filtering by domain to save compute is a defect, not an optimization — if
// cost becomes a concern, say so in the PR rather than quietly narrowing this.

/** Columns the classifier reads. Note what is absent: no ifs_domains, no
 * ifs_subdomains, and no join to anything that carries them. */
export const INTAKE_COLUMNS =
  "artifact_id, source_url, canonical_url, published_at, raw_content, enrich_completed_at, signal_envelope";

export const INTAKE_LIMIT = 2000;

/** Minimal shape of the query builder, so a test stub can satisfy it. */
export interface QueryBuilderLike {
  select(cols: string): this;
  eq(col: string, val: unknown): this;
  gt(col: string, val: unknown): this;
  order(col: string, opts?: Record<string, unknown>): this;
  limit(n: number): this;
}
export interface ClientLike {
  from(table: string): QueryBuilderLike;
}

/**
 * The one and only intake query. The only narrowing applied is enrichment
 * status and the watermark — no domain filter, no geographic filter, no
 * relevance filter.
 */
export function buildIntakeQuery<T extends ClientLike>(client: T, since: string, limit = INTAKE_LIMIT) {
  return client
    .from("artifacts")
    .select(INTAKE_COLUMNS)
    .eq("enrich_status", "complete")
    .gt("enrich_completed_at", since)
    .order("enrich_completed_at", { ascending: true })
    .limit(limit);
}
