// Faraday — AUTO-030: Artifact Enrichment Pipeline
// v21 (2026-07-17): concurrent batches — up to MAX_OPEN_BATCHES in flight at
// SUBMIT_MAX=1000 each. v20 serialized on a single 500-artifact batch, so one
// slow batch (Anthropic SLA is 24h) froze all throughput while query-lane
// first-fetch intake ran ~2k/hour.
// v20 (2026-07-17): rebuilt on the Anthropic Message Batches API.
//
// Why: (1) batch pricing is 50% of synchronous pricing on both input and
// output — enrichment is already asynchronous/queued, so the discount is
// free; (2) the old drain (10 artifacts / 10 min = 1,440/day) was undersized
// vs poller intake (~3.5k/day) and the backlog compounded. Batches lift
// throughput to ~17k/day at the same cron cadence.
//
// Also in v20: the plaintext CRON_TOKEN constant is GONE (the v8 TODO) —
// auth is the service-role key or the fcron house token compared by SHA-256
// (census-backfill pattern).
//
// CC-FAR-OPS-RESTORE-1.1 (2026-07-24): CRAWLER_ID bumped AUTO-030_v2.1 →
// AUTO-030_v2.2. The 1.0 Fix 3 — robust fenced-JSON stripping in
// enrich-pure.parseEnrichmentText plus the <=5% per-item failure tolerance in
// enrich-pure.batchRunSucceeded (replacing the old rule that flipped the whole
// batch to failed on any single unparseable/errored item — the cause of 11
// false-alarm runs in 14 days) — already shipped in this function, but the
// crawler_id was still v2.1, so pre- and post-fix health-log runs were
// indistinguishable. This bump draws that line. Parser- and threshold-side
// only: no change to the enrichment prompt, model, or output schema.
//
// Flow (cron POSTs {mode:"auto"} every 10 min):
//   poll:   for each enrich_batches row not completed → GET the batch; when
//           ended, stream results JSONL and process up to PROCESS_MAX
//           artifacts (chunk → embed → chunks/enrichments/entities → complete);
//           leftovers drain on subsequent invocations.
//   submit: reclaim stale 'processing' (>26h) → pending; claim up to
//           SUBMIT_MAX pending → POST /v1/messages/batches; record the batch.
//
// Boundaries unchanged from v19: writes artifacts/artifact_chunks/
// artifact_enrichments/artifact_entities/enrich_batches/automation_health_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type ArtifactLike,
  batchRunSucceeded,
  buildBatchRequests,
  chunkText,
  type EnrichmentResult,
  mentionName,
  parseBatchResults,
} from "./enrich-pure.ts";

const AUTO_ID = "AUTO-030";
const CRAWLER_ID = "AUTO-030_v2.2";
const EMBED_MODEL = "text-embedding-3-small";
const SUBMIT_MAX = 1000;
const MAX_OPEN_BATCHES = 4; // v21: one slow batch must not freeze the pipe
const CLAIM_CHUNK = 400; // id-list updates chunked — 1,000 uuids in one .in() exceeds URL limits
const PROCESS_MAX = 120;
const STALE_PROCESSING_HOURS = 26;
const MAX_ATTEMPTS = 3;
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceKey);

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

function anthropicHeaders(key: string) {
  return { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
}

async function embedTexts(texts: string[], openaiKey: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const slice = texts.slice(i, i + 96);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: slice }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    out.push(...data.data.map((d: { embedding: number[] }) => d.embedding));
  }
  return out;
}

// ---------- submit ----------

