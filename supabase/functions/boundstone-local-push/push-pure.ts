// push-pure.ts — FDY-91. Decide what to send to Boundstone, build the payload,
// and be the ENTIRE write surface onto that project.
//
// Deno-free (ext-pure pattern) so tests import it directly.
//
// ===========================================================================
// ⚠️ ONE CALL PER ARTICLE, NOT TWO — THIS IS A DEVIATION FROM THE BRIEF AND
//    IT IS DELIBERATE
// ===========================================================================
// FDY-91's brief says: send every relevant item to bs_press_propose, and send
// the restriction-shaped ones ALSO to bs_record_candidate_propose, keyed
// content_hash = sha256(lower(headline) || publisher_domain).
//
// That was written before FDY-77 existed. FDY-77 is now on Boundstone `main`
// (20261008120000_news_candidate_bridge.sql) and it installs an AFTER INSERT OR
// UPDATE trigger on press_items which proposes a candidate for every published,
// unsuppressed, unlinked, on-topic row, keyed:
//
//     content_hash = 'news:' || md5(boundstone.press_canonical_url(url))
//
// Two writers keyed differently on one article is TWO candidate rows in a queue
// a human reads. So Boundstone's 20261009110000 (the other half of this issue)
// has bs_press_propose propose the candidate ITSELF, before the insert, on
// FDY-77's own key — and the bridge's later propose is absorbed as
// {action:'duplicate'}. Faraday therefore makes exactly ONE call per article
// and passes the candidate fields into it:
//
//     propose_candidate: true | false
//     artifact_id, jurisdiction_name, signal_reasons, discovery_host
//
// The brief's sha256 hash is NOT computed anywhere, because computing a second
// hash scheme is how the duplicate gets created. The EXECUTE grant on
// bs_record_candidate_propose still exists under decision D1 — FDY-92 and the
// existing boundstone-candidates lane use it — but THIS function never calls
// it. test/boundstone-local-push.test.mjs asserts that by name.
//
// ===========================================================================
// WHAT IS NEVER SENT, AND HOW THAT IS ENFORCED RATHER THAN INTENDED
// ===========================================================================
// * No article text. buildPressPayload() is a whitelist: it constructs the
//   object key by key and PAYLOAD_KEYS below is the complete set. A caller
//   cannot add one, because nothing reads from the artifact row except the two
//   strings boundstone_push_due returns, and raw_content is not one of them.
// * No aggregator URL. isAggregatorUrl() refuses before the payload exists,
//   and Boundstone's enforce_press_item() refuses again on the insert.
// * No score, no summary, no sentiment, no ranking. signal_reasons is the list
//   of MATCHED KEYWORDS — the literal strings that fired — not a judgement
//   about them, and signal_score is absent rather than zero.
// * No expiration_date and no `enacted`. Not expressible here at all.

import { type Attribution, type Gazetteer, attributeHeadline } from "./attribution-pure.ts";
import { headlineFromParts, hostOf, isAggregatorUrl } from "./headline-pure.ts";

/** The Boundstone RPC this lane calls. Exactly one. */
export const FN_PRESS_PROPOSE = "bs_press_propose";

/**
 * The function this lane must NEVER call, named so a test can assert its
 * absence. It is reachable with the push role's grant; not calling it is the
 * decision that keeps one article to one candidate.
 */
export const FN_FORBIDDEN_DIRECT_CANDIDATE = "bs_record_candidate_propose";

/** Every key bs_press_propose reads out of `p`, in the order it reads them. */
export const PAYLOAD_KEYS = [
  "headline",
  "url",
  "published_date",
  "state_abbr",
  "http_status",
  "retrieved_at",
  "artifact_id",
  "discovery_host",
  "jurisdiction_name",
  "propose_candidate",
  "signal_reasons",
] as const;

/**
 * Keys that must never appear in a payload. Not a style rule — each one is a
 * guardrail. `record_slug` is here because bs_press_propose accepts it and
 * Faraday has no business deciding which Boundstone record an article belongs
 * to; that is match_press_record's job and a human's.
 */
