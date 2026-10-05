// artifact-body-fetch v1.3 — CC-ARTIFACT-BODY-FETCH-1.0 (Phases 1–2).
//
// v1.3 (2026-10-05): HTTP 404/410 is a permanently GONE document, not a failure.
// Such rows are written 'skipped' (no retries) and kept out of the failure-rate
// window, which also now only counts runs since lane.failure_window_since. The
// 2026-09-28 stop was 2001-era EDGAR per-document URLs (…/<accession>/0001.txt)
// that SEC no longer serves — dead links, not a fetch problem.
//
// v1.2 (2026-09-28): the attempt is charged BEFORE the fetch (and refunded on an
// SEC block), so a document that kills the worker mid-extraction (CPU/memory
// limit) drops out of the queue after MAX_ATTEMPTS instead of being re-claimed
// first on every run and wedging the lane.
//
// v1.1 (2026-09-27): v1.0 died with WORKER_RESOURCE_LIMIT ("CPU Time exceeded")
// after 10 embeds. Edge workers meter CPU per request, so: pdfjs (unpdf) is now
// imported lazily — only when a PDF is actually fetched; embeddings are requested
// as base64 and decoded through typed arrays instead of JSON-parsing ~150k floats
// per OpenAI response; the run row is written at START and finalised at the end,
// so a killed worker still leaves a trace; the caller sets the lease
// (lease_seconds) and a per-invocation cap (limit).
//
// Fetches full document bodies into artifacts.body_text and, once a lane's
// embed gate is opened, re-chunks + re-embeds the rows whose body is
// materially deeper than the ingest capture. raw_content is NEVER modified.
//
// Modes (POST JSON):
//   {mode:"fetch", lane:"puc_gov"|"sec", limit?}   claim → fetch → extract → write
//   {mode:"embed", lane, limit?}                  chunk body → embed → atomic replace
//   {mode:"status", lane}                         lane config + measurement
//
// Lane state lives in artifact_body_fetch_lanes (edit rows, no redeploy):
// fetch_enabled / embed_enabled gates, user_agent, pacing, SEC form priority,
// block streak + exponential backoff, and one-worker-per-lane leases.
//
// SEC access policy (Phase 2):
//   * Declared User-Agent from the lane row (organisation + contact email).
//   * Sequential only; >= min_interval_ms between request STARTS (250ms = 4 req/s max).
//   * 403/429 = block: stop this invocation, backoff 60s·2^(n-1) persisted in the
//     lane row, 3 consecutive blocks disables the lane. Never rotates agents,
//     proxies or paths — a refusal is reported, not routed around.
//   * SEC refuses the Supabase EDGE IP range (sec-archives-egress-probe v2), so
//     each SEC document is fetched through artifact_body_sec_http_get() (the
//     database's egress). Pacing stays here; the RPC performs one request.
//
// Writes: artifacts.body_* / sec_form_type, artifact_chunks (via the atomic
// artifact_body_replace_chunks RPC), artifact_body_fetch_runs,
// artifact_body_fetch_lanes, automation_health_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chunkSource,
  chunkText,
  extractSecDocument,
  EXTRACTOR_VERSION,
  hostOf,
  htmlToText,
  isBlockResponse,
  isSecHost,
  looksLikeHtml,
  MIN_BODY_CHARS,
  normalizeWhitespace,
  robotsAllows,
  truncateAtParagraph,
} from "./body-pure.ts";

const AUTO_ID = "AUTO-246"; // provisional — registry grant pending
const CRAWLER_ID = "artifact-body-fetch_v1.3";
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_BATCH = 96;
const MAX_ATTEMPTS = 3;
const BUDGET_MS = 130_000; // gateway drops at 150s
const MAX_BYTES = 25_000_000;
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";

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
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Lane {
  lane: string;
  fetch_enabled: boolean;
  embed_enabled: boolean;
  user_agent: string;
  min_interval_ms: number;
  per_host_interval_ms: number;
  failure_rate_stop: number;
  failure_window_since: string | null;
}

interface Claimed {
  artifact_id: string;
  source_url: string;
  raw_len: number;
  body_attempts: number;
  sec_form_type: string | null;
}

