#!/usr/bin/env node
// CC-SOURCE-SCALE-500 Wave 8 (path to 10k) — parse docs/rosters/WAVE8-*.md into
// Google News query-lane seed SQL parts (jsonb_to_recordset, entity NOT EXISTS
// dedupe, ON CONFLICT DO NOTHING). Usage: node scripts/seed-entity-rosters-wave8.mjs <outdir>
import { readFileSync, writeFileSync } from "node:fs";

const outdir = process.argv[2] ?? "/tmp";
const R = (f) => readFileSync(new URL(`../docs/rosters/${f}`, import.meta.url), "utf8");

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}
function tableRows(md) {
  const out = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 2 || cells[0] === "Entity" || /^[-: ]+$/.test(cells[0])) continue;
    out.push(cells);
  }
  return out;
}

const rows = [];
const seen = new Set();
const SEGS = new Set(["supply_chain", "investors", "startups", "public_companies", "hyperscalers", "dc_operators"]);
function add(prefix, entity, kind, segment, country, extra = {}) {
  const e = entity.trim();
  if (!e || e.length < 3 || e.length > 90) return;
  const key = `gsearch:${prefix}-${slug(e)}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ k: key, e, kind, seg: segment, c: (country ?? "").trim(), ...extra });
}

for (const c of tableRows(R("WAVE8-INTL-GOVERNMENT.md"))) {
  add("igov", c[0], "government", "intl_gov", c[2], { lvl: (c[1] ?? "national").toLowerCase() });
}
for (const c of tableRows(R("WAVE8-INDUSTRY-ORGS.md"))) {
  add("org", c[0], "industry_org", "industry_orgs", c[2]);
}
for (const c of tableRows(R("WAVE8-COMPANIES-RESIDUAL.md"))) {
  const seg = (c[1] ?? "").trim();
  if (!SEGS.has(seg)) continue;
  const prefix = { supply_chain: "sup", investors: "inv", startups: "stp", public_companies: "pub", hyperscalers: "hyp", dc_operators: "op" }[seg];
  add(prefix, c[0], "company", seg, c[3]);
}

const TPL = `insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select x.k,
  left('Google News search: "' || x.e || '" (' || x.seg || ' watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || x.e || '"'),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || x.e || '" data center OR AI OR infrastructure') || '&hl=en-US&gl=US&ceid=US:en',
  'rss','weekly','SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D22'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', x.e, 'entity_kind', x.kind, 'segment', x.seg, 'country', x.c,
    'wave', 8,
    'query', '"' || x.e || '" data center OR AI OR infrastructure')
  || case when x.lvl is not null then jsonb_build_object('gov_level', x.lvl, 'gov_region', 'intl') else '{}'::jsonb end
from jsonb_to_recordset('%s'::jsonb)
  as x(k text, e text, kind text, seg text, c text, lvl text)
where not exists (select 1 from source_registry sr where sr.fetch_config->>'entity' = x.e)
on conflict (source_key) do nothing;`;

const per = 130;
for (let i = 0; i * per < rows.length; i++) {
  const payload = JSON.stringify(rows.slice(i * per, (i + 1) * per)).replace(/'/g, "''");
  writeFileSync(`${outdir}/w8_part${i + 1}.sql`, TPL.replace("%s", payload));
}
console.log(`rows: ${rows.length}, parts: ${Math.ceil(rows.length / per)}, by segment:`,
  Object.fromEntries([...new Set(rows.map(r => r.seg))].map(s => [s, rows.filter(r => r.seg === s).length])));
