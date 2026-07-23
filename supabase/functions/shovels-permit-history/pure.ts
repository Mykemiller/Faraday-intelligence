// shovels-permit-history/pure.ts — pure, I/O-free (Deno-style tests run under Node).
// RSC-05 velocity source normalization + the min-n / recency-decay aggregation.
// Permit field names VALIDATED against the live /permits/search response 2026-07.

export const SHOVELS_FILTER = {
  property_type: "commercial",
  tag: "new_construction",      // the tight class — never widen
  permit_from: "2016-01-01",    // 10-year window (Myke's call, 2026-07)
  permit_to: "2026-06-30",
} as const;

export interface RawPermit {
  id: string; type?: string; tags?: string[]; property_type?: string; status?: string;
  file_date?: string; issue_date?: string; job_value?: number;
  property_building_area?: number; latitude?: number; longitude?: number; geo_id?: string;
}

export function lagDays(file?: string, issue?: string): number | null {
  if (!file || !issue) return null;
  const d = Math.round((Date.parse(issue) - Date.parse(file)) / 86_400_000);
  return Number.isFinite(d) ? d : null;
}

export function normalize(p: RawPermit, countyFips: string | null) {
  return {
    shovels_permit_id: p.id, county_fips: countyFips, geo_id: p.geo_id ?? null,
    permit_type: p.type ?? null, tags: p.tags ?? [], status: p.status ?? null,
    property_type: p.property_type ?? null, file_date: p.file_date ?? null, issue_date: p.issue_date ?? null,
    lag_days: lagDays(p.file_date, p.issue_date), job_value: p.job_value ?? null,
    building_area_sqft: p.property_building_area ?? null, latitude: p.latitude ?? null, longitude: p.longitude ?? null,
  };
}

export interface VelRow { lag_days: number | null; issue_date: string | null; permit_type: string | null }
export interface VelResult { median_lag_days: number; recent_median_lag_days: number; n: number }

export function velocity(rows: VelRow[], opts: { MIN_N?: number; HALF_LIFE_DAYS?: number; ASOF?: string } = {}): VelResult | null {
  const MIN_N = opts.MIN_N ?? 25;
  const HALF_LIFE_DAYS = opts.HALF_LIFE_DAYS ?? 730;
  const asOf = Date.parse(opts.ASOF ?? "2026-06-30");
  const usable = rows.filter((r) => {
    if (r.lag_days == null || r.issue_date == null) return false;
    const isElectricalSignoff = /electric/i.test(r.permit_type ?? "") && r.lag_days < 4;
    return !isElectricalSignoff && r.lag_days >= 0;
  });
  if (usable.length < MIN_N) return null;
  const plain = median(usable.map((r) => r.lag_days!));
  const weighted = usable.map((r) => ({ lag: r.lag_days!, w: Math.pow(0.5, (asOf - Date.parse(r.issue_date!)) / (HALF_LIFE_DAYS * 86_400_000)) }));
  return { median_lag_days: plain, recent_median_lag_days: weightedMedian(weighted), n: usable.length };
}

export function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function weightedMedian(xs: { lag: number; w: number }[]): number { const s = [...xs].sort((a, b) => a.lag - b.lag); const half = s.reduce((t, x) => t + x.w, 0) / 2; let acc = 0; for (const x of s) { acc += x.w; if (acc >= half) return x.lag; } return s[s.length - 1].lag; }
