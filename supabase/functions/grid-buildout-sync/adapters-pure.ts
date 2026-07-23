// grid-buildout-sync — pure transforms (no network, no db). Unit-tested in
// test/grid-buildout-sync.test.mjs. Mirrors the poller-pure.ts / sync-pure.ts
// split: all normalization + classification + fingerprinting lives here so the
// handler stays thin.
//
// FAR-379: ISO/RTO transmission-expansion-plan rows are normalized into the
// grid_buildout_projects row shape, and each named substation endpoint is
// projected into a substation_source_mention for resolution against the HIFLD
// spine. Per-ISO field spellings vary, so every field is picked defensively.
//
// Date semantics (the crux — only actual/energized grades): the TPIT section a
// row came from is authoritative — "Completed" → actual; "Future"/"RTP" →
// projected — with the row's status text as a corroborating override.

export type DateType = "actual" | "required" | "projected" | "approved" | "unknown";

export interface GridBuildoutProject {
  source_type: "iso_transmission_plan" | "puc_filing";
  source_key: string;
  source_ref: string;
  iso_rto: string | null;
  state_abbr: string | null;
  county_fips: string | null;   // resolved by the handler; pure module fills county_raw
  county_raw: string | null;
  project_name: string | null;
  project_description: string | null;
  driver: string | null;
  driver_raw: string | null;
  is_large_load_dc: boolean;
  est_cost_usd: number | null;
  capacity_mw: number | null;
  voltage_kv: number | null;
  substation_names: string[];
  tariff_flag: boolean;
  tariff_type: string | null;
  docket_number: string | null;
  utility_name: string | null;
  planned_inservice_date: string | null;  // ISO yyyy-mm-dd
  actual_inservice_date: string | null;    // ISO yyyy-mm-dd
  date_type: DateType;
  project_status: string | null;
  confidence_tier: "SRC" | "EST";
  raw: Record<string, unknown>;
}

/** A single substation endpoint projected out of a project, for resolution. */
export interface SubstationMention {
  extracted_name_frag: string;
  extracted_voltage_kv: number | null;
  state_abbr_hint: string | null;
  county_fips_hint: string | null;      // handler resolves county_raw → FIPS
  extracted_inservice_date: string | null;
  extracted_date_type: DateType;
  extraction_confidence: number;
}

