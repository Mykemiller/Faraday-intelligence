#!/usr/bin/env node
// gen-local-watch-query-migration.mjs — FDY-88.
//
// Regenerates supabase/migrations/20261009200000_local_watch_query_scoping.sql
// from (a) the committed roster snapshot docs/far-88/loc-watch-entities.txt and
// (b) buildLocalQuery() in supabase/functions/source-poller/local-query.ts.
//
// The migration is data, not logic: one explicit (source_key, new_query) tuple
// per live row, so a reviewer can diff any single jurisdiction and so the SQL
// can never drift from the tested TypeScript builder.
//
// Usage:
//   node scripts/gen-local-watch-query-migration.mjs            # write the migration
//   node scripts/gen-local-watch-query-migration.mjs --check     # verify it is current
//   node scripts/gen-local-watch-query-migration.mjs --stdout    # print, write nothing
//
// This script NEVER connects to a database and NEVER applies anything. The
// migration it emits carries the UN-APPLIED header; Myke applies it on merge.
//
// To refresh the snapshot (read-only, when the roster changes):
//   psql "$FARADAY_DB_URL" -At -c "set default_transaction_read_only = on;
//     select fetch_config->>'entity' from public.source_registry
//      where source_key like 'gsearch:loc-%' order by 1;" \
//     >> docs/far-88/loc-watch-entities.txt

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalQuery,
  classifyLocalName,
  hasTopLevelBareOr,
  localJurisdictionFromEntity,
  localSourceKey,
} from "../supabase/functions/source-poller/local-query.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
export const SNAPSHOT = resolve(ROOT, "docs/far-88/loc-watch-entities.txt");
export const MIGRATION = resolve(ROOT, "supabase/migrations/20261009200000_local_watch_query_scoping.sql");

/** Expected roster size and composition, measured read-only against production
 * (project ycadmmngkdhvpcsrcuaq) on 2026-10-07. A drift here is a real change
 * in the lane and must be re-verified, not papered over. */
export const EXPECTED_ROWS = 1000;
export const EXPECTED_KINDS = {
  city: 539,
  county: 267,
  town: 142,
  village: 28,
  parish: 22,
  municipio: 2,
};