interface Counters {
  attempted: number; ok: number; failed: number; empty: number; blocked: number;
  skipped: number; truncated: number; embedded: number; chunks_written: number; tokens_used: number;
}

const newCounters = (): Counters => ({
  attempted: 0, ok: 0, failed: 0, empty: 0, blocked: 0, skipped: 0, truncated: 0,
  embedded: 0, chunks_written: 0, tokens_used: 0,
});

// ---------------------------------------------------------------- fetching

interface Fetched {
  status: number | null;
  contentType: string;
  text?: string;       // decoded text body
  bytes?: Uint8Array;  // binary body (PDF)
  error?: string;
}

async function fetchDirect(url: string, ua: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return { status: res.status, contentType: ct, error: `body too large (${buf.byteLength} bytes)` };
    const isPdf = ct.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
    if (isPdf) return { status: res.status, contentType: "application/pdf", bytes: buf };
    return { status: res.status, contentType: ct, text: new TextDecoder("utf-8", { fatal: false }).decode(buf) };
  } catch (e) {
    return { status: null, contentType: "", error: String(e).slice(0, 300) };
  }
}

async function fetchSec(url: string): Promise<Fetched> {
  const { data, error } = await supabase.rpc("artifact_body_sec_http_get", { p_url: url });
  if (error) return { status: null, contentType: "", error: `rpc: ${error.message}`.slice(0, 300) };
  const d = data as { status: number | null; content_type?: string; content?: string; error?: string };
  if (d.error) return { status: null, contentType: "", error: d.error };
  return { status: d.status, contentType: (d.content_type ?? "").toLowerCase(), text: d.content ?? "" };
}

const robotsCache = new Map<string, string | null>();
async function robotsFor(url: string, ua: string): Promise<string | null> {
  const u = new URL(url);
  const key = u.origin;
  if (robotsCache.has(key)) return robotsCache.get(key)!;
  let txt: string | null = null;
  try {
    const res = await fetch(`${key}/robots.txt`, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(10_000) });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text")) txt = await res.text();
  } catch { /* unreachable robots ⇒ treat as absent */ }
  robotsCache.set(key, txt);
  return txt;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  // Lazy: pdfjs is large and its evaluation costs CPU on every cold worker.
  const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return normalizeWhitespace(Array.isArray(text) ? text.join("\n\n") : text);
}

// ---------------------------------------------------------------- fetch mode

