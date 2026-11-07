// FDY-97: migration-ledger integrity (ported in spirit from Boundstone's
// test/ledger-integrity.test.mjs; see scripts/lib/ledger.mjs for why it matches
// by NAME and carries a shrink-only baseline).
//
// The live assertion reads the committed snapshot supabase/ledger-snapshot.json.
// .github/workflows/ledger-drift.yml refreshes it daily from production (opt-in,
// read-only role) and then runs this file, so an apply_migration that leaves no
// file behind turns the workflow red the next morning.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { checkLedger, migrationNameFromFile } from "../scripts/lib/ledger.mjs";

const snapshot = JSON.parse(readFileSync(new URL("../supabase/ledger-snapshot.json", import.meta.url), "utf8"));
const baseline = JSON.parse(readFileSync(new URL("../supabase/ledger-baseline.json", import.meta.url), "utf8"));
const repoFiles = readdirSync(new URL("../supabase/migrations/", import.meta.url));

test("every applied migration name is filed in the repo or grandfathered in the baseline", () => {
  const r = checkLedger(snapshot, repoFiles, baseline);
  assert.deepEqual(
    r.newUnfiled,
    [],
    `applied to production with no file in supabase/migrations/ — commit the SQL (any version prefix; matched by name): ${r.newUnfiled.join(", ")}`,
  );
});

test("the baseline only shrinks: a grandfathered name that is now filed must be removed from it", () => {
  const r = checkLedger(snapshot, repoFiles, baseline);
  assert.deepEqual(r.staleBaseline, [], `remove from supabase/ledger-baseline.json: ${r.staleBaseline.join(", ")}`);
});

test("the snapshot carries names and versions only — never SQL bodies", () => {
  for (const row of snapshot.applied) {
    assert.deepEqual(Object.keys(row).sort(), ["name", "version"]);
    assert.match(row.version, /^\d{14}$/);
  }
  assert.ok(snapshot.applied.length > 0);
  assert.equal(snapshot.project, "ycadmmngkdhvpcsrcuaq");
});

// ---- the checker itself, on fixtures ------------------------------------

const FIX_SNAPSHOT = {
  applied: [
    { version: "20261001000000", name: "alpha" },
    { version: "20261012123456", name: "beta" }, // MCP-stamped version, filed under another
    { version: "20261013000000", name: "gamma" },
  ],
};
const FIX_FILES = ["20261001000000_alpha.sql", "20261009210000_beta.sql", "README.md"];

test("fixture: matching is by name, so a re-stamped version still counts as filed", () => {
  const r = checkLedger(FIX_SNAPSHOT, FIX_FILES, { unfiled: ["gamma"] });
  assert.deepEqual(r.newUnfiled, []);
  assert.deepEqual(r.staleBaseline, []);
  assert.equal(r.unfiledCount, 1);
});

test("fixture: an injected NEW unfiled name fails", () => {
  const snap = { applied: [...FIX_SNAPSHOT.applied, { version: "20261106022911", name: "fdy227_new_thing" }] };
  const r = checkLedger(snap, FIX_FILES, { unfiled: ["gamma"] });
  assert.deepEqual(r.newUnfiled, ["fdy227_new_thing"]);
});

test("fixture: a baseline entry that became filed is reported stale", () => {
  const r = checkLedger(FIX_SNAPSHOT, [...FIX_FILES, "20261107000000_gamma.sql"], { unfiled: ["gamma"] });
  assert.deepEqual(r.newUnfiled, []);
  assert.deepEqual(r.staleBaseline, ["gamma"]);
});

test("fixture: filed-but-unapplied is informational, not a failure", () => {
  const r = checkLedger(FIX_SNAPSHOT, [...FIX_FILES, "20261010110000_not_yet.sql"], { unfiled: ["gamma"] });
  assert.deepEqual(r.filedNotApplied, ["not_yet"]);
  assert.deepEqual(r.newUnfiled, []);
});

test("migrationNameFromFile strips any numeric prefix", () => {
  assert.equal(migrationNameFromFile("0034_cc_state_incentive_source_registry.sql"), "cc_state_incentive_source_registry");
  assert.equal(migrationNameFromFile("20261009210000_poller_fair_scheduling.sql"), "poller_fair_scheduling");
});
