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
import { isRelevant } from "./poller-relevance.ts";
import { localAttribution, localJurisdictionFromEntity } from "./local-query.ts";
import {
  type DueRow,
  hostDelayMs,
  hostOf,
  MIN_HOST_GAP_MS,
  SEGMENT_FLOORS,
  selectDueFair,
} from "./poller-schedule.ts";

// NOTE (FDY-88 + FDY-89, conflict resolved by the orchestrator): FDY-88 pinned
// CRAWLER_ID at v1.3 on the grounds that the deployed function was five
// versions ahead of this file (measured read-only 2026-10-07: v1.3 257,173 ·
// v1.4 30,541 · v1.5 158,817 · v1.6 236 · v1.8 57,943), so any id this repo
// invented would collide with existing provenance. FDY-89 then PORTED v1.4
// through v1.8 into this repo, each pinned by a test, which removes that
// premise: the file now genuinely represents the deployed lineage, so the bump
// to v1.9 is correct and is kept. FDY-88's per-item attribution version is
// retained independently as crawl_metadata.attribution_rev, so attribution
// provenance stays readable without depending on CRAWLER_ID.
// `isDue` is no longer imported: FDY-89's selectDueFair subsumes it.
const CRAWLER_ID = "source-poller_v1.9"; // v1.2 index-poll · v1.3 cadence-aware + relevance gate · v1.4 canonical envelope keys (CC-INGEST-METADATA-EXTRACTION-1.0) · v1.5 publisher attribution from feed <source> (CC-PUBLISHER-ATTRIBUTION-1.0) · v1.6 empty query-lane feed is valid + cadence-priority selection (CC-PILLAR-FEED-COVERAGE-1.0) · v1.7 query-lane probes the canonical feed_url only + transient failures don't count toward the 3-strike error (verify lane) · v1.8 same transient guard on the RUN lane's 5-strike ladder · v1.9 FAIR due-selection (FDY-89): v1.6's priority-pool concatenation is superseded by overdue-ratio ranking + a local_gov floor
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
  // v1.9: at most one request per second per host (news.google.com is ONE host).
  await politeWait(url);
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
  scope: string | null;
  fetch_config: Record<string, unknown>;
  last_fetch_at: string | null;
  created_at: string | null;
  etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
}

const SOURCE_COLS =
  "source_key,name,url,feed_url,access_method,license,license_status,idf_domains,cadence,status,countable,scope,fetch_config,etag,last_modified,last_fetch_at,created_at,consecutive_failures";

/** v1.9 (FDY-89): the SECURITY DEFINER selector shipped by migration
 * 20261009210000. It sees every active row — not a 320-row window — so it can
 * rank by overdue ratio and hold the local_gov floor. When the migration has
 * not been applied yet the run lane falls back to selectDueFair() over a
 * multi-window candidate set, which is the same spec computed client-side. */
const SELECT_DUE_RPC = "poller_select_due";

/** Per-host politeness gate. The gsearch query lane is ~9,000 rows all on the
 * single host news.google.com, so without this the fairer selection would turn
 * into a burst against an upstream that already answers 429 under load. */
const hostLastRequestAt = new Map<string, number>();

