// eia-retired-sync/pure.ts — pure normalization for the EIA-860M "Retired" tab.
// No network. Column keys are matched case/space-insensitively because EIA renames
// headers between vintages — PROVISIONAL until validated against a live workbook.

export interface EiaRetiredRow { [k: string]: string | number | null | undefined }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolve a value by any of several candidate header spellings. */
export function pick(row: EiaRetiredRow, ...cands: string[]): string | null {
  const map = new Map(Object.keys(row).map((k) => [norm(k), k]));
  for (const c of cands) {
    const hit = map.get(norm(c));
    if (hit != null && row[hit] != null && String(row[hit]).trim() !== "") return String(row[hit]).trim();
  }
  return null;
}

export function toInt(v: string | null): number | null {
  if (v == null) return null;
  const n = parseInt(v.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
export function toNum(v: string | null): number | null {
  if (v == null) return null;
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeRetired(row: EiaRetiredRow) {
  const plant_code = pick(row, "Plant ID", "Plant Code", "plant_code");
  const generator_id = pick(row, "Generator ID", "generator_id");
  if (!plant_code || !generator_id) return null;   // key required
  return {
    plant_code,
    generator_id,
    plant_name: pick(row, "Plant Name"),
    state: pick(row, "Plant State", "State"),
    county: pick(row, "County"),
    latitude: toNum(pick(row, "Latitude")),
    longitude: toNum(pick(row, "Longitude")),
    technology: pick(row, "Technology"),
    energy_source: pick(row, "Energy Source Code", "Energy Source 1", "Energy Source"),
    prime_mover: pick(row, "Prime Mover Code", "Prime Mover"),
    nameplate_capacity_mw: toNum(pick(row, "Nameplate Capacity (MW)", "Net Summer Capacity (MW)")),
    operating_year: toInt(pick(row, "Operating Year")),
    retirement_year: toInt(pick(row, "Retirement Year")),
    retirement_month: toInt(pick(row, "Retirement Month")),
    balancing_authority_code: pick(row, "Balancing Authority Code", "Balancing Authority"),
    sector: pick(row, "Sector", "Sector Name"),
  };
}

/** Content hash basis — stable across re-pulls unless a material field changes. */
export function retiredBasis(r: ReturnType<typeof normalizeRetired>): string {
  if (!r) return "";
  return [r.plant_code, r.generator_id, r.retirement_year, r.retirement_month, r.nameplate_capacity_mw].join("|");
}
