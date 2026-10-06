// classify-pure.ts — CC-BOUNDSTONE-INGEST-1.1 §6.3 (FAR-418).
// The Gate 1 prompt and, more importantly, the validation that decides whether
// a model response is allowed to become a candidate at all.
// Deno-free (ext-pure pattern) so tests import it directly.
//
// The zero-fabrication rules in §6.3 are not prompt requests here. Three of the
// four are ENFORCED IN CODE, because a citation engine that trusts a model to
// have been careful has no answer when it wasn't:
//   * `extract` must be a verbatim span of the document. Checked by substring
//     match on whitespace-normalized text. A paraphrase is rejected outright.
//   * `effective_date` is dropped unless `effective_date_stated` is true.
//   * unknown authority / jurisdiction / instrument number stay null; the empty
//     string and the words "unknown"/"n/a" are coerced to null, never kept.

export const CLASSIFIER_MODEL = "claude-sonnet-5";
export const MAX_OUTPUT_TOKENS = 1024;
export const MAX_EXTRACT_CHARS = 600;

export const AUTHORITY_LEVELS = [
  "LOCAL",
  "STATE",
  "STATE_AGENCY",
  "GRID_OPERATOR",
  "UTILITY",
  "FEDERAL",
] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

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

// §6.7: no proper nouns anywhere in this prompt. The model is told to READ the
// document for the issuing body's name; it is never given a list to match
// against, because a list is how a classifier learns to see only the states
// someone thought of.
export const SYSTEM_PROMPT =
  `You decide whether a document records a RESTRICTION ON DATA CENTER DEVELOPMENT, and transcribe it. Return ONLY valid JSON.

{
  "is_restriction": true,
  "authority_level": "STATE_AGENCY",
  "issuing_authority": "the body as it names itself in the document, or null",
  "instrument_type": "order",
  "instrument_no": "docket number / ordinance number / revision id, or null",
  "state_abbr": "XX or null",
  "jurisdiction_name": "name or null",
  "effective_date": "YYYY-MM-DD or null",
  "effective_date_stated": true,
  "extract": "a verbatim span copied from the document, <=${MAX_EXTRACT_CHARS} chars",
  "signal_score": 0.91,
  "signal_reasons": ["restriction_verb:suspended", "object:large load", "authority:commission", "scope:statewide"]
}

authority_level is one of: ${AUTHORITY_LEVELS.join(", ")}.
  LOCAL          a city, county, township, town, village, parish or tribal body
  STATE          a legislature or a governor, effect statewide
  STATE_AGENCY   a utility commission order or docket
  GRID_OPERATOR  an independent system operator's protocol revision, queue suspension or tariff gate
  UTILITY        a utility's own tariff or service-territory restriction
  FEDERAL        a federal instrument

instrument_type is one of: ${INSTRUMENT_TYPES.join(", ")}.
  Use "rescission" when a restriction is LIFTED, expired or repealed. A lifted
  restriction is a record event, not a non-event: set is_restriction true for it.

RULES — these decide whether the answer is usable at all:

1. "extract" MUST be copied character-for-character from the document. Never
   paraphrase, never summarise, never tidy the grammar. If no span of the
   document supports the claim, set is_restriction false and return an empty
   extract. A paraphrase in a citation is a fabrication with good manners, and
   it is checked: a non-verbatim extract is discarded along with the candidate.

2. "effective_date" is TRANSCRIBED or null. Set effective_date_stated false
   when the document does not state a date, and leave effective_date null.
   NEVER compute a date from a term length ("a 180-day moratorium" does not
   tell you when it started).

3. Unknown issuing authority, jurisdiction, state or instrument number → null.
   Never guess, never infer from the publisher, never fill a field because it
   looks empty. Empty is correct when the document is silent.

4. If the document is a paywall notice, a consent interstitial, an error page or
   otherwise was not retrieved, set is_restriction false. Do NOT infer the
   content from the headline.

5. is_restriction is FALSE for: growth and expansion announcements (new campus,
   new capacity, contracted load rising), ordinary permit approvals, and
   commentary or opinion about restrictions that does not itself record one.

6. signal_score is your confidence 0.000-1.000 that this document records a real
   restriction instrument. signal_reasons lists the specific triggers you used.

No markdown, no backticks, no explanation. JSON only.`;

