// dc-hub-sync — pure transforms (no network, no db). Unit-tested in
// test/dc-hub-sync.test.mjs. Mirrors the poller-pure.ts / enrich-pure.ts split:
// all normalization + fingerprinting lives here so the handler stays thin.
//
// DC Hub facility payloads are normalized into the dc_facilities row shape.
// The exact DC Hub REST field spelling is treated defensively (several
// candidate keys per field) because the live response shape is validated
// against Myke's account key at deploy time — see docs/dc-hub-intelligence.

export interface FacilityRow {
  facility_id: string;
  slug: string | null;
  name: string;
  operator: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  market: string | null;
  latitude: number | null;
  longitude: number | null;
  total_power_mw: number | null;
  used_power_mw: number | null;
  cooling_type: string | null;
  fiber_provider_count: number | null;
  fiber_carriers: string[];
  commission_year: number | null;
  operational_status: string;
  dcpi_verdict: string | null;
  dcpi_market_rank: number | null;
  tenants: string[];
  raw: Record<string, unknown>;
  dc_hub_retrieved_at: string | null;
}

const STATUS_MAP: Record<string, string> = {
  operational: "operational",
  live: "operational",
  active: "operational",
  "in service": "operational",
  "under construction": "under_construction",
  under_construction: "under_construction",
  construction: "under_construction",
  building: "under_construction",
  planned: "planned",
  proposed: "planned",
  announced: "planned",
  development: "planned",
  decommissioned: "decommissioned",
  retired: "decommissioned",
  closed: "decommissioned",
};

/** Map a free-text DC Hub status onto the dc_facilities enum. */
export function resolveStatus(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const key = raw.trim().toLowerCase();
  return STATUS_MAP[key] ?? "unknown";
}

/** First present, non-empty value among several candidate keys. */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
}

function toStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Coerce carriers/tenants that may arrive as string[], comma string, or object[]. */
export function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "string"
          ? x
          : x && typeof x === "object"
          ? String((x as Record<string, unknown>).name ??
                   (x as Record<string, unknown>).carrier ??
                   (x as Record<string, unknown>).tenant ?? "")
          : ""
      )
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === "string") {
    return v.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** Normalize a DC Hub facility object into a dc_facilities row (raw = shareable projection). */
export function normalizeFacility(f: Record<string, unknown>): FacilityRow | null {
  const id = toStr(pick(f, ["facility_id", "id", "slug"]));
  const name = toStr(pick(f, ["name", "facility_name", "title"]));
  if (!id || !name) return null; // id + name are the minimum viable row

  const carriers = toStringArray(pick(f, ["fiber_carriers", "carriers", "carrier_list"]));
  const fiberCount = toInt(pick(f, ["fiber_provider_count", "fiber_count", "carrier_count"]));

  return {
    facility_id: id,
    slug: toStr(pick(f, ["slug", "id"])) ?? id,
    name,
    operator: toStr(pick(f, ["operator", "provider", "owner"])),
    address: toStr(pick(f, ["address", "street_address", "location"])),
    city: toStr(pick(f, ["city", "locality"])),
    state: toStr(pick(f, ["state", "region", "province"])),
    country: toStr(pick(f, ["country", "country_code", "iso_country"])),
    market: toStr(pick(f, ["market", "metro", "dcpi_market"])),
    latitude: toNum(pick(f, ["latitude", "lat"])),
    longitude: toNum(pick(f, ["longitude", "lon", "lng"])),
    total_power_mw: toNum(pick(f, ["total_power_mw", "capacity_mw", "power_mw", "total_mw"])),
    used_power_mw: toNum(pick(f, ["used_power_mw", "used_mw", "utilized_mw"])),
    cooling_type: toStr(pick(f, ["cooling_type", "cooling"])),
    fiber_provider_count: fiberCount ?? (carriers.length || null),
    fiber_carriers: carriers,
    commission_year: toInt(pick(f, ["commission_year", "commissioning_year", "year_commissioned", "built_year"])),
    operational_status: resolveStatus(pick(f, ["operational_status", "status", "lifecycle"])),
    dcpi_verdict: toStr(pick(f, ["dcpi_verdict", "market_verdict", "verdict"])),
    dcpi_market_rank: toInt(pick(f, ["dcpi_market_rank", "market_rank", "dcpi_rank"])),
    tenants: toStringArray(pick(f, ["tenants", "tenant_list", "customers"])),
    raw: sharablePayload(f),
    dc_hub_retrieved_at: toStr(pick(f, ["retrieved_at", "updated_at", "as_of"])),
  };
}

// Keep `raw` to a known-shareable projection. We deliberately do NOT persist the
// whole DC Hub object — the table is anon-readable and gated fields must not be
// re-published. Only echo back the identity/context we already surface in columns.
function sharablePayload(f: Record<string, unknown>): Record<string, unknown> {
  const keep = [
    "facility_id", "id", "slug", "name", "operator", "provider", "market",
    "metro", "country", "country_code", "dcpi_verdict", "market_verdict",
    "operational_status", "status",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (f[k] !== undefined) out[k] = f[k];
  return out;
}

/**
 * Deterministic fingerprint over the salient fields. The handler SHA-256s this
 * to produce content_hash; an unchanged facility yields an unchanged hash and
 * the upsert is skipped (content-addressing precedent from the Briefing Library
 * Gamma export + the artifacts content_hash dedupe).
 */
export function facilityFingerprint(row: FacilityRow): string {
  const salient = [
    row.facility_id, row.name, row.operator, row.address, row.city, row.state,
    row.country, row.market, row.latitude, row.longitude, row.total_power_mw,
    row.used_power_mw, row.cooling_type, row.fiber_provider_count,
    row.fiber_carriers.join("|"), row.commission_year, row.operational_status,
    row.dcpi_verdict, row.dcpi_market_rank, row.tenants.join("|"),
  ];
  return JSON.stringify(salient);
}

/**
 * Normalize an operator string for matching against tracking_companies.name:
 * lowercase, strip corporate suffixes and punctuation, collapse whitespace.
 * Exact-normalized match only — fuzzy resolution is intentionally out of scope
 * (a wrong company link is worse than an unmapped miss).
 */
export function normalizeOperatorName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\./g, "")          // drop dots so "L.L.C." → "llc", "Inc." → "inc"
    .replace(/,/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|ag|holdings?|group)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
