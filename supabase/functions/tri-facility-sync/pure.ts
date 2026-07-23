// tri-facility-sync/pure.ts — pure normalization for EPA TRI tri_facility records
// (Envirofacts). Field names VALIDATED live 2026-07. NAICS is NOT on tri_facility
// (industry_class enriched downstream). Key-map built ONCE per row (perf). No network.

export interface TriRow { [k: string]: string | number | null | undefined }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function industryClass(naics: string | null): string {
  if (!naics) return "unknown";
  const n = naics.replace(/[^0-9]/g, "");
  if (n.startsWith("3313")) return "smelter";
  if (n.startsWith("3311") || n.startsWith("3312") || n.startsWith("331")) return "steel";
  if (n.startsWith("322")) return "paper";
  if (n.startsWith("3344")) return "fab";
  if (n.startsWith("32411") || n.startsWith("324")) return "refinery";
  if (n.startsWith("3254")) return "pharma";
  if (n.startsWith("325")) return "chemical";
  if (n.startsWith("3361") || n.startsWith("3362") || n.startsWith("3363")) return "auto";
  return "other";
}

function toNum(v: string | null): number | null {
  if (v == null) return null;
  const x = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(x) ? x : null;
}

export function normalizeFacility(row: TriRow, reportingYear: number) {
  // Build the normalized-key → original-key map ONCE (not per field lookup).
  const map = new Map(Object.keys(row).map((k) => [norm(k), k]));
  const g = (...cands: string[]): string | null => {
    for (const c of cands) {
      const hit = map.get(norm(c));
      if (hit != null && row[hit] != null && String(row[hit]).trim() !== "") return String(row[hit]).trim();
    }
    return null;
  };
  const tri_facility_id = g("tri_facility_id", "TRIFID");
  if (!tri_facility_id) return null;
  const fips = g("state_county_fips_code");
  const naics = g("primary_naics", "naics");
  return {
    tri_facility_id,
    frs_registry_id: g("epa_registry_id", "frs_id"),
    facility_name: g("facility_name"),
    reporting_year: reportingYear,
    naics_primary: naics,
    industry_class: industryClass(naics),
    state: g("state_abbr"),
    county: g("county_name"),
    county_fips: fips && fips.replace(/[^0-9]/g, "").length === 5 ? fips.replace(/[^0-9]/g, "") : null,
    latitude: toNum(g("pref_latitude", "fac_latitude")),
    longitude: toNum(g("pref_longitude", "fac_longitude")),
    fac_closed_ind: g("fac_closed_ind"),
  };
}

/** Cheap, deterministic content basis (no crypto). */
export function facilityBasis(f: ReturnType<typeof normalizeFacility>): string {
  if (!f) return "";
  return [f.tri_facility_id, f.reporting_year, f.fac_closed_ind, f.county_fips].join("|");
}
