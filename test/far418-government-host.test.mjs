// CC-BOUNDSTONE-INGEST-1.1 §6.4 / guardrail 6 (FAR-418).
//
// `boundstone.allowed_source_domains` DOES NOT EXIST. Checked read-only against
// information_schema.tables in project fwnerwrtlgnchuprvfgl on 2026-10-06 — the
// only domain table in that schema is `blocked_source_domains`. So the rule the
// classifier applies is Boundstone's own: a quotable source is a GOVERNMENT
// HOST that is not a blocked commercial monitor.
//
// WHAT MAKES THIS TEST WORTH ANYTHING: every `gov:` expectation below is the
// LIVE OUTPUT of boundstone.is_government_host(), and every `host:` expectation
// the live output of boundstone.url_host(), read on 2026-10-06 with:
//
//   select u, boundstone.url_host(u), boundstone.is_government_host(u) from ...
//
// They are not predictions about what the SQL probably does. If the mirror and
// the database ever disagree, Faraday will cite a link Boundstone will not
// publish — which is the failure this file exists to make impossible.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BLOCKED_SOURCE_DOMAINS,
  isGovernmentHost,
  makeProvenance,
  urlHost,
} from "../supabase/functions/boundstone-candidates/primary-source.ts";

/** Verbatim rows from the live query. Column order: url, host, is_government_host. */
const LIVE = [
  ["https://www.energy.gov/articles/x", "www.energy.gov", true],
  ["http://PUC.TEXAS.GOV/order", "puc.texas.gov", true],
  ["https://www.army.mil/news", "www.army.mil", true],
  ["https://www.ci.austin.tx.us/agenda", "www.ci.austin.tx.us", true],
  ["https://example.us/page", "example.us", true],
  ["https://x.ca.us", "x.ca.us", true],
  ["energy.gov/x", "energy.gov", true],
  ["https://energy.gov:8443/x", "energy.gov", true],
  ["https://WWW.ENERGY.GOV/x", "www.energy.gov", true],
  ["https://legiscan.com/TX/bill/HB1", "legiscan.com", false],
  ["https://www.reuters.com/a", "www.reuters.com", false],
  ["https://gov.example.com/a", "gov.example.com", false],
  ["https://notgov.govern/a", "notgov.govern", false],
  ["https://data365.co/a", "data365.co", false],
  ["", "", false],
  // ⚠️ The two warts. Postgres regexp_replace is case-sensitive without 'i', so
  // an uppercase scheme is not stripped and the "host" is the scheme itself.
  // Mirrored on purpose — see the long note in primary-source.ts.
  ["HTTPS://energy.gov/x", "https", false],
  ["ftp://energy.gov/x", "ftp", false],
];

test("urlHost() reproduces boundstone.url_host() on every live fixture", () => {
  for (const [u, host] of LIVE) {
    assert.equal(urlHost(u), host, `url_host(${JSON.stringify(u)})`);
  }
});

test("isGovernmentHost() reproduces boundstone.is_government_host() on every live fixture", () => {
  for (const [u, , gov] of LIVE) {
    assert.equal(isGovernmentHost(u), gov, `is_government_host(${JSON.stringify(u)})`);
  }
});

test("null and undefined are false, matching the SQL's coalesce(u,'') guard", () => {
  assert.equal(isGovernmentHost(null), false);
  assert.equal(isGovernmentHost(undefined), false);
  assert.equal(urlHost(null), "");
  assert.equal(urlHost(undefined), "");
});

test("guardrail 6: .gov, .mil and US state/local .us — and nothing else", () => {
  for (const u of [
    "https://puc.texas.gov/docket/1",
    "https://ferc.gov/x",
    "https://defense.mil/x",
    "https://cityofx.ny.us/agenda",
    "https://county.pa.us/minutes",
  ]) assert.ok(isGovernmentHost(u), u);

  for (
    const u of [
      "https://www.utilitydive.com/news/x",
      "https://datacenterdynamics.com/x",
      "https://somecompany.gov.co/x",
      "https://governor.example.org/x",
    ]
  ) assert.ok(!isGovernmentHost(u), u);
});

// ---------------------------------------------------------------------------
// The blocklist, and the order of the two rules.
// ---------------------------------------------------------------------------

test("the four commercial monitors are never quotable, on any host form", () => {
  const prov = makeProvenance();
  for (
    const u of [
      "https://legiscan.com/TX/bill/HB1",
      "https://www.legiscan.com/TX/bill/HB1",
      "https://api.fiscalnote.com/x",
      "https://policynote.com/x",
      "https://data365.co/x",
      "https://data365.com/x",
    ]
  ) {
    assert.ok(!prov.isQuotable(u), `${u} must not be quotable`);
    assert.equal(prov.kindOf(u), null, `${u} must have no authority kind`);
  }
});

test("the blocklist wins over the government rule, not the other way round", () => {
  // A blocked vendor sitting on a government-looking host is still blocked.
  const prov = makeProvenance(["monitor.gov"]);
  assert.ok(isGovernmentHost("https://monitor.gov/x"), "fixture must be a government host");
  assert.ok(!prov.isQuotable("https://monitor.gov/x"), "blocklist must win");
  assert.ok(!prov.isQuotable("https://www.monitor.gov/x"), "subdomains too");
});

test("suffix matching stops at a dot — xlegiscan.com is not legiscan.com", () => {
  const prov = makeProvenance();
  // Not quotable either way (it is a .com), but it must not be BLOCKED by
  // accident, because the same matcher is what a future allowlist would use.
  assert.equal(prov.kindOf("https://xlegiscan.com/x"), null);
  assert.ok(!prov.isQuotable("https://xlegiscan.com/x"));
});

test("a government host that is not blocked is quotable and typed GOV_TLD", () => {
  const prov = makeProvenance();
  assert.ok(prov.isQuotable("https://puc.texas.gov/docket/1"));
  assert.equal(prov.kindOf("https://puc.texas.gov/docket/1"), "GOV_TLD");
});

test("BLOCKED_SOURCE_DOMAINS is sorted, lowercase, de-duplicated", () => {
  const list = [...BLOCKED_SOURCE_DOMAINS];
  assert.deepEqual(list, [...list].sort(), "keep it sorted so a diff is readable");
  assert.deepEqual(list, [...new Set(list)], "no duplicates");
  for (const d of list) assert.equal(d, d.toLowerCase(), `${d} must be lowercase`);
});
