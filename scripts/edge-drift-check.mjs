#!/usr/bin/env node
// edge-drift-check.mjs — FDY-97 pre-deploy guard.
//
// Compares the DEPLOYED bundle of one edge function with supabase/functions/<slug>/
// in this checkout, and refuses (exit 1) when deploying would overwrite code
// that is not in git or roll production back. Run it before EVERY deploy:
//
//   node scripts/edge-drift-check.mjs <slug>
//   node scripts/edge-drift-check.mjs <slug> --allow-repo-ahead   # after reading the diff
//   node scripts/edge-drift-check.mjs <slug> --deployed-dir /tmp/deployed/<slug>   # offline
//
// Exit codes: 0 identical (or repo strictly ahead with --allow-repo-ahead),
//             1 drift / deployed marker above repo marker,
//             2 usage or environment error (missing token, unreachable API).
//
// Network mode reads SUPABASE_ACCESS_TOKEN from the environment and never prints
// it. Project defaults to the Faraday project of record; the decoy project is
// refused outright.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareBundles, exitCodeFor } from "./lib/edge-drift.mjs";

const PROJECT_OF_RECORD = "ycadmmngkdhvpcsrcuaq";
const DECOY_PROJECTS = new Set(["xgbpmlkanxewtfizloay"]);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = /(^|\/)(node_modules|\.git)(\/|$)|\.DS_Store$/;

function usage(msg) {
  if (msg) console.error(`edge-drift-check: ${msg}`);
  console.error("usage: node scripts/edge-drift-check.mjs <slug> [--project <ref>] [--repo-dir <dir>] [--deployed-dir <dir>] [--allow-repo-ahead] [--json]");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { slug: null, project: PROJECT_OF_RECORD, repoDir: null, deployedDir: null, allowRepoAhead: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-repo-ahead") out.allowRepoAhead = true;
    else if (a === "--json") out.json = true;
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--repo-dir") out.repoDir = argv[++i];
    else if (a === "--deployed-dir") out.deployedDir = argv[++i];
    else if (a.startsWith("--")) usage(`unknown flag ${a}`);
    else if (!out.slug) out.slug = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!out.slug || !/^[a-z0-9][a-z0-9_-]*$/.test(out.slug)) usage("a function slug is required");
  if (DECOY_PROJECTS.has(out.project)) usage(`refusing the decoy project ${out.project}`);
  return out;
}

export function readDir(dir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      if (SKIP.test(rel)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else files[rel] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return files;
}

/** Parse a multipart/form-data body into {filename -> text}. */
function parseMultipart(buf, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error("multipart response without a boundary");
  const boundary = `--${m[1] ?? m[2]}`;
  const text = buf.toString("latin1");
  const files = {};
  for (const part of text.split(boundary)) {
    const sep = part.indexOf("\r\n\r\n");
    if (sep < 0) continue;
    const head = part.slice(0, sep);
    const name = head.match(/filename="([^"]+)"/i)?.[1];
    if (!name) continue;
    let body = part.slice(sep + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    files[name] = Buffer.from(body, "latin1").toString("utf8");
  }
  return files;
}

async function fetchDeployed(project, slug) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    usage("SUPABASE_ACCESS_TOKEN is not set (a Supabase personal access token; it is read, never printed). Or pass --deployed-dir.");
  }
  const base = `https://api.supabase.com/v1/projects/${project}/functions/${slug}`;
  const headers = { authorization: `Bearer ${token}` };
  const meta = await fetch(base, { headers });
  if (meta.status === 404) return { meta: null, files: null };
  if (!meta.ok) throw new Error(`metadata request failed: HTTP ${meta.status}`);
  const info = await meta.json();
  const body = await fetch(`${base}/body`, { headers: { ...headers, accept: "multipart/form-data" } });
  if (!body.ok) throw new Error(`body request failed: HTTP ${body.status}`);
  const ct = body.headers.get("content-type") ?? "";
  if (!/multipart\/form-data/i.test(ct)) {
    throw new Error(`body came back as ${ct || "unknown type"}, not multipart (eszip bundles cannot be compared here; use --deployed-dir with files from get_edge_function)`);
  }
  return { meta: info, files: parseMultipart(Buffer.from(await body.arrayBuffer()), ct) };
}

export function report(slug, result, meta) {
  const lines = [];
  lines.push(`edge-drift-check ${slug}: ${result.status}`);
  if (meta) lines.push(`  deployed version ${meta.version ?? "?"}, updated_at ${meta.updated_at ? new Date(meta.updated_at).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT" : "?"}`);
  lines.push(`  marker: deployed ${result.deployedMarker?.raw ?? "(none)"} · repo ${result.repoMarker?.raw ?? "(none)"} · ${result.markerVerdict}`);
  for (const f of result.deployedOnlyFiles) lines.push(`  DEPLOYED-ONLY file: ${f}  ← production code that is not in git`);
  for (const f of result.repoOnlyFiles) lines.push(`  repo-only file: ${f}`);
  for (const c of result.changedFiles) {
    lines.push(`  changed: ${c.path}  (- deployed / + repo)`);
    for (const l of c.diff) lines.push(`    ${l}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoDir = resolve(args.repoDir ?? join(REPO_ROOT, "supabase", "functions", args.slug));
  const repo = existsSync(repoDir) ? readDir(repoDir) : null;

  let deployed = null;
  let meta = null;
  if (args.deployedDir) {
    if (!existsSync(args.deployedDir)) usage(`--deployed-dir ${args.deployedDir} does not exist`);
    deployed = readDir(resolve(args.deployedDir));
  } else {
    try {
      ({ meta, files: deployed } = await fetchDeployed(args.project, args.slug));
    } catch (e) {
      console.error(`edge-drift-check: ${String(e.message ?? e)}`);
      process.exit(2);
    }
  }

  if (!repo && !deployed) usage(`${args.slug} is neither deployed nor in the repo`);
  if (!repo) {
    console.log(`edge-drift-check ${args.slug}: DEPLOYED-ONLY — no supabase/functions/${args.slug}/ in git. Capture the deployed source into the repo before any deploy.`);
    process.exit(1);
  }
  if (!deployed) {
    console.log(`edge-drift-check ${args.slug}: REPO-ONLY — not deployed; a first deploy cannot roll anything back.`);
    process.exit(0);
  }

  const result = compareBundles(deployed, repo, { slug: args.slug });
  const code = exitCodeFor(result, { allowRepoAhead: args.allowRepoAhead });
  if (args.json) console.log(JSON.stringify({ slug: args.slug, ...result, exit: code }, null, 2));
  else {
    console.log(report(args.slug, result, meta));
    if (code === 1 && result.markerVerdict === "deployed-ahead") {
      console.log("  REFUSE: the deployed marker is above the repo marker — deploying would roll production back.");
    } else if (code === 1 && result.markerVerdict === "repo-ahead" && !args.allowRepoAhead) {
      console.log("  The repo marker is ahead. If every '-' line above is intentionally superseded, re-run with --allow-repo-ahead.");
    } else if (code === 0 && result.status === "DRIFT") {
      console.log("  ALLOWED (--allow-repo-ahead): repo marker strictly above deployed, no deployed-only files.");
    }
  }
  process.exit(code);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
