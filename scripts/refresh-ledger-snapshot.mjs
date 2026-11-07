#!/usr/bin/env node
// refresh-ledger-snapshot.mjs — FDY-97. Rewrites supabase/ledger-snapshot.json
// from supabase_migrations.schema_migrations (version + name only, never the
// SQL bodies) over a READ-ONLY connection.
//
//   FARADAY_LEDGER_RO_URL=postgres://... node scripts/refresh-ledger-snapshot.mjs
//
// Uses the `psql` client (present on GitHub's ubuntu runners). The URL is passed
// through the environment (PGURI-style via argv would show in `ps`), and never
// printed. Exits 0 with a notice when the variable is unset, so an un-provisioned
// workflow stays green rather than failing every day.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const url = process.env.FARADAY_LEDGER_RO_URL;
if (!url) {
  console.log("::notice::FARADAY_LEDGER_RO_URL is not set — ledger snapshot not refreshed (opt-in; see FDY-97).");
  process.exit(0);
}
if (url.includes("xgbpmlkanxewtfizloay")) {
  console.error("refusing the decoy project");
  process.exit(2);
}

const sql =
  "select coalesce(json_agg(json_build_object('version', version, 'name', name) order by version), '[]'::json) " +
  "from supabase_migrations.schema_migrations";
// Parse the URL into libpq env vars so nothing secret lands on the command line.
const u = new URL(url);
const env = {
  ...process.env,
  PGHOST: u.hostname,
  PGPORT: u.port || "5432",
  PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
  PGSSLMODE: u.searchParams.get("sslmode") ?? "require",
  PGOPTIONS: "-c default_transaction_read_only=on",
};
const r = spawnSync("psql", ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { env, encoding: "utf8" });
if (r.status !== 0) {
  // stderr from psql does not contain the password (it came from PGPASSWORD).
  console.error(`psql failed (exit ${r.status}): ${(r.stderr ?? "").split("\n")[0]}`);
  process.exit(2);
}
const applied = JSON.parse(r.stdout.trim());
const captured = new Date().toLocaleString("sv-SE", { timeZone: "America/Chicago" }).replace(" ", "T");
const snapshot = {
  _comment:
    "FDY-97: names + versions of supabase_migrations.schema_migrations on the Faraday project of record. No SQL bodies. Refresh with scripts/refresh-ledger-snapshot.mjs.",
  project: "ycadmmngkdhvpcsrcuaq",
  captured_at: `${captured} CT`,
  applied,
};
writeFileSync(new URL("../supabase/ledger-snapshot.json", import.meta.url), JSON.stringify(snapshot, null, 1) + "\n");
console.log(`ledger snapshot refreshed: ${applied.length} applied rows, captured ${captured} CT`);
