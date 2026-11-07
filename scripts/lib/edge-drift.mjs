// edge-drift.mjs — pure comparison logic for scripts/edge-drift-check.mjs (FDY-97).
//
// No network and no filesystem access here: callers hand in {path -> content}
// maps, so the whole decision is fixture-testable. See test/edge-drift-check.test.mjs.

/** Normalise one file for comparison: CRLF -> LF, strip a UTF-8 BOM, and mask
 * every 64-hex string literal. The mask exists for two reasons: deployed bundles
 * carry SHA-256 auth fallbacks that must never be printed by a diff, and a
 * masked copy (e.g. one written by hand from get_edge_function output) must
 * still compare equal to the repo. */
export function normalise(text) {
  return String(text)
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(["'`])[0-9a-fA-F]{64}\1/g, '$1<REDACTED>$1')
    .replace(/(["'`])<REDACTED>\1/g, '"<REDACTED>"');
}

/** Normalise a bundle path: the Management API reports deployed files either as
 * bare names ("index.ts") or under a build prefix ("source/index.ts",
 * "supabase/functions/<slug>/index.ts", "file:///tmp/.../source/index.ts"). */
export function normalisePath(p, slug) {
  let s = String(p).replace(/\\/g, "/").replace(/^file:\/\//, "");
  const fnPrefix = `supabase/functions/${slug}/`;
  const i = s.indexOf(fnPrefix);
  if (i >= 0) return s.slice(i + fnPrefix.length);
  const j = s.lastIndexOf("/source/");
  if (j >= 0) return s.slice(j + "/source/".length);
  return s.replace(/^\.?\//, "");
}

/** Pull the version marker out of an entrypoint. Recognises the house shapes:
 *   const CRAWLER_ID = "source-poller_v1.8";
 *   const FN_VERSION = "v2.5";   const VERSION = "1.2.0";
 *   const AUTO_ID = "AUTO-030_v2.5";
 * Returns { name, raw, version:[n,...] } or null. */
export function extractMarker(text) {
  const re = /\bconst\s+([A-Z][A-Z0-9_]*(?:ID|VERSION|VER))\s*=\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    const raw = m[2];
    const v = raw.match(/(?:^|[_\-\s.v])v?(\d+(?:\.\d+)+|\d+)$/i) ?? raw.match(/_v(\d+(?:\.\d+)*)/i);
    if (v && (/v\d/i.test(raw) || /^\d+(\.\d+)+$/.test(raw))) {
      return { name: m[1], raw, version: v[1].split(".").map(Number) };
    }
  }
  return null;
}

/** -1 / 0 / 1 numeric compare of two version arrays ([1,10] > [1,9]). */
export function compareVersions(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Minimal line diff (LCS) — enough to show a reviewer WHAT differs, never a
 * patch to apply. Returns lines prefixed "- " (deployed only) / "+ " (repo only). */
export function lineDiff(a, b, maxLines = 400) {
  const A = a.split("\n");
  const B = b.split("\n");
  if (A.length * B.length > 4_000_000) {
    return [`(file too large for an inline diff: ${A.length} vs ${B.length} lines)`];
  }
  const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${A[i++]}`);
    else out.push(`+ ${B[j++]}`);
  }
  while (i < A.length) out.push(`- ${A[i++]}`);
  while (j < B.length) out.push(`+ ${B[j++]}`);
  return out.length > maxLines ? [...out.slice(0, maxLines), `… ${out.length - maxLines} more`] : out;
}

/**
 * Compare a deployed bundle with the repo directory.
 * @param {Record<string,string>} deployed  path -> content
 * @param {Record<string,string>} repo      path -> content
 * @param {{ slug: string, entrypoint?: string }} opts
 * @returns {{ status: 'IDENTICAL'|'DRIFT', deployedOnlyFiles: string[], repoOnlyFiles: string[],
 *            changedFiles: {path:string, diff:string[]}[], deployedMarker, repoMarker,
 *            markerVerdict: 'equal'|'repo-ahead'|'deployed-ahead'|'unknown' }}
 */
export function compareBundles(deployed, repo, opts) {
  const slug = opts.slug;
  const entry = opts.entrypoint ?? "index.ts";
  const D = new Map(Object.entries(deployed).map(([p, c]) => [normalisePath(p, slug), normalise(c)]));
  const R = new Map(Object.entries(repo).map(([p, c]) => [normalisePath(p, slug), normalise(c)]));
  const deployedOnlyFiles = [...D.keys()].filter((p) => !R.has(p)).sort();
  const repoOnlyFiles = [...R.keys()].filter((p) => !D.has(p)).sort();
  const changedFiles = [];
  for (const [p, c] of [...D.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    if (R.has(p) && R.get(p) !== c) changedFiles.push({ path: p, diff: lineDiff(c, R.get(p)) });
  }
  const deployedMarker = D.has(entry) ? extractMarker(D.get(entry)) : null;
  const repoMarker = R.has(entry) ? extractMarker(R.get(entry)) : null;
  let markerVerdict = "unknown";
  if (deployedMarker && repoMarker) {
    const c = compareVersions(deployedMarker.version, repoMarker.version);
    markerVerdict = c === 0 ? "equal" : c > 0 ? "deployed-ahead" : "repo-ahead";
  }
  const identical = !deployedOnlyFiles.length && !repoOnlyFiles.length && !changedFiles.length;
  return {
    status: identical ? "IDENTICAL" : "DRIFT",
    deployedOnlyFiles,
    repoOnlyFiles,
    changedFiles,
    deployedMarker,
    repoMarker,
    markerVerdict,
  };
}

/**
 * Exit-code policy.
 *   0  identical — safe to deploy (a no-op deploy).
 *   1  drift, or the deployed marker is ABOVE the repo marker. Deploying would
 *      either overwrite unreviewed production code or roll production back.
 *   0  with allowRepoAhead, ONLY when content drifts and the repo marker is
 *      strictly above the deployed one (the operator has read the diff and is
 *      deliberately shipping newer work). Never when the deployed marker is
 *      equal, above, or absent, and never when the deployed bundle carries a
 *      file the repo lacks.
 */
export function exitCodeFor(result, { allowRepoAhead = false } = {}) {
  if (result.markerVerdict === "deployed-ahead") return 1;
  if (result.status === "IDENTICAL") return 0;
  if (allowRepoAhead && result.markerVerdict === "repo-ahead" && result.deployedOnlyFiles.length === 0) return 0;
  return 1;
}
