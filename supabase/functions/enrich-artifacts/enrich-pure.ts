// enrich-pure.ts — pure logic for enrich-artifacts v20 (Batches API rebuild).
// Deno-free (ext-pure pattern) so tests import it directly.

export const ENRICH_MODEL = "claude-haiku-4-5-20251001";
export const MAX_OUTPUT_TOKENS = 512;

export const SYSTEM_PROMPT = `You are Faraday's intelligence enrichment engine. Analyze data center and AI infrastructure content and return ONLY valid JSON.

Output schema:
{
  "summary": "2-3 sentence factual summary",
  "category_tags": ["tag1", "tag2"],
  "relevance_score": 0.0,
  "priority_flag": false,
  "prediction_signals": {},
  "entity_mentions": []
}

Category tags must be from: chips_density, power_architecture, grid_regulatory, ma_capital, hyperscaler, new_entrants, cooling_water, people_signals, orchestration, construction, sustainability

entity_mentions must be an array of plain strings (company / org / person names). No objects.

No markdown, no backticks, no explanation. JSON only.`;

export interface ArtifactLike {
  artifact_id: string;
  raw_content: string;
  source_type: string;
  source_url: string;
  ifs_domains: string[] | null;
}

export interface EnrichmentResult {
  summary: string;
  category_tags: string[];
  relevance_score: number;
  priority_flag: boolean;
  prediction_signals: Record<string, unknown>;
  entity_mentions: unknown[];
}

/** One Message Batches request per artifact; custom_id carries the artifact id. */
export function buildBatchRequests(artifacts: ArtifactLike[]) {
  return artifacts.map((a) => ({
    custom_id: a.artifact_id,
    params: {
      model: ENRICH_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Source type: ${a.source_type}\nURL: ${a.source_url}\nDomains: ${(a.ifs_domains ?? []).join(", ") || "unknown"}\n\nContent:\n${a.raw_content.slice(0, 6000)}`,
      }],
    },
  }));
}

/** Parse the enrichment JSON out of a model response, tolerating fences. */
export function parseEnrichmentText(text: string): EnrichmentResult {
  return JSON.parse(text.replace(/```json|```/g, "").trim()) as EnrichmentResult;
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
