// Pure helpers for ingest-state-incentives-push — no Deno/network imports, so
// they run under the repo's node test runner (--experimental-strip-types).
//
// The push endpoint accepts rows ALREADY parsed by the Playwright scraper
// (which runs in GitHub Actions, where there is a real browser + open egress).
// It reuses the exact state_incentive_disclosures contract + content-hash
// dedupe as the fetch-based ingest-state-incentives fn, so scraped rows flow
// through the same resolve_and_score (INC-01..05) pipeline. Scraped sources are
// registered at confidence_cap='INF' (migration 0036), so they never score SRC.

// The whitelisted disclosure columns a pushed row may set. state_abbr and
// source_key are stamped from the top-level request (authoritative), never from
// per-row data — a scraper cannot mislabel rows into another state/source.
export type PushRow = {
  state_abbr: string;
  source_key: string;
  source_record_id: string | null;
  recipient_name: string | null;
  project_name: string | null;
  project_address: string | null;
  parcel_id: string | null;
  place_name: string | null;
  county_name: string | null;
  incentive_type: string | null;
  raw_incentive_type: string | null;
  program_name: string | null;
  statute_citation: string | null;
  award_value_usd: number | null;
  term_start: string | null;
  term_end: string | null;
  term_years: number | null;
  source_url: string | null;
  raw: unknown;
};

const STR_FIELDS = [
  "source_record_id", "recipient_name", "project_name", "project_address",
  "parcel_id", "place_name", "county_name", "incentive_type",
  "raw_incentive_type", "program_name", "statute_citation",
  "term_start", "term_end", "source_url",
] as const;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
  return isFinite(n) ? n : null;
}

// Build a clean disclosure row from untrusted scraper output. state_abbr and
// source_key come from the request, not the row. Unknown keys are dropped.
export function buildPushRow(raw: Record<string, unknown>, sourceKey: string, stateAbbr: string): PushRow {
  const row = {} as PushRow;
  row.state_abbr = stateAbbr.toUpperCase();
  row.source_key = sourceKey;
  for (const k of STR_FIELDS) (row as Record<string, unknown>)[k] = str(raw[k]);
  row.award_value_usd = numOrNull(raw.award_value_usd);
  row.term_years = numOrNull(raw.term_years);
  row.raw = raw.raw ?? raw;
  return row;
}

// Identical hashing to ingest-state-incentives/index.ts so a given disclosure
// content-hashes the same regardless of ingest path.
export async function contentHash(r: PushRow): Promise<string> {
  const basis = [
    r.state_abbr, r.source_key, r.source_record_id ?? "",
    r.recipient_name ?? "", r.program_name ?? "", r.raw_incentive_type ?? "",
    r.award_value_usd ?? "", r.term_start ?? "", r.term_end ?? "", r.county_name ?? "",
  ].join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Basic request validation. Returns an error string or null.
export function validatePushBody(body: {
  source_key?: unknown; state_abbr?: unknown; rows?: unknown;
}): string | null {
  if (typeof body.source_key !== "string" || body.source_key.trim() === "") return "source_key required";
  if (typeof body.state_abbr !== "string" || !/^[A-Za-z]{2}$/.test(body.state_abbr)) return "state_abbr must be a 2-letter code";
  if (!Array.isArray(body.rows)) return "rows must be an array";
  if (body.rows.length > 50000) return "rows exceeds 50000 per call";
  return null;
}
