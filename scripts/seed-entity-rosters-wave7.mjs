#!/usr/bin/env node
// CC-SOURCE-SCALE-500 Wave 7 (company top-up) — parse the docs/rosters/WAVE7-*.md
// roster tables into Google News query-lane seed SQL parts (jsonb_to_recordset,
// entity-dedup via NOT EXISTS, ON CONFLICT DO NOTHING).
// Usage: node scripts/seed-entity-rosters-wave7.mjs <outdir>
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
function sections(md) {
  const map = {};
  for (const sec of ("\n" + md).split(/\n# /).slice(1)) {
    map[sec.split("\n", 1)[0].trim()] = tableRows(sec);
  }
  return map;
}

const rows = [];
const seen = new Set();
function add(prefix, entity, segment, country) {
  const e = entity.trim();
  if (!e || e.length < 3 || e.length > 90) return;
  const key = `gsearch:${prefix}-${slug(e)}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ k: key, e, kind: "company", seg: segment, c: (country ?? "").trim() });
}

for (const c of tableRows(R("WAVE7-HYPERSCALERS-NEOCLOUDS.md"))) add("hyp", c[0], "hyperscalers", c[2]);
for (const c of tableRows(R("WAVE7-DC-OPERATORS.md"))) add("op", c[0], "dc_operators", c[2]);
try {
  for (const c of tableRows(R("WAVE7-DC-OPERATORS-DIRECTORY.md"))) add("op", c[0], "dc_operators", c[2]);
} catch { /* directory-harvest doc is optional */ }
for (const c of tableRows(R("WAVE7-PUBLIC-COMPANIES-TOPUP.md"))) add("pub", c[0], "public_companies", c[3]);
for (const c of tableRows(R("WAVE7-STARTUPS-TOPUP.md"))) add("stp", c[0], "startups", c[2]);
const si = sections(R("WAVE7-SUPPLY-INVESTORS-TOPUP.md"));
for (const c of si.SUPPLY_CHAIN ?? []) add("sup", c[0], "supply_chain", c[2]);
for (const c of si.INVESTORS ?? []) add("inv", c[0], "investors", c[2]);

// Hyperscalers/neoclouds and DC operators are daily (the 0010 operator tier);
// the long tail stays weekly (poller v8 cadence gate).
const TPL = `insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select x.k,
  left('Google News search: "' || x.e || '" (' || x.seg || ' watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || x.e || '"'),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || x.e || '" data center OR AI OR infrastructure') || '&hl=en-US&gl=US&ceid=US:en',
  'rss',
  case when x.seg in ('hyperscalers','dc_operators') then 'daily' else 'weekly' end,
  'SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D22'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', x.e, 'entity_kind', x.kind, 'segment', x.seg, 'country', x.c,
    'wave', 7,
    'query', '"' || x.e || '" data center OR AI OR infrastructure')
from jsonb_to_recordset('%s'::jsonb)
  as x(k text, e text, kind text, seg text, c text)
where not exists (select 1 from source_registry sr where sr.fetch_config->>'entity' = x.e)
on conflict (source_key) do nothing;`;

const per = 130;
for (let i = 0; i * per < rows.length; i++) {
  const payload = JSON.stringify(rows.slice(i * per, (i + 1) * per)).replace(/'/g, "''");
  writeFileSync(`${outdir}/w7_part${i + 1}.sql`, TPL.replace("%s", payload));
}
console.log(`rows: ${rows.length}, parts: ${Math.ceil(rows.length / per)}, by segment:`,
  Object.fromEntries([...new Set(rows.map(r => r.seg))].map(s => [s, rows.filter(r => r.seg === s).length])));
