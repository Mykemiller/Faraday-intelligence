// CC-BOUNDSTONE-INGEST-1.1 §5 (FAR-418) — the tagging spine.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildBatchRequests,
  buildSystemPrompt,
  compareCodes,
  deriveTags,
  UNCLASSIFIED,
} from "../supabase/functions/enrich-artifacts/enrich-pure.ts";

// Real codes from public.faraday_subdomains, spanning 5 IDF domains — §11
// requires the fixture set to cross at least 3, so a fix validated on one lane
// cannot pass for validated.
const TAXONOMY = [
  { subdomain_code: "D1.1", domain_code: "D1", display_name: "GPU Architecture & Roadmap" },
  { subdomain_code: "D2.1", domain_code: "D2", display_name: "800V DC Power Distribution" },
  { subdomain_code: "D3.1", domain_code: "D3", display_name: "Interconnection Queue & Grid Access" },
  { subdomain_code: "D3.2", domain_code: "D3", display_name: "State Moratorium & Legislative Landscape" },
  { subdomain_code: "D3.3", domain_code: "D3", display_name: "Utility Rate Cases & PUC Proceedings" },
  { subdomain_code: "D13.1", domain_code: "D13", display_name: "Community Benefits & Host Agreements" },
  { subdomain_code: "D18.1", domain_code: "D18", display_name: "Project Opposition Register" },
];

test("§5.2 domains are DERIVED from subdomains, never taken from the model", () => {
  const t = deriveTags(["D3.2", "D3.1", "D18.1"], TAXONOMY);
  // Numeric order, the way a human reads it: D3 before D18. A default .sort()
  // would put D18.1 first and make every ordered comparison subtly wrong.
  assert.deepEqual(t.ifs_subdomains, ["D3.1", "D3.2", "D18.1"]);
  assert.deepEqual(t.ifs_domains, ["D3", "D18"]);
  assert.equal(t.unclassified, false);
});

test("§5.2 the two columns can never disagree — domains are exactly the parents", () => {
  for (const picks of [["D1.1"], ["D2.1", "D3.3"], ["D13.1", "D18.1", "D3.1"]]) {
    const t = deriveTags(picks, TAXONOMY);
    const parents = [...new Set(t.ifs_subdomains.map((c) => c.split(".")[0]))].sort(compareCodes);
    assert.deepEqual(t.ifs_domains, parents, picks.join(","));
    // And a D#.# never leaks into the domains column — the measured defect
    // (1,739 artifacts carry a subdomain string in ifs_domains).
    for (const d of t.ifs_domains) assert.match(d, /^D\d+$/);
    for (const s of t.ifs_subdomains) assert.match(s, /^D\d+\.\d+$/);
  }
});

test("§5.2 an invented code is dropped, not repaired", () => {
  const t = deriveTags(["D3.2", "D9.9", "D99.1", "banana"], TAXONOMY);
  assert.deepEqual(t.ifs_subdomains, ["D3.2"]);
  assert.deepEqual(t.ifs_domains, ["D3"]);
});

test("§5.2 nothing recognised becomes an explicit UNCLASSIFIED, never a silent empty", () => {
  for (const input of [[], null, undefined, ["D9.9"], ["UNCLASSIFIED"], "not an array", [42]]) {
    const t = deriveTags(input, TAXONOMY);
    assert.deepEqual(t.ifs_subdomains, [UNCLASSIFIED], JSON.stringify(input));
    assert.deepEqual(t.ifs_domains, []);
    assert.equal(t.unclassified, true);
  }
});

test("§5.2 the sentinel never coexists with a real code", () => {
  const t = deriveTags(["UNCLASSIFIED", "D3.2"], TAXONOMY);
  assert.deepEqual(t.ifs_subdomains, ["D3.2"]);
  assert.equal(t.unclassified, false);
});

test("§5.2 casing and padding are tolerated; identity is not", () => {
  assert.deepEqual(deriveTags([" d3.2 "], TAXONOMY).ifs_subdomains, ["D3.2"]);
  assert.deepEqual(deriveTags(["D3.2", "D3.2"], TAXONOMY).ifs_subdomains, ["D3.2"]);
});

test("§5.2 the source's domains are a labelled PRIOR, never an assertion", () => {
  const [req] = buildBatchRequests(
    [{
      artifact_id: "a1",
      raw_content: "The commission suspended large load interconnection.",
      source_type: "web_news",
      source_url: "https://example.com/x",
      source_prior_domains: ["D13"],
    }],
    TAXONOMY,
  );
  const user = req.params.messages[0].content;
  // The prior is present…
  assert.match(user, /D13/);
  // …and explicitly framed as a fact about the FEED that may be overruled.
  assert.match(user, /hint about the FEED/i);
  assert.match(user, /overrule it when the document says otherwise/i);
  // The old wording asserted it as this item's domain. It must be gone.
  assert.ok(!/^Domains: /m.test(user), "the bare 'Domains:' assertion is the inheritance defect");
});

test("§5.2 the prompt carries the live taxonomy and demands a classification", () => {
  const p = buildSystemPrompt(TAXONOMY);
  for (const t of TAXONOMY) assert.ok(p.includes(t.subdomain_code), t.subdomain_code);
  assert.match(p, /Judge the document, not its publisher/i);
  assert.match(p, /\["UNCLASSIFIED"\]/);
  assert.match(p, /do NOT return an empty array/i);
  // Sorted numerically, not lexically — D2.1 must precede D13.1.
  assert.ok(p.indexOf("D2.1") < p.indexOf("D13.1"), "taxonomy must sort numerically");
});

test("§11 fixture: an item's tags follow the DOCUMENT, across >=3 IDF domains", () => {
  // Appendix A.1 item 1 is the motivating case: a state executive directive
  // ingested through a local-community feed and filed as ["D13"]. The item's
  // own content must reach D3.2 regardless of what its feed is about.
  const fixtures = [
    { picks: ["D3.2"], feedPrior: ["D13"], expectDomains: ["D3"] },
    { picks: ["D3.1"], feedPrior: ["D22"], expectDomains: ["D3"] },
    { picks: ["D18.1"], feedPrior: ["D22"], expectDomains: ["D18"] },
    { picks: ["D13.1"], feedPrior: ["D3"], expectDomains: ["D13"] },
    { picks: ["D2.1"], feedPrior: ["D1"], expectDomains: ["D2"] },
  ];
  const domainsTouched = new Set();
  for (const f of fixtures) {
    const t = deriveTags(f.picks, TAXONOMY);
    assert.deepEqual(t.ifs_domains, f.expectDomains);
    // The feed's prior must not appear anywhere in the written result.
    for (const prior of f.feedPrior) {
      if (!f.expectDomains.includes(prior)) {
        assert.ok(!t.ifs_domains.includes(prior), `feed prior ${prior} leaked into the item's tags`);
      }
    }
    t.ifs_domains.forEach((d) => domainsTouched.add(d));
  }
  assert.ok(domainsTouched.size >= 3, `fixtures must span >=3 IDF domains, spanned ${domainsTouched.size}`);
});