export function buildUserPrompt(a: {
  source_url: string;
  published_at: string | null;
  title: string;
  body: string;
}): string {
  return `URL: ${a.source_url}
Published: ${a.published_at ?? "unknown"}
Title: ${a.title}

Document:
${a.body.slice(0, 12000)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Classification {
  is_restriction: boolean;
  authority_level: AuthorityLevel | null;
  issuing_authority: string | null;
  instrument_type: string | null;
  instrument_no: string | null;
  state_abbr: string | null;
  jurisdiction_name: string | null;
  effective_date: string | null;
  effective_date_stated: boolean;
  extract: string;
  signal_score: number;
  signal_reasons: string[];
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  value?: Classification;
}

/** Collapse whitespace and lowercase, so a verbatim check is not defeated by a
 * line break the model normalized away. Everything else — wording, order,
 * punctuation — must still match exactly. */
export function normalizeForCompare(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Empty, "unknown", "n/a", "none", "null" all mean the document was silent.
 * Keeping any of them as a string would publish a guess dressed as a fact. */
export function nullish(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (/^(unknown|n\/?a|none|null|not stated|not specified|tbd|-{1,2})$/i.test(t)) return null;
  return t;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a parsed model response against §6.3. Returns ok:false with a reason
 * rather than throwing — a rejected classification is an ordinary outcome that
 * the caller counts, not an error that aborts a run.
 *
 * `documentText` is the text the model was actually shown. The verbatim check
 * is run against it, so a model that quotes something plausible but absent is
 * caught here rather than in a published citation.
 */
export function validateClassification(raw: unknown, documentText: string): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const o = raw as Record<string, unknown>;

  if (o.is_restriction !== true) return { ok: false, reason: "is_restriction not true" };

  const level = typeof o.authority_level === "string" ? o.authority_level.toUpperCase() : "";
  if (!AUTHORITY_LEVELS.includes(level as AuthorityLevel)) {
    return { ok: false, reason: `authority_level '${level}' not in vocabulary` };
  }

  const extract = typeof o.extract === "string" ? o.extract.trim() : "";
  if (!extract) return { ok: false, reason: "empty extract" };
  if (extract.length > MAX_EXTRACT_CHARS) {
    return { ok: false, reason: `extract ${extract.length} chars > ${MAX_EXTRACT_CHARS}` };
  }
  // THE RULE THAT MATTERS. Not advisory.
  if (!normalizeForCompare(documentText).includes(normalizeForCompare(extract))) {
    return { ok: false, reason: "extract is not a verbatim span of the document" };
  }

  // §6.3 — a date exists only if the document said so. `effective_date_stated`
  // is the model's own claim, and the date is dropped whenever it is not true.
  const stated = o.effective_date_stated === true;
  let effective: string | null = null;
  if (stated) {
    const d = nullish(o.effective_date);
    if (d && ISO_DATE.test(d) && !isNaN(Date.parse(d))) effective = d;
  }

  const instrument = nullish(o.instrument_type);
  if (instrument && !INSTRUMENT_TYPES.includes(instrument as never)) {
    return { ok: false, reason: `instrument_type '${instrument}' not in vocabulary` };
  }

  const stateRaw = nullish(o.state_abbr);
  const state = stateRaw && /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : null;

  let score = Number(o.signal_score);
  if (!isFinite(score)) score = 0;
  score = Math.min(1, Math.max(0, score));

  const reasons = Array.isArray(o.signal_reasons)
    ? o.signal_reasons.filter((r): r is string => typeof r === "string").slice(0, 24)
    : [];

  return {
    ok: true,
    value: {
      is_restriction: true,
      authority_level: level as AuthorityLevel,
      issuing_authority: nullish(o.issuing_authority),
      instrument_type: instrument,
      instrument_no: nullish(o.instrument_no),
      state_abbr: state,
      jurisdiction_name: nullish(o.jurisdiction_name),
      effective_date: effective,
      effective_date_stated: stated,
      extract,
      signal_score: score,
      signal_reasons: reasons,
    },
  };
}

/** Strip markdown fences and recover the outermost object, mirroring the
 * enrichment pipeline's parser. Never repairs JSON content. */
export function parseClassifierText(text: string): unknown {
  const stripped = (text ?? "")
    .trim()
    .replace(/^\s*```[a-zA-Z0-9]*\s*/, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (e) {
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(stripped.slice(first, last + 1));
    throw e;
  }
}

/**
 * Identity of a CANDIDATE, for the §6.5 content hash.
 *
 * DEVIATION FROM §6.5 AS WRITTEN, and the reason. The CC specifies
 * `sha256(canonical_url || instrument_no || effective_date)`. Taken literally
 * that keys on the DISCOVERY URL, so one commission order reported by three
 * outlets yields three candidates — which §6.6 forbids in the same breath
 * ("trade-press coverage … dedupes into the underlying instrument as
 * corroboration — never a second row"). The two clauses cannot both hold.
 *
 * Resolved in favour of §6.6, because that is the behaviour the digest depends
 * on: an inbox that lists the same order three times stops being read.
 *
 *   - When the instrument identifies itself — an instrument number plus the
 *     state and authority that issued it — THAT is the key. It is stable across
 *     every outlet that reports it, which is exactly the property wanted.
 *   - With no instrument number there is nothing outlet-independent to key on,
 *     so the canonical URL is the fallback, as the CC wrote it. Two outlets
 *     covering an unnumbered instrument will produce two candidates; that is a
 *     known, bounded cost and the digest shows them adjacently.
 */
export function candidateHashInput(c: {
  canonical_url: string;
  instrument_no: string | null;
  effective_date: string | null;
  state_abbr?: string | null;
  authority_level?: string | null;
}): string {
  const no = (c.instrument_no ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (no) {
    return [
      "instrument",
      c.authority_level ?? "",
      c.state_abbr ?? "",
      no,
      c.effective_date ?? "",
    ].join("|");
  }
  return ["url", c.canonical_url, c.effective_date ?? ""].join("|");
}