export function readEntities(file = SNAPSHOT) {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** entity string → { entity, sourceKey, kind, query }. Throws on anything the
 * builder cannot classify or that would emit a top-level bare OR. */
export function planRows(entities) {
  const rows = [];
  const seen = new Set();
  for (const entity of entities) {
    const jur = localJurisdictionFromEntity(entity);
    if (!jur) throw new Error(`unparseable entity: ${JSON.stringify(entity)}`);
    const kind = classifyLocalName(jur.name);
    if (kind === "other") throw new Error(`unclassifiable Census name: ${JSON.stringify(entity)}`);
    const query = buildLocalQuery(jur);
    if (hasTopLevelBareOr(query)) throw new Error(`top-level bare OR for ${entity}: ${query}`);
    const sourceKey = localSourceKey(entity);
    if (seen.has(sourceKey)) throw new Error(`duplicate source_key ${sourceKey} (from ${entity})`);
    seen.add(sourceKey);
    rows.push({ entity, sourceKey, kind, query });
  }
  return rows;
}

const sq = (s) => `'${s.replace(/'/g, "''")}'`;

export function renderMigration(rows) {
  const counts = {};
  for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const composition = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");

  const values = rows.map((r) => `  (${sq(r.sourceKey)}, ${sq(r.query)})`).join(",\n");

  return `-- UN-APPLIED — applied by Myke on merge
-- 20261009200000_local_watch_query_scoping.sql — FDY-88
-- Rewrites fetch_config.query, feed_url and url for every "local gov watch"
-- source (source_key like 'gsearch:loc-%'), from buildLocalQuery() in
-- supabase/functions/source-poller/local-query.ts.
--
-- GENERATED FILE. Do not hand-edit. Regenerate with:
--   node scripts/gen-local-watch-query-migration.mjs
-- Input roster: docs/far-88/loc-watch-entities.txt (read read-only from project
-- ycadmmngkdhvpcsrcuaq on 2026-10-07).
--
-- WHAT IT FIXES (all three verified in production, 2026-10-07):
--   1. v1 queries ended in a top-level bare alternation
--        "Acworth city" GA data center OR rezoning OR zoning OR moratorium
--      which Google News reads as (…) OR rezoning OR zoning OR moratorium, so
--      any national zoning story matched.
--   2. For Oregon the stored query was literally
--        "Redmond city" OR data center OR rezoning OR zoning OR moratorium
--      — the state abbreviation became the OR operator. (Same trap for IN.)
--   3. The Census LSAD suffix ("Acworth city") is not news language, so true
--      local hits were suppressed.
--
-- ROWS: ${rows.length} (${composition})
-- SAFETY: source_key is never touched. The previous query is preserved at
-- fetch_config.query_v1 and fetch_config.query_rev is set to 2, so the rewrite
-- is idempotent and reversible (docs/far-88/rollback.sql).
-- SCOPE: these rows are scope='query_feed', countable=false — this migration
-- cannot change any published count or confidence grade.

begin;

create temporary table _fdy88_local_queries (
  source_key text primary key,
  new_query  text not null
) on commit drop;

insert into _fdy88_local_queries (source_key, new_query) values
${values};

-- Guard: the generated set must match production exactly before anything is written.
do $guard$
declare
  n_generated int;
  n_live      int;
  n_missing   int;
  n_unplanned int;
begin
  select count(*) into n_generated from _fdy88_local_queries;
  select count(*) into n_live from public.source_registry where source_key like 'gsearch:loc-%';
  select count(*) into n_missing from _fdy88_local_queries q
    where not exists (select 1 from public.source_registry sr where sr.source_key = q.source_key);
  select count(*) into n_unplanned from public.source_registry sr
    where sr.source_key like 'gsearch:loc-%'
      and not exists (select 1 from _fdy88_local_queries q where q.source_key = sr.source_key);
  if n_generated <> ${rows.length} then
    raise exception 'FDY-88: expected ${rows.length} generated rows, got %', n_generated;
  end if;
  if n_live <> ${rows.length} then
    raise exception 'FDY-88: expected ${rows.length} live gsearch:loc-%% rows, got % — re-run the generator against a fresh roster snapshot', n_live;
  end if;
  if n_missing <> 0 then
    raise exception 'FDY-88: % generated source_keys are absent from source_registry', n_missing;
  end if;
  if n_unplanned <> 0 then
    raise exception 'FDY-88: % live gsearch:loc-%% rows have no generated query', n_unplanned;
  end if;
end
$guard$;

update public.source_registry sr
set fetch_config =
      jsonb_set(
        jsonb_set(
          case
            when sr.fetch_config ? 'query_v1' then sr.fetch_config
            else jsonb_set(sr.fetch_config, '{query_v1}',
                           coalesce(sr.fetch_config -> 'query', 'null'::jsonb), true)
          end,
          '{query}', to_jsonb(q.new_query), true),
        '{query_rev}', to_jsonb(2), true),
    feed_url = 'https://news.google.com/rss/search?q=' || public.gsearch_seed_url(q.new_query)
               || '&hl=en-US&gl=US&ceid=US:en',
    url      = 'https://news.google.com/search?q=' || public.gsearch_seed_url(q.new_query),
    updated_at = now()
from _fdy88_local_queries q
where sr.source_key = q.source_key;

-- Verify: every row rewritten, every old query preserved, no bare top-level OR left.
do $verify$
declare
  n_rev int;
  n_v1  int;
  n_bad int;
begin
  select count(*) into n_rev from public.source_registry
    where source_key like 'gsearch:loc-%' and fetch_config ->> 'query_rev' = '2';
  select count(*) into n_v1 from public.source_registry
    where source_key like 'gsearch:loc-%' and fetch_config ? 'query_v1';
  -- Strip every (…) group, then look for a surviving bare OR: that is exactly
  -- the top-level alternation the v1 queries had. The generated queries are
  -- single-level, so one pass of the regexp removes all groups.
  select count(*) into n_bad from public.source_registry
    where source_key like 'gsearch:loc-%'
      and regexp_replace(fetch_config ->> 'query', '\\([^()]*\\)', ' ', 'g')
          ~ '(^|[^A-Za-z])OR([^A-Za-z]|$)';
  if n_rev <> ${rows.length} then
    raise exception 'FDY-88: expected ${rows.length} rows at query_rev=2, got %', n_rev;
  end if;
  if n_v1 <> ${rows.length} then
    raise exception 'FDY-88: expected ${rows.length} rows with query_v1, got %', n_v1;
  end if;
  if n_bad <> 0 then
    raise exception 'FDY-88: % rewritten queries still contain an unparenthesised OR', n_bad;
  end if;
end
$verify$;

commit;
`;
}

function main() {
  const args = process.argv.slice(2);
  const rows = planRows(readEntities());

  if (rows.length !== EXPECTED_ROWS) {
    throw new Error(`roster drift: expected ${EXPECTED_ROWS} rows, snapshot has ${rows.length}`);
  }
  const counts = {};
  for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  for (const [kind, n] of Object.entries(EXPECTED_KINDS)) {
    if (counts[kind] !== n) {
      throw new Error(`roster drift: expected ${n} ${kind} rows, snapshot has ${counts[kind] ?? 0}`);
    }
  }

  const sql = renderMigration(rows);
  if (args.includes("--stdout")) {
    process.stdout.write(sql);
    return;
  }
  if (args.includes("--check")) {
    const current = readFileSync(MIGRATION, "utf8");
    if (current !== sql) {
      console.error("MIGRATION OUT OF DATE — run: node scripts/gen-local-watch-query-migration.mjs");
      process.exit(1);
    }
    console.log(`ok: migration is current (${rows.length} rows)`);
    return;
  }
  writeFileSync(MIGRATION, sql);
  console.log(`wrote ${MIGRATION} (${rows.length} rows)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
