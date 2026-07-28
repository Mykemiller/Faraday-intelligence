// Tests for ingest-state-incentives mappers.ts (pure row-mappers + registry).
// Sample rows are REAL first-page responses captured server-side (pg_net)
// 2026-07-26 from each source — so these assert the adapters against the
// live field shapes, not invented ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapOkQualityJobs,
  mapWiWedcAred,
  mapIaIeda,
  mapDcTif,
  toDateUS,
  toDateEpochMs,
  parseUsdScaled,
  normalizeType,
  LIVE_SOURCES,
  PENDING_SOURCES,
} from "../supabase/functions/ingest-state-incentives/mappers.ts";

test("toDateUS parses m/d/Y and falls through to ISO", () => {
  assert.equal(toDateUS("08/15/2006"), "2006-08-15");
  assert.equal(toDateUS("8/5/2021"), "2021-08-05");
  assert.equal(toDateUS("2021-05-21T00:00:00"), "2021-05-21");
  assert.equal(toDateUS(""), null);
  assert.equal(toDateUS(1234), null);
});

test("toDateEpochMs converts Esri epoch-ms to ISO date", () => {
  assert.equal(toDateEpochMs(1496102400000), "2017-05-30");
  assert.equal(toDateEpochMs(null), null);
  assert.equal(toDateEpochMs("1496102400000"), null); // strings rejected on purpose
});

test("OK Quality Jobs (CKAN) → CommonRecord", () => {
  const row = {
    _id: 1, "Fiscal Year": "2007", "Vendor Name": "A G EQUIPMENT CO",
    "Street Address": "3401 W ALBANY", "Vendor Address City": "BROKEN ARROW",
    "Vendor Address State": "OK", "Vendor Address Zip Code": "74012",
    "Issue Date": "08/15/2006", "Payment Amount": "$10649.55",
    "Department Description": "QUALITY JOBS INCENTIVE PAYMENT",
    "Business Unit": "OKLAHOMA TAX COMMISSION",
    "Account Description": "DISBURSEMENT OF INCENTIVE PAYMENTS TO QUALIFIED ESTABLISHMENTS",
  };
  const r = mapOkQualityJobs(row);
  assert.equal(r.state_abbr, "OK");
  assert.equal(r.source_key, "ok_quality_jobs");
  assert.equal(r.recipient_name, "A G EQUIPMENT CO");
  assert.equal(r.place_name, "BROKEN ARROW");
  assert.equal(r.project_address, "3401 W ALBANY");
  assert.equal(r.award_value_usd, 10649.55); // "$"/"," stripped
  assert.equal(r.term_start, "2006-08-15");
  assert.equal(r.incentive_type, "rebate");
  assert.equal(r.county_name, null); // honest: OK carries only city/zip
  assert.equal(r.program_name, "Oklahoma Quality Jobs Program");
  assert.equal(r.statute_citation, "68 O.S. §3601 et seq.");
  assert.equal(r.source_record_id, "A G EQUIPMENT CO:2007:08/15/2006:$10649.55");
});

test("WI WEDC ARED (ArcGIS) → CommonRecord", () => {
  const row = {
    id: "a3JVq000000jR7aMAE", lat: 43.45598, lng: -88.65888, uid: "FY17356",
    name: "ARED Item-673617", naics: "333112", agency: "DOT", county: "Dodge",
    zipcode: 53032, ObjectId: 1, industry: "Manufacturing", awardDate: 1496102400000,
    awardType: "Grant", awardYear: 2017, awardAmount: 400000, projectName: "Horicon",
    municipality: "Horicon", awardRecipient: "John Deere Horicon Works",
    awardProgram: "Transportation Facilities Economic Assistance and Development (TEA) Program",
  };
  const r = mapWiWedcAred(row);
  assert.equal(r.state_abbr, "WI");
  assert.equal(r.source_key, "wi_wedc_ared");
  assert.equal(r.recipient_name, "John Deere Horicon Works");
  assert.equal(r.county_name, "Dodge"); // resolves to jurisdictions
  assert.equal(r.place_name, "Horicon");
  assert.equal(r.award_value_usd, 400000);
  assert.equal(r.incentive_type, "grant");
  assert.equal(r.raw_incentive_type, "Grant");
  assert.equal(r.term_start, "2017-05-30");
  assert.equal(r.source_record_id, "FY17356");
  assert.equal(r.program_name.startsWith("Transportation Facilities"), true);
});

test("WI ARED falls back to ObjectId when uid/id missing", () => {
  const r = mapWiWedcAred({ ObjectId: 42, awardRecipient: "X", county: "Dane" });
  assert.equal(r.source_record_id, "oid:42");
  assert.equal(r.award_value_usd, null); // no awardAmount → null, not 0
});

