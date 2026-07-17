// source-poller — CC-SOURCE-SCALE-500 Wave 1 (AUTO-199, FAR-368)
// Registry-driven feed verifier + poller over source_registry (subsystem='poller').
//
// Modes (POST JSON):
//   {mode:"status"}                       — counts + recent run summary (no writes)
//   {mode:"verify", limit?, source_key?}  — probe/discover feed URLs for registered
//                                           sources; activate license-cleared ones
//   {mode:"run", limit?, source_key?}     — poll active sources → artifacts
//                                           (content_hash dedupe), refresh countable
//
// Auth: fcron house token (SHA-256 compare — census-backfill pattern, no plaintext
// constant) or the service-role key. verify_jwt=false.
//
// Boundaries: writes ONLY source_registry (own subsystem='poller' rows),
// artifacts (insert, dedup on content_hash), automation_health_log. Never touches
// scoring tables. Gated/restrictive-tos sources are probed for reachability but
// NEVER activated and NEVER countable — activation requires license_status in
// ('cleared','attribution_required').

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyFeed,
  discoverCandidates,
  extractAlternateLinks,
  parseFeed,
  toIso,
} from "./poller-pure.ts";
import { jsonFetchUrl, parseJsonSource } from "./poller-json.ts";
import { extractIndexItems, type IndexPollConfig } from "./poller-index.ts";

const CRAWLER_ID = "source-poller_v1.2"; // v1.1 JSON-API adapters · v1.2 index-poll
const AUTO_ID = "AUTO-199";
const UA = "FaradayIntelligenceBot/1.0 (+https://faraday-intelligence.ai; data-source poller)";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const WALL_BUDGET_MS = 95_000;
const FETCH_TIMEOUT_MS = 8_000;
const ACTIVATABLE = ["cleared", "attribution_required"];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const envToken = Deno.env.get("CRON_TOKEN");
  if (envToken && token === envToken) return true;
  return (await sha256hex(token)) === CRON_TOKEN_FALLBACK_SHA256;
}

