#!/usr/bin/env node
// CC-SOURCE-SCALE-500 Wave 1 — parse docs/CC-SOURCE-FEED-CANDIDATES.md into
// source_registry seed SQL. Idempotent output: ON CONFLICT (source_key) DO NOTHING.
// Usage: node scripts/seed-source-registry-wave1.mjs > /tmp/wave1-seed.sql
import { readFileSync } from "node:fs";

const md = readFileSync(new URL("../docs/CC-SOURCE-FEED-CANDIDATES.md", import.meta.url), "utf8");

const WIRES = /PR Newswire|Business Wire|GlobeNewswire/i;
const STATUS = /\bStatus\b|Health Dashboard|metastatus/i;
const INDUSTRY = [
  "ASHRAE", "AGC of America", "ABC Newsroom", "Modular Building Institute", "Fiber Broadband Association",
  "Nareit", "NCSL", "IEDC", "7x24 Exchange", "Data Center World / AFCOM", "CSIS", "Brookings", "CSET",
  "RAND", "CNAS", "Carnegie", "Stanford HAI", "OECD.AI", "RMI News", "IEA News", "Economic Policy Institute",
  "ITEP", "Tax Foundation", "Tax Policy Center", "Center on Budget", "Good Jobs First", "The Conference Board",
  "Uptime Institute", "SANS Internet Storm Center", "CNCF Blog", "Kubernetes Blog",
  "Piedmont Environmental Council", "Data Center Watch", "Lloyd's Media Centre", "NERC Newsroom",
];
const BLOGS = [
  "Construction Physics", "Telecom Ramblings", "Chips and Cheese", "WikiChip Fuse",
  "Krebs on Security", "AutomatedBuildings.com", "SemiAnalysis",
];
const COMPANY_EXTRA = [
  "TrendForce News", "PitchBook News", "CoStar News", "TeleGeography Blog", "MSRC Security Update Guide",
  "Dodge Construction Network News", "Fluidstack", "Synergy Research Group", "Dell'Oro Group blog/press",
  "Omdia — press/analyst opinions", "Gartner Newsroom", "IDC Newsroom", "AM Best News (BestWire)",
  "Swiss Re News / Institute", "ADP Research / National Employment Report", "Indeed Hiring Lab",
  "Lightcast blog", "Phaidra Blog", "EkkoSense News", "SchedMD News",
];
const HOURLY = /Status|Health Dashboard|metastatus|NWS Alerts|EDGAR/i;

function slug(name) {
  return name.toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[—–].*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
function q(s) { return s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`; }

function classify(name, posture, domains) {
  if (WIRES.test(name)) return "wire_service";
  if (domains.includes("D23") && STATUS.test(name)) return "status_feed";
  if (/gov-public-domain/i.test(posture)) return "government_feed";
  if (BLOGS.some((b) => name.startsWith(b))) return "blog";
  if (INDUSTRY.some((b) => name.startsWith(b))) return "industry_entity";
  if (COMPANY_EXTRA.some((b) => name.startsWith(b))) return "company_feed";
  if (/Newsroom|News Center|Press|Media Center|What's New|Insights|Blog\b/i.test(name)) return "company_feed";
  return "news_feed";
}
function licenseStatus(posture) {
  if (/restrictive-tos|legal read/i.test(posture)) return "gated";
  if (/CC|republishable|credit required|attribution/i.test(posture)) return "attribution_required";
  if (/gov-public-domain|public-rss|paywalled/i.test(posture)) return "cleared";
  return "unreviewed";
}

const sections = md.split(/\n# /).slice(1); // each starts with "D..."
const byKey = new Map();
for (const sec of sections) {
  const header = sec.split("\n", 1)[0];
  const m = header.match(/^D(\d+)(?:\s*\+\s*D(\d+))?/);
  if (!m) continue;
  const domains = [`D${m[1]}`];
  if (m[2]) domains.push(`D${m[2]}`);
  for (const line of sec.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // | '' | Source | Publisher | Homepage | Feed | Verified | cadence | Access | License | Why | ''
    if (cells.length < 10 || cells[1] === "Source" || cells[1].startsWith("---")) continue;
    const [name, publisher, home, feedCell, verified, cad, access, posture] = cells.slice(1, 9);
    if (!name || !home.startsWith("http")) continue;
    const key = "feed:" + slug(name);
    const feedUrl = (feedCell.match(/https?:\/\/[^\s)]+/) || [null])[0];
    if (byKey.has(key)) {
      const row = byKey.get(key);
      for (const d of domains) if (!row.domains.includes(d)) row.domains.push(d);
      continue;
    }
    byKey.set(key, {
      key, name, publisher, home, feedUrl,
      probeHint: feedCell, verified, cad, access, posture, domains: [...domains],
    });
  }
}

const rows = [...byKey.values()];
let sql = "";
for (const r of rows) {
  const st = classify(r.name, r.posture, r.domains);
  const cadence = HOURLY.test(r.name) ? "hourly" : "daily";
  const access = r.feedUrl && /json|api/i.test(r.probeHint) ? "json_api" : "rss";
  sql += `insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,countable,status,subsystem,fetcher,source_type,fetch_config)
values (${q(r.key)},${q(r.name)},${q(r.publisher)},${q(r.home)},${q(r.feedUrl)},${q(access)},${q(cadence)},'SRC',${q(r.posture)},${q(licenseStatus(r.posture))},array[${r.domains.map(q).join(",")}]::text[],false,'registered','poller','source-poller',${q(st)},${q(JSON.stringify({ probe_hint: r.probeHint, catalog_verified: r.verified, est_items_day: r.cad, access: r.access }))}::jsonb)
on conflict (source_key) do nothing;\n`;
}
process.stdout.write(`-- Wave 1 seed: ${rows.length} candidate feeds\n` + sql);
console.error(`rows: ${rows.length}`);

// --compact: emit a single jsonb_to_recordset INSERT (smaller payload for MCP apply)
if (process.argv.includes("--compact")) {
  const compact = rows.map((r) => ({
    k: r.key, n: r.name, p: r.publisher, u: r.home, f: r.feedUrl,
    a: r.feedUrl && /json|api/i.test(r.probeHint) ? "json_api" : "rss",
    c: HOURLY.test(r.name) ? "hourly" : "daily",
    l: r.posture, s: licenseStatus(r.posture), d: r.domains,
    t: classify(r.name, r.posture, r.domains), h: r.probeHint,
  }));
  const payload = JSON.stringify(compact).replace(/'/g, "''");
  process.stdout.write(`insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,countable,status,subsystem,fetcher,source_type,fetch_config)
select k, n, p, u, f, a, c, 'SRC', l, s, d, false, 'registered', 'poller', 'source-poller', t,
       jsonb_build_object('probe_hint', h)
from jsonb_to_recordset('${payload}'::jsonb)
  as x(k text, n text, p text, u text, f text, a text, c text, l text, s text, d text[], t text, h text)
on conflict (source_key) do nothing;`);
}