async function politeWait(url: string): Promise<void> {
  const host = hostOf(url);
  if (!host) return;
  const wait = hostDelayMs(hostLastRequestAt, host, Date.now(), MIN_HOST_GAP_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  hostLastRequestAt.set(host, Date.now());
}

function toDueRow(r: SourceRow): DueRow {
  return {
    source_key: r.source_key,
    cadence: r.cadence,
    last_fetch_at: r.last_fetch_at,
    segment: (r.fetch_config?.segment as string | undefined) ?? null,
    created_at: r.created_at,
  };
}

// ---------- verify ----------

async function verifyOne(src: SourceRow): Promise<{ ok: boolean; detail: string }> {
  const tried: string[] = [];
  let candidates = discoverCandidates(src.url, src.feed_url);
  // v1.7: a query-lane source's feed_url IS canonical — a Google News RSS search
  // URL has no "/feed/" or "/rss.xml" variant to discover, so the 8-candidate
  // suffix walk is pure waste. Worse, against a rate-limiting upstream it turns
  // ONE throttled request into EIGHT. That is what stalled the 2026-09-06 re-arm
  // drain: verify managed 5 sources in 113s and failed every one with "no feed
  // among 8 candidates" while those same feed_urls answered HTTP 200 from a
  // different egress. Probe the canonical URL only, and fail fast.
  if (src.scope === "query_feed" && src.feed_url) candidates = [src.feed_url];
  // Set when a probe fails in a way that says nothing about the feed's validity
  // (timeout, or a retryable upstream status). Such a run must NOT count toward
  // the 3-strike -> status='error' transition, which is a terminal dead-end:
  // verify only re-probes status='registered', so a throttled afternoon would
  // permanently strand healthy sources.
  let transient = false;
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
      // Abort/timeout/DNS — infrastructure, not evidence about the feed.
      transient = true;
      continue;
    }
    if (!res.ok) {
      // 408/425/429 and 5xx are "come back later", not "this is not a feed".
      // v1.8: shared with the run lane via isTransientStatus so the two lanes
      // cannot drift apart on what counts as transient.
      if (isTransientStatus(res.status)) transient = true;
      await res.body?.cancel();
      continue;
    }
    const body = (await res.text()).slice(0, 500_000);
    const kind = classifyFeed(res.headers.get("content-type"), body);
    if (kind) {
      const items = kind === "json" ? [] : parseFeed(body, 5);
      // v1.6 (CC-PILLAR-FEED-COVERAGE-1.0): a well-formed QUERY-LANE feed with
      // zero items is a legitimate EMPTY RESULT SET, not a broken feed. Google
      // News answers 200 with a valid ~1.3KB RSS shell when a search currently
      // matches nothing. Treating that as a verification failure marked 2,638
      // healthy company/utility watches status='error' after 3 probes — and
      // verify only re-probes status='registered', so they became permanently
      // unreachable by BOTH verify and run: a terminal dead-end that silently
      // removed a third of the watch fleet. Curated (non-query) feeds keep the
      // stricter check, where an empty feed usually does mean a wrong URL.
      if (kind !== "json" && items.length === 0 && src.scope !== "query_feed") continue;
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
      const empty = kind !== "json" && items.length === 0 ? " (empty result set — valid)" : "";
      return { ok: true, detail: `${kind} @ ${cand}${empty}${activate ? " (activated)" : " (verified, not activatable: " + src.license_status + ")"}` };
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
  // v1.7: a transient run leaves the strike count untouched — the source stays
  // 'registered' and is simply re-probed later.
  const prevFail = Number(src.fetch_config?.verify_fail_count) || 0;
  const failCount = transient ? prevFail : prevFail + 1;
  await supabase
    .from("source_registry")
    .update({
      status: failCount >= 3 && src.status === "registered" ? "error" : src.status,
      fetch_config: {
        ...src.fetch_config,
        verify_last_at: new Date().toISOString(),
        verify_fail_count: failCount,
        verify_error: transient
          ? `transient: unreachable across ${tried.length} candidate(s) — not counted`
          : `no feed among ${tried.length} candidates`,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("source_key", src.source_key);
  return { ok: false, detail: `${transient ? "transient" : "no feed"} (${tried.length} tried)` };
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
    // Abort/timeout/DNS — infrastructure, not evidence about the feed.
    await bumpFailure(src, `fetch error: ${String(e).slice(0, 200)}`, true);
    return { found: 0, inserted: 0, note: "fetch error (transient)" };
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
    const transient = isTransientStatus(res.status);
    await bumpFailure(src, `http ${res.status}`, transient);
    return { found: 0, inserted: 0, note: `http ${res.status}${transient ? " (transient)" : ""}` };
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
  let gated = 0;
  let attributed = 0;
  // FDY-88: local-gov watch sources carry a named jurisdiction. Flag each item
  // 'named' or 'unmatched' so a diluted feed is measurable. Nothing is dropped
  // and no already-stored artifact is touched.
  const locJur =
    src.fetch_config?.segment === "local_gov"
      ? localJurisdictionFromEntity(String(src.fetch_config?.entity ?? ""))
      : null;
  for (const it of items) {
    const idKey = `${src.source_key}|${it.link ?? it.title}`;
    const contentHash = await sha256hex(idKey);
    const raw = `${it.title}\n\n${it.summary}`.trim();
    // v1.3 relevance gate: query-lane noise is stored for audit but never
    // sent to the enrichment LLM. Curated feeds are always relevant.
    const skip = src.scope === "query_feed" && !isRelevant(it);
    if (skip) gated++;
    // v1.5 (CC-PUBLISHER-ATTRIBUTION-1.0): the feed item's own <source> element,
    // when present, names the actual publication. This is what makes a Google
    // News redirect link citable — the link itself cannot be resolved to a
    // canonical publisher URL from our egress (batchexecute answers 429 +
    // reCAPTCHA), but the publisher is stated in the feed and needs no fetch.
    const publisher = it.publisher ?? null;
    const publisherHome = it.publisherHome ?? null;
    if (publisher) attributed++;
    rows.push({
      crawler_id: CRAWLER_ID,
      auto_id: AUTO_ID,
      source_type: "web_news",
      enrich_status: skip ? "skipped" : "pending",
      source_url: it.link ?? src.feed_url,
      published_at: toIso(it.published),
      raw_content: raw || it.title || "(no content)",
      content_hash: contentHash,
      // content_length is a GENERATED column — never supply it
      signal_envelope: {
        // v1.4 canonical keys (CC-INGEST-METADATA-EXTRACTION-1.0): title is the
        // item's own headline, summary its feed summary. `source` is the
        // publisher name. For query-lane sources (Google News searches) the
        // registry name is the search query, not a publication — so `source` is
        // written ONLY from the item's own <source> element (v1.5), never from
        // the registry name. Manufacturing that attribution is the exact failure
        // the citability rule exists to prevent.
        ...(it.title ? { title: it.title } : {}),
        ...(it.summary ? { summary: it.summary } : {}),
        ...(publisher ? { publisher } : {}),
        ...(publisherHome ? { publisher_home: publisherHome } : {}),
        ...(src.scope === "query_feed"
          ? (publisher ? { source: publisher } : {})
          : { source: publisher ?? src.name }),
        source_key: src.source_key,
        source_name: src.name,
        idf_domains: src.idf_domains,
        license: src.license,
        license_status: src.license_status,
        confidence_cap: "SRC",
      },
      crawl_metadata: {
        feed_url: src.feed_url,
        mode: "poller",
        fetched_at: nowIso,
        ...(locJur
          ? {
              attribution: localAttribution(it, locJur),
              attribution_entity: locJur.entity,
              attribution_rev: 1,
            }
          : {}),
      },
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
  const notes = [gated > 0 ? `gated=${gated}` : "", attributed > 0 ? `pub=${attributed}` : ""].filter(Boolean).join(" ");
  return { found: items.length, inserted, note: notes ? `ok ${notes}` : "ok" };
}

// v1.8: `transient` means the fetch told us nothing about the FEED — an abort,
// a timeout, or an upstream throttle (408/425/429/5xx). Those must not advance
// the 5-strike ladder, because status='error' is a DEAD END: verify only
// re-probes status='registered', so a throttled row becomes unreachable by both
// lanes. That is exactly how 2,638 healthy company/utility watches were lost.
// A real failure (404, a parse/insert error) still counts.
async function bumpFailure(src: SourceRow, err: string, transient = false) {
  const fails = transient ? src.consecutive_failures : src.consecutive_failures + 1;
  await supabase
    .from("source_registry")
    .update({
      last_fetch_at: new Date().toISOString(),
      consecutive_failures: fails,
      status: !transient && fails >= 5 ? "error" : src.status,
      fetch_config: {
        ...src.fetch_config,
        last_error: transient ? `transient (not counted): ${err}` : err,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("source_key", src.source_key);
}

/** HTTP statuses that say "come back later", not "this feed is broken". */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
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

  let fetched: Record<string, unknown>[] | null = null;
  let error: { message: string } | null = null;
  // v1.9: how the run lane's slots were awarded, echoed in the response and the
  // health log so starvation is visible without a query.
  let selection = "n/a";
  let lanes: Record<string, string> = {};

  if (bodyIn.source_key) {
    const r = await supabase.from("source_registry").select(SOURCE_COLS)
      .eq("subsystem", "poller").eq("source_key", String(bodyIn.source_key)).limit(limit);
    fetched = r.data as Record<string, unknown>[] | null;
    error = r.error;
  } else if (mode === "verify") {
    // registered rows not yet verified, oldest attempt first (resume-safe)
    const r = await supabase.from("source_registry").select(SOURCE_COLS)
      .eq("subsystem", "poller").eq("status", "registered")
      .order("updated_at", { ascending: true }).limit(limit);
    fetched = r.data as Record<string, unknown>[] | null;
    error = r.error;
  } else {
    // ---- v1.9 (FDY-89) FAIR DUE-SELECTION -------------------------------
    // Superseded: v1.3's "over-fetch 4x oldest-first, then filter to due" and
    // v1.6's "priority-cadence pool concatenated ahead of the general pool".
    // Both ranked by ABSOLUTE staleness (last_fetch_at ASC) and used isDue() as
    // a filter only, so the 1,312-row daily cohort — already ~1,566 due
    // events/day against the 1,920 slots/day the cron buys — took every slot
    // before the general pool was reached. Measured live 2026-10-07 by replaying
    // that selection read-only: 80/80 slots to daily segments, 0 to any weekly
    // segment, while 895 of 1,000 local_gov rows were due and 873 were >2x
    // overdue. The 7 hourly rows at 10x overdue lost too, to daily rows at 1.05x.
    //
    // Now: rank by overdue RATIO (now - due_at)/interval(cadence) across every
    // active row, with a per-run floor for named segments (local_gov >= 25%)
    // that spills when unused. Primary path is the SECURITY DEFINER selector
    // public.poller_select_due(int) (migration 20261009210000), which sees all
    // ~10.3k rows rather than a 320-row window.
    const rpc = await supabase.rpc(SELECT_DUE_RPC, { p_limit: limit });
    if (!rpc.error && Array.isArray(rpc.data)) {
      const keys = (rpc.data as { source_key: string; quota_lane: string }[]);
      for (const k of keys) lanes[k.source_key] = k.quota_lane;
      if (keys.length === 0) {
        fetched = [];
        selection = "rpc:poller_select_due (0 due)";
      } else {
        const r = await supabase.from("source_registry").select(SOURCE_COLS)
          .in("source_key", keys.map((k) => k.source_key));
        error = r.error;
        // Preserve the selector's overdue order — .in() returns rows unordered.
        const byKey = new Map((r.data ?? []).map((row) => [(row as unknown as SourceRow).source_key, row]));
        fetched = keys.map((k) => byKey.get(k.source_key)).filter(Boolean) as Record<string, unknown>[];
        selection = "rpc:poller_select_due";
      }
    } else {
      // Fallback: migration 20261009210000 not applied yet (or the role cannot
      // execute it). Same spec, computed client-side by selectDueFair() over a
      // union of candidate windows. Three windows rather than one because a
      // single `last_fetch_at ASC NULLS FIRST` window is exactly the bias being
      // fixed: measured 2026-10-07 the 320-row window was 320/320 never-fetched
      // rows, 273 of them one segment (utilities).
      const win = Math.max(limit * 4, 400);
      const base = () =>
        supabase.from("source_registry").select(SOURCE_COLS)
          .eq("subsystem", "poller").eq("status", "active").not("feed_url", "is", null)
          .order("last_fetch_at", { ascending: true, nullsFirst: true }).limit(win);
      const windows = await Promise.all([
        base(),                                                     // global stalest
        base().not("cadence", "in", "(weekly,archival_refresh,one_time)"), // short-cadence lanes
        ...Object.keys(SEGMENT_FLOORS).map((seg) =>                  // each floored segment
          base().eq("fetch_config->>segment", seg)),
      ]);
      error = windows.find((w) => w.error)?.error ?? null;
      const seen = new Set<string>();
      const candidates: SourceRow[] = [];
      for (const w of windows) {
        for (const row of (w.data ?? []) as unknown as SourceRow[]) {
          if (seen.has(row.source_key)) continue;
          seen.add(row.source_key);
          candidates.push(row);
        }
      }
      const picked = selectDueFair(candidates.map(toDueRow), { limit, nowMs: Date.now() });
      lanes = picked.lanes;
      const byKey = new Map(candidates.map((r) => [r.source_key, r]));
      fetched = picked.picked.map((d) => byKey.get(d.source_key)).filter(Boolean) as unknown as Record<string, unknown>[];
      selection = `fallback:selectDueFair (candidates=${candidates.length} due=${picked.dueTotal})`;
    }
  }

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "content-type": "application/json" } });
  }
  // Both run-lane paths return rows that are already due AND already capped at
  // `limit`, in overdue order. No further filtering or slicing here — doing that
  // is what let the order silently decide the outcome.
  const sources = fetched;

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
        okCount += r.note.startsWith("ok") || r.note === "304" ? 1 : 0;
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

  // Which lane won each processed slot — the starvation canary.
  const laneCounts: Record<string, number> = {};
  for (const src of (sources ?? []) as unknown as SourceRow[]) {
    const lane = lanes[src.source_key];
    if (lane) laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
  }

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
    notes: `mode=${mode} processed=${processed}/${sources?.length ?? 0} ok=${okCount} selection=${selection}${
      Object.keys(laneCounts).length ? " lanes=" + JSON.stringify(laneCounts) : ""
    }`,
  });

  return new Response(
    JSON.stringify({ ok: true, mode, selection, lanes: laneCounts, processed, of: sources?.length ?? 0, verified_or_polled_ok: okCount, artifacts_found: found, artifacts_new: inserted, results }),
    { headers: { "content-type": "application/json" } },
  );
});