async function runFetch(lane: Lane, limit: number, lease: number, deadline: number, errors: string[]) {
  const c = newCounters();
  let stopReason: string | null = null;
  let blockDetail: string | null = null;

  const { data: claimed, error: claimErr } = await supabase.rpc("artifact_body_fetch_claim", {
    p_lane: lane.lane, p_limit: limit, p_lease_seconds: lease,
  });
  if (claimErr) throw new Error(`claim: ${claimErr.message}`);
  const rows = (claimed ?? []) as Claimed[];
  if (rows.length === 0) return { c, stopReason: "nothing_claimed_or_lane_gated", released: null };

  const sec = lane.lane === "sec";
  let lastStart = 0;
  const lastHostStart = new Map<string, number>();

  for (const row of rows) {
    if (Date.now() > deadline) { stopReason = "budget"; break; }
    const host = hostOf(row.source_url);

    // Pacing: global floor between request starts, plus a per-host floor.
    const hostWait = (lastHostStart.get(host) ?? 0) + lane.per_host_interval_ms - Date.now();
    const globalWait = lastStart + lane.min_interval_ms - Date.now();
    const wait = Math.max(hostWait, globalWait, 0);
    if (wait > 0) await sleep(wait);

    if (!sec) {
      const robots = await robotsFor(row.source_url, lane.user_agent);
      const u = new URL(row.source_url);
      if (!robotsAllows(robots, u.pathname + u.search, "faraday")) {
        await writeRow(row, { status: "blocked", error: "robots.txt disallows", meta: { robots: "disallowed" } });
        c.attempted++; c.blocked++;
        continue;
      }
    }

    // Charge the attempt up front: a worker killed mid-document must not leave the
    // row claimable forever (it would be first in line on every run).
    await supabase.from("artifacts").update({ body_attempts: Math.min(row.body_attempts + 1, MAX_ATTEMPTS) })
      .eq("artifact_id", row.artifact_id);

    lastStart = Date.now();
    lastHostStart.set(host, lastStart);
    c.attempted++;
    const f = isSecHost(row.source_url) ? await fetchSec(row.source_url) : await fetchDirect(row.source_url, lane.user_agent);

    // Host-level refusal: do not charge the row an attempt, stop the invocation.
    if (f.status != null && isBlockResponse(f.status, f.text ?? "", host)) {
      c.blocked++;
      blockDetail = `${f.status} ${host} ${(f.text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)}`;
      if (sec) {
        // Host-level refusal is not the document's fault: refund the attempt.
        await supabase.from("artifacts").update({ body_attempts: row.body_attempts }).eq("artifact_id", row.artifact_id);
        stopReason = `blocked ${f.status}`;
        break;
      }
      await writeRow(row, { status: "blocked", error: blockDetail, meta: { http_status: f.status } });
      continue;
    }

    // Permanently gone (dead link): record and move on — never retried, never a "failure".
    if (f.status === 404 || f.status === 410) {
      c.skipped++;
      await writeRow({ ...row, body_attempts: MAX_ATTEMPTS - 1 }, {
        status: "skipped", error: `gone: HTTP ${f.status}`, meta: { http_status: f.status },
      });
      continue;
    }

    if (f.error || f.status == null || f.status >= 400) {
      const err = f.error ?? `HTTP ${f.status}`;
      c.failed++;
      await writeRow(row, { status: "failed", error: err, meta: { http_status: f.status } });
      continue;
    }

    try {
      let text = "";
      const meta: Record<string, unknown> = {
        http_status: f.status, content_type: f.contentType, extractor: EXTRACTOR_VERSION,
      };
      if (f.bytes) {
        text = await pdfText(f.bytes);
        meta.format = "pdf";
      } else if (sec) {
        const e = extractSecDocument(f.text ?? "", row.source_url);
        text = e.text;
        Object.assign(meta, {
          format: "edgar", conformed_type: e.conformedType, document_type: e.documentType,
          is_exhibit: e.isExhibit, dropped_documents: e.droppedDocuments, tail_cut: e.tailCut,
          ingest_form: row.sec_form_type,
        });
      } else if (/html|xml/.test(f.contentType) || looksLikeHtml(f.text ?? "")) {
        text = htmlToText(f.text ?? "", { preferMain: true, dropChrome: true });
        meta.format = "html";
      } else if (/text\//.test(f.contentType) || f.contentType === "") {
        text = normalizeWhitespace(f.text ?? "");
        meta.format = "text";
      } else {
        c.skipped++;
        await writeRow(row, { status: "skipped", error: `unsupported content-type ${f.contentType}`, meta });
        continue;
      }

      const t = truncateAtParagraph(text);
      if (t.truncated) { c.truncated++; meta.truncated = true; meta.original_chars = text.length; }
      else meta.truncated = false;

      if (t.text.length < MIN_BODY_CHARS) {
        c.empty++;
        await writeRow(row, { status: "empty", error: `extracted ${t.text.length} chars`, meta });
        continue;
      }
      c.ok++;
      await writeRow(row, { status: "ok", body: t.text, meta });
    } catch (e) {
      c.failed++;
      await writeRow(row, { status: "failed", error: `extract: ${String(e).slice(0, 250)}`, meta: { http_status: f.status } });
    }
  }

  const blocked = sec && stopReason?.startsWith("blocked") === true;
  const { data: released, error: relErr } = await supabase.rpc("artifact_body_fetch_release", {
    p_lane: lane.lane, p_blocked: blocked, p_any_success: c.ok > 0, p_block_detail: blockDetail,
  });
  if (relErr) errors.push(`release: ${relErr.message}`);

  // Failure-rate stop (>20%): this invocation plus the lane's recent fetch runs,
  // evaluated once at least 50 real attempts (ok+failed+empty) are in the window.
  let recentQ = supabase
    .from("artifact_body_fetch_runs")
    .select("ok, failed, empty")
    .eq("lane", lane.lane).eq("mode", "fetch").gt("attempted", 0);
  if (lane.failure_window_since) recentQ = recentQ.gte("started_at", lane.failure_window_since);
  const { data: recentRuns } = await recentQ.order("started_at", { ascending: false }).limit(6);
  let wOk = c.ok, wFailed = c.failed, wEmpty = c.empty;
  for (const r of recentRuns ?? []) { wOk += r.ok; wFailed += r.failed; wEmpty += r.empty; }
  const wTotal = wOk + wFailed + wEmpty;
  if (wTotal >= 50 && wFailed / wTotal > lane.failure_rate_stop) {
    const reason = `auto-stopped ${new Date().toISOString()}: failure rate ${(100 * wFailed / wTotal).toFixed(1)}% over last ${wTotal} attempts`;
    await supabase.rpc("artifact_body_lane_stop", { p_lane: lane.lane, p_reason: reason });
    stopReason = reason;
  }
  return { c, stopReason, released };
}

