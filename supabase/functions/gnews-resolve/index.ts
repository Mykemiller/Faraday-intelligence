// gnews-resolve v1.0 — FDY-90.
//
// Turns Faraday's local-watch Google News artifacts into something usable
// downstream: resolves each news.google.com/rss/articles/<token> redirect to the
// publisher's article URL, then fetches the article body for the relevant subset
// through the SAME machinery the existing artifact-body-fetch lane uses.
//
// Modes (POST JSON, service-role or cron token):
//   {mode:"resolve", limit?}  claim → resolve token → write crawl_metadata.publisher_*
//   {mode:"fetch",   limit?}  claim resolved rows → robots → GET → extract → body_*
//   {mode:"status"}           lane config + measurement (read-only)
//
// WHY A SEPARATE FUNCTION AND NOT A NEW artifact-body-fetch LANE
// artifact_body_lane(source_type, source_url) is an IMMUTABLE two-argument
// predicate shared by the fetch claim, the embed claim and the measurement. A
// Google News row's source_url is the aggregator redirect, so the URL to fetch
// lives in crawl_metadata — unreachable from that signature. Widening it would
// change lane membership for rows already in flight on two live lanes. Instead
// this function owns its own claim RPCs and reuses everything that is already
// lane-generic: the artifact_body_fetch_lanes row (gnews_local), its lease,
// backoff, block streak and failure-rate stop, artifact_body_fetch_release,
// artifact_body_lane_stop, artifact_body_fetch_runs, and every extractor in
// body-pure.ts. No existing object changes behaviour.
//
// ROBOTS — READ THIS BEFORE ENABLING THE LANE
// news.google.com/robots.txt (fetched 2026-10-07) is, for User-agent: *,
// `Disallow: /` with a short Allow list covering only /, /home, /nwshp,
// /topics/, /publications/, /stories/, /swg/ and /about. It does NOT allow
// /rss/articles/ or /_/DotsSplashUi/. A strict reading therefore disallows the
// resolve step, so the lane carries a second, explicit gate:
// aggregator_robots_ack. Both fetch_enabled AND aggregator_robots_ack must be
// true before a single resolve request is made, and the lane ships with both
// false. This is Myke's call to make in one UPDATE, not a decision this code
// takes silently. (The pre-existing source-poller already fetches
// news.google.com/rss/search to obtain these feeds at all; that is out of
// FDY-90's scope and is not changed here.)
// The BODY fetch hits publisher hosts and honours their robots.txt
// unconditionally, through the same robotsAllows() the SEC/PUC lane uses.
//
// Politeness: honest User-Agent "Faraday/1.0 (+https://faraday-intelligence.ai;
// contact: signals@faraday-intelligence.ai)" from the lane row, >= 1 s between
// request STARTS per host (<= 1 req/s), sequential only, 403/429 => blocked and
// the invocation stops, three consecutive blocks disables the lane. No UA
// rotation, no proxies, no paywall circumvention.
//
// Writes: artifacts.crawl_metadata (six additive keys, via
// gnews_resolve_record), artifacts.body_* (via gnews_body_record),
// artifact_body_fetch_runs, artifact_body_fetch_lanes, automation_health_log.
// source_url, raw_content and signal_envelope are never written.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  EXTRACTOR_VERSION,
  hostOf,
  htmlToText,
  isBlockResponse,
  looksLikeHtml,
  MIN_BODY_CHARS,
  normalizeWhitespace,
  robotsAllows,
  truncateAtParagraph,
} from "../artifact-body-fetch/body-pure.ts";
import {
  GNEWS_RESOLVER_VERSION,
  GNEWS_USER_AGENT,
  resolveGnewsUrl,
} from "./gnews-pure.ts";
import {
  GNEWS_LANE,
  gnewsMetadataDelta,
  RESOLVE_MAX_ATTEMPTS,
} from "./gnews-store.ts";

const AUTO_ID = "AUTO-246"; // shares the body-fetch automation registry entry
const CRAWLER_ID = `gnews-resolve_v1.0+${GNEWS_RESOLVER_VERSION}`;
const BUDGET_MS = 130_000; // the gateway drops at 150s
const MAX_BYTES = 25_000_000;
const CRON_TOKEN_FALLBACK_SHA256 =
  "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceKey);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === serviceKey) return true;
  return (await sha256hex(token)) === CRON_TOKEN_FALLBACK_SHA256;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Lane {
  lane: string;
  fetch_enabled: boolean;
  user_agent: string;
  min_interval_ms: number;
  per_host_interval_ms: number;
  failure_rate_stop: number;
  failure_window_since: string | null;
  aggregator_robots_ack: boolean;
}