async function submitBatch(anthropicKey: string) {
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_HOURS * 3600_000).toISOString();
  await supabase
    .from("artifacts")
    .update({ enrich_status: "pending", enrich_queued_at: null })
    .eq("enrich_status", "processing")
    .lt("enrich_queued_at", staleCutoff);

  const { data: batch, error } = await supabase
    .from("artifacts")
    .select("artifact_id, raw_content, source_type, source_url, ifs_domains")
    .eq("enrich_status", "pending")
    .order("discovered_at", { ascending: true })
    .limit(SUBMIT_MAX);
  if (error) throw new Error(`claim query: ${error.message}`);
  if (!batch || batch.length === 0) return { submitted: 0 };

  const ids = batch.map((a) => a.artifact_id);
  const queuedAt = new Date().toISOString();
  for (let i = 0; i < ids.length; i += CLAIM_CHUNK) {
    await supabase
      .from("artifacts")
      .update({ enrich_status: "processing", enrich_queued_at: queuedAt })
      .in("artifact_id", ids.slice(i, i + CLAIM_CHUNK));
  }

  const res = await fetch("https://api.anthropic.com/v1/messages/batches", {
    method: "POST",
    headers: anthropicHeaders(anthropicKey),
    body: JSON.stringify({ requests: buildBatchRequests(batch as ArtifactLike[]) }),
  });
  if (!res.ok) {
    // Release the claim so the next run retries.
    for (let i = 0; i < ids.length; i += CLAIM_CHUNK) {
      await supabase.from("artifacts").update({ enrich_status: "pending", enrich_queued_at: null }).in("artifact_id", ids.slice(i, i + CLAIM_CHUNK));
    }
    throw new Error(`batch create ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const created = await res.json();
  await supabase.from("enrich_batches").insert({ batch_id: created.id, artifact_count: batch.length });
  return { submitted: batch.length, batch_id: created.id };
}

// ---------- poll / drain ----------

async function processResult(artifactId: string, enrichment: EnrichmentResult, openaiKey: string, entityLookup: Map<string, string>) {
  const { data: art } = await supabase
    .from("artifacts")
    .select("artifact_id, raw_content, enrich_status")
    .eq("artifact_id", artifactId)
    .single();
  if (!art || art.enrich_status !== "processing") return false; // already drained or reclaimed

  const chunks = chunkText(art.raw_content);
  if (chunks.length > 0) {
    const embeddings = await embedTexts(chunks, openaiKey);
    await supabase.from("artifact_chunks").delete().eq("artifact_id", artifactId);
    const { error: chunkErr } = await supabase.from("artifact_chunks").insert(
      chunks.map((text, i) => ({
        artifact_id: artifactId,
        chunk_index: i,
        chunk_text: text,
        embedding: embeddings[i],
        embedding_model: EMBED_MODEL,
      })),
    );
    if (chunkErr) throw new Error(`chunk insert: ${chunkErr.message}`);
  }

  const { error: enrichErr } = await supabase.from("artifact_enrichments").upsert({
    artifact_id: artifactId,
    model_version: `${CRAWLER_ID}:batch`,
    summary: enrichment.summary,
    category_tags: enrichment.category_tags,
    relevance_score: enrichment.relevance_score,
    priority_flag: enrichment.priority_flag,
    prediction_signals: enrichment.prediction_signals,
  }, { onConflict: "artifact_id" });
  if (enrichErr) throw new Error(`enrichment insert: ${enrichErr.message}`);

  const links: Array<{ artifact_id: string; entity_id: string; mention_count: number }> = [];
  const seen = new Set<string>();
  for (const raw of (Array.isArray(enrichment.entity_mentions) ? enrichment.entity_mentions : [])) {
    const name = mentionName(raw);
    const entityId = name ? entityLookup.get(name.toLowerCase()) : undefined;
    if (entityId && !seen.has(entityId)) {
      seen.add(entityId);
      links.push({ artifact_id: artifactId, entity_id: entityId, mention_count: 1 });
    }
  }
  if (links.length > 0) {
    await supabase.from("artifact_entities").upsert(links, { onConflict: "artifact_id,entity_id", ignoreDuplicates: false });
  }

  await supabase
    .from("artifacts")
    .update({ enrich_status: "complete", enrich_completed_at: new Date().toISOString() })
    .eq("artifact_id", artifactId);
  return true;
}

async function failResult(artifactId: string, reason: string, errors: string[]) {
  const { data: art } = await supabase
    .from("artifacts").select("enrich_attempts, enrich_status").eq("artifact_id", artifactId).single();
  if (!art || art.enrich_status !== "processing") return;
  const attempts = (art.enrich_attempts ?? 0) + 1;
  const giveUp = attempts >= MAX_ATTEMPTS;
  errors.push(`${artifactId} (attempt ${attempts}${giveUp ? ", giving up" : ""}): ${reason}`);
  await supabase
    .from("artifacts")
    .update({ enrich_status: giveUp ? "failed" : "pending", enrich_attempts: attempts, enrich_queued_at: null })
    .eq("artifact_id", artifactId);
}

async function pollBatches(anthropicKey: string, openaiKey: string, deadlineMs: number) {
  let processed = 0, failed = 0;
  const errors: string[] = [];

  const { data: open } = await supabase
    .from("enrich_batches").select("batch_id, artifact_count, succeeded, errored")
    .is("completed_at", null).order("submitted_at", { ascending: true });
  if (!open || open.length === 0) return { processed, failed, errors, openBatches: 0 };

  const { data: entityRows } = await supabase.from("entities").select("entity_id, canonical_name, aliases");
  const entityLookup = new Map<string, string>();
  for (const e of (entityRows ?? [])) {
    entityLookup.set(e.canonical_name.toLowerCase(), e.entity_id);
    for (const alias of (e.aliases ?? [])) entityLookup.set(alias.toLowerCase(), e.entity_id);
  }

  for (const b of open) {
    if (Date.now() > deadlineMs || processed >= PROCESS_MAX) break;
    const res = await fetch(`https://api.anthropic.com/v1/messages/batches/${b.batch_id}`, { headers: anthropicHeaders(anthropicKey) });
    if (!res.ok) { errors.push(`batch ${b.batch_id} status ${res.status}`); continue; }
    const info = await res.json();
    if (info.processing_status !== "ended") {
      await supabase.from("enrich_batches").update({ status: info.processing_status }).eq("batch_id", b.batch_id);
      continue;
    }
    const resultsRes = await fetch(info.results_url, { headers: anthropicHeaders(anthropicKey) });
    if (!resultsRes.ok) { errors.push(`batch ${b.batch_id} results ${resultsRes.status}`); continue; }
    const lines = parseBatchResults(await resultsRes.text());

    let drainedAll = true;
    let ok = b.succeeded ?? 0, err = b.errored ?? 0;
    for (const line of lines) {
      if (Date.now() > deadlineMs || processed + failed >= PROCESS_MAX) { drainedAll = false; break; }
      try {
        if (line.ok && line.enrichment) {
          if (await processResult(line.artifactId, line.enrichment, openaiKey, entityLookup)) { processed++; ok++; }
        } else {
          await failResult(line.artifactId, line.error ?? "batch error", errors);
          failed++; err++;
        }
      } catch (e) {
        await failResult(line.artifactId, String(e).slice(0, 200), errors);
        failed++; err++;
      }
    }
    await supabase.from("enrich_batches").update({
      status: drainedAll ? "completed" : "draining",
      succeeded: ok,
      errored: err,
      ...(drainedAll ? { completed_at: new Date().toISOString() } : {}),
    }).eq("batch_id", b.batch_id);
  }
  return { processed, failed, errors, openBatches: open.length };
}

