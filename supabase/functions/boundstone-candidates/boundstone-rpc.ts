// boundstone-rpc.ts — the ENTIRE write surface onto the Boundstone project.
// CC-BOUNDSTONE-INGEST-1.1 §6.5 (FAR-418), rebuilt onto Boundstone migration
// 0042's receiving contract.
// Deno-free (ext-pure pattern) so tests import it directly.
//
// WHY THIS MODULE EXISTS AT ALL
// Boundstone did not just grant a table; it shipped three SECURITY DEFINER
// functions and nothing else. The caller holds a service-role key, so it could
// write `boundstone.record_candidates` directly — and must not. The function
// reads the payload KEY BY KEY and never splats it, which is what makes
// `review_state`, `reviewed_by` and `created_at` unsettable by a caller. Going
// around it with `.from(...).insert(...)` would hand Faraday the ability to
// mark its own proposals promoted. That is the line this module exists to keep,
// so there is exactly ONE place that talks to Boundstone and it only ever calls
// `.rpc()`. test/far418-boundstone-rpc-only.test.mjs drives this module with a
// recording stub and fails if a single `.from(` ever appears in the call list.
//
// PROMOTION IS A HUMAN EDITORIAL ACT. Every row this module creates lands at
// review_state='pending'. Nothing here promotes, publishes, or touches
// `boundstone.records`, and nothing here writes a `confidence_grade` — that
// column is trigger-derived on the Boundstone side and is not ours to set.

/** Minimal shape of a supabase-js client's RPC surface, so a test stub can
 * satisfy it. NOTE WHAT IS ABSENT: no `from`. A client that only matches this
 * interface cannot express a table write. */
