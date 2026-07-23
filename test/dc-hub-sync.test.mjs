// Tests for the dc-hub-sync pure logic (sync-pure.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  facilityFingerprint,
  normalizeFacility,
  normalizeOperatorName,
  resolveStatus,
  toStringArray,
} from "../supabase/functions/dc-hub-sync/sync-pure.ts";

test("normalizeFacility maps a canonical DC Hub facility onto the row shape", () => {
  const row = normalizeFacility({
    id: "equinix-dc1-ashburn",
    name: "Equinix DC1",
    operator: "Equinix, Inc.",
    address: "21715 Filigree Ct",
    city: "Ashburn",
    state: "VA",
    country: "US",
    market: "Northern Virginia",
    latitude: 39.0,
    longitude: -77.4,
    total_power_mw: 120,
    used_power_mw: 90,
    cooling_type: "chilled water",
    fiber_carriers: ["Lumen", "Zayo"],
    commissioning_year: 2005,
    status: "Operational",
    dcpi_verdict: "BUILD",
    tenants: ["AWS"],
  });
  assert.ok(row);
  assert.equal(row.facility_id, "equinix-dc1-ashburn");
  assert.equal(row.operational_status, "operational");
  assert.equal(row.fiber_provider_count, 2); // derived from carriers when count absent
  assert.deepEqual(row.fiber_carriers, ["Lumen", "Zayo"]);
  assert.equal(row.commission_year, 2005);
  assert.equal(row.total_power_mw, 120);
});

test("normalizeFacility returns null without id or name (minimum viable row)", () => {
  assert.equal(normalizeFacility({ operator: "x" }), null);
  assert.equal(normalizeFacility({ id: "x" }), null);
  assert.equal(normalizeFacility({ name: "x" }), null);
});

test("normalizeFacility accepts alternate field spellings (defensive)", () => {
  const row = normalizeFacility({
    facility_id: "f-2",
    facility_name: "Site 2",
    provider: "Digital Realty",
    capacity_mw: "45",
    lat: "1.3",
    lng: "103.8",
    metro: "Singapore",
    lifecycle: "under construction",
  });
  assert.ok(row);
  assert.equal(row.name, "Site 2");
  assert.equal(row.operator, "Digital Realty");
  assert.equal(row.total_power_mw, 45); // string coerced
  assert.equal(row.market, "Singapore");
  assert.equal(row.operational_status, "under_construction");
});

test("resolveStatus maps known strings and falls back to unknown", () => {
  assert.equal(resolveStatus("Live"), "operational");
  assert.equal(resolveStatus("PLANNED"), "planned");
  assert.equal(resolveStatus("retired"), "decommissioned");
  assert.equal(resolveStatus("mystery"), "unknown");
  assert.equal(resolveStatus(undefined), "unknown");
});

test("toStringArray handles arrays, comma strings, and object lists", () => {
  assert.deepEqual(toStringArray(["A", " B "]), ["A", "B"]);
  assert.deepEqual(toStringArray("Lumen, Zayo; AT&T"), ["Lumen", "Zayo", "AT&T"]);
  assert.deepEqual(toStringArray([{ name: "AWS" }, { tenant: "Meta" }]), ["AWS", "Meta"]);
  assert.deepEqual(toStringArray(null), []);
});

test("normalizeOperatorName strips suffixes/punct for company matching", () => {
  assert.equal(normalizeOperatorName("Equinix, Inc."), "equinix");
  assert.equal(normalizeOperatorName("Digital Realty Trust, L.L.C."), "digital realty trust");
  assert.equal(normalizeOperatorName("NTT Global Data Centers Corporation"), "ntt global data centers");
  assert.equal(normalizeOperatorName("AT&T"), "at and t");
  assert.equal(normalizeOperatorName(null), "");
});

test("facilityFingerprint is stable on identical input and sensitive to change", () => {
  const base = {
    id: "f-1", name: "F1", operator: "Op", total_power_mw: 10, status: "operational",
  };
  const a = facilityFingerprint(normalizeFacility(base));
  const b = facilityFingerprint(normalizeFacility({ ...base }));
  const c = facilityFingerprint(normalizeFacility({ ...base, total_power_mw: 11 }));
  assert.equal(a, b);          // unchanged facility → unchanged fingerprint (skip re-sync)
  assert.notEqual(a, c);       // a changed MW → new fingerprint (re-sync)
});
