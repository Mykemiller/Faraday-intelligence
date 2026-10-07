#!/usr/bin/env node
// check-local-watch-precision.mjs — FDY-88 precision check.
//
// For a sample of local-gov jurisdictions, fetches the OLD (v1) and NEW (v2)
// Google News RSS feeds and reports what share of returned items actually name
// the jurisdiction (the `named` attribution flag the poller now records).
//
// Usage:
//   node scripts/check-local-watch-precision.mjs --live              # fetch news.google.com
//   node scripts/check-local-watch-precision.mjs --fixtures <dir>    # replay saved feeds
//   node scripts/check-local-watch-precision.mjs --live --save <dir> # fetch and save
//   …--json <file>   also write the machine-readable result
//
// Politeness: strictly serial, >= 1 request/second, honest user agent (the same
// UA string the source-poller sends). Read-only — this script writes nothing to
// any database and never applies a migration.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildLocalQuery,
  buildLocalQueryV1,
  googleNewsFeedUrl,
  localAttribution,
  localJurisdictionFromEntity,
} from "../supabase/functions/source-poller/local-query.ts";
import { parseFeed } from "../supabase/functions/source-poller/poller-pure.ts";

const UA = "FaradayIntelligenceBot/1.0 (+https://faraday-intelligence.ai; data-source poller)";
const MIN_INTERVAL_MS = 1100;

/** The sample the issue specifies: 10 places, 6 counties, 4 townships, including
 * the four named cases. Township rows do NOT exist in the live lane (waves 6a /
 * 8b selected level in ('county','place') only) — they are measured anyway so
 * the L6 township expansion inherits a number. Cobb County GA is likewise not a
 * live source row; it is measured because the issue names it. */
export const SAMPLE = [
  // places (10)
  "Redmond city, OR",
  "Klamath Falls city, OR",
  "Acworth city, GA",
  "Normal town, IL",
  "Archbold village, OH",
  "Forrest City city, AR",
  "Mableton city, GA",
  "New Carlisle city, IN",
  "Cedar Rapids city, IA",
  "Bend city, OR",
  // counties / parishes (6)
  "Cobb County, GA",
  "Loudoun County, VA",
  "Prince William County, VA",
  "Assumption Parish, LA",
  "Multnomah County, OR",
  "Hamilton County, IN",
  // townships (4) — not in the live lane; builder coverage for L6
  "Allendale charter township, MI",
  "Bloomfield township, MI",
  "Saline township, MI",
  "Howell township, NJ",
];

let lastFetch = 0;
async function politeFetch(url) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, body: "" };
    return { ok: true, status: res.status, body: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, body: "", error: String(e) };
  } finally {
    clearTimeout(t);
  }
}

const slug = (entity, rev) => `${entity.replace(/[^A-Za-z0-9]+/g, "_")}.${rev}.xml`;

/** Measure one feed body.
 *
 * TWO numbers, because they answer different questions:
 *  - title_named / title_pct: the issue's metric — does the HEADLINE name the
 *    jurisdiction. Strict, and the fairest apples-to-apples old-vs-new figure.
 *  - named / pct: the poller's attribution flag — headline OR RSS description.
 *
 * Both UNDER-count v2 on purpose. A v2 query requires the jurisdiction name in
 * the document, so every returned item provably contains it somewhere; an
 * 'unmatched' v2 item usually just means the name is not in the ~200-character
 * snippet Google returns. A v1 'unmatched' item, by contrast, often does not
 * mention the jurisdiction anywhere at all — it matched a bare `zoning`. */
export function measure(body, jur) {
  const items = parseFeed(body, 100);
  const named = items.filter((it) => localAttribution(it, jur) === "named");
  const titleNamed = items.filter((it) => localAttribution({ title: it.title }, jur) === "named");
  return {
    items: items.length,
    named: named.length,
    pct: items.length ? Math.round((named.length / items.length) * 1000) / 10 : null,
    title_named: titleNamed.length,
    title_pct: items.length ? Math.round((titleNamed.length / items.length) * 1000) / 10 : null,
    sample_named: named.slice(0, 2).map((i) => i.title),
    sample_unmatched: items
      .filter((it) => localAttribution(it, jur) !== "named")
      .slice(0, 3)
      .map((i) => i.title),
  };
}

async function body(entity, rev, query, { live, fixtures, save }) {
  if (fixtures) {
    try {
      return { ok: true, body: readFileSync(resolve(fixtures, slug(entity, rev)), "utf8") };
    } catch (e) {
      return { ok: false, body: "", error: `fixture missing: ${String(e)}` };
    }
  }
  if (!live) return { ok: false, body: "", error: "neither --live nor --fixtures given" };
  const r = await politeFetch(googleNewsFeedUrl(query));
  if (r.ok && save) {
    mkdirSync(save, { recursive: true });
    writeFileSync(resolve(save, slug(entity, rev)), r.body);
  }
  return r;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const mode = {
    live: args.includes("--live"),
    fixtures: opt("--fixtures"),
    save: opt("--save"),
  };
  const jsonOut = opt("--json");

  const results = [];
  for (const entity of SAMPLE) {
    const jur = localJurisdictionFromEntity(entity);
    const v1 = buildLocalQueryV1(jur);
    const v2 = buildLocalQuery(jur);
    const oldFeed = await body(entity, "v1", v1, mode);
    const newFeed = await body(entity, "v2", v2, mode);
    results.push({
      entity,
      query_v1: v1,
      query_v2: v2,
      old: oldFeed.ok ? measure(oldFeed.body, jur) : { error: oldFeed.error ?? `http ${oldFeed.status}` },
      new: newFeed.ok ? measure(newFeed.body, jur) : { error: newFeed.error ?? `http ${newFeed.status}` },
    });
    const o = results.at(-1).old;
    const n = results.at(-1).new;
    const cell = (m) =>
      `${String(m.title_named ?? "-").padStart(3)}/${String(m.items ?? "-").padEnd(3)} ` +
      `(${m.title_pct ?? m.error ?? "-"}% title, ${m.pct ?? "-"}% any)`;
    console.log(`${entity.padEnd(32)} old ${cell(o)}   new ${cell(n)}`);
  }

  const sum = (k, f) => results.reduce((a, r) => a + (r[k][f] ?? 0), 0);
  const side = (k) => {
    const items = sum(k, "items");
    const named = sum(k, "named");
    const titleNamed = sum(k, "title_named");
    return {
      items,
      named,
      pct: items ? Math.round((named / items) * 1000) / 10 : null,
      title_named: titleNamed,
      title_pct: items ? Math.round((titleNamed / items) * 1000) / 10 : null,
      feeds_at_the_100_item_cap: results.filter((r) => r[k].items === 100).length,
      empty_feeds: results.filter((r) => r[k].items === 0).length,
    };
  };
  const summary = {
    mode: mode.fixtures ? "fixtures" : "live",
    measured_at: new Date().toISOString(),
    jurisdictions: results.length,
    old: side("old"),
    new: side("new"),
  };
  console.log(
    `\nTOTAL  old ${summary.old.title_named}/${summary.old.items} titles (${summary.old.title_pct}%), ` +
      `${summary.old.pct}% any, ${summary.old.feeds_at_the_100_item_cap} feeds at the 100-item cap` +
      `\n       new ${summary.new.title_named}/${summary.new.items} titles (${summary.new.title_pct}%), ` +
      `${summary.new.pct}% any, ${summary.new.feeds_at_the_100_item_cap} feeds at the 100-item cap`,
  );
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ summary, results }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