async function fetchWithTimeout(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.5, */*;q=0.1", ...headers },
      redirect: "follow",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

interface SourceRow {
  source_key: string;
  name: string;
  url: string;
  feed_url: string | null;
  access_method: string;
  license: string;
  license_status: string;
  idf_domains: string[];
  cadence: string;
  status: string;
  countable: boolean;
  fetch_config: Record<string, unknown>;
  etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
}

const SOURCE_COLS =
  "source_key,name,url,feed_url,access_method,license,license_status,idf_domains,cadence,status,countable,fetch_config,etag,last_modified,consecutive_failures";

// ---------- verify ----------

async function verifyOne(src: SourceRow): Promise<{ ok: boolean; detail: string }> {
  const tried: string[] = [];
  let candidates = discoverCandidates(src.url, src.feed_url);
  // Feed autodiscovery from the homepage HTML (once), appended after direct probes.
  let htmlChecked = false;
  // Kept for the Wave-3 index-poll fallback when no feed is found.
  let indexHtml: string | null = null;
  let indexUrl: string | null = null;
  for (let i = 0; i < candidates.length && tried.length < 8; i++) {
    const cand = candidates[i];
    tried.push(cand);
    let res: Response;
    try {
      // Probe via the windowed URL for JSON APIs whose bare endpoint is huge
      // (NVD full corpus, NWS historical firehose) — cand stays the stored URL.
      res = await fetchWithTimeout(jsonFetchUrl(src.source_key, cand, Date.now()));
    } catch {
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    const body = (await res.text()).slice(0, 500_000);
    const kind = classifyFeed(res.headers.get("content-type"), body);
    if (kind) {
      const items = kind === "json" ? [] : parseFeed(body, 5);
      if (kind !== "json" && items.length === 0) continue; // parseable shell, no items
      const activate = ACTIVATABLE.includes(src.license_status);
      const { error: upErr } = await supabase
        .from("source_registry")
        .update({
          feed_url: cand,
          access_method: kind === "json" ? "json_api" : "rss",
          status: activate ? "active" : src.status,
          consecutive_failures: 0,
          fetch_config: {
            ...src.fetch_config,
            verified_at: new Date().toISOString(),
            verify_kind: kind,
            verify_fail_count: 0,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("source_key", src.source_key);
      if (upErr) return { ok: false, detail: `db update failed: ${upErr.message.slice(0, 150)}` };
      return { ok: true, detail: `${kind} @ ${cand}${activate ? " (activated)" : " (verified, not activatable: " + src.license_status + ")"}` };
    }
    // If we got HTML back on the first (homepage-ish) candidate, mine it for
    // rel=alternate feed links and append them to the probe list.
    if (!htmlChecked && /<html/i.test(body.slice(0, 1000))) {
      htmlChecked = true;
      indexHtml = body;
      indexUrl = cand;
      const alts = extractAlternateLinks(body, cand).filter((u) => !candidates.includes(u));
      candidates = [...candidates.slice(0, i + 1), ...alts, ...candidates.slice(i + 1)];
    }
  }
  // Wave-3 fallback: no feed anywhere, but we hold the index page's HTML —
  // try heuristic article-link extraction and activate as an index_poll source.
  if (indexHtml && indexUrl) {
    const cfg = (src.fetch_config?.index_poll ?? {}) as IndexPollConfig;
    const links = extractIndexItems(indexHtml, indexUrl, cfg);
    if (links.length >= (cfg.min_items ?? 8)) {
      const activate = ACTIVATABLE.includes(src.license_status);
      // access_method vocabulary is CHECK-constrained — 'html' is the allowed
      // value; verify_kind='index' marks the index-poll pipeline.
      const { error: upErr } = await supabase
        .from("source_registry")
        .update({
          feed_url: indexUrl,
          access_method: "html",
          status: activate ? "active" : src.status,
          consecutive_failures: 0,
          fetch_config: {
            ...src.fetch_config,
            verified_at: new Date().toISOString(),
            verify_kind: "index",
            verify_fail_count: 0,
            index_sample: links[0]?.link,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("source_key", src.source_key);
      if (upErr) return { ok: false, detail: `db update failed: ${upErr.message.slice(0, 150)}` };
      return { ok: true, detail: `index @ ${indexUrl} (${links.length} links)${activate ? " (activated)" : ""}` };
    }
  }
  const failCount = (Number(src.fetch_config?.verify_fail_count) || 0) + 1;
  await supabase
    .from("source_registry")
    .update({
      status: failCount >= 3 && src.status === "registered" ? "error" : src.status,
      fetch_config: {
        ...src.fetch_config,
        verify_last_at: new Date().toISOString(),
        verify_fail_count: failCount,
        verify_error: `no feed among ${tried.length} candidates`,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("source_key", src.source_key);
  return { ok: false, detail: `no feed (${tried.length} tried)` };
}

// ---------- run (poll) ----------

async function pollOne(src: SourceRow): Promise<{ found: number; inserted: number; note: string }> {
  const nowIso = new Date().toISOString();
  const headers: Record<string, string> = {};
  if (src.etag) headers["if-none-match"] = src.etag;
  if (src.last_modified) headers["if-modified-since"] = src.last_modified;
  const fetchUrl = jsonFetchUrl(src.source_key, src.feed_url!, Date.now());
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchUrl, headers);
  } catch (e) {
    await bumpFailure(src, `fetch error: ${String(e).slice(0, 200)}`);
    return { found: 0, inserted: 0, note: "fetch error" };
  }
  if (res.status === 304) {
    await res.body?.cancel();
    await supabase
      .from("source_registry")
      .update({ last_fetch_at: nowIso, last_ok_at: nowIso, consecutive_failures: 0, updated_at: nowIso })
      .eq("source_key", src.source_key);
    return { found: 0, inserted: 0, note: "304" };
  }
  if (!res.ok) {
    await res.body?.cancel();
    await bumpFailure(src, `http ${res.status}`);
    return { found: 0, inserted: 0, note: `http ${res.status}` };
  }
  // JSON APIs can be multi-MB (CISA KEV ~8MB) and must not be truncated
  // mid-document; markup feeds stay tightly capped.
  const isJsonCt = (res.headers.get("content-type") ?? "").toLowerCase().includes("json");
  const body = (await res.text()).slice(0, isJsonCt ? 15_000_000 : 1_500_000);
  const kind = classifyFeed(res.headers.get("content-type"), body);
  let items;
  if (src.access_method === "html") {
    // Wave-3: heuristic article-link extraction from the index page
    // (access_method 'html' + verify_kind 'index'). Config overrides in
    // fetch_config.index_poll (data, no redeploy).
    items = extractIndexItems(body, fetchUrl, (src.fetch_config?.index_poll ?? {}) as IndexPollConfig);
  } else if (kind === "json") {
    // Wave-2 adapters: named (KEV/NVD/GCP-status/NWS) + shape-detected
    // (JSON Feed spec, statuspage summary). No adapter → healthy no-op.
    items = parseJsonSource(src.source_key, body, 50);
    if (items === null) {
      await supabase
        .from("source_registry")
        .update({ last_fetch_at: nowIso, last_ok_at: nowIso, consecutive_failures: 0, updated_at: nowIso })
        .eq("source_key", src.source_key);
      return { found: 0, inserted: 0, note: "json (adapter pending)" };
    }
  } else if (!kind) {
    await supabase
      .from("source_registry")
      .update({ last_fetch_at: nowIso, consecutive_failures: 0, updated_at: nowIso })
      .eq("source_key", src.source_key);
    return { found: 0, inserted: 0, note: "not a feed" };
  } else {
    items = parseFeed(body, 50);
  }
  const rows = [];
  for (const it of items) {
    const idKey = `${src.source_key}|${it.link ?? it.title}`;
    const contentHash = await sha256hex(idKey);
    const raw = `${it.title}\n\n${it.summary}`.trim();
    rows.push({
      crawler_id: CRAWLER_ID,
      auto_id: AUTO_ID,
      source_type: "web_news",
      source_url: it.link ?? src.feed_url,
      published_at: toIso(it.published),
      raw_content: raw || it.title || "(no content)",
      content_hash: contentHash,
      // content_length is a GENERATED column — never supply it
      signal_envelope: {
        source_key: src.source_key,
        source_name: src.name,
        idf_domains: src.idf_domains,
        license: src.license,
        license_status: src.license_status,
        confidence_cap: "SRC",
      },
      crawl_metadata: { feed_url: src.feed_url, mode: "poller", fetched_at: nowIso },
    });
  }
  let inserted = 0;
  if (rows.length) {
    const { data, error } = await supabase
      .from("artifacts")
      .upsert(rows, { onConflict: "content_hash", ignoreDuplicates: true })
      .select("artifact_id");
    if (error) {
      await bumpFailure(src, `insert error: ${error.message.slice(0, 200)}`);
      return { found: rows.length, inserted: 0, note: "insert error" };
    }
    inserted = data?.length ?? 0;
  }
  await supabase
    .from("source_registry")
    .update({
      last_fetch_at: nowIso,
      last_ok_at: nowIso,
      ...(inserted > 0 ? { last_artifact_at: nowIso } : {}),
      etag: res.headers.get("etag"),
      last_modified: res.headers.get("last-modified"),
      consecutive_failures: 0,
      updated_at: nowIso,
    })
    .eq("source_key", src.source_key);
  return { found: items.length, inserted, note: "ok" };
}

async function bumpFailure(src: SourceRow, err: string) {
  const fails = src.consecutive_failures + 1;
  await supabase
    .from("source_registry")
    .update({
      last_fetch_at: new Date().toISOString(),
      consecutive_failures: fails,
      status: fails >= 5 ? "error" : src.status,
      fetch_config: { ...src.fetch_config, last_error: err },
      updated_at: new Date().toISOString(),
    })
    .eq("source_key", src.source_key);
}

/** R1 countable maintenance: active + license-clear + artifact in trailing 30d.
 * Query-lane rows (scope='query_feed' — Google News searches etc.) are ingested
 * like any source but NEVER countable: R1 excludes search queries from the
 * marketed source count. */
async function refreshCountable() {
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  await supabase
    .from("source_registry")
    .update({ countable: true })
    .eq("subsystem", "poller")
    .eq("status", "active")
    .in("license_status", ACTIVATABLE)
    .gte("last_artifact_at", cutoff)
    .eq("countable", false)
    .is("scope", null);
  await supabase
    .from("source_registry")
    .update({ countable: false })
    .eq("subsystem", "poller")
    .eq("countable", true)
    .or(`last_artifact_at.lt.${cutoff},last_artifact_at.is.null`);
}

// ---------- handler ----------

Deno.serve(async (req: Request) => {
  if (!(await authorized(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const started = Date.now();
  const startedIso = new Date().toISOString();
  let bodyIn: Record<string, unknown> = {};
  try {
    bodyIn = await req.json();
  } catch {
    /* default status */
  }
  const mode = String(bodyIn.mode ?? "status");
  const limit = Math.min(Number(bodyIn.limit ?? 40), 150);

  if (mode === "status") {
    const { data } = await supabase
      .from("source_registry")
      .select("status,countable,license_status")
      .eq("subsystem", "poller");
    const counts: Record<string, number> = {};
    let countable = 0;
    for (const r of data ?? []) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      if (r.countable) countable++;
    }
    return new Response(JSON.stringify({ ok: true, mode, poller_sources: data?.length ?? 0, by_status: counts, countable }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (mode !== "verify" && mode !== "run") {
    return new Response(JSON.stringify({ error: `unknown mode '${mode}'` }), { status: 400, headers: { "content-type": "application/json" } });
  }

  let q = supabase.from("source_registry").select(SOURCE_COLS).eq("subsystem", "poller").limit(limit);
  if (bodyIn.source_key) q = q.eq("source_key", String(bodyIn.source_key));
  else if (mode === "verify") {
    // registered rows not yet verified, oldest attempt first (resume-safe)
    q = q.eq("status", "registered").order("updated_at", { ascending: true });
  } else {
    q = q.eq("status", "active").not("feed_url", "is", null).order("last_fetch_at", { ascending: true, nullsFirst: true });
  }
  const { data: sources, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "content-type": "application/json" } });
  }

  const results: Record<string, string> = {};
  let processed = 0, okCount = 0, found = 0, inserted = 0;
  const errors: unknown[] = [];
  for (const src of (sources ?? []) as unknown as SourceRow[]) {
    if (Date.now() - started > WALL_BUDGET_MS) break;
    processed++;
    try {
      if (mode === "verify") {
        const r = await verifyOne(src);
        if (r.ok) okCount++;
        results[src.source_key] = r.detail;
      } else {
        const r = await pollOne(src);
        okCount += r.note === "ok" || r.note === "304" ? 1 : 0;
        found += r.found;
        inserted += r.inserted;
        results[src.source_key] = `${r.note} found=${r.found} new=${r.inserted}`;
      }
    } catch (e) {
      errors.push({ source_key: src.source_key, error: String(e).slice(0, 300) });
      results[src.source_key] = "exception";
    }
  }

  if (mode === "run") await refreshCountable();

  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID,
    crawler_id: CRAWLER_ID,
    run_started_at: startedIso,
    run_completed_at: new Date().toISOString(),
    artifacts_found: found,
    artifacts_new: inserted,
    artifacts_duped: Math.max(0, found - inserted),
    errors,
    success: errors.length === 0,
    notes: `mode=${mode} processed=${processed}/${sources?.length ?? 0} ok=${okCount}`,
  });

  return new Response(
    JSON.stringify({ ok: true, mode, processed, of: sources?.length ?? 0, verified_or_polled_ok: okCount, artifacts_found: found, artifacts_new: inserted, results }),
    { headers: { "content-type": "application/json" } },
  );
});
