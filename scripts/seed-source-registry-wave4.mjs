#!/usr/bin/env node
// CC-SOURCE-SCALE-500 Wave 4 — parse the three CC-SOURCE-NEWS-WAVE4-*.md
// catalogs into compact source_registry seed SQL parts (jsonb_to_recordset,
// ON CONFLICT DO NOTHING). Usage: node scripts/seed-source-registry-wave4.mjs <outdir>
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const outdir = process.argv[2] ?? "/tmp";
const docs = readdirSync(new URL("../docs", import.meta.url))
  .filter((f) => f.startsWith("CC-SOURCE-NEWS-WAVE4-"))
  .map((f) => new URL(`../docs/${f}`, import.meta.url));

const INDUSTRY = /association|institute|council|society|alliance|coalition|exchange|NECA|IBEW|nonprofit|foundation|CNCF|coop|co-op|APPA|NRECA/i;
const COMPANY = /newsroom|press|blog|insights|media center|— (Oklo|X-energy|TerraPower|NuScale|Kairos)/i;

function slug(name) {
  return name.toLowerCase().replace(/\(.*?\)/g, "").replace(/[—–].*$/, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function licenseStatus(posture) {
  if (/restrictive-tos|legal read/i.test(posture)) return "gated";
  if (/CC|republishable|credit required|attribution/i.test(posture)) return "attribution_required";
  if (/gov-public-domain|public-rss|paywalled/i.test(posture)) return "cleared";
  return "unreviewed";
}
function classify(name, publisher, posture) {
  if (/gov-public-domain/i.test(posture)) return "government_feed";
  if (INDUSTRY.test(name) || INDUSTRY.test(publisher)) return "industry_entity";
  if (COMPANY.test(name)) return "company_feed";
  return "news_feed";
}

const byKey = new Map();
for (const url of docs) {
  const md = readFileSync(url, "utf8");
  for (const sec of md.split(/\n# /).slice(1)) {
    const m = sec.split("\n", 1)[0].match(/^D(\d+)(?:\s*\+\s*D(\d+))?/);
    if (!m) continue;
    const domains = [`D${m[1]}`, ...(m[2] ? [`D${m[2]}`] : [])];
    for (const line of sec.split("\n")) {
      if (!line.startsWith("| ")) continue;
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 10 || cells[2] === "Source" || /^[-: ]+$/.test(cells[2] || "-")) continue;
      const [name, publisher, home, feedCell, , , , posture] = cells.slice(2, 10);
      if (!name || !home?.startsWith("http")) continue;
      const key = "feed:" + slug(name);
      const feedUrl = (feedCell.match(/https?:\/\/[^\s)]+/) || [null])[0];
      if (byKey.has(key)) {
        for (const d of domains) if (!byKey.get(key).d.includes(d)) byKey.get(key).d.push(d);
        continue;
      }
      byKey.set(key, {
        k: key, n: name, p: publisher, u: home, f: feedUrl,
        l: posture, s: licenseStatus(posture), d: [...domains],
        t: classify(name, publisher, posture),
      });
    }
  }
}

const rows = [...byKey.values()];
const TPL = `insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,countable,status,subsystem,fetcher,source_type,fetch_config)
select k, n, p, u, f, 'rss', 'daily', 'SRC', l, s, d, false, 'registered', 'poller', 'source-poller', t, '{"wave":4}'::jsonb
from jsonb_to_recordset('%s'::jsonb)
  as x(k text, n text, p text, u text, f text, l text, s text, d text[], t text)
on conflict (source_key) do nothing;`;

const per = 95;
for (let i = 0; i * per < rows.length; i++) {
  const payload = JSON.stringify(rows.slice(i * per, (i + 1) * per)).replace(/'/g, "''");
  writeFileSync(`${outdir}/wave4_part${i + 1}.sql`, TPL.replace("%s", payload));
}
console.log(`rows: ${rows.length}, parts: ${Math.ceil(rows.length / per)}`);
