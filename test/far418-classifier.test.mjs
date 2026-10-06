// CC-BOUNDSTONE-INGEST-1.1 §6 (FAR-418) — Gate 0, Gate 1 validation, dedupe.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { gate0 } from "../supabase/functions/boundstone-candidates/gate0.ts";
import {
  candidateHashInput,
  normalizeForCompare,
  nullish,
  parseClassifierText,
  validateClassification,
} from "../supabase/functions/boundstone-candidates/classify-pure.ts";
import {
  extractAuthorityLinks,
  rankAuthorityLinks,
  retrievalPlan,
} from "../supabase/functions/boundstone-candidates/primary-source.ts";

// ---------------------------------------------------------------------------
// Gate 0
// ---------------------------------------------------------------------------

test("§6.2 Gate 0 needs a restriction verb AND a development object", () => {
  assert.equal(gate0("The commission suspended new large load interconnection requests.").pass, true);
  // Verb alone — the corpus is full of moratoria on everything else.
  assert.equal(gate0("The council approved a moratorium on short-term rentals.").pass, false);
  // Object alone — this is the growth-announcement firehose.
  assert.equal(gate0("A new hyperscale data center campus was announced.").pass, false);
});

test("§6.2 word boundaries: 'cap' in 'capacity', 'ban' in 'urban' must not fire", () => {
  const r = gate0("Urban capacity for the data center campus expanded.");
  assert.equal(r.pass, false, `fired on: ${r.verbs.join(",")}`);
});

test("§6.2 the vocabulary is instrument-generic and carries no proper noun", () => {
  // Each of these is a different jurisdiction and instrument class, same words.
  const docs = [
    "The county adopted an ordinance imposing a moratorium on data center development.",
    "The governor directed the agency to halt approvals of new hyperscale projects.",
    "The commission deferred all large load interconnection requests pending review.",
    "The market operator suspended the load interconnection queue under the revised protocol.",
    "The utility's new tariff restricts high-density load additions above 100 MW.",
  ];
  for (const d of docs) assert.equal(gate0(d).pass, true, d);
});

// ---------------------------------------------------------------------------
// Gate 1 validation — the zero-fabrication rules, enforced
// ---------------------------------------------------------------------------

const DOC =
  "ORDER NO. 2026-1147. The Commission hereby suspends acceptance of new large load " +
  "interconnection requests exceeding 75 MW, effective July 1, 2026, pending completion " +
  "of the large load study docket.";

const GOOD = {
  is_restriction: true,
  authority_level: "STATE_AGENCY",
  issuing_authority: "the Commission",
  instrument_type: "order",
  instrument_no: "2026-1147",
  state_abbr: "zz",
  jurisdiction_name: null,
  effective_date: "2026-07-01",
  effective_date_stated: true,
  extract: "suspends acceptance of new large load interconnection requests exceeding 75 MW",
  signal_score: 0.91,
  signal_reasons: ["restriction_verb:suspends", "object:large load"],
};

test("§6.3 a well-formed classification validates and normalizes", () => {
  const r = validateClassification(GOOD, DOC);
  assert.ok(r.ok, r.reason);
  assert.equal(r.value.state_abbr, "ZZ");
  assert.equal(r.value.effective_date, "2026-07-01");
  assert.equal(r.value.signal_score, 0.91);
});

test("§6.3 a PARAPHRASED extract is rejected — this is the rule that matters", () => {
  const r = validateClassification(
    { ...GOOD, extract: "The commission paused big power hookups for data centers." },
    DOC,
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /verbatim/);
});

test("§6.3 verbatim tolerates re-wrapped whitespace and nothing else", () => {
  const ok = validateClassification(
    { ...GOOD, extract: "suspends   acceptance of new large load\ninterconnection requests exceeding 75 MW" },
    DOC,
  );
  assert.ok(ok.ok, ok.reason);
  // One word changed is not a whitespace difference.
  const bad = validateClassification(
    { ...GOOD, extract: "suspends acceptance of all large load interconnection requests exceeding 75 MW" },
    DOC,
  );
  assert.equal(bad.ok, false);
  assert.equal(normalizeForCompare("  A   B \n C "), "a b c");
});

test("§6.3 an effective date is never kept unless the document stated one", () => {
  // The single most-cited failure mode: computing a date from a term length.
  const r = validateClassification({ ...GOOD, effective_date_stated: false, effective_date: "2026-07-01" }, DOC);
  assert.ok(r.ok, r.reason);
  assert.equal(r.value.effective_date, null, "an unstated date must not survive");
  // A non-ISO or unparseable date is dropped rather than coerced.
  const r2 = validateClassification({ ...GOOD, effective_date: "180 days from adoption" }, DOC);
  assert.ok(r2.ok);
  assert.equal(r2.value.effective_date, null);
});

test("§6.3 unknown fields become null, never a guess", () => {
  for (const v of ["", "  ", "unknown", "N/A", "n/a", "none", "not stated", "TBD", "--"]) {
    assert.equal(nullish(v), null, v);
  }
  assert.equal(nullish("Docket 2026-1147"), "Docket 2026-1147");
  const r = validateClassification({ ...GOOD, issuing_authority: "unknown", instrument_no: "" }, DOC);
  assert.ok(r.ok);
  assert.equal(r.value.issuing_authority, null);
  assert.equal(r.value.instrument_no, null);
});

