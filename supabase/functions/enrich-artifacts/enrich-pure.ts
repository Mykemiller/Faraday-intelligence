// enrich-pure.ts — pure logic for enrich-artifacts.
// v20: Batches API rebuild. v22: per-item IDF tag derivation
// (CC-BOUNDSTONE-INGEST-1.1 §5.2, FAR-418).
// Deno-free (ext-pure pattern) so tests import it directly.

export const ENRICH_MODEL = "claude-haiku-4-5-20251001";
// v22 raises the ceiling: the response now carries two tag arrays alongside the
// summary. 512 was tight enough that a long summary could truncate the JSON.
export const MAX_OUTPUT_TOKENS = 768;

/** One row of the live IDF taxonomy (public.faraday_subdomains). Loaded at
 * submit time and injected into the prompt — never hardcoded here. Hardcoding
 * would fork the taxonomy, and the taxonomy is always-human (FAR-177). */
export interface TaxonomyEntry {
  subdomain_code: string; // 'D3.2'
  domain_code: string; // 'D3'
  display_name: string;
}

export const UNCLASSIFIED = "UNCLASSIFIED";

/** Order D-codes the way a human reads them: D2 before D13, D3.2 before D3.10.
 * Lexical ordering puts D18 ahead of D3 and quietly corrupts every ordered
 * comparison downstream. */
export function compareCodes(a: string, b: string): number {
  const parse = (c: string) => c.replace(/^D/i, "").split(".").map(Number);
  const [ad, as_ = 0] = parse(a);
  const [bd, bs = 0] = parse(b);
  return ad === bd ? as_ - bs : ad - bd;
}

/**
 * v22 — the item classifies itself.
 *
 * THE DEFECT THIS REPLACES: artifacts carried the tags of the SOURCE that
 * emitted them (a DB trigger copied signal_envelope.idf_domains onto every
 * row). A statewide regulatory action arriving through a general-news feed was
 * therefore filed under whatever that feed is nominally about. Measured on the
 * trailing 30 days: 5,448 of 328,530 artifacts carry any subdomain at all
 * (1.7%), and 1,739 carry a D#.# string in the DOMAINS column. Nothing in the
 * pipeline had ever asked an item what it was about.
 *
 * The source's own domains are still passed in, but as a PRIOR the model may
 * overrule — never as a value that gets written.
 */
export function buildSystemPrompt(taxonomy: TaxonomyEntry[]): string {
  const lines = taxonomy
    .slice()
    .sort((a, b) => compareCodes(a.subdomain_code, b.subdomain_code))
    .map((t) => `${t.subdomain_code} ${t.display_name}`)
    .join("\n");

  return `You are Faraday's intelligence enrichment engine. Analyze data center and AI infrastructure content and return ONLY valid JSON.

Output schema:
{
  "summary": "2-3 sentence factual summary",
  "category_tags": ["tag1", "tag2"],
  "relevance_score": 0.0,
  "priority_flag": false,
  "prediction_signals": {},
  "entity_mentions": [],
  "ifs_subdomains": ["D0.0"]
}

Category tags must be from: chips_density, power_architecture, grid_regulatory, ma_capital, hyperscaler, new_entrants, cooling_water, people_signals, orchestration, construction, sustainability

entity_mentions must be an array of plain strings (company / org / person names). No objects.

ifs_subdomains: classify THIS DOCUMENT, from the list below. Rules:
- Choose 1-3 codes that the document's own content supports. Copy the code exactly.
- Judge the document, not its publisher. A feed's usual subject is a hint, never the answer: a statewide regulatory action reported by a local-community outlet is a regulatory item, not a local-community item.
- If nothing in the list fits, return exactly ["${UNCLASSIFIED}"]. That is a real, useful answer. Do NOT reach for a loosely-related code to avoid it, and do NOT return an empty array.
- Never invent a code that is not listed.

Available subdomains:
${lines}

No markdown, no backticks, no explanation. JSON only.`;
}

export interface ArtifactLike {
  artifact_id: string;
  raw_content: string;
  source_type: string;
  source_url: string;
  /** The SOURCE's declared domains, read from signal_envelope.idf_domains.
   * A prompt prior only — §5.2 forbids writing this onto the artifact. */
  source_prior_domains?: string[] | null;
}

export interface EnrichmentResult {
  summary: string;
  category_tags: string[];
  relevance_score: number;
  priority_flag: boolean;
  prediction_signals: Record<string, unknown>;
  entity_mentions: unknown[];
  ifs_subdomains?: unknown;
}

/** Resolved, validated tags for one artifact. */
export interface DerivedTags {
  ifs_domains: string[];
  ifs_subdomains: string[];
  unclassified: boolean;
}

/**
 * Validate the model's subdomain picks against the live taxonomy and derive the
 * parent domains from them.
 *
 * Domains are DERIVED, never taken from the model: D3.2's parent is D3 by
 * construction, so asking for both invites the two columns to disagree — which
 * is the column confusion migration 0030 constrains against.
 *
 * Anything not in the taxonomy is dropped, not repaired. If nothing survives,
 * the result is the UNCLASSIFIED sentinel: a loud "the classifier looked and
 * found nothing", which is a different and more useful statement than the empty
 * array that 98.3% of the corpus currently carries.
 */
