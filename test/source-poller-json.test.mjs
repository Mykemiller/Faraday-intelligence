// Tests for the Wave-2 JSON-API adapters (poller-json.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonFetchUrl, parseJsonSource } from "../supabase/functions/source-poller/poller-json.ts";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");

test("jsonFetchUrl windows NVD to trailing 7 days and caps page size", () => {
  const u = jsonFetchUrl("feed:nvd", "https://services.nvd.nist.gov/rest/json/cves/2.0", NOW);
  assert.ok(u.includes("pubStartDate=2026-07-10T12%3A00%3A00.000Z"));
  assert.ok(u.includes("pubEndDate=2026-07-17T12%3A00%3A00.000Z"));
  assert.ok(u.includes("resultsPerPage=100"));
});

test("jsonFetchUrl scopes NWS to current actual alerts; passthrough otherwise", () => {
  assert.ok(jsonFetchUrl("feed:nws-alerts", "https://api.weather.gov/alerts", NOW).includes("status=actual"));
  assert.equal(jsonFetchUrl("feed:other", "https://x.com/f.json", NOW), "https://x.com/f.json");
});

test("KEV adapter sorts newest-first and builds NVD detail links", () => {
  const body = JSON.stringify({
    vulnerabilities: [
      { cveID: "CVE-2021-0001", vulnerabilityName: "Old Bug", vendorProject: "V", product: "P", dateAdded: "2021-11-03", shortDescription: "old", requiredAction: "patch" },
      { cveID: "CVE-2026-9999", vulnerabilityName: "New Bug", vendorProject: "V", product: "P", dateAdded: "2026-07-15", shortDescription: "new" },
    ],
  });
  const items = parseJsonSource("feed:cisa-kev-catalog", body);
  assert.equal(items.length, 2);
  assert.ok(items[0].title.startsWith("CVE-2026-9999"));
  assert.equal(items[0].link, "https://nvd.nist.gov/vuln/detail/CVE-2026-9999");
  assert.ok(items[1].summary.includes("Required action: patch"));
});

test("NVD adapter extracts id, english description, published", () => {
  const body = JSON.stringify({
    vulnerabilities: [
      { cve: { id: "CVE-2026-1234", published: "2026-07-16T01:00:00.000", descriptions: [{ lang: "es", value: "no" }, { lang: "en", value: "buffer overflow" }] } },
      { cve: { descriptions: [] } },
    ],
  });
  const items = parseJsonSource("feed:nvd", body);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "CVE-2026-1234");
  assert.equal(items[0].summary, "buffer overflow");
});

test("GCP incidents adapter joins uri onto the status host", () => {
  const body = JSON.stringify([
    { id: "abc", external_desc: "Elevated latency in us-east1", uri: "incidents/abc", begin: "2026-07-16T09:00:00Z", status_impact: "SERVICE_DISRUPTION", most_recent_update: { text: "Mitigated." } },
  ]);
  const items = parseJsonSource("feed:google-cloud-status", body);
  assert.equal(items[0].link, "https://status.cloud.google.com/incidents/abc");
  assert.ok(items[0].summary.includes("Mitigated."));
});

test("NWS adapter reads GeoJSON features", () => {
  const body = JSON.stringify({
    features: [
      { id: "https://api.weather.gov/alerts/urn:x:1", properties: { headline: "Heat Advisory issued", event: "Heat Advisory", areaDesc: "Travis, TX", sent: "2026-07-17T10:00:00Z", severity: "Moderate", description: "Hot." } },
    ],
  });
  const items = parseJsonSource("feed:nws-alerts", body);
  assert.equal(items[0].title, "Heat Advisory issued");
  assert.equal(items[0].link, "https://api.weather.gov/alerts/urn:x:1");
  assert.equal(items[0].summary, "Moderate: Hot.");
});

test("shape-detected fallbacks: JSON Feed spec and statuspage summary; else null", () => {
  const jf = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ title: "T", url: "https://e/1", date_published: "2026-07-01T00:00:00Z", content_text: "body" }] });
  assert.equal(parseJsonSource("feed:unknown", jf)[0].link, "https://e/1");
  const sp = JSON.stringify({ page: { url: "https://status.x.com" }, incidents: [{ name: "Outage", created_at: "2026-07-17T08:00:00Z", shortlink: "https://stspg.io/z", status: "resolved", incident_updates: [{ body: "Fixed" }] }] });
  const spItems = parseJsonSource("feed:unknown", sp);
  assert.equal(spItems[0].title, "Outage");
  assert.equal(spItems[0].summary, "resolved: Fixed");
  assert.equal(parseJsonSource("feed:unknown", '{"random":true}'), null);
  assert.equal(parseJsonSource("feed:unknown", "{broken"), null);
});