test("§6.3 vocabulary is closed: an invented authority level or instrument is refused", () => {
  assert.equal(validateClassification({ ...GOOD, authority_level: "REGIONAL" }, DOC).ok, false);
  assert.equal(validateClassification({ ...GOOD, instrument_type: "vibe" }, DOC).ok, false);
  // A bad state abbreviation is dropped to null rather than failing the record.
  const r = validateClassification({ ...GOOD, state_abbr: "Texas" }, DOC);
  assert.ok(r.ok);
  assert.equal(r.value.state_abbr, null);
});

test("§6.3 is_restriction=false and out-of-range scores are handled", () => {
  assert.equal(validateClassification({ ...GOOD, is_restriction: false }, DOC).ok, false);
  assert.equal(validateClassification(null, DOC).ok, false);
  assert.equal(validateClassification({ ...GOOD, signal_score: 4 }, DOC).value.signal_score, 1);
  assert.equal(validateClassification({ ...GOOD, signal_score: "x" }, DOC).value.signal_score, 0);
});

test("§6.3 fenced JSON parses; genuinely broken JSON throws", () => {
  assert.deepEqual(parseClassifierText('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseClassifierText('Here you go: {"a":2} — done'), { a: 2 });
  assert.throws(() => parseClassifierText("not json at all"));
});

// ---------------------------------------------------------------------------
// §6.6 instrument classes and dedupe
// ---------------------------------------------------------------------------

test("§6.6 trade-press coverage dedupes INTO the instrument, never a second row", () => {
  const instrument = { instrument_no: "2026-1147", effective_date: "2026-07-01", state_abbr: "ZZ", authority_level: "STATE_AGENCY" };
  const viaCommission = candidateHashInput({ ...instrument, canonical_url: "https://commission.example.gov/orders/2026-1147" });
  const viaTradePress = candidateHashInput({ ...instrument, canonical_url: "https://www.tradepress.example.com/story/9" });
  const viaLocalPaper = candidateHashInput({ ...instrument, canonical_url: "https://www.localpaper.example.com/a/1" });
  assert.equal(viaCommission, viaTradePress);
  assert.equal(viaCommission, viaLocalPaper);
});

test("§6.6 two genuinely different instruments never collide", () => {
  const a = candidateHashInput({ canonical_url: "https://x.gov/a", instrument_no: "2026-1147", effective_date: "2026-07-01", state_abbr: "ZZ", authority_level: "STATE_AGENCY" });
  const b = candidateHashInput({ canonical_url: "https://x.gov/a", instrument_no: "2026-1148", effective_date: "2026-07-01", state_abbr: "ZZ", authority_level: "STATE_AGENCY" });
  // Same number, different state — different instruments.
  const c = candidateHashInput({ canonical_url: "https://y.gov/a", instrument_no: "2026-1147", effective_date: "2026-07-01", state_abbr: "YY", authority_level: "STATE_AGENCY" });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("§6.6 an unnumbered instrument falls back to the URL, and says so", () => {
  const a = candidateHashInput({ canonical_url: "https://x.gov/a", instrument_no: null, effective_date: null });
  const b = candidateHashInput({ canonical_url: "https://y.gov/b", instrument_no: null, effective_date: null });
  assert.ok(a.startsWith("url|"));
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// §6.4 Gate 2
// ---------------------------------------------------------------------------

test("§6.4 the retrieval plan is resolved from authority_level into registry keys", () => {
  const article = (p) => p[0].via === "article";
  const stateAgency = retrievalPlan("STATE_AGENCY", "ZZ", null);
  assert.ok(article(stateAgency), "the in-article link scan is always first");
  assert.deepEqual(stateAgency.map((s) => s.via), ["article", "puc:zz"]);

  assert.deepEqual(retrievalPlan("STATE", "ZZ", null).map((s) => s.via), ["article", "gov:zz", "legis:zz"]);
  assert.deepEqual(retrievalPlan("GRID_OPERATOR", "ZZ", "iso:market").map((s) => s.via), ["article", "iso:market-notices", "puc:zz"]);

  // A utility restriction is cited from the DOCKET, never the press release.
  const utility = retrievalPlan("UTILITY", "ZZ", null);
  assert.deepEqual(utility.map((s) => s.via), ["article", "puc:zz"]);
  assert.match(utility[1].why, /never the utility's press release/i);
});

test("§6.4 only quotable hosts are offered, and instrument-ish links rank first", () => {
  const html = `
    <a href="https://www.tradepress.example.com/more">More coverage</a>
    <a href="https://commission.example.gov/">Commission home</a>
    <a href="https://commission.example.gov/orders/2026-1147.pdf">Read the full order 2026-1147</a>`;
  const isQuotable = (u) => /\.gov(\/|$)/.test(new URL(u).hostname + "/") || new URL(u).hostname.endsWith(".gov");
  const links = extractAuthorityLinks(html, "https://www.tradepress.example.com/story/9", isQuotable);
  assert.equal(links.length, 2, "the trade-press link is not an authority link");
  const ranked = rankAuthorityLinks(links, "2026-1147");
  assert.match(ranked[0].url, /2026-1147\.pdf$/);
  assert.ok(ranked[0].score > ranked[1].score, "a bare origin must not outrank the instrument");
});