interface Counters {
  attempted: number;
  ok: number;
  failed: number;
  empty: number;
  blocked: number;
  skipped: number;
  truncated: number;
}

const newCounters = (): Counters => ({
  attempted: 0, ok: 0, failed: 0, empty: 0, blocked: 0, skipped: 0, truncated: 0,
});

// ---------------------------------------------------------------- resolve mode

interface ResolveRow {
  artifact_id: string;
  source_url: string;
  crawl_metadata: Record<string, unknown> | null;
  resolve_attempts: number;
}

async function runResolve(lane: Lane, limit: number, lease: number, deadline: number, errors: string[]) {
  const c = newCounters();
  let stopReason: string | null = null;
  let blockDetail: string | null = null;

  // Explicit robots acknowledgement for the aggregator host (see header).
  if (!lane.aggregator_robots_ack) {
    return { c, stopReason: "aggregator_robots_ack is false — see migration 20261009220000", released: null };
  }

  const { data, error } = await supabase.rpc("gnews_resolve_claim", {
    p_limit: limit,
    p_lease_seconds: lease,
  });
  if (error) throw new Error(`resolve claim: ${error.message}`);
  const rows = (data ?? []) as ResolveRow[];
  if (rows.length === 0) return { c, stopReason: "nothing_claimed_or_lane_gated", released: null };

  // One host for the whole mode (news.google.com); the per-host floor governs.
  const interval = Math.max(lane.per_host_interval_ms, lane.min_interval_ms, 1000);
  let lastStart = 0;

  for (const row of rows) {
    if (Date.now() > deadline) { stopReason = "budget"; break; }
    const wait = lastStart + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    c.attempted++;

    const attempts = Math.min((row.resolve_attempts ?? 0) + 1, RESOLVE_MAX_ATTEMPTS);
    const r = await resolveGnewsUrl(row.source_url, {
      userAgent: lane.user_agent || GNEWS_USER_AGENT,
    });

    if (r.error && /^blocked:/.test(r.error)) {
      // A host-level refusal is not this row's fault: do not charge the attempt.
      c.blocked++;
      blockDetail = `${r.error} news.google.com`;
      stopReason = r.error;
      break;
    }

    // Only the six resolver keys travel; the server merges them with jsonb `||`
    // and fans them out to every row carrying the same token.
    const delta = gnewsMetadataDelta(r, { attempts, at: new Date().toISOString() });
    const { error: wErr } = await supabase.rpc("gnews_resolve_record", {
      p_source_url: row.source_url,
      p_delta: delta,
    });
    if (wErr) {
      c.failed++;
      errors.push(`${row.artifact_id}: record ${wErr.message}`.slice(0, 200));
      continue;
    }
    if (r.publisher_url) c.ok++;
    else c.failed++;
  }

  const { data: released, error: relErr } = await supabase.rpc("artifact_body_fetch_release", {
    p_lane: GNEWS_LANE,
    p_blocked: c.blocked > 0,
    p_any_success: c.ok > 0,
    p_block_detail: blockDetail,
  });
  if (relErr) errors.push(`release: ${relErr.message}`);
  return { c, stopReason, released };
}

// ---------------------------------------------------------------- fetch mode

interface FetchRow {
  artifact_id: string;
  publisher_url: string;
  publisher_domain: string;
  body_attempts: number;
}