// ---------- handler ----------

Deno.serve(async (req: Request) => {
  const runStarted = new Date().toISOString();
  const deadlineMs = Date.now() + 100_000;

  if (!(await authorized(req))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!openaiKey || !anthropicKey) {
    return new Response(JSON.stringify({ skipped: true, reason: "API keys not set — nothing claimed." }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  let mode = "auto";
  try { mode = String((await req.json()).mode ?? "auto"); } catch { /* default */ }

  if (mode === "status") {
    const { count: pending } = await supabase.from("artifacts").select("*", { count: "exact", head: true }).eq("enrich_status", "pending");
    const { count: processing } = await supabase.from("artifacts").select("*", { count: "exact", head: true }).eq("enrich_status", "processing");
    const { data: open } = await supabase.from("enrich_batches").select("batch_id,status,artifact_count").is("completed_at", null);
    return new Response(JSON.stringify({ pending, processing, open_batches: open }), { headers: { "Content-Type": "application/json" } });
  }

  const out: Record<string, unknown> = { mode };
  const errors: string[] = [];
  try {
    if (mode === "auto" || mode === "poll") {
      const polled = await pollBatches(anthropicKey, openaiKey, deadlineMs);
      out.processed = polled.processed;
      out.failed = polled.failed;
      out.open_batches = polled.openBatches;
      errors.push(...polled.errors);
    }
    if (mode === "auto" || mode === "submit") {
      // v21: keep up to MAX_OPEN_BATCHES in flight — Anthropic's batch SLA is
      // 24h, so serializing on one batch can freeze throughput behind a slow one.
      const { count: openCount } = await supabase.from("enrich_batches").select("*", { count: "exact", head: true }).is("completed_at", null);
      if (mode === "submit" || (openCount ?? 0) < MAX_OPEN_BATCHES) {
        const sub = await submitBatch(anthropicKey);
        out.submitted = sub.submitted;
        if (sub.batch_id) out.batch_id = sub.batch_id;
      } else {
        out.submitted = 0;
        out.note = `${openCount} batches in flight — skipped submit`;
      }
    }
  } catch (e) {
    errors.push(String(e).slice(0, 300));
  }

  // CC-FAR-OPS-RESTORE-1.0 Fix 3: a couple of per-item failures out of ~120
  // (an unparseable line, an Anthropic "errored" result) must not flag the
  // whole run failed — that produced 11 false-alarm runs in 14 days. Tolerate
  // per-item failures up to BATCH_FAILURE_TOLERANCE; systemic errors (submit /
  // batch-fetch / top-level) still fail the run. Every per-item failure is
  // still captured in `errors` and `notes` below.
  const processed = Number(out.processed ?? 0);
  const failed = Number(out.failed ?? 0);
  const systemicErrors = Math.max(0, errors.length - failed); // errors not tied to a per-item failure
  const success = batchRunSucceeded(processed, failed, systemicErrors);

  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID,
    crawler_id: CRAWLER_ID,
    run_started_at: runStarted,
    run_completed_at: new Date().toISOString(),
    artifacts_found: processed + failed,
    artifacts_new: processed,
    artifacts_duped: 0,
    errors,
    success,
    notes: `v21 batches mode=${mode} processed=${processed} failed=${failed} submitted=${out.submitted ?? 0} success=${success}${systemicErrors ? ` systemic_errors=${systemicErrors}` : ""}`,
  });

  return new Response(JSON.stringify({ ...out, errors: errors.length ? errors : undefined }), {
    headers: { "Content-Type": "application/json" },
  });
});