async function writeRow(
  row: Claimed,
  r: { status: "ok" | "failed" | "blocked" | "skipped" | "empty"; body?: string; error?: string; meta?: Record<string, unknown> },
) {
  const patch: Record<string, unknown> = {
    body_fetch_status: r.status,
    body_fetched_at: new Date().toISOString(),
    body_attempts: Math.min(row.body_attempts + 1, MAX_ATTEMPTS),
    body_fetch_error: r.error ?? null,
    body_meta: r.meta ?? null,
  };
  if (r.status === "ok" && r.body) {
    patch.body_text = r.body;
    patch.body_char_count = r.body.length;
  }
  const conformed = r.meta?.conformed_type as string | undefined;
  if (conformed) patch.sec_form_type = conformed; // SEC header beats the ingest form when seen
  const { error } = await supabase.from("artifacts").update(patch).eq("artifact_id", row.artifact_id);
  if (error) throw new Error(`write ${row.artifact_id}: ${error.message}`);
}

// ---------------------------------------------------------------- embed mode

/** base64 float32 (little-endian) → pgvector text literal, without JSON float parsing. */
function base64ToVectorLiteral(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const f = new Float32Array(bytes.buffer);
  if (f.length !== 1536) throw new Error(`unexpected embedding dim ${f.length}`);
  return "[" + Array.prototype.join.call(f, ",") + "]";
}

async function embedTexts(texts: string[], key: string): Promise<{ vectors: string[]; tokens: number }> {
  const vectors: string[] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const slice = texts.slice(i, i + EMBED_BATCH);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBED_MODEL, input: slice, encoding_format: "base64" }),
      });
      if (res.status !== 429 && res.status < 500) break;
      await sleep(2000 * (attempt + 1));
    }
    if (!res || !res.ok) throw new Error(`OpenAI embeddings ${res?.status}: ${(await res?.text())?.slice(0, 200)}`);
    const data = await res.json();
    tokens += data.usage?.total_tokens ?? 0;
    for (const d of data.data) vectors.push(base64ToVectorLiteral(d.embedding));
  }
  return { vectors, tokens };
}