const robotsCache = new Map<string, string | null>();
async function robotsFor(url: string, ua: string): Promise<string | null> {
  const key = new URL(url).origin;
  if (robotsCache.has(key)) return robotsCache.get(key)!;
  let txt: string | null = null;
  try {
    const res = await fetch(`${key}/robots.txt`, {
      headers: { "User-Agent": ua },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text")) txt = await res.text();
  } catch { /* unreachable robots ⇒ treat as absent (RFC 9309 allows) */ }
  robotsCache.set(key, txt);
  return txt;
}

async function runFetch(lane: Lane, limit: number, lease: number, deadline: number, errors: string[]) {
  const c = newCounters();
  let stopReason: string | null = null;
  let blockDetail: string | null = null;

  const { data, error } = await supabase.rpc("gnews_body_claim", {
    p_limit: limit,
    p_lease_seconds: lease,
  });
  if (error) throw new Error(`body claim: ${error.message}`);
  const rows = (data ?? []) as FetchRow[];
  if (rows.length === 0) return { c, stopReason: "nothing_claimed_or_lane_gated", released: null };

  const lastHostStart = new Map<string, number>();
  let lastStart = 0;

  for (const row of rows) {
    if (Date.now() > deadline) { stopReason = "budget"; break; }
    const host = hostOf(row.publisher_url);
    const wait = Math.max(
      (lastHostStart.get(host) ?? 0) + lane.per_host_interval_ms - Date.now(),
      lastStart + lane.min_interval_ms - Date.now(),
      0,
    );
    if (wait > 0) await sleep(wait);

    // robots.txt on the PUBLISHER host, honoured unconditionally.
    const robots = await robotsFor(row.publisher_url, lane.user_agent);
    const u = new URL(row.publisher_url);
    if (!robotsAllows(robots, u.pathname + u.search, "faraday")) {
      c.attempted++; c.blocked++;
      await writeBody(row, { status: "blocked", error: "robots.txt disallows", meta: { robots: "disallowed" } });
      continue;
    }

    // Charge the attempt BEFORE the request: a worker killed mid-document must
    // not be re-claimed first on every subsequent run (the v1.2 lesson).
    await supabase.rpc("gnews_body_charge_attempt", { p_artifact_id: row.artifact_id });

    lastStart = Date.now();
    lastHostStart.set(host, lastStart);
    c.attempted++;

    let status: number | null = null;
    let contentType = "";
    let text = "";
    try {
      const res = await fetch(row.publisher_url, {
        headers: {
          "User-Agent": lane.user_agent,
          "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      status = res.status;
      contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        c.skipped++;
        await writeBody(row, {
          status: "skipped",
          error: `body too large (${buf.byteLength} bytes)`,
          meta: { http_status: status },
        });
        continue;
      }
      text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    } catch (e) {
      c.failed++;
      await writeBody(row, { status: "failed", error: String(e).slice(0, 300), meta: { http_status: null } });
      continue;
    }

    // Paywall / bot-wall refusal: recorded, never routed around.
    if (isBlockResponse(status, text, host)) {
      c.blocked++;
      blockDetail = `${status} ${host}`;
      await writeBody(row, { status: "blocked", error: blockDetail, meta: { http_status: status } });
      continue;
    }
    if (status === 404 || status === 410) {
      c.skipped++;
      await writeBody(row, { status: "skipped", error: `gone: HTTP ${status}`, meta: { http_status: status }, exhaust: true });
      continue;
    }
    if (status >= 400) {
      c.failed++;
      await writeBody(row, { status: "failed", error: `HTTP ${status}`, meta: { http_status: status } });
      continue;
    }

    try {
      const meta: Record<string, unknown> = {
        http_status: status,
        content_type: contentType,
        extractor: EXTRACTOR_VERSION,
        resolver: GNEWS_RESOLVER_VERSION,
        publisher_domain: row.publisher_domain,
      };
      let body: string;
      if (/html|xml/.test(contentType) || looksLikeHtml(text)) {
        body = htmlToText(text, { preferMain: true, dropChrome: true });
        meta.format = "html";
      } else if (/text\//.test(contentType) || contentType === "") {
        body = normalizeWhitespace(text);
        meta.format = "text";
      } else {
        c.skipped++;
        await writeBody(row, { status: "skipped", error: `unsupported content-type ${contentType}`, meta });
        continue;
      }
      const t = truncateAtParagraph(body);
      if (t.truncated) { c.truncated++; meta.truncated = true; meta.original_chars = body.length; }
      else meta.truncated = false;
      if (t.text.length < MIN_BODY_CHARS) {
        c.empty++;
        await writeBody(row, { status: "empty", error: `extracted ${t.text.length} chars`, meta });
        continue;
      }
      c.ok++;
      await writeBody(row, { status: "ok", body: t.text, meta });
    } catch (e) {
      c.failed++;
      await writeBody(row, { status: "failed", error: `extract: ${String(e).slice(0, 250)}`, meta: { http_status: status } });
    }
  }

  const { data: released, error: relErr } = await supabase.rpc("artifact_body_fetch_release", {
    p_lane: GNEWS_LANE,
    p_blocked: false, // publisher-level refusals are per-row, not a lane block
    p_any_success: c.ok > 0,
    p_block_detail: blockDetail,
  });
  if (relErr) errors.push(`release: ${relErr.message}`);

  // Failure-rate stop, same rule and threshold as the SEC/PUC lanes.
  let q = supabase
    .from("artifact_body_fetch_runs")
    .select("ok, failed, empty")
    .eq("lane", GNEWS_LANE).eq("mode", "fetch").gt("attempted", 0);
  if (lane.failure_window_since) q = q.gte("started_at", lane.failure_window_since);
  const { data: recent } = await q.order("started_at", { ascending: false }).limit(6);
  let wOk = c.ok, wFailed = c.failed, wEmpty = c.empty;
  for (const r of recent ?? []) { wOk += r.ok; wFailed += r.failed; wEmpty += r.empty; }
  const wTotal = wOk + wFailed + wEmpty;
  if (wTotal >= 50 && wFailed / wTotal > lane.failure_rate_stop) {
    const reason = `auto-stopped ${new Date().toISOString()}: failure rate ${(100 * wFailed / wTotal).toFixed(1)}% over last ${wTotal} attempts`;
    await supabase.rpc("artifact_body_lane_stop", { p_lane: GNEWS_LANE, p_reason: reason });
    stopReason = reason;
  }
  return { c, stopReason, released };
}

async function writeBody(
  row: FetchRow,
  r: {
    status: "ok" | "failed" | "blocked" | "skipped" | "empty";
    body?: string;
    error?: string;
    meta?: Record<string, unknown>;
    exhaust?: boolean;
  },
) {
  const { error } = await supabase.rpc("gnews_body_record", {
    p_artifact_id: row.artifact_id,
    p_status: r.status,
    p_body_text: r.status === "ok" ? (r.body ?? null) : null,
    p_error: r.error ?? null,
    p_meta: r.meta ?? null,
    p_exhaust: r.exhaust === true,
  });
  if (error) throw new Error(`write ${row.artifact_id}: ${error.message}`);
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req: Request) => {
  const started = new Date().toISOString();
  const deadline = Date.now() + BUDGET_MS;
  if (!(await authorized(req))) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body = defaults */ }
  const mode = String(body.mode ?? "status");
  const limit = Math.max(1, Math.min(Number(body.limit ?? 30), 120));
  const lease = Math.max(30, Math.min(Number(body.lease_seconds ?? 170), 300));

  const { data: lane, error: laneErr } = await supabase
    .from("artifact_body_fetch_lanes").select("*").eq("lane", GNEWS_LANE).maybeSingle();
  if (laneErr || !lane) {
    return json({ error: `lane '${GNEWS_LANE}' missing — migration 20261009220000 not applied` }, 400);
  }

  if (mode === "status") {
    const { data: m } = await supabase.rpc("gnews_resolve_measure");
    const { user_agent: _ua, ...cfg } = lane as Record<string, unknown>;
    return json({ lane: cfg, resolver: GNEWS_RESOLVER_VERSION, measure: m });
  }
  if (mode !== "resolve" && mode !== "fetch") return json({ error: `unknown mode '${mode}'` }, 400);

  const { data: runRow } = await supabase.from("artifact_body_fetch_runs")
    .insert({ lane: GNEWS_LANE, mode, started_at: started, stop_reason: "running" })
    .select("run_id").single();
  const runId = (runRow as { run_id?: string } | null)?.run_id;

  const errors: string[] = [];
  let result: { c: Counters; stopReason: string | null; released?: unknown } =
    { c: newCounters(), stopReason: null };
  try {
    result = mode === "resolve"
      ? await runResolve(lane as Lane, limit, lease, deadline, errors)
      : await runFetch(lane as Lane, limit, lease, deadline, errors);
  } catch (e) {
    errors.push(String(e).slice(0, 300));
    await supabase.rpc("artifact_body_fetch_release", {
      p_lane: GNEWS_LANE, p_blocked: false, p_any_success: false, p_block_detail: null,
    });
  }

  const c = result.c;
  const gated = result.stopReason === "nothing_claimed_or_lane_gated"
    || (result.stopReason ?? "").startsWith("aggregator_robots_ack");
  const runPatch = {
    finished_at: new Date().toISOString(),
    attempted: c.attempted, ok: c.ok, failed: c.failed, empty: c.empty,
    blocked: c.blocked, skipped: c.skipped, truncated: c.truncated,
    stop_reason: result.stopReason, errors: errors.slice(0, 50),
  };
  if (runId && gated) await supabase.from("artifact_body_fetch_runs").delete().eq("run_id", runId);
  else if (runId) await supabase.from("artifact_body_fetch_runs").update(runPatch).eq("run_id", runId);

  if (!gated) {
    await supabase.from("automation_health_log").insert({
      auto_id: AUTO_ID,
      crawler_id: CRAWLER_ID,
      run_started_at: started,
      run_completed_at: new Date().toISOString(),
      artifacts_found: c.attempted,
      artifacts_new: c.ok,
      artifacts_duped: 0,
      errors,
      success: errors.length === 0
        && !(result.stopReason ?? "").startsWith("auto-stopped")
        && !(result.stopReason ?? "").startsWith("blocked"),
      notes: JSON.stringify({ lane: GNEWS_LANE, mode, ...c, stop_reason: result.stopReason }),
    });
  }

  return json({
    lane: GNEWS_LANE, mode, ...c,
    stop_reason: result.stopReason,
    lane_state: result.released,
    errors: errors.length ? errors : undefined,
  });
});
