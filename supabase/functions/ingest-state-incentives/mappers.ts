// Pure row-mappers + source registry for ingest-state-incentives (v1.1).
// No Deno/network imports — unit-testable with the repo's node runner
// (test/incentive-mappers.test.ts). The engine (index.ts) owns fetching,
// hashing, upserts, and telemetry.

export type CommonRecord = {
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

export function normalizeType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/(tax increment|reinvestment zone|\btif\b)/.test(s)) return "tif";
  if (/abat/.test(s)) return "abatement";
  if (/exempt/.test(s)) return "exemption";
  if (/(payment.?in.?lieu|pilot)/.test(s)) return "pilot";
  if (/credit/.test(s)) return "credit";
  if (/grant/.test(s)) return "grant";
  if (/loan/.test(s)) return "loan";
  return "other";
}

export function toDate(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function yearsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start), b = Date.parse(end);
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round(((b - a) / (365.25 * 864e5)) * 10) / 10;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

// US m/d/Y (e.g. "08/15/2006") -> ISO "2006-08-15". Non-US strings fall through
// to toDate() semantics (ISO-prefix) so a single call is safe on mixed feeds.
export function toDateUS(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v.trim());
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return toDate(v);
}

// Esri/ArcGIS date fields arrive as epoch milliseconds (number). -> ISO date.
export function toDateEpochMs(v: unknown): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Money strings with a magnitude word, e.g. "$50.0 million" -> 50000000,
// "$1.2 billion" -> 1200000000, "$500,000" -> 500000. Returns null on no number.
export function parseUsdScaled(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const str = String(v).toLowerCase().replace(/[$,]/g, "").trim();
  const m = /(-?\d+(?:\.\d+)?)\s*(billion|million|thousand|b|m|k)?\b/.exec(str);
  if (!m) return null;
  let n = Number(m[1]);
  if (isNaN(n)) return null;
  switch (m[2]) {
    case "billion": case "b": n *= 1e9; break;
    case "million": case "m": n *= 1e6; break;
    case "thousand": case "k": n *= 1e3; break;
  }
  return Math.round(n); // scaled multiplies introduce float noise ($534.8M → 534799999.999…)
}

// "Albany County Industrial Development Agency" -> "Albany"; city IDAs -> null.
export function countyFromAuthority(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /^(.+?)\s+county\b/i.exec(name);
  return m ? m[1].trim() : null;
}