async function runEmbed(lane: Lane, limit: number, lease: number, deadline: number, errors: string[]) {
  const c = newCounters();
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { c, stopReason: "OPENAI_API_KEY not set" };
  const { data, error } = await supabase.rpc("artifact_body_embed_claim", { p_lane: lane.lane, p_limit: limit, p_lease_seconds: lease });
  if (error) throw new Error(`embed claim: ${error.message}`);
  const rows = (data ?? []) as Array<{ artifact_id: string; raw_content: string | null; body_text: string }>;
  let stopReason: string | null = rows.length ? null : "nothing_claimed_or_lane_gated";
  try {
    for (const r of rows) {
      if (Date.now() > deadline) { stopReason = "budget"; break; }
      c.attempted++;
      try {
        const chunks = chunkText(chunkSource(r.raw_content, r.body_text));
        if (chunks.length === 0) { c.skipped++; continue; }
        const { vectors, tokens } = await embedTexts(chunks, key);
        c.tokens_used += tokens;
        const payload = chunks.map((text, i) => ({ i, text, embedding: vectors[i] }));
        const { data: n, error: repErr } = await supabase.rpc("artifact_body_replace_chunks", {
          p_artifact_id: r.artifact_id, p_model: EMBED_MODEL, p_chunks: payload,
        });
        if (repErr) throw new Error(`replace: ${repErr.message}`);
        c.embedded++;
        c.chunks_written += Number(n ?? 0);
      } catch (e) {
        c.failed++;
        errors.push(`${r.artifact_id}: ${String(e).slice(0, 200)}`);
        if (/OpenAI embeddings (401|403)/.test(String(e))) { stopReason = "openai auth"; break; }
      }
    }
  } finally {
    await supabase.rpc("artifact_body_embed_release", { p_lane: lane.lane });
  }
  return { c, stopReason };
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req: Request) => {
  const started = new Date().toISOString();
  const deadline = Date.now() + BUDGET_MS;
  if (!(await authorized(req))) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const mode = String(body.mode ?? "fetch");
  const laneName = String(body.lane ?? "");
  const limit = Math.max(1, Math.min(Number(body.limit ?? 200), 500));
  const lease = Math.max(30, Math.min(Number(body.lease_seconds ?? 170), 300));

  const { data: lane, error: laneErr } = await supabase
    .from("artifact_body_fetch_lanes").select("*").eq("lane", laneName).maybeSingle();
  if (laneErr || !lane) return json({ error: `unknown lane '${laneName}'` }, 400);

  if (mode === "status") {
    const { data: m } = await supabase.rpc("artifact_body_fetch_measure", { p_lane: laneName });
    const { user_agent: _ua, ...cfg } = lane as Record<string, unknown>;
    return json({ lane: cfg, measure: m });
  }
  if (mode !== "fetch" && mode !== "embed") return json({ error: `unknown mode '${mode}'` }, 400);

  // Written at START so a worker killed mid-run (CPU/memory limit) still leaves a row.
  const { data: runRow } = await supabase.from("artifact_body_fetch_runs")
    .insert({ lane: laneName, mode, started_at: started, stop_reason: "running" })
    .select("run_id").single();
  const runId = (runRow as { run_id?: string } | null)?.run_id;

  const errors: string[] = [];
  let result: { c: Counters; stopReason: string | null; released?: unknown } = { c: newCounters(), stopReason: null };
  try {
    result = mode === "fetch"
      ? await runFetch(lane as Lane, limit, lease, deadline, errors)
      : await runEmbed(lane as Lane, limit, lease, deadline, errors);
  } catch (e) {
    errors.push(String(e).slice(0, 300));
    if (mode === "fetch") await supabase.rpc("artifact_body_fetch_release", { p_lane: laneName, p_blocked: false, p_any_success: false });
  }
  const c = result.c;
  const gated = result.stopReason === "nothing_claimed_or_lane_gated";

  const runPatch = {
    finished_at: new Date().toISOString(),
    attempted: c.attempted, ok: c.ok, failed: c.failed, empty: c.empty, blocked: c.blocked,
    skipped: c.skipped, truncated: c.truncated, embedded: c.embedded, chunks_written: c.chunks_written,
    tokens_used: c.tokens_used, stop_reason: result.stopReason, errors: errors.slice(0, 50),
  };
  if (runId && gated) await supabase.from("artifact_body_fetch_runs").delete().eq("run_id", runId);
  else if (runId) await supabase.from("artifact_body_fetch_runs").update(runPatch).eq("run_id", runId);
  else await supabase.from("artifact_body_fetch_runs").insert({ lane: laneName, mode, started_at: started, ...runPatch });
  if (!gated) {
    await supabase.from("automation_health_log").insert({
      auto_id: AUTO_ID,
      crawler_id: CRAWLER_ID,
      run_started_at: started,
      run_completed_at: new Date().toISOString(),
      artifacts_found: c.attempted,
      artifacts_new: mode === "fetch" ? c.ok : c.embedded,
      artifacts_duped: 0,
      errors,
      success: errors.length === 0 && !(result.stopReason ?? "").startsWith("auto-stopped") && !(result.stopReason ?? "").startsWith("blocked"),
      notes: JSON.stringify({ lane: laneName, mode, ...c, stop_reason: result.stopReason }),
    });
  }
  return json({ lane: laneName, mode, ...c, stop_reason: result.stopReason, lane_state: result.released, errors: errors.length ? errors : undefined });
});
