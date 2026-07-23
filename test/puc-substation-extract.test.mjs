// Tests for puc-substation-extract pure logic (puc-pure.ts) — FAR-379.
// Titles below are real PUCT docket_title strings from puc_dockets.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyPucDateType,
  docketToMentions,
  extractCcnEndpoints,
  screenDocket,
} from "../supabase/functions/puc-substation-extract/puc-pure.ts";

test("extractCcnEndpoints parses ALL-CAPS CCN transmission titles", () => {
  assert.deepEqual(
    extractCcnEndpoints("APPLICATION OF ONCOR ELECTRIC DELIVERY COMPANY LLC TO AMEND ITS CERTIFICATE OF CONVENIENCE AND NECESSITY FOR THE EL CAPITAN SWITCH-TO-DRY LAKE SWITCH 345-KV TRANSMISSION LINE").sort(),
    ["Dry Lake", "El Capitan"],
  );
  assert.deepEqual(
    extractCcnEndpoints("...FOR THE DINOSAUR SWITCH - LONGSHORE SWITCH 765 KV TRANSMISSION LINE").sort(),
    ["Dinosaur", "Longshore"],
  );
});

test("classifyPucDateType: applications are approved, energization is actual", () => {
  assert.equal(classifyPucDateType("APPLICATION ... CERTIFICATE OF CONVENIENCE ...", "transmission"), "approved");
  assert.equal(classifyPucDateType("FINAL ORDER energizing the X switch placed in service", "transmission"), "actual");
});

test("screenDocket flags a Texas CCN transmission docket as a candidate", () => {
  const c = screenDocket({
    docket_title: "APPLICATION OF BRAZOS ELECTRIC POWER COOPERATIVE, INC. TO AMEND ITS CERTIFICATE OF CONVENIENCE AND NECESSITY FOR THE PROPOSED KOSSE SWITCH TO KOSSE 138-KV TRANSMISSION LINE IN LIMESTONE COUNTY",
    docket_type: "transmission",
  });
  assert.equal(c.is_candidate, true);
  assert.equal(c.voltage_kv, 138);
  assert.equal(c.county_raw, "Limestone");
  assert.equal(c.date_type, "approved");        // application → never grades
  assert.ok(c.substation_names.includes("Kosse"));
  assert.equal(c.is_transmission_siting, true);
});

test("screenDocket excludes rate/procedural dockets (cost control)", () => {
  const c = screenDocket({
    docket_title: "TRANSMISSION AND DISTRIBUTION UTILITY MONTHLY RATE UPDATES REQUIRED UNDER PURA § 39.113",
    docket_type: "transmission",
  });
  assert.equal(c.is_candidate, false);
  assert.equal(c.reason, "excluded:rate/procedural");
});

test("docketToMentions carries the approved date_type as non-grading EST", () => {
  const c = screenDocket({
    docket_title: "APPLICATION ... FOR THE EL CAPITAN SWITCH-TO-DRY LAKE SWITCH 345-KV TRANSMISSION LINE IN CULBERSON COUNTY",
    docket_type: "transmission",
  });
  const ms = docketToMentions(c, "48109", "TX");
  assert.equal(ms.length, 2);
  for (const m of ms) {
    assert.equal(m.extracted_date_type, "approved");
    assert.equal(m.extracted_inservice_date, null);   // no actual date until PDF stage
    assert.equal(m.extraction_confidence, 0.30);
    assert.equal(m.county_fips_hint, "48109");
  }
});
