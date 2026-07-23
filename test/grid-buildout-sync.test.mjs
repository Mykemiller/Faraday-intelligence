// Tests for the grid-buildout-sync pure logic (adapters-pure.ts) — FAR-379.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDateType,
  classifyDriver,
  detectLargeLoadDc,
  extractCountyRaw,
  extractSubstationNames,
  extractVoltageKv,
  normalizeErcotTpit,
  projectFingerprint,
  toIsoDate,
} from "../supabase/functions/grid-buildout-sync/adapters-pure.ts";

test("toIsoDate parses the formats ERCOT/PUC sources emit", () => {
  assert.equal(toIsoDate("12/4/2013"), "2013-12-04");
  assert.equal(toIsoDate("2024-05-02"), "2024-05-02");
  assert.equal(toIsoDate("Dec 4, 2013"), "2013-12-04");
  assert.equal(toIsoDate("May 2024"), "2024-05-01");
  assert.equal(toIsoDate("2027"), "2027-01-01");
  assert.equal(toIsoDate("n/a"), null);
});

test("extractVoltageKv pulls the kV rating", () => {
  assert.equal(extractVoltageKv("Cottonwood to Edith Clarke 345-kV line"), 345);
  assert.equal(extractVoltageKv("new 138 kV substation"), 138);
  assert.equal(extractVoltageKv("no rating here"), null);
});

test("extractCountyRaw pulls the county name", () => {
  assert.equal(extractCountyRaw("Rebuild in Dickens County, TX"), "Dickens");
  assert.equal(extractCountyRaw("A line in Deaf Smith County"), "Deaf Smith");
  assert.equal(extractCountyRaw("no county"), null);
});

test("extractSubstationNames captures endpoints and station names", () => {
  assert.deepEqual(
    extractSubstationNames("Rebuild the Cottonwood to Edith Clarke 345-kV line").sort(),
    ["Cottonwood", "Edith Clarke"],
  );
  assert.ok(extractSubstationNames("new San Miguel Switching Station").includes("San Miguel"));
  assert.ok(extractSubstationNames("Bakersfield Switch upgrade").includes("Bakersfield"));
});

test("classifyDateType: section is authoritative, status overrides", () => {
  assert.equal(classifyDateType("completed", "Energized"), "actual");
  assert.equal(classifyDateType("future", "Planned"), "projected");
  assert.equal(classifyDateType("future", "In Service"), "actual");   // status override
  assert.equal(classifyDateType("rtp", null), "projected");
  assert.equal(classifyDateType("cancelled", "Cancelled"), "unknown");
});

test("classifyDriver + detectLargeLoadDc read the description", () => {
  assert.equal(classifyDriver("serve a new data center large load"), "load_growth");
  assert.equal(classifyDriver("generation interconnection for a solar POI"), "generation_interconnection");
  assert.equal(classifyDriver("reliability contingency overload"), "reliability");
  assert.equal(detectLargeLoadDc("hyperscale data center"), true);
  assert.equal(detectLargeLoadDc("routine rebuild"), false);
});

test("normalizeErcotTpit (completed) → actual date grades; SRC tier", () => {
  const out = normalizeErcotTpit({
    "RTP Project Number": "13ETT0042",
    "Project Name": "Cottonwood Switching Station (CREZ)",
    "Project Description": "Energize the Edith Clarke to Cottonwood 345-kV line into the new Cottonwood Switching Station in Dickens County",
    "Project Status": "Energized",
    "Projected In-Service Date": "12/4/2013",
    "Estimated Cost": "$120,000,000",
  }, "completed");
  assert.ok(out);
  assert.equal(out.project.date_type, "actual");
  assert.equal(out.project.actual_inservice_date, "2013-12-04");
  assert.equal(out.project.planned_inservice_date, null);
  assert.equal(out.project.confidence_tier, "SRC");
  assert.equal(out.project.voltage_kv, 345);
  assert.equal(out.project.county_raw, "Dickens");
  assert.ok(out.project.substation_names.includes("Cottonwood"));
  // every mention carries the actual date + SRC-ish extraction confidence
  const m = out.mentions.find((x) => x.extracted_name_frag === "Cottonwood");
  assert.ok(m);
  assert.equal(m.extracted_date_type, "actual");
  assert.equal(m.extracted_inservice_date, "2013-12-04");
  assert.ok(m.extraction_confidence >= 0.8);
});

test("normalizeErcotTpit (future) → projected date never grades; EST tier", () => {
  const out = normalizeErcotTpit({
    "RTP Project Number": "24RTP0777",
    "Project Name": "Bakersfield Switch addition",
    "Project Description": "New 345-kV terminal at Bakersfield Switch in Pecos County",
    "Project Status": "Planned",
    "Projected In-Service Date": "6/1/2027",
  }, "future");
  assert.ok(out);
  assert.equal(out.project.date_type, "projected");
  assert.equal(out.project.planned_inservice_date, "2027-06-01");
  assert.equal(out.project.actual_inservice_date, null);
  assert.equal(out.project.confidence_tier, "EST");
  assert.equal(out.mentions[0].extraction_confidence, 0.30);
});

test("normalizeErcotTpit needs a ref or name", () => {
  assert.equal(normalizeErcotTpit({ "Project Description": "x" }, "future"), null);
});

test("projectFingerprint is stable and change-sensitive", () => {
  const row = {
    "RTP Project Number": "X1", "Project Name": "N",
    "Project Description": "A to B 138-kV", "Project Status": "Planned",
    "Projected In-Service Date": "1/1/2027",
  };
  const a = projectFingerprint(normalizeErcotTpit(row, "future").project);
  const b = projectFingerprint(normalizeErcotTpit({ ...row }, "future").project);
  const c = projectFingerprint(normalizeErcotTpit({ ...row, "Estimated Cost": "$5" }, "future").project);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
