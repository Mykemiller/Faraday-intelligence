// CC-BOUNDSTONE-INGEST-1.1 §6.7 / [REC-8] / §11 (FAR-418).
//
// "No state name, market name, commission name, utility name or docket-number
//  format appears in any prompt, regex, threshold or scoring weight. A test
//  greps the classifier's prompt and rule files for a list of all 50 state
//  names and all 7 market names and fails on any hit."
//
// SCOPE, stated so it cannot drift: this greps the DECISION SURFACE — the
// prompts, the lexical vocabulary, the retrieval logic and the scoring. It
// deliberately does NOT grep the ROSTER or the allowlist seed, which are DATA
// and are required by §3.2/§7.3 to name all seven market operators explicitly.
// The rule is "the classifier must not have learned a geography", not "the word
// must never be written down".
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DECISION_SURFACE = [
  "supabase/functions/boundstone-candidates/gate0.ts",
  "supabase/functions/boundstone-candidates/classify-pure.ts",
  "supabase/functions/boundstone-candidates/primary-source.ts",
  "supabase/functions/boundstone-candidates/intake.ts",
];

const STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
  "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const MARKET_NAMES = [
  "CAISO", "ERCOT", "ISO-NE", "ISO New England", "MISO", "Midcontinent",
  "NYISO", "PJM", "SPP", "Southwest Power Pool", "Electric Reliability Council",
];

// Commission and utility naming that would betray a jurisdiction even without
// the state's name attached.
const AUTHORITY_NAMES = [
  "Public Utility Commission of", "Corporation Commission", "Board of Public Utilities",
  "State Corporation Commission", "Utilities and Transportation Commission",
];

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

test("§6.7 no state name appears on the decision surface", () => {
  for (const file of DECISION_SURFACE) {
    const src = read(file);
    for (const name of STATE_NAMES) {
      // Word-boundary, case-sensitive: "Indiana" must fire, "indianapolis" in a
      // URL must not, and neither should the "Georgia" inside a longer word.
      const re = new RegExp(`\\b${name}\\b`);
      assert.ok(!re.test(src), `${file} names the state "${name}"`);
    }
  }
});

test("§6.7 no market operator appears on the decision surface", () => {
  for (const file of DECISION_SURFACE) {
    const src = read(file);
    for (const name of MARKET_NAMES) {
      assert.ok(!new RegExp(`\\b${name}\\b`).test(src), `${file} names the market "${name}"`);
    }
  }
});

test("§6.7 no commission or utility proper noun appears on the decision surface", () => {
  for (const file of DECISION_SURFACE) {
    const src = read(file);
    for (const name of AUTHORITY_NAMES) {
      assert.ok(!src.includes(name), `${file} names the authority "${name}"`);
    }
  }
});

test("§6.7 no docket-number FORMAT is hardcoded", () => {
  // A regex like /^\d{5}-[A-Z]{2}$/ is a jurisdiction in disguise: it silently
  // rejects every state that numbers its dockets differently.
  for (const file of DECISION_SURFACE) {
    const src = read(file);
    const suspicious = src.match(/\/\^?[^/\n]*\\d\{\d+\}[^/\n]*\$?\/[gimsuy]*/g) ?? [];
    for (const s of suspicious) {
      // The only fixed numeric shape allowed anywhere here is an ISO date.
      assert.ok(
        /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(s),
        `${file} hardcodes a numeric format that looks like a docket pattern: ${s}`,
      );
    }
  }
});

test("§6.7 signal scoring carries no geographic term", () => {
  const src = read("supabase/functions/boundstone-candidates/classify-pure.ts");
  // Isolate anything that reads like a weight or threshold.
  const scoringLines = src.split("\n").filter((l) => /score|weight|threshold|\bboost\b/i.test(l));
  for (const line of scoringLines) {
    for (const name of [...STATE_NAMES, ...MARKET_NAMES]) {
      assert.ok(!new RegExp(`\\b${name}\\b`).test(line), `scoring line mentions ${name}: ${line.trim()}`);
    }
  }
});

test("§6.7 the guard works — it catches a planted violation", () => {
  const planted = 'const BOOST = { Texas: 0.2 };';
  assert.ok(new RegExp("\\bTexas\\b").test(planted), "the detector must catch a planted state name");
});
