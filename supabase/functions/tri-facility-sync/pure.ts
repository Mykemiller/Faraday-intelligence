// tri-facility-sync/pure.ts — pure normalization for EPA TRI facility-year records
// (Envirofacts / TRI Basic Data Files). Maps NAICS → the seven target industry
// classes. No network. Header mapping PROVISIONAL until validated against live pulls.

export interface TriRow { [k: string]: string | number | null | undefined }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function pick(row: TriRow, ...cands: string[]): string | null {
  const map = new Map(Object.keys(row).map((k) => [norm(k), k]));
  for (const c of cands) {
    const hit = map.get(norm(c));
    if (hit != null && row[hit] != null && String(row[hit]).trim() !== "") return String(row[hit]).trim();
  }
  return null;
}

/** NAICS (any depth) → target industry class for the stranded-industrial thesis. */
export function industryClass(naics: string | null): string {
  if (!naics) return "other";
  const n = naics.replace(/[^0-9]/g, "");
  if (n.startsWith("3313")) return "smelter";        // alumina & aluminum production
  if (n.startsWith("3311") || n.startsWith("3312") || n.startsWith("331")) return "steel";
  if (n.startsWith("322")) return "paper";
  if (n.startsWith("3344")) return "fab";            // semiconductor & related
  if (n.startsWith("32411")) return "refinery";
  if (n.startsWith("324")) return "refinery";
  if (n.startsWith("3254")) return "pharma";
  if (n.startsWith("325")) return "chemical";
  if (n.startsWith("3361") || n.startsWith("3362") || n.startsWith("3363")) return "auto";
  return "other";
}

export function toNum(v: string | null): number | null {
  if (v == null) return null;
  const x = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(x) ? x : null;
}

/** Pad a county FIPS to 5 digits from state FIPS (2) + county FIPS (3) if split. */
export function county5(stateFips: string | null, countyFips: string | null, combined: string | null): string | null {
  if (combined) { const c = combined.replace(/[^0-9]/g, ""); if (c.length === 5) return c; }
  if (stateFips && countyFips) {
    const s = stateFips.replace(/[^0-9]/g, "").padStart(2, "0");
    const c = countyFips.replace(/[^0-9]/g, "").padStart(3, "0");
    if (s.length === 2 && c.length === 3) return s + c;
  }
  return null;
}

export function normalizeFacility(row: TriRow, reportingYear: number) {
  const tri_facility_id = pick(row, "TRI_FACILITY_ID", "TRIFID", "tri_facility_id");
  if (!tri_facility_id) return null;
  const naics = pick(row, "PRIMARY_NAICS", "NAICS", "naics_code");
  return {
    tri_facility_id,
    frs_registry_id: pick(row, "FRS_ID", "REGISTRY_ID", "frs_registry_id"),
    facility_name: pick(row, "FACILITY_NAME", "FAC_NAME"),
    reporting_year: reportingYear,
    naics_primary: naics,
    industry_class: industryClass(naics),
    state: pick(row, "STATE_ABBR", "ST", "state"),
    county: pick(row, "COUNTY_NAME", "COUNTY"),
    county_fips: county5(pick(row, "FIPS_STATE", "STATE_FIPS"), pick(row, "FIPS_COUNTY", "COUNTY_FIPS"), pick(row, "COUNTY_FIPS_5", "FIPS")),
    latitude: toNum(pick(row, "LATITUDE", "PREF_LATITUDE")),
    longitude: toNum(pick(row, "LONGITUDE", "PREF_LONGITUDE")),
  };
}

export function facilityBasis(f: ReturnType<typeof normalizeFacility>): string {
  if (!f) return "";
  return [f.tri_facility_id, f.reporting_year, f.naics_primary, f.county_fips].join("|");
}