export function deriveTags(raw: unknown, taxonomy: TaxonomyEntry[]): DerivedTags {
  const byCode = new Map(taxonomy.map((t) => [t.subdomain_code, t]));
  const picks = Array.isArray(raw) ? raw : [];
  const subs: string[] = [];
  for (const p of picks) {
    if (typeof p !== "string") continue;
    const code = p.trim().toUpperCase();
    if (code === UNCLASSIFIED) continue; // handled by the fallthrough below
    if (byCode.has(code) && !subs.includes(code)) subs.push(code);
  }
  if (subs.length === 0) {
    return { ifs_domains: [], ifs_subdomains: [UNCLASSIFIED], unclassified: true };
  }
  // Numeric, not lexical. A default .sort() puts D18.1 before D3.1, which makes
  // every ordered read of these arrays subtly wrong and any diff between two
  // taggings unreadable.
  subs.sort(compareCodes);
  const domains = [...new Set(subs.map((c) => byCode.get(c)!.domain_code))].sort(compareCodes);
  return { ifs_domains: domains, ifs_subdomains: subs, unclassified: false };
}

/** One Message Batches request per artifact; custom_id carries the artifact id. */
export function buildBatchRequests(artifacts: ArtifactLike[], taxonomy: TaxonomyEntry[]) {
  const system = buildSystemPrompt(taxonomy);
  return artifacts.map((a) => ({
    custom_id: a.artifact_id,
    params: {
      model: ENRICH_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{
        role: "user",
        // "Publisher's usual subject" names the prior for what it is. The
        // previous wording ("Domains:") read as an assertion about this item
        // and is precisely how source-level tags became item-level facts.
        content: `Source type: ${a.source_type}\nURL: ${a.source_url}\nPublisher's usual subject (a hint about the FEED, not a fact about this document — overrule it when the document says otherwise): ${(a.source_prior_domains ?? []).join(", ") || "unknown"}\n\nContent:\n${a.raw_content.slice(0, 6000)}`,
      }],
    },
  }));
}

/** Parse the enrichment JSON out of a model response. Strips markdown code
 * fences (```json / ``` / any ```lang tag, case-insensitive) plus surrounding
 * whitespace before JSON.parse; if that still fails, falls back to the
 * outermost {...} object (handles stray prose or a leftover fence around an
 * otherwise-valid object). This never repairs the model's JSON *content* — a
 * genuinely malformed object (e.g. an unescaped inner quote) still throws and
 * is recorded as a per-item failure by the caller. */
export function parseEnrichmentText(text: string): EnrichmentResult {
  const stripped = text
    .trim()
    .replace(/^\s*```[a-zA-Z0-9]*\s*/, "") // leading fence + optional language tag
    .replace(/\s*```\s*$/, "")             // trailing fence
    .trim();
  try {
    return JSON.parse(stripped) as EnrichmentResult;
  } catch (e) {
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(stripped.slice(first, last + 1)) as EnrichmentResult;
    }
    throw e;
  }
}

/** Fraction of per-item failures a batch run tolerates before it is flagged
 * unhealthy. Occasional single-item enrichment failures (an unparseable line,
 * an Anthropic-side "errored" result) out of ~120 must not mark the whole run
 * failed — that produced 11 false-alarm runs in 14 days. */
export const BATCH_FAILURE_TOLERANCE = 0.05;

/** Health-log success flag for an enrich run. A run is healthy when the
 * per-item failure rate is within BATCH_FAILURE_TOLERANCE AND no systemic
 * (non-per-item) error occurred — a submit failure, a batch-fetch error, or a
 * top-level exception still fails the run. Per-item failures are recorded in
 * the errors array / notes regardless; this flag alone no longer flips on them.
 *   processed       — items enriched successfully this run
 *   failed          — items that failed per-item (each also logged to errors)
 *   systemicErrors  — errors NOT tied to a per-item failure (errors.length - failed) */
export function batchRunSucceeded(
  processed: number,
  failed: number,
  systemicErrors: number,
): boolean {
  if (systemicErrors > 0) return false;
  const attempted = processed + failed;
  if (attempted === 0) return true; // nothing to do — a healthy no-op run
  return failed / attempted <= BATCH_FAILURE_TOLERANCE;
}

export interface BatchLine {
  artifactId: string;
  ok: boolean;
  enrichment?: EnrichmentResult;
  error?: string;
}

/** Parse the results JSONL stream from a finished batch. Never throws on a
 * bad line — each line resolves to ok:false with the reason instead. */
export function parseBatchResults(jsonl: string): BatchLine[] {
  const out: BatchLine[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const id = obj.custom_id;
      if (!id) continue;
      if (obj.result?.type === "succeeded") {
        const text = obj.result.message?.content?.[0]?.text ?? "{}";
        try {
          out.push({ artifactId: id, ok: true, enrichment: parseEnrichmentText(text) });
        } catch {
          out.push({ artifactId: id, ok: false, error: `unparseable enrichment JSON: ${text.slice(0, 120)}` });
        }
      } else {
        out.push({ artifactId: id, ok: false, error: obj.result?.type ?? "unknown result type" });
      }
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Claude may return entity_mentions as strings OR objects; coerce to a name. */
export function mentionName(m: unknown): string | null {
  if (typeof m === "string") return m;
  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    const v = o.name ?? o.entity ?? o.entity_name ?? o.text;
    if (typeof v === "string") return v;
  }
  return null;
}

const CHUNK_CHARS = 512 * 4;
const OVERLAP_CHARS = 64 * 4;

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_CHARS, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start = end - OVERLAP_CHARS;
  }
  return chunks.filter((c) => c.length > 50);
}