export interface RpcClientLike {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

// ---------------------------------------------------------------------------
// The contract, as read from the live database (project fwnerwrtlgnchuprvfgl)
// with pg_get_functiondef / pg_get_constraintdef on 2026-10-06. Not guessed.
// ---------------------------------------------------------------------------

export const FN_PROPOSE = "bs_record_candidate_propose";
export const FN_WATERMARK_GET = "bs_ingest_watermark_get";
export const FN_WATERMARK_SET = "bs_ingest_watermark_set";

/** The one watermark key this function owns. */
export const WATERMARK_KEY = "boundstone-candidates";

/** `record_candidates_authority_level_ck`. NULL is also accepted. */
export const AUTHORITY_LEVELS = [
  "LOCAL",
  "STATE",
  "STATE_AGENCY",
  "GRID_OPERATOR",
  "UTILITY",
  "FEDERAL",
] as const;

/** `record_candidates_instrument_type_ck`. NULL is also accepted. */
export const INSTRUMENT_TYPES = [
  "ordinance",
  "order",
  "executive_directive",
  "protocol_revision",
  "tariff",
  "resolution",
  "statute",
  "rescission",
] as const;

/** `record_candidates_state_abbr_ck`: `^[A-Z]{2}$`, or NULL. */
export const STATE_ABBR_RE = /^[A-Z]{2}$/;

/**
 * Every key `bs_record_candidate_propose` reads out of `p`, in the order the
 * function reads them. A key not on this list is silently ignored by the
 * function; sending one anyway would be a lie about the contract, so the
 * builder refuses to.
 */
export const PAYLOAD_KEYS = [
  "artifact_id",
  "source_url",
  "canonical_url",
  "discovery_host",
  "headline",
  "extract",
  "published_at",
  "authority_level",
  "issuing_authority",
  "state_abbr",
  "jurisdiction_name",
  "instrument_type",
  "instrument_no",
  "signal_score",
  "signal_reasons",
  "primary_source_url",
  "primary_source_ok",
  "content_hash",
] as const;

/** The four the function RAISES on when missing or blank. */
export const REQUIRED_PAYLOAD_KEYS = [
  "artifact_id",
  "source_url",
  "headline",
  "content_hash",
] as const;

/**
 * Columns a caller must never try to set, kept as an explicit list so the
 * refusal is testable rather than implied. `bs_record_candidate_propose`
 * already ignores them — this is the belt to that braces, and it is also where
 * `confidence_grade` is named so that a future edit adding it fails loudly.
 */
export const FORBIDDEN_PAYLOAD_KEYS = [
  "id",
  "review_state",
  "reviewed_by",
  "reviewed_at",
  "reject_reason",
  "created_at",
  "confidence_grade",
] as const;

export interface CandidatePayload {
  artifact_id: string;
  source_url: string;
  canonical_url: string | null;
  discovery_host: string | null;
  headline: string;
  extract: string | null;
  published_at: string | null;
  authority_level: string | null;
  issuing_authority: string | null;
  state_abbr: string | null;
  jurisdiction_name: string | null;
  instrument_type: string | null;
  instrument_no: string | null;
  signal_score: number | null;
  signal_reasons: string[];
  primary_source_url: string | null;
  primary_source_ok: boolean | null;
  content_hash: string;
}

export interface BuildResult {
  ok: boolean;
  reason?: string;
  payload?: CandidatePayload;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Map a classified artifact onto the function's keys.
 *
 * THE VOCABULARIES ARE COERCED, NOT TRUSTED. `authority_level` and
 * `instrument_type` are CHECK-constrained on the Boundstone side and both
 * accept NULL, so an out-of-vocabulary value becomes NULL here rather than a
 * CHECK violation that aborts the row. Rejecting the candidate outright would
 * lose a real restriction over a label; sending it unlabelled keeps the
 * document and tells the reviewer the label is missing. Same for `state_abbr`,
 * which is uppercased first because the function's own `upper()` runs AFTER the
 * CHECK would have been written — we match its result, not its input.
 */
export function buildCandidatePayload(input: {
  artifact_id: unknown;
  source_url: unknown;
  canonical_url?: unknown;
  discovery_host?: unknown;
  headline: unknown;
  extract?: unknown;
  published_at?: unknown;
  authority_level?: unknown;
  issuing_authority?: unknown;
  state_abbr?: unknown;
  jurisdiction_name?: unknown;
  instrument_type?: unknown;
  instrument_no?: unknown;
  signal_score?: unknown;
  signal_reasons?: unknown;
  primary_source_url?: unknown;
  primary_source_ok?: unknown;
  content_hash: unknown;
}): BuildResult {
  const artifactId = text(input.artifact_id);
  const sourceUrl = text(input.source_url);
  const headline = text(input.headline);
  const contentHash = text(input.content_hash);

  // Mirror the function's own four RAISEs, so a bad row is counted as a
  // rejection here instead of surfacing as a 500 from Postgres.
  if (!contentHash) return { ok: false, reason: "content_hash is required — it is the dedupe key" };
  if (!artifactId) return { ok: false, reason: "artifact_id is required" };
  if (!sourceUrl) return { ok: false, reason: "source_url is required" };
  if (!headline) return { ok: false, reason: "headline is required" };

  const levelRaw = text(input.authority_level);
  const level = levelRaw && (AUTHORITY_LEVELS as readonly string[]).includes(levelRaw.toUpperCase())
    ? levelRaw.toUpperCase()
    : null;

  const instrumentRaw = text(input.instrument_type);
  const instrument =
    instrumentRaw && (INSTRUMENT_TYPES as readonly string[]).includes(instrumentRaw.toLowerCase())
      ? instrumentRaw.toLowerCase()
      : null;

  const stateRaw = text(input.state_abbr);
  const state = stateRaw && STATE_ABBR_RE.test(stateRaw.toUpperCase()) ? stateRaw.toUpperCase() : null;

  let score: number | null = null;
  if (input.signal_score !== null && input.signal_score !== undefined && input.signal_score !== "") {
    const n = Number(input.signal_score);
    if (isFinite(n)) score = Math.min(1, Math.max(0, n));
  }

  const reasons = Array.isArray(input.signal_reasons)
    ? input.signal_reasons.filter((r): r is string => typeof r === "string" && r.trim() !== "")
      .map((r) => r.trim()).slice(0, 48)
    : [];

  const primaryOk = input.primary_source_ok === null || input.primary_source_ok === undefined
    ? null
    : input.primary_source_ok === true;

  const payload: CandidatePayload = {
    artifact_id: artifactId,
    source_url: sourceUrl,
    canonical_url: text(input.canonical_url),
    discovery_host: text(input.discovery_host),
    headline,
    extract: text(input.extract),
    published_at: text(input.published_at),
    authority_level: level,
    issuing_authority: text(input.issuing_authority),
    state_abbr: state,
    jurisdiction_name: text(input.jurisdiction_name),
    instrument_type: instrument,
    instrument_no: text(input.instrument_no),
    signal_score: score,
    signal_reasons: reasons,
    primary_source_url: text(input.primary_source_url),
    primary_source_ok: primaryOk,
    content_hash: contentHash,
  };

  const extra = Object.keys(payload).filter((k) => !(PAYLOAD_KEYS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, reason: `payload carries keys the function does not read: ${extra.join(", ")}` };

  return { ok: true, payload };
}

export interface ProposeResult {
  /** false only when the RPC itself errored. A duplicate is a success. */
  ok: boolean;
  /** 'inserted' | 'duplicate' | 'error' */
  action: string;
  candidate_id: string | null;
  error?: string;
}

/**
 * §6.5 — propose one candidate.
 *
 * `action:'duplicate'` IS A NO-OP AND A SUCCESS. The function's
 * `on conflict (content_hash) do nothing` is the §6.6 behaviour the digest
 * depends on: trade-press coverage of an instrument we already hold is absorbed
 * into the existing row rather than opening a second one. Counting it as an
 * error would make a correctly-behaving run look broken, and counting it as a
 * write would inflate the only number anyone checks.
 */
export async function proposeCandidate(
  client: RpcClientLike,
  payload: CandidatePayload,
): Promise<ProposeResult> {
  const { data, error } = await client.rpc(FN_PROPOSE, { p: payload });
  if (error) return { ok: false, action: "error", candidate_id: null, error: error.message };
  const row = (data ?? {}) as Record<string, unknown>;
  const action = typeof row.action === "string" ? row.action : "unknown";
  const id = typeof row.candidate_id === "string" ? row.candidate_id : null;
  return { ok: true, action, candidate_id: id };
}

/** Returns the stored watermark, or null when the key has never been set. */
export async function watermarkGet(
  client: RpcClientLike,
  key: string = WATERMARK_KEY,
): Promise<{ ok: boolean; at: string | null; error?: string }> {
  const { data, error } = await client.rpc(FN_WATERMARK_GET, { p_key: key });
  if (error) return { ok: false, at: null, error: error.message };
  return { ok: true, at: typeof data === "string" && data !== "" ? data : null };
}

/** The function RAISES on a null key or a null timestamp; both are checked here
 * first so a caller never turns a missed watermark into a 500. */
export async function watermarkSet(
  client: RpcClientLike,
  at: string | null,
  key: string = WATERMARK_KEY,
): Promise<{ ok: boolean; at: string | null; error?: string }> {
  if (!key || key.trim() === "") return { ok: false, at: null, error: "watermark key is required" };
  if (!at) return { ok: false, at: null, error: "watermark timestamp is required" };
  const { data, error } = await client.rpc(FN_WATERMARK_SET, { p_key: key, p_at: at });
  if (error) return { ok: false, at: null, error: error.message };
  return { ok: true, at: typeof data === "string" ? data : at };
}

/**
 * The §5 canary. A fixed, obviously-synthetic payload built through the SAME
 * builder a real candidate goes through, so a `?dry=1` run reports the exact
 * shape and vocabulary it would send even when the corpus yields nothing.
 *
 * `bs_record_candidate_propose` HAS NO DRY MODE — it is a plain INSERT with an
 * ON CONFLICT, verified by reading its definition. So the dry path builds this
 * and does NOT call it. Calling it "to see what would happen" would write a
 * row, which is the one thing a dry run may not do.
 */
export function canaryPayload(nowIso: string): CandidatePayload {
  const built = buildCandidatePayload({
    artifact_id: "canary-00000000-0000-0000-0000-000000000000",
    source_url: "https://example.gov/canary",
    canonical_url: "https://example.gov/canary",
    discovery_host: "example.gov",
    headline: "CANARY — dry run, nothing was written",
    extract: "CANARY — dry run, nothing was written",
    published_at: nowIso,
    authority_level: "STATE_AGENCY",
    issuing_authority: null,
    state_abbr: null,
    jurisdiction_name: null,
    instrument_type: "order",
    instrument_no: null,
    signal_score: 0,
    signal_reasons: ["canary:dry_run"],
    primary_source_url: "https://example.gov/canary",
    primary_source_ok: true,
    content_hash: `canary:${nowIso}`,
  });
  // The builder cannot fail on this input; if it ever does, that is a contract
  // change and the caller should hear about it rather than see a silent null.
  if (!built.ok || !built.payload) throw new Error(`canary payload no longer builds: ${built.reason}`);
  return built.payload;
}
