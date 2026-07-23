// eia-retired-sync/pure.ts — pure normalization for the EIA-860M "Retired" tab.
// Key-map built ONCE per row (perf). Header keys matched case/space-insensitively
// (EIA renames headers between vintages). No network.

export interface EiaRetiredRow { [k: string]: string | number | null | undefined }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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
  const map = new Map(Object.keys(row).map((k) => [norm(k), k]));
  const g = (...cands: string[]): string | null => {
    for (const c of cands) {
      const hit = map.get(norm(c));
      if (hit != null && row[hit] != null && String(row[hit]).trim() !== "") return String(row[hit]).trim();
    }
    return null;
  };
  const plant_code = g("Plant ID", "Plant Code", "plant_code");
  const generator_id = g("Generator ID", "generator_id");
  if (!plant_code || !generator_id) return null;
  return {
    plant_code, generator_id,
    plant_name: g("Plant Name"),
    state: g("Plant State", "State"),
    county: g("County"),
    latitude: toNum(g("Latitude")),
    longitude: toNum(g("Longitude")),
    technology: g("Technology"),
    energy_source: g("Energy Source Code", "Energy Source 1", "Energy Source"),
    prime_mover: g("Prime Mover Code", "Prime Mover"),
    nameplate_capacity_mw: toNum(g("Nameplate Capacity (MW)", "Net Summer Capacity (MW)")),
    operating_year: toInt(g("Operating Year")),
    retirement_year: toInt(g("Retirement Year")),
    retirement_month: toInt(g("Retirement Month")),
    balancing_authority_code: g("Balancing Authority Code", "Balancing Authority"),
    sector: g("Sector", "Sector Name"),
  };
}

export function retiredBasis(r: ReturnType<typeof normalizeRetired>): string {
  if (!r) return "";
  return [r.plant_code, r.generator_id, r.retirement_year, r.retirement_month, r.nameplate_capacity_mw].join("|");
}