// ── small coercers (shared idiom with sync-pure.ts) ─────────────────────────
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
function toStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parse a US date (m/d/yyyy, yyyy-mm-dd, "Dec 4, 2013", "May 2024") → ISO or null. */
export function toIsoDate(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);            // yyyy-mm-dd
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);          // m/d/yyyy
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const MON: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  m = s.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);  // Mon d, yyyy
  if (m && MON[m[1].toLowerCase()]) return `${m[3]}-${MON[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  m = s.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/);               // Mon yyyy → 1st
  if (m && MON[m[1].toLowerCase()]) return `${m[2]}-${MON[m[1].toLowerCase()]}-01`;
  m = s.match(/^(\d{4})$/);                                          // bare year → Jan 1
  if (m) return `${m[1]}-01-01`;
  return null;
}

/** kV rating out of a description ("345-kV", "138 kV") → number or null. */
export function extractVoltageKv(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{2,4})\s*-?\s*kv\b/i);
  return m ? Number(m[1]) : null;
}

/** Texas county out of "…in Dickens County" → "Dickens" (county_raw); FIPS is a handler concern. */
export function extractCountyRaw(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/\bin\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*?)\s+[Cc]ount(?:y|ies)\b/);
  return m ? m[1].trim() : null;
}

/** Strip trailing substation-type words a greedy capture may have swallowed. */
function cleanName(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/\s+(Switching Station|Switching|Switchyard|Substation|Switch|Station|SS|Line|Project)$/i, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Substation / switching-station endpoints out of a project description.
 * Handles "A to B 345-kV line" (both endpoints) and "<Name> Switching Station".
 * Deliberately generous — the county+name resolution gate downstream is the
 * real filter, so a spurious endpoint here costs nothing (lands unresolved).
 */
export function extractSubstationNames(text: string | null): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const NAME = "[A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+)*";

  // "<Name> (Switch|Switching Station|Substation|SS|Station)"
  const re1 = new RegExp(`(${NAME})\\s+(?:Switching Station|Substation|Switchyard|Switch|SS|Station)\\b`, "g");
  for (const m of text.matchAll(re1)) out.add(m[1].trim());

  // "<A> to <B>  NNN-kV" — capture both endpoints of a line
  const re2 = new RegExp(`(${NAME})\\s+to\\s+(${NAME})\\b`, "g");
  for (const m of text.matchAll(re2)) { out.add(m[1].trim()); out.add(m[2].trim()); }

  // Drop obvious non-names captured by the greedy patterns; dedupe AFTER
  // cleaning (two raw captures can normalize to the same name).
  const STOP = new Set(["The", "A", "New", "Rebuild", "Construct", "Add", "Amend", "Line", "Energize"]);
  const cleaned = [...out].map(cleanName).filter((s) => s.length > 2 && !STOP.has(s));
  return [...new Set(cleaned)];
}

const DRIVER_RULES: [RegExp, string][] = [
  [/data\s?center|hyperscale|large\s?load|\bAI\b/i, "load_growth"],
  [/generation|interconnection|solar|wind|battery|storage|\bGIA\b|POI/i, "generation_interconnection"],
  [/reliability|contingency|overload|thermal|voltage/i, "reliability"],
  [/economic|congestion|market efficiency/i, "economic"],
  [/policy|renewable|CREZ|public policy/i, "policy"],
  [/asset condition|aging|rebuild|end of life|replace/i, "asset_condition"],
];
/** Normalize a free-text driver/description onto a driver bucket. */
export function classifyDriver(text: string | null): string | null {
  if (!text) return null;
  for (const [re, bucket] of DRIVER_RULES) if (re.test(text)) return bucket;
  return null;
}
export function detectLargeLoadDc(text: string | null): boolean {
  return !!text && /data\s?center|hyperscale|large\s?load|crypto|\bAI\b/i.test(text);
}

/**
 * The TPIT section a row came from is the authoritative date semantics. Status
 * text overrides (an "Energized" row in the Future tab is actual). Only "actual"
 * ever grades a substation downstream.
 */
export function classifyDateType(section: string | null, status: string | null): DateType {
  const sec = (section ?? "").toLowerCase();
  const st = (status ?? "").toLowerCase();
  if (/energiz|in.?service|complete|closed out/.test(st)) return "actual";
  if (/completed/.test(sec)) return "actual";
  if (/cancel/.test(sec) || /cancel/.test(st)) return "unknown";
  if (/under construction|construction/.test(st)) return "required";
  if (/future|rtp|planned|proposed/.test(sec)) return "projected";
  return "unknown";
}

/**
 * Normalize one ERCOT TPIT project row (from a given workbook section) into a
 * grid_buildout_projects row + the substation mentions it implies.
 * `section` is the TPIT tab: "future" | "completed" | "cancelled" | "rtp".
 */
export function normalizeErcotTpit(
  row: Record<string, unknown>,
  section: string,
): { project: GridBuildoutProject; mentions: SubstationMention[] } | null {
  const ref = toStr(pick(row, ["RTP Project Number", "rtp_project_number", "Project ID", "project_id", "id"]));
  const name = toStr(pick(row, ["Project Name", "project_name", "Project Title", "title", "name"]));
  if (!ref && !name) return null;   // need at least a stable ref or a name

  const desc = toStr(pick(row, ["Project Description", "project_description", "description", "Scope"]));
  const status = toStr(pick(row, ["Project Status", "project_status", "status", "Status"]));
  const blob = [name, desc].filter(Boolean).join(". ");

  const dateType = classifyDateType(section, status);
  const rawDate = toIsoDate(pick(row, [
    "Actual In-Service Date", "actual_in_service_date", "Completion Date",
    "Projected In-Service Date", "projected_in_service_date", "In-Service Date",
    "in_service_date", "Estimated In-Service Date",
  ]));
  const isActual = dateType === "actual";

  const voltage = toNum(pick(row, ["Voltage", "voltage_kv", "kV", "kv"])) ?? extractVoltageKv(blob);
  const countyRaw = toStr(pick(row, ["County", "county"])) ?? extractCountyRaw(blob);
  const stateAbbr = (toStr(pick(row, ["State", "state"])) ?? "TX").slice(0, 2).toUpperCase();
  const names = extractSubstationNames(blob);

  const project: GridBuildoutProject = {
    source_type: "iso_transmission_plan",
    source_key: "iso:ercot-tpit",
    source_ref: ref ?? `ercot:${name}`,
    iso_rto: "ERCOT",
    state_abbr: stateAbbr,
    county_fips: null,
    county_raw: countyRaw,
    project_name: name,
    project_description: desc,
    driver: classifyDriver(blob),
    driver_raw: toStr(pick(row, ["Driver", "Need", "driver", "need"])),
    is_large_load_dc: detectLargeLoadDc(blob),
    est_cost_usd: toNum(pick(row, ["Estimated Cost", "estimated_cost", "Cost", "cost"])),
    capacity_mw: toNum(pick(row, ["MW", "Capacity MW", "capacity_mw"])),
    voltage_kv: voltage,
    substation_names: names,
    tariff_flag: /tariff|rate class|large load/i.test(blob),
    tariff_type: null,
    docket_number: null,
    utility_name: toStr(pick(row, ["Utility", "Owner", "TSP", "utility", "owner"])),
    planned_inservice_date: isActual ? null : rawDate,
    actual_inservice_date: isActual ? rawDate : null,
    date_type: dateType,
    project_status: status,
    confidence_tier: isActual ? "SRC" : "EST",
    raw: row,
  };

  const mentions: SubstationMention[] = names.map((n) => ({
    extracted_name_frag: n,
    extracted_voltage_kv: voltage,
    state_abbr_hint: stateAbbr,
    county_fips_hint: null,   // handler resolves from county_raw
    extracted_inservice_date: rawDate,
    extracted_date_type: dateType,
    extraction_confidence: isActual ? 0.85 : 0.30,   // SRC vs EST (per Locked tiers)
  }));

  return { project, mentions };
}

/**
 * Deterministic fingerprint over the salient fields → SHA-256'd by the handler
 * to content_hash. Unchanged project → unchanged hash → upsert skipped
 * (content-addressing precedent from dc-hub-sync / artifacts).
 */
export function projectFingerprint(p: GridBuildoutProject): string {
  return JSON.stringify([
    p.source_key, p.source_ref, p.project_name, p.project_description,
    p.voltage_kv, p.county_raw, p.driver, p.est_cost_usd, p.capacity_mw,
    p.substation_names.join("|"), p.planned_inservice_date,
    p.actual_inservice_date, p.date_type, p.project_status,
  ]);
}