function year4(v: unknown): string | null {
  const m = /(\d{4})/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

type Row = Record<string, unknown>;
const s = (r: Row, k: string): string | null => {
  const v = r[k];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

export function mapNyDoei(row: Row): CommonRecord {
  const start = toDate(row.start_date), end = toDate(row.end_date);
  return {
    state_abbr: "NY", source_key: "ny_esd_dei",
    source_record_id: s(row, "project_id_number"),
    recipient_name: s(row, "recipient_name") ?? s(row, "original_recipient"),
    project_name: s(row, "name_of_project"),
    project_address: null, parcel_id: null, place_name: null,
    county_name: s(row, "county"),
    incentive_type: normalizeType(s(row, "assistance_type")),
    raw_incentive_type: s(row, "assistance_type"),
    program_name: s(row, "program_through_which_the_funding_was_awarded"),
    statute_citation: null,
    award_value_usd: num(row.total_lead_agency_benefits_awarded ?? row.assistance_amount),
    term_start: start, term_end: end, term_years: yearsBetween(start, end),
    source_url: "https://data.ny.gov/d/26ei-n4eb", raw: row,
  };
}

export function mapNyIda(row: Row): CommonRecord {
  const approved = toDate(row.date_project_approved);
  const endYear = year4(row.planned_end_year);
  const end = endYear ? `${endYear}-12-31` : null;
  const exemptions = num(row.total_exemptions) ?? num(row.net_exemptions);
  const pilotMade = num(row.total_pilot_made) ?? 0;
  return {
    state_abbr: "NY", source_key: "ny_ida_projects",
    source_record_id: [s(row, "project_code") ?? "", toDate(row.fiscal_year_end_date) ?? ""].join(":"),
    recipient_name: s(row, "applicant_name"),
    project_name: s(row, "project_name"),
    project_address: s(row, "project_address_line_1"),
    parcel_id: null,
    place_name: s(row, "project_city"),
    county_name: countyFromAuthority(s(row, "authority_name")),
    incentive_type: pilotMade > 0 ? "pilot" : "abatement",
    raw_incentive_type: s(row, "project_purpose") ?? "IDA exemptions/PILOT",
    program_name: s(row, "authority_name"),
    statute_citation: "NY General Municipal Law §859",
    award_value_usd: exemptions,
    term_start: approved, term_end: end, term_years: yearsBetween(approved, end),
    source_url: "https://data.ny.gov/d/9rtk-3fkw", raw: row,
  };
}

export function mapCtDecd(row: Row): CommonRecord {
  const exec = toDate(row.contract_execution_date);
  const grant = num(row.grant_amount) ?? 0, loan = num(row.loan_amount) ?? 0;
  const total = num(row.total_assistance);
  return {
    state_abbr: "CT", source_key: "ct_decd_business_assistance",
    source_record_id: [s(row, "company_name") ?? "", exec ?? "", s(row, "fiscal_year") ?? ""].join(":"),
    recipient_name: s(row, "company_name"),
    project_name: null,
    project_address: s(row, "company_address"), parcel_id: null,
    place_name: s(row, "municipality"),
    county_name: s(row, "county_1"),
    incentive_type: grant >= loan ? "grant" : "loan",
    raw_incentive_type: s(row, "funding_source"),
    program_name: s(row, "funding_source"),
    statute_citation: s(row, "statutory_reference"),
    award_value_usd: total ?? (grant + loan > 0 ? grant + loan : null),
    term_start: exec, term_end: null, term_years: null,
    source_url: "https://data.ct.gov/d/xnw3-nytd", raw: row,
  };
}

export function mapMdFinanceTracker(row: Row): CommonRecord {
  const program = [s(row, "program_name_level_one"), s(row, "program_name_level_two")]
    .filter(Boolean).join(" / ") || null;
  return {
    state_abbr: "MD", source_key: "md_commerce_finance_tracker",
    source_record_id: [s(row, "recipient") ?? "", s(row, "fiscal_year") ?? String(row.fiscal_year ?? ""),
                       program ?? ""].join(":"),
    recipient_name: s(row, "recipient"),
    project_name: null,
    project_address: s(row, "address"), parcel_id: null,
    place_name: s(row, "city"),
    county_name: s(row, "county"),
    incentive_type: normalizeType(s(row, "incentive_type")),
    raw_incentive_type: s(row, "incentive_type"),
    program_name: program,
    statute_citation: null,
    award_value_usd: num(row.approved_amount) ?? num(row.loan_guarantee_amount),
    term_start: null, term_end: null, term_years: null,
    source_url: "https://opendata.maryland.gov/d/cf3i-xdgb", raw: row,
  };
}

export function mapOrEnterpriseZone(sourceKey: string, datasetId: string) {
  return (row: Row): CommonRecord => {
    const began = year4(row.year_s_exemption_s_began);
    const years = num(row.exemption_period_years_2);
    const start = began ? `${began}-01-01` : null;
    const end = began && years ? `${Number(began) + Math.ceil(years)}-01-01` : null;
    return {
      state_abbr: "OR", source_key: sourceKey,
      source_record_id: [s(row, "name_of_qualified_business") ?? "",
                         s(row, "enterprise_zone_name") ?? "",
                         s(row, "property_tax_year") ?? ""].join(":"),
      recipient_name: s(row, "name_of_qualified_business"),
      project_name: null, project_address: null, parcel_id: null, place_name: null,
      county_name: s(row, "oregon_county"),
      incentive_type: "exemption",
      raw_incentive_type: "Enterprise Zone property tax exemption",
      program_name: s(row, "enterprise_zone_name"),
      statute_citation: "ORS 285C",
      award_value_usd: num(row.property_taxes_abated_6),
      term_start: start, term_end: end, term_years: years,
      source_url: `https://data.oregon.gov/d/${datasetId}`, raw: row,
    };
  };
}

export function mapOrEip(row: Row): CommonRecord {
  const cert = toDate(row.date_final_certificate);
  return {
    state_abbr: "OR", source_key: "or_energy_incentive_program",
    source_record_id: [s(row, "applicant_business_name") ?? "", cert ?? "",
                       s(row, "application") ?? ""].join(":"),
    recipient_name: s(row, "applicant_business_name"),
    project_name: s(row, "project_type"),
    project_address: s(row, "site_address"), parcel_id: null,
    place_name: s(row, "site_city"),
    county_name: s(row, "site_county"),
    incentive_type: "credit",
    raw_incentive_type: s(row, "program") ?? "Energy Incentive Program tax credit",
    program_name: s(row, "program"),
    statute_citation: null,
    award_value_usd: num(row.final_tax_credit_or_grant),
    term_start: cert, term_end: null, term_years: null,
    source_url: "https://data.oregon.gov/d/ria5-vqsx", raw: row,
  };
}

export function mapDeEeif(row: Row): CommonRecord {
  const dt = toDate(row.app_completed_to_fiscal_date);
  return {
    state_abbr: "DE", source_key: "de_eeif_grants",
    source_record_id: s(row, "control_number"),
    recipient_name: s(row, "name_of_grantee"),
    project_name: s(row, "project_description"),
    project_address: s(row, "street_address"), parcel_id: null,
    place_name: s(row, "city"),
    county_name: s(row, "county"),
    incentive_type: "grant",
    raw_incentive_type: "Energy Efficiency Investment Fund grant",
    program_name: "Energy Efficiency Investment Fund",
    statute_citation: null,
    award_value_usd: num(row.final_award_amount),
    term_start: dt, term_end: null, term_years: null,
    source_url: "https://data.delaware.gov/d/vukm-g6g5", raw: row,
  };
}

// ── Wave 1 (CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0) ────────────────────────
// New per-recipient primary-source feeds beyond the v1.1 Socrata set. Field
// names below are taken from LIVE responses probed 2026-07-26 (server-side
// pg_net), not guessed — see docs/ingest/CC-INGEST-STATE-INCENTIVE-ALL-WAVES-*.

// OK — Oklahoma Quality Jobs Program incentive payments (CKAN datastore,
// data.ok.gov resource d4845ba8…). Per-vendor cash rebate of new payroll.
// County is NOT carried (only city/zip) → county_name left null (honest); the
// row lands in the disclosure table but writes no INC-* attribute until a
// city/zip→county resolver exists. Documented as a coverage gap, not fabricated.
export function mapOkQualityJobs(row: Row): CommonRecord {
  const issue = toDateUS(row["Issue Date"]);
  return {
    state_abbr: "OK", source_key: "ok_quality_jobs",
    source_record_id: [s(row, "Vendor Name") ?? "", s(row, "Fiscal Year") ?? "",
                       s(row, "Issue Date") ?? "", s(row, "Payment Amount") ?? ""].join(":"),
    recipient_name: s(row, "Vendor Name"),
    project_name: null,
    project_address: s(row, "Street Address"), parcel_id: null,
    place_name: s(row, "Vendor Address City"),
    county_name: null,
    incentive_type: "rebate",
    raw_incentive_type: s(row, "Department Description") ?? s(row, "Account Description"),
    program_name: "Oklahoma Quality Jobs Program",
    statute_citation: "68 O.S. §3601 et seq.",
    award_value_usd: num(row["Payment Amount"]),
    term_start: issue, term_end: null, term_years: null,
    source_url: "https://data.ok.gov/dataset/oklahoma-quality-jobs-program", raw: row,
  };
}

// WI — WEDC "All Reportable Economic Development" (ARED) awards, ArcGIS hosted
// FeatureServer (services2.arcgis.com/xkpZtaTA2F05Vq7i). Carries county +
// municipality (resolves) and a numeric awardAmount.
export function mapWiWedcAred(row: Row): CommonRecord {
  const start = toDateEpochMs(row.awardDate);
  return {
    state_abbr: "WI", source_key: "wi_wedc_ared",
    source_record_id: s(row, "uid") ?? s(row, "id") ?? (row.ObjectId != null ? `oid:${row.ObjectId}` : null),
    recipient_name: s(row, "awardRecipient"),
    project_name: s(row, "projectName"),
    project_address: null, parcel_id: null,
    place_name: s(row, "municipality"),
    county_name: s(row, "county"),
    incentive_type: normalizeType(s(row, "awardType")),
    raw_incentive_type: s(row, "awardType"),
    program_name: s(row, "awardProgram"),
    statute_citation: null,
    award_value_usd: num(row.awardAmount),
    term_start: start,
    term_end: null,
    term_years: null,
    source_url: "https://www.wedc.org/about-wedc/transparency/", raw: row,
  };
}

// IA — Iowa Economic Development Authority award contracts, Iowa Data Hub JSON
// (idh-be.iowa.gov dataset 946). Carries county + city; award value = direct
// financial assistance + tax benefits (both are the state's incentive to the
// recipient; capital_investment is the recipient's own spend and is excluded).
export function mapIaIeda(row: Row): CommonRecord {
  const direct = num(row.direct_assistance_awarded) ?? 0;
  const taxben = num(row.tax_benefits_awarded) ?? 0;
  const total = direct + taxben;
  const start = toDate(row.award_date);
  const end = toDate(row.project_completion_date);
  const itype = direct > 0 && taxben > 0 ? "mixed"
    : direct > 0 ? "grant"
    : taxben > 0 ? "credit" : "other";
  return {
    state_abbr: "IA", source_key: "ia_ieda_awards",
    source_record_id: s(row, "primary_funding_agreement")
      ?? [s(row, "contract_name") ?? "", toDate(row.award_date) ?? ""].join(":"),
    recipient_name: s(row, "contract_name"),
    project_name: null,
    project_address: null, parcel_id: null,
    place_name: s(row, "city"),
    county_name: s(row, "county"),
    incentive_type: itype,
    raw_incentive_type: s(row, "program"),
    program_name: s(row, "program"),
    statute_citation: null,
    award_value_usd: total > 0 ? total : null,
    term_start: start, term_end: end, term_years: yearsBetween(start, end),
    source_url: "https://www.iowaeda.com/impact/", raw: row,
  };
}

// ── Wave 2 (CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0) ────────────────────────
// DC — Tax Increment Financing (TIF) areas, DC OCTO ArcGIS MapServer layer 26
// (maps2.dcgis.dc.gov DCGIS_DATA/Business_Incentives_WebMercator). Fields probed
// live 2026-07-26. The dollar figure is carried IN the layer
// (INITIAL_AUTHORIZATION, e.g. "$50.0 million") — no separate OCFO scrape needed,
// so this stays SRC (primary). DC is a single county-equivalent jurisdiction, so
// county_name is the constant "District of Columbia" (resolves).
export function mapDcTif(row: Row): CommonRecord {
  const authYear = year4(row.YEAR_AUTHORIZED);
  const matYear = year4(row.MATURITY_YEAR);
  const start = authYear ? `${authYear}-01-01` : null;
  const end = matYear ? `${matYear}-12-31` : null;
  const name = s(row, "NAME");
  return {
    state_abbr: "DC", source_key: "dc_tif_areas",
    source_record_id: s(row, "GLOBALID") ?? [name ?? "", authYear ?? ""].join(":"),
    recipient_name: name,
    project_name: name,
    project_address: null, parcel_id: null,
    place_name: s(row, "WARD") ? `Ward ${s(row, "WARD")}` : null,
    county_name: "District of Columbia",
    incentive_type: normalizeType(s(row, "TYPE")) ?? "tif",
    raw_incentive_type: s(row, "TYPE"),
    program_name: "DC Tax Increment Financing",
    statute_citation: s(row, "DC_CODE"),
    award_value_usd: parseUsdScaled(row.INITIAL_AUTHORIZATION),
    term_start: start, term_end: end, term_years: yearsBetween(start, end),
    source_url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Incentives_WebMercator/MapServer/26",
    raw: row,
  };
}

export type SourceKind = "socrata" | "ckan" | "arcgis" | "idh_json";

export type LiveSource = {
  state_abbr: string;
  source_key: string;
  kind: SourceKind;
  map: (row: Row) => CommonRecord;
  // socrata
  domain?: string;
  dataset_id?: string;
  order_field?: string;
  // ckan (datastore_search)
  ckan_domain?: string;
  resource_id?: string;
  // arcgis (FeatureServer layer query)
  arcgis_layer_url?: string;
  arcgis_order?: string;
  // idh_json (Iowa Data Hub rows.json)
  idh_domain?: string;
  idh_dataset?: string;
};

export const LIVE_SOURCES: LiveSource[] = [
  { state_abbr: "NY", source_key: "ny_esd_dei", kind: "socrata", domain: "data.ny.gov",
    dataset_id: "26ei-n4eb", order_field: "project_id_number", map: mapNyDoei },
  { state_abbr: "NY", source_key: "ny_ida_projects", kind: "socrata", domain: "data.ny.gov",
    dataset_id: "9rtk-3fkw", order_field: ":id", map: mapNyIda },
  { state_abbr: "CT", source_key: "ct_decd_business_assistance", kind: "socrata", domain: "data.ct.gov",
    dataset_id: "xnw3-nytd", order_field: ":id", map: mapCtDecd },
  { state_abbr: "MD", source_key: "md_commerce_finance_tracker", kind: "socrata", domain: "opendata.maryland.gov",
    dataset_id: "cf3i-xdgb", order_field: ":id", map: mapMdFinanceTracker },
  { state_abbr: "OR", source_key: "or_ez_parta_2025", kind: "socrata", domain: "data.oregon.gov",
    dataset_id: "9cc3-52ar", order_field: ":id", map: mapOrEnterpriseZone("or_ez_parta_2025", "9cc3-52ar") },
  { state_abbr: "OR", source_key: "or_ez_parta_2024", kind: "socrata", domain: "data.oregon.gov",
    dataset_id: "ecbu-9t3b", order_field: ":id", map: mapOrEnterpriseZone("or_ez_parta_2024", "ecbu-9t3b") },
  { state_abbr: "OR", source_key: "or_energy_incentive_program", kind: "socrata", domain: "data.oregon.gov",
    dataset_id: "ria5-vqsx", order_field: ":id", map: mapOrEip },
  { state_abbr: "DE", source_key: "de_eeif_grants", kind: "socrata", domain: "data.delaware.gov",
    dataset_id: "vukm-g6g5", order_field: ":id", map: mapDeEeif },

  // ── Wave 1 — API drop-in (verified live 2026-07-26) ──
  { state_abbr: "OK", source_key: "ok_quality_jobs", kind: "ckan",
    ckan_domain: "data.ok.gov", resource_id: "d4845ba8-1caa-43fb-821c-b902d3520b06",
    map: mapOkQualityJobs },
  { state_abbr: "WI", source_key: "wi_wedc_ared", kind: "arcgis",
    arcgis_layer_url: "https://services2.arcgis.com/xkpZtaTA2F05Vq7i/arcgis/rest/services/ImpactMap_featureSvc_Awards/FeatureServer/0",
    arcgis_order: "ObjectId", map: mapWiWedcAred },
  { state_abbr: "IA", source_key: "ia_ieda_awards", kind: "idh_json",
    idh_domain: "idh-be.iowa.gov", idh_dataset: "946", map: mapIaIeda },

  // ── Wave 2 — bulk/ArcGIS (verified live 2026-07-26) ──
  // DC TIF is an ArcGIS layer (no Excel needed); the other Wave-2 states are in
  // PENDING_SOURCES with documented fetch/URL blockers.
  { state_abbr: "DC", source_key: "dc_tif_areas", kind: "arcgis",
    arcgis_layer_url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Incentives_WebMercator/MapServer/26",
    arcgis_order: "OBJECTID", map: mapDcTif },
];

export type PendingSource = {
  state_abbr: string;
  source_key: string;
  source_url: string;
  note: string;
};

export const PENDING_SOURCES: PendingSource[] = [
  { state_abbr: "TX", source_key: "tx_comptroller_lda_tif", source_url: "https://comptroller.texas.gov/transparency/local/development-agreements/",
    note: "Ch.380/381 Local Development Agreement database (public search app). data.texas.gov EDC datasets rejected: corporation financials, not per-recipient awards." },
  { state_abbr: "WA", source_key: "wa_dor_incentive_disclosure", source_url: "https://dor.wa.gov/about/statistics-reports/tax-incentive-public-disclosure-reports",
    note: "DOR Tax Incentive Public Disclosure (annual). Confirmed ABSENT from data.wa.gov Socrata (probe 2026-07-08)." },
  { state_abbr: "IL", source_key: "il_dceo_edge", source_url: "https://dceo.illinois.gov/expandrelocate/incentives/edge.html",
    note: "EDGE agreements + Corporate Accountability reports. Confirmed ABSENT from data.illinois.gov (probe 2026-07-08)." },
  { state_abbr: "OH", source_key: "oh_development_tca", source_url: "https://development.ohio.gov/business/state-incentives",
    note: "Tax Credit Authority annual reports (PDF). data.ohio.gov is not CKAN at the standard API path (404, probe 2026-07-08)." },
  { state_abbr: "NJ", source_key: "nj_eda_transparency", source_url: "https://www.njeda.gov/public-information/",
    note: "NJEDA transparency/activity reports. Confirmed ABSENT from data.nj.gov (probe 2026-07-08)." },
  { state_abbr: "LA", source_key: "la_itep_fastlane", source_url: "https://fastlaneng.louisianaeconomicdevelopment.com/public/reports",
    note: "ITEP via LED FastLane public reports (export; scrape contract TBD)." },
  { state_abbr: "MO", source_key: "mo_ded_accountability", source_url: "https://ded.mo.gov/data-reports",
    note: "DED tax-credit accountability data. Confirmed ABSENT from data.mo.gov (probe 2026-07-08)." },
  { state_abbr: "PA", source_key: "pa_dced_investment_tracker", source_url: "https://dced.pa.gov/about-dced/investment-tracker/",
    note: "DCED Investment Tracker (web app). Confirmed ABSENT from data.pa.gov (probe 2026-07-08)." },
  { state_abbr: "CO", source_key: "co_oedit_incentives", source_url: "https://oedit.colorado.gov/reports",
    note: "OEDIT JGITC/Strategic Fund reports (PDF). Confirmed ABSENT from data.colorado.gov (probe 2026-07-08)." },
  { state_abbr: "MI", source_key: "mi_medc_msf", source_url: "https://www.michiganbusiness.org/reports-data/",
    note: "MEDC/MSF legislative reports (PDF/Excel)." },
  { state_abbr: "MN", source_key: "mn_deed_business_subsidy", source_url: "https://mn.gov/deed/",
    note: "DEED Business Subsidy / MBAF annual Excel. WAVE-2 BLOCKER (probe 2026-07-26): the DEED site is JS-rendered and every candidate report path soft-404s, so the direct .xlsx URL is not machine-discoverable. Needs the direct MBAF export link (browser/Myke) — the SheetJS bulk parser is proven working, this is a URL-discovery block, not a capability block." },
  { state_abbr: "TN", source_key: "tn_openecd_fasttrack", source_url: "https://www.tn.gov/ecd/resources/openecd/fasttrack-project-database.html",
    note: "OpenECD FastTrack contracted-projects .xlsx (OpenECD_Contracted_7-15-2026.xlsx, href confirmed live). WAVE-2 BLOCKER (probe 2026-07-26): the tn.gov /content/dam CDN resets the TLS connection from the Supabase edge runtime (os error 104 at Connect — IP/fingerprint block, unaffected by headers). Parser ready; needs a reachable mirror or fetch proxy." },
  { state_abbr: "TX", source_key: "tx_comptroller_ch313", source_url: "https://comptroller.texas.gov/economy/local/ch313/",
    note: "Ch.313 (expired 2022) / Ch.403 JETI agreements. WAVE-2 FINDING (probe 2026-07-26): the only .xlsx on the Ch.313 page is a generic Comptroller report INDEX (Table of Contents, not recipient data); recipient-level Ch.313 data is per-agreement (PDF/app). Reclassified to Wave-3/4 scrape — no clean bulk file exists." },
  { state_abbr: "FL", source_key: "fl_commerce_incentives", source_url: "https://floridajobs.org/business-growth-and-partnerships/for-businesses-and-entrepreneurs/business-resource/incentives-reporting",
    note: "FloridaCommerce incentive reporting portal (app)." },
  { state_abbr: "HI", source_key: "hi_film_tax_credit", source_url: "https://opendata.hawaii.gov/dataset/film-tax-credit",
    note: "CKAN datastore live (probe 2026-07-26) but LOW YIELD: anonymized (no recipient names), film-only (not site/DC-relevant), last modified 2020-10-19. Registered, not ingested — recipient-level capture would fabricate identities the source suppresses." },
  { state_abbr: "NV", source_key: "nv_goed_abatements", source_url: "https://goed.nv.gov/programs-incentives/",
    note: "GOED abatement dashboards (Tableau; no API). data.nv.gov not Socrata-indexed (probe 2026-07-08)." },
  { state_abbr: "KY", source_key: "ky_kedfa_approvals", source_url: "https://ced.ky.gov/Reports_Publications",
    note: "KEDFA monthly project approvals (PDF)." },
  { state_abbr: "IN", source_key: "in_iedc_transparency", source_url: "https://iedc.in.gov/program/transparency-portal",
    note: "IEDC transparency portal. hub.mph.in.gov not in Socrata discovery (probe 2026-07-08); portal API unconfirmed." },
  { state_abbr: "NC", source_key: "nc_jdig_onenc", source_url: "https://www.commerce.nc.gov/grants-incentives/competitive-incentives/reports",
    note: "JDIG/OneNC annual grant reports (PDF/Excel). linc.osbm.nc.gov not in Socrata discovery (probe 2026-07-08)." },
  { state_abbr: "SC", source_key: "sc_commerce_reports", source_url: "https://www.sccommerce.com/about-us/resources",
    note: "SC Commerce incentive reports (PDF)." },
  { state_abbr: "VA", source_key: "va_vedp_incentives", source_url: "https://www.vedp.org/reports",
    note: "VEDP incentive reports. Confirmed ABSENT from data.virginia.gov CKAN (probe 2026-07-08). Tier-B V2 per v1 scope." },
  { state_abbr: "GA", source_key: "ga_decd_reports", source_url: "https://www.georgia.org/about-us/publications-reports",
    note: "Tier-B V2 scraping per v1 scope. data.georgia.gov DNS dead (probe 2026-07-08)." },
  { state_abbr: "AZ", source_key: "az_aca_annual_report", source_url: "https://www.azcommerce.com/about-us/transparency/",
    note: "ACA annual report + transparency page. Tier-B V2 per v1 scope." },
];