export const FORBIDDEN_PAYLOAD_KEYS = [
  "body",
  "raw_content",
  "extract",
  "excerpt",
  "summary",
  "snippet",
  "abstract",
  "text",
  "content",
  "sentiment",
  "relevance",
  "score",
  "signal_score",
  "rank",
  "ranking",
  "primary_source_url",
  "source_domain",
  "dup_cluster_key",
  "ingest_run_id",
  "feed_source_id",
  "is_published",
  "unpublished_reason",
  "record_slug",
  "confidence_grade",
  "review_state",
] as const;

/** The closed vocabulary of ledger reasons. The migration's comment lists the
 *  same strings; a reason outside this set is a bug, not a new case. */
export const LEDGER_REASONS = [
  "no_publisher_url",
  "no_headline",
  "aggregator_url",
  "no_honest_state",
  "ambiguous_state_named",
  "ambiguous_jurisdiction",
  "not_retrieved",
  "rejected_by_boundstone",
  "duplicate_at_boundstone",
  "no_credential",
  "disabled",
] as const;

export type LedgerReason = (typeof LEDGER_REASONS)[number];
export type LedgerKind = "press" | "candidate" | "both" | "skipped";

// ---------------------------------------------------------------------------
// The restriction test
// ---------------------------------------------------------------------------
// BOTH halves are required (brief §B.4): a restriction verb AND a local-
// government noun. Either alone is a false positive factory —
//
//   verb only:  "Microsoft pauses construction on three data centers"
//               (a corporate decision, not a government act)
//   noun only:  "County commission tours new data center campus"
//
// ⚠️ `ban` is bounded by \b. Unbounded it matches "Albany", "urban",
// "abandoned" and "banner", and "Albany data center" is a headline this corpus
// actually contains. Measured over the 6,157-row relevant window on 2026-10-08:
// 232 of the 1,507 attributable rows match both halves.
//
// This is a KEYWORD TEST, not a classifier, and the distinction matters: it
// decides whether a human is shown a candidate, never whether a record exists.
// Boundstone's review queue is the judgement; this is the shortlist.
export const RESTRICTION_PATTERNS: readonly [string, RegExp][] = [
  ["moratori", /moratori/i],
  ["ban", /\bban(s|ned|ning)?\b/i],
  ["pause", /\bpaus(e|es|ed|ing)\b/i],
  ["ordinance", /ordinance/i],
  ["rezon", /rezon/i],
  ["prohibit", /prohibit/i],
];

export const LOCAL_GOVERNMENT_NOUN =
  /\b(count(y|ies)|parish|township|city|town|village|borough|board|commission(ers?)?|council|supervisors?|trustees?|zoning|planning|aldermen|selectmen|quorum court)\b/i;

/**
 * The matched restriction keywords, in declaration order, or [] when the
 * headline is not restriction-shaped. The returned strings ARE
 * `signal_reasons`: the literal keywords that fired, which is a statement of
 * fact about the headline rather than an opinion about the article.
 */
export function restrictionKeywords(headline: string): string[] {
  if (typeof headline !== "string") return [];
  if (!LOCAL_GOVERNMENT_NOUN.test(headline)) return [];
  const hits = RESTRICTION_PATTERNS.filter(([, re]) => re.test(headline)).map(([k]) => k);
  return hits;
}

// ---------------------------------------------------------------------------
// One artifact in, one decision out
// ---------------------------------------------------------------------------

/** Exactly what public.boundstone_push_due(int) returns. No raw_content. */
export interface DueRow {
  artifact_id: string;
  published_at: string;
  publisher_url: string | null;
  publisher_domain: string | null;
  rss_line1: string | null;
  rss_publisher: string | null;
}