test("IA IEDA (idh JSON) → CommonRecord, award = direct + tax benefits", () => {
  const row = {
    contract_name: "Alliance Outdoor Group, inc.", county: "Appanoose",
    city: "Centerville", status: "Under contract - In Performance",
    program: "High Quality Jobs Program", primary_funding_agreement: "21-HQJDF-005",
    award_date: "2021-05-21T00:00:00.000", total_project_cost: 1966290.0,
    capital_investment: 1966290.0, direct_assistance_awarded: 150000.0,
    tax_benefits_awarded: 147524.0, projected_jobs_created: 25,
  };
  const r = mapIaIeda(row);
  assert.equal(r.state_abbr, "IA");
  assert.equal(r.source_key, "ia_ieda_awards");
  assert.equal(r.recipient_name, "Alliance Outdoor Group, inc.");
  assert.equal(r.county_name, "Appanoose");
  assert.equal(r.place_name, "Centerville");
  assert.equal(r.award_value_usd, 297524); // 150000 + 147524; excludes capital_investment
  assert.equal(r.incentive_type, "mixed");
  assert.equal(r.term_start, "2021-05-21");
  assert.equal(r.source_record_id, "21-HQJDF-005");
  assert.equal(r.program_name, "High Quality Jobs Program");
});

test("IA incentive_type collapses to grant / credit / other by component", () => {
  assert.equal(mapIaIeda({ direct_assistance_awarded: 100 }).incentive_type, "grant");
  assert.equal(mapIaIeda({ tax_benefits_awarded: 100 }).incentive_type, "credit");
  assert.equal(mapIaIeda({ contract_name: "Z" }).incentive_type, "other");
  assert.equal(mapIaIeda({ contract_name: "Z" }).award_value_usd, null);
});

test("parseUsdScaled handles magnitude words and plain dollars", () => {
  assert.equal(parseUsdScaled("$50.0 million"), 50000000);
  assert.equal(parseUsdScaled("$1.2 billion"), 1200000000);
  assert.equal(parseUsdScaled("$534.8 million"), 534800000); // rounded, no float noise
  assert.equal(parseUsdScaled("$500,000"), 500000);
  assert.equal(parseUsdScaled("750 thousand"), 750000);
  assert.equal(parseUsdScaled(2500000), 2500000);
  assert.equal(parseUsdScaled(""), null);
  assert.equal(parseUsdScaled("n/a"), null);
});

test("DC TIF (ArcGIS layer 26) → CommonRecord", () => {
  const row = {
    NAME: "Verizon Center", TYPE: "TIF", WARD: "2",
    DC_CODE: "https://code.dccouncil.gov/us/dc/council/laws/17-12",
    OBJECTID: 655, MATURITY_YEAR: 2043, YEAR_AUTHORIZED: 2007,
    INITIAL_AUTHORIZATION: "$50.0 million",
    GLOBALID: "{8370B12D-8FBC-47E4-A12C-6BA8ABCA17B8}",
  };
  const r = mapDcTif(row);
  assert.equal(r.state_abbr, "DC");
  assert.equal(r.source_key, "dc_tif_areas");
  assert.equal(r.recipient_name, "Verizon Center");
  assert.equal(r.project_name, "Verizon Center");
  assert.equal(r.county_name, "District of Columbia"); // resolves to the DC county row
  assert.equal(r.place_name, "Ward 2");
  assert.equal(r.award_value_usd, 50000000);
  assert.equal(r.incentive_type, "tif");
  assert.equal(r.term_start, "2007-01-01");
  assert.equal(r.term_end, "2043-12-31");
  assert.equal(r.statute_citation, "https://code.dccouncil.gov/us/dc/council/laws/17-12");
  assert.equal(r.source_record_id, "{8370B12D-8FBC-47E4-A12C-6BA8ABCA17B8}");
});

test("LIVE_SOURCES: unique keys and kind-correct endpoint config", () => {
  const keys = LIVE_SOURCES.map((s) => s.source_key);
  assert.equal(new Set(keys).size, keys.length, "source_keys must be unique");
  for (const s of LIVE_SOURCES) {
    assert.ok(typeof s.map === "function", `${s.source_key} needs a mapper`);
    if (s.kind === "socrata") assert.ok(s.domain && s.dataset_id, `${s.source_key} socrata cfg`);
    if (s.kind === "ckan") assert.ok(s.ckan_domain && s.resource_id, `${s.source_key} ckan cfg`);
    if (s.kind === "arcgis") assert.ok(s.arcgis_layer_url, `${s.source_key} arcgis cfg`);
    if (s.kind === "idh_json") assert.ok(s.idh_domain && s.idh_dataset, `${s.source_key} idh cfg`);
  }
  for (const k of ["ok_quality_jobs", "wi_wedc_ared", "ia_ieda_awards", "dc_tif_areas"]) {
    assert.ok(keys.includes(k), `Wave-1/2 source ${k} present`);
  }
});

test("PENDING_SOURCES no longer double-lists states promoted to live", () => {
  const live = new Set(LIVE_SOURCES.map((s) => s.state_abbr));
  const pendingStates = PENDING_SOURCES.map((p) => p.state_abbr);
  for (const st of ["OK", "WI", "IA"]) {
    assert.ok(live.has(st), `${st} is live`);
    assert.ok(!pendingStates.includes(st), `${st} removed from PENDING`);
  }
});

test("normalizeType keeps the shared incentive vocabulary", () => {
  assert.equal(normalizeType("Grant"), "grant");
  assert.equal(normalizeType("Tax Increment Financing"), "tif");
  assert.equal(normalizeType(null), null);
});
