// FDY-97: scripts/edge-drift-check.mjs — fixture tests, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compareBundles,
  compareVersions,
  exitCodeFor,
  extractMarker,
  normalise,
  normalisePath,
} from "../scripts/lib/edge-drift.mjs";

const CLI = fileURLToPath(new URL("../scripts/edge-drift-check.mjs", import.meta.url));
const HEX = "ab".repeat(32); // a fake 64-hex constant, not a real secret

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "edge-drift-"));
  for (const [p, c] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, c);
  }
  return dir;
}

function run(deployed, repo, ...flags) {
  const r = spawnSync(process.execPath, [CLI, "demo-fn", "--deployed-dir", fixture(deployed), "--repo-dir", fixture(repo), ...flags], {
    encoding: "utf8",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: "" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const idx = (v, extra = "") => `const CRAWLER_ID = "demo-fn_v${v}";\nconst FALLBACK = "${HEX}";\n${extra}export {};\n`;

test("identical bundles exit 0", () => {
  const r = run({ "index.ts": idx("1.8") }, { "index.ts": idx("1.8") });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /IDENTICAL/);
});

test("CRLF, a BOM and a hand-redacted 64-hex constant still compare identical", () => {
  const deployed = "﻿" + idx("1.8").replace(HEX, "<REDACTED>").replace(/\n/g, "\r\n");
  const r = run({ "index.ts": deployed }, { "index.ts": idx("1.8") });
  assert.equal(r.code, 0, r.out);
});

test("content drift with equal markers exits 1 and shows the hunk", () => {
  const r = run({ "index.ts": idx("1.8", "const prodOnly = 1;\n") }, { "index.ts": idx("1.8") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /- const prodOnly = 1;/);
});

test("deployed marker above repo marker exits 1 even with --allow-repo-ahead (rollback)", () => {
  const r = run({ "index.ts": idx("1.8") }, { "index.ts": idx("1.3") }, "--allow-repo-ahead");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /roll production back/);
});

test("repo marker ahead: exit 1 by default, 0 only with --allow-repo-ahead", () => {
  const deployed = { "index.ts": idx("1.8") };
  const repo = { "index.ts": idx("1.9", "const fair = true;\n"), "poller-schedule.ts": "export {};\n" };
  assert.equal(run(deployed, repo).code, 1);
  assert.equal(run(deployed, repo, "--allow-repo-ahead").code, 0);
});

test("a deployed-only FILE blocks even a repo-ahead marker", () => {
  const r = run({ "index.ts": idx("1.8"), "promote-pure.ts": "export {};\n" }, { "index.ts": idx("1.9") }, "--allow-repo-ahead");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /DEPLOYED-ONLY file: promote-pure\.ts/);
});

test("output never contains a 64-hex constant", () => {
  const r = run({ "index.ts": idx("1.8", "const x = 2;\n") }, { "index.ts": idx("1.8") });
  assert.ok(!/[0-9a-f]{64}/i.test(r.out), "a secret-shaped constant leaked into the diff output");
});

test("no token and no --deployed-dir is a usage error (exit 2), and names the variable only", () => {
  const r = spawnSync(process.execPath, [CLI, "demo-fn"], { encoding: "utf8", env: { ...process.env, SUPABASE_ACCESS_TOKEN: "" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /SUPABASE_ACCESS_TOKEN is not set/);
});

test("the decoy project is refused", () => {
  const r = spawnSync(process.execPath, [CLI, "demo-fn", "--project", "xgbpmlkanxewtfizloay"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /decoy/);
});

// ---- pure helpers ---------------------------------------------------------

test("extractMarker recognises the house shapes", () => {
  assert.deepEqual(extractMarker('const CRAWLER_ID = "source-poller_v1.8";').version, [1, 8]);
  assert.deepEqual(extractMarker('const AUTO_ID = "AUTO-030_v2.5";').version, [2, 5]);
  assert.deepEqual(extractMarker('const FN_VERSION = "v0.4";').version, [0, 4]);
  assert.equal(extractMarker('const AUTO_ID = "AUTO-199";'), null);
  // first versioned const wins, a plain AUTO id before it is skipped
  assert.equal(extractMarker('const AUTO_ID = "AUTO-199";\nconst CRAWLER_ID = "x_v1.9";').raw, "x_v1.9");
});

test("compareVersions is numeric, not lexical", () => {
  assert.equal(compareVersions([1, 10], [1, 9]), 1);
  assert.equal(compareVersions([1, 9], [1, 9, 0]), 0);
  assert.equal(compareVersions([0, 4], [0, 5]), -1);
});

test("normalisePath strips the bundle prefixes the API reports", () => {
  assert.equal(normalisePath("file:///tmp/user_fn_x_30/source/index.ts", "s"), "index.ts");
  assert.equal(normalisePath("supabase/functions/s/lib/a.ts", "s"), "lib/a.ts");
  assert.equal(normalisePath("./index.ts", "s"), "index.ts");
});

test("exitCodeFor: unknown markers never allow a drifting deploy", () => {
  const res = compareBundles({ "index.ts": "a" }, { "index.ts": "b" }, { slug: "s" });
  assert.equal(res.markerVerdict, "unknown");
  assert.equal(exitCodeFor(res, { allowRepoAhead: true }), 1);
  assert.equal(normalise(`"${HEX}"`), '"<REDACTED>"');
});