export interface PressPayload {
  headline: string;
  url: string;
  published_date: string;
  state_abbr: string;
  http_status: number;
  retrieved_at: string;
  artifact_id: string;
  discovery_host: string;
  jurisdiction_name: string | null;
  propose_candidate: boolean;
  signal_reasons: string[];
}

export type Decision =
  | { send: true; payload: PressPayload; attribution: Attribution; kind: "press" | "both" }
  | { send: false; reason: LedgerReason; attribution: Attribution | null };

/**
 * `published_date` as a plain ISO date in UTC. Transcribed from
 * artifacts.published_at, never computed and never shifted into a local zone:
 * a press item's date is the publisher's claim about its own article, and
 * moving it by a timezone would be an edit (guardrail 7).
 */
export function publishedDate(publishedAt: unknown): string | null {
  if (typeof publishedAt !== "string" && !(publishedAt instanceof Date)) return null;
  const d = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Decide one row. Every refusal names itself; nothing is silently dropped,
 * because a silent drop is an artifact the hourly sweep re-reads forever.
 *
 * `httpStatus` is the proof that SOMEBODY fetched the publisher URL. For this
 * lane the fetcher is Faraday (FDY-90's body step), so the proof has to travel
 * with the item: Boundstone's press_items.retrieved_at is NOT NULL precisely so
 * it never publishes a link nobody fetched. A missing status is not a pass.
 */
export function decide(
  row: DueRow,
  gaz: Gazetteer,
  opts: { httpStatus?: number | null; retrievedAt?: string | null } = {},
): Decision {
  const url = typeof row.publisher_url === "string" ? row.publisher_url.trim() : "";
  if (url === "") return { send: false, reason: "no_publisher_url", attribution: null };

  // ⚠️ BEFORE anything else. D2 is absolute: an aggregator URL is never stored
  // in Boundstone. If FDY-90 ever stored a google URL as a publisher_url, this
  // is the line that stops it leaving Faraday, and
  // gnews_resolve_measure().aggregator_urls_stored_as_publisher is the alarm.
  if (isAggregatorUrl(url) || !/^https?:\/\/[^/]/.test(url)) {
    return { send: false, reason: "aggregator_url", attribution: null };
  }

  // The headline comes from the RSS first line, with Google's " - <outlet>"
  // suffix stripped. A row whose headline cannot be ESTABLISHED is skipped:
  // publishing line 1 unstripped would attribute Google's constructed string to
  // the publisher.
  const extracted = headlineFromParts(row.rss_line1, row.rss_publisher);
  if (!extracted) return { send: false, reason: "no_headline", attribution: null };

  const date = publishedDate(row.published_at);
  if (!date) return { send: false, reason: "no_headline", attribution: null };

  const attribution = attributeHeadline(extracted.headline, gaz);
  if (!attribution.state_abbr) {
    // The attribution's own reason, so the ledger distinguishes "nothing named
    // a state" from "two states were named" — which are different problems.
    const reason = (attribution.reason ?? "no_honest_state") as LedgerReason;
    return {
      send: false,
      reason: (LEDGER_REASONS as readonly string[]).includes(reason) ? reason : "no_honest_state",
      attribution,
    };
  }

  const status = opts.httpStatus ?? null;
  if (status === null || status < 200 || status > 299) {
    return { send: false, reason: "not_retrieved", attribution };
  }

  const signal_reasons = restrictionKeywords(extracted.headline);
  const propose_candidate = signal_reasons.length > 0;

  return {
    send: true,
    kind: propose_candidate ? "both" : "press",
    attribution,
    payload: {
      headline: extracted.headline,
      url,
      published_date: date,
      state_abbr: attribution.state_abbr,
      http_status: status,
      retrieved_at: opts.retrievedAt ?? new Date().toISOString(),
      artifact_id: row.artifact_id,
      discovery_host:
        (typeof row.publisher_domain === "string" && row.publisher_domain.trim()) || hostOf(url),
      jurisdiction_name: attribution.jurisdiction_name,
      propose_candidate,
      signal_reasons,
    },
  };
}

/**
 * The payload as a plain object with EXACTLY the keys in PAYLOAD_KEYS.
 * Constructed key by key rather than spread, so a field added to PressPayload
 * later cannot reach Boundstone without someone editing this list.
 */
export function buildPressPayload(p: PressPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {
    headline: p.headline,
    url: p.url,
    published_date: p.published_date,
    state_abbr: p.state_abbr,
    http_status: p.http_status,
    retrieved_at: p.retrieved_at,
    artifact_id: p.artifact_id,
    discovery_host: p.discovery_host,
    propose_candidate: p.propose_candidate,
    signal_reasons: p.signal_reasons,
  };
  // Absent, not null: bs_press_propose treats '' and absent alike, and sending
  // an explicit null for a jurisdiction nobody established reads like a claim.
  if (p.jurisdiction_name) out.jurisdiction_name = p.jurisdiction_name;
  return out;
}

// ---------------------------------------------------------------------------
// The write surface
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a PostgREST client's RPC surface. NOTE WHAT IS ABSENT: no
 * `from`. A client that only satisfies this interface cannot express a table
 * write against Boundstone, which is guardrail 4 expressed as a type.
 */
export interface RpcClientLike {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface PressResult {
  ok: boolean;
  id: string | null;
  status: string | null;
  reason: string | null;
  /** The reply, already small. Stored in the ledger's `response`. */
  response: Record<string, unknown> | null;
  error: string | null;
}

/** Propose one press item. The only call this module ever makes. */
export async function proposePress(
  client: RpcClientLike,
  payload: PressPayload,
): Promise<PressResult> {
  const { data, error } = await client.rpc(FN_PRESS_PROPOSE, { p: buildPressPayload(payload) });
  if (error) {
    return { ok: false, id: null, status: null, reason: null, response: null, error: error.message };
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const status = typeof d.status === "string" ? d.status : null;
  return {
    // `duplicate` is a SUCCESS. An hourly job re-reading its own window depends
    // on that: a second call for the same (url, state_abbr) is the no-op the
    // unique index guarantees, not an error to retry.
    ok: status === "inserted" || status === "duplicate",
    id: typeof d.id === "string" ? d.id : null,
    status,
    reason: typeof d.reason === "string" ? d.reason : null,
    // ⚠️ Only these five keys are kept. The reply is already small, but
    // narrowing it here is what makes boundstone_push_record's article-text
    // refusal unreachable rather than merely unlikely.
    response: {
      id: d.id ?? null,
      status: status,
      reason: d.reason ?? null,
      is_published: d.is_published ?? null,
      unpublished_reason: d.unpublished_reason ?? null,
    },
    error: null,
  };
}

/** The ledger row for one decided artifact. */
export function ledgerRow(
  artifactId: string,
  decision: Decision,
  result: PressResult | null,
): { artifact_id: string; kind: LedgerKind; reason?: string; boundstone_id?: string; response?: unknown } {
  if (!decision.send) {
    return { artifact_id: artifactId, kind: "skipped", reason: decision.reason };
  }
  if (!result || !result.ok) {
    // Boundstone refused it, or the call failed. Either way nothing is stored
    // there, so this is a skip — and the reply is kept so an operator can read
    // `response->>'reason'` (blocked_source_domain, not_retrieved, …) without
    // re-running anything.
    return {
      artifact_id: artifactId,
      kind: "skipped",
      reason: "rejected_by_boundstone",
      response: result?.response ?? null,
    };
  }
  // ⚠️ A duplicate is ledgered as the kind it WOULD have been, with the id of
  // the row that already exists. Ledgering it 'skipped' would be a lie: the
  // press item is on boundstone.org and this artifact is the reason.
  const row: ReturnType<typeof ledgerRow> = {
    artifact_id: artifactId,
    kind: decision.kind,
    response: result.response,
  };
  if (result.id) row.boundstone_id = result.id;
  return row;
}
