// One-off: emit supabase/migrations/0013_wave7_operator_vercel_harvest.sql —
// the 90-operator Vercel-harvest delta (WAVE7-DC-OPERATORS-VERCEL.md only).
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync(new URL("../docs/rosters/WAVE7-DC-OPERATORS-VERCEL.md", import.meta.url), "utf8");
const rows = [];
for (const line of md.split("\n")) {
  if (!line.startsWith("|")) continue;
  const c = line.split("|").map((s) => s.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
  if (c.length < 3 || c[0] === "Entity" || /^[-: ]+$/.test(c[0])) continue;
  const slug = c[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  rows.push({ k: `gsearch:op-${slug}`, e: c[0], kind: "company", seg: "dc_operators", c: c[2] });
}

const payload = JSON.stringify(rows).replace(/'/g, "''");
const sql = `-- 0013_wave7_operator_vercel_harvest.sql — CC-SOURCE-SCALE-500 Wave 7 delta:
-- ${rows.length} operators from the Vercel-egress directory harvest (Baxtel metro
-- indexes + knowledge-vouched; datacenters.com / datacentermap.com bot-challenge
-- Vercel egress too and were dropped). Applied to prod 2026-07-18.
insert into source_registry (source_key,name,provider,url,feed_url,access_method,cadence,confidence_cap,license,license_status,idf_domains,scope,countable,status,subsystem,fetcher,source_type,fetch_config)
select x.k,
  left('Google News search: "' || x.e || '" (' || x.seg || ' watch)', 200),
  'Google News RSS',
  'https://news.google.com/search?q=' || gsearch_seed_url('"' || x.e || '"'),
  'https://news.google.com/rss/search?q=' || gsearch_seed_url('"' || x.e || '" data center OR AI OR infrastructure') || '&hl=en-US&gl=US&ceid=US:en',
  'rss','daily','SRC',
  'google-news-rss (aggregator; items link to underlying publishers)','attribution_required',
  array['D22'],'query_feed',false,'registered','poller','source-poller','search_query',
  jsonb_build_object('entity', x.e, 'entity_kind', x.kind, 'segment', x.seg, 'country', x.c,
    'wave', 7,
    'query', '"' || x.e || '" data center OR AI OR infrastructure')
from jsonb_to_recordset('${payload}'::jsonb)
  as x(k text, e text, kind text, seg text, c text)
where not exists (select 1 from source_registry sr where sr.fetch_config->>'entity' = x.e)
on conflict (source_key) do nothing;
`;
writeFileSync(new URL("../supabase/migrations/0013_wave7_operator_vercel_harvest.sql", import.meta.url), sql);
console.log(`rows: ${rows.length}`);
