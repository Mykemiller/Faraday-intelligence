// CC-INGEST-STATE-INCENTIVE-API-1.0/1.1  (JPAS T7 Incentives, INC-01..05) — AUTO-178
// v1.1 (CC-BULLETIN-INCENTIVE-DIGEST-1.0 expansion, Myke decision 2026-07-08):
// the per-state fetchers became a config-driven Socrata source registry
// (mappers.ts) — 8 LIVE sources across NY/CT/MD/OR/DE + 24 registered-pending
// states with documented sources. Behavior contract unchanged from v1.0:
//   * windowed paging with {offset, pages}; {chain:true} self-invokes until done
//   * content-hash idempotent upsert into state_incentive_disclosures
//   * fn_state_incentives_resolve_and_score() per state each window (INC-01..05)
//   * per-source automation_health_log rows (auto_id AUTO-178; NOTE: AUTO-178
//     collides with faraday-crawl-healthcheck in the registry — kept until the
//     registry reassignment is granted, so telemetry stays continuous)
// The bulletin digest does NOT run here — bulletin-incentive-digest sweeps the
// landing table on its own weekly cron (clean write boundary).
//
// Auth: verify_jwt=false (cron-callable). If STATE_INCENTIVE_INGEST_SECRET is set,
// the request body must carry a matching secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type CommonRecord, LIVE_SOURCES, PENDING_SOURCES, type LiveSource,
} from "./mappers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("STATE_INCENTIVE_INGEST_SECRET") ?? "";
const NY_APP_TOKEN = Deno.env.get("DATA_NY_APP_TOKEN") ?? "";

const AUTO_ID = "AUTO-178";
const CRAWLER_ID = "ingest-state-incentives_v1.1";
const SCHEMA_VERSION = "v1";
const MAX_PER_SOURCE = 200000;
const PAGE_SIZE = 1000;
const DEFAULT_PAGES_PER_CALL = 8;

async function contentHash(r: CommonRecord): Promise<string> {
  const basis = [
    r.state_abbr, r.source_key, r.source_record_id ?? "",
    r.recipient_name ?? "", r.program_name ?? "", r.raw_incentive_type ?? "",
    r.award_value_usd ?? "", r.term_start ?? "", r.term_end ?? "", r.county_name ?? "",
  ].join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type WindowResult = { records: CommonRecord[]; exhausted: boolean };

async function fetchSocrataWindow(src: LiveSource, offset: number, pages: number): Promise<WindowResult> {
  const records: CommonRecord[] = [];
  let exhausted = false;
  for (let p = 0; p < pages; p++) {
    const off = offset + p * PAGE_SIZE;
    if (off >= MAX_PER_SOURCE) { exhausted = true; break; }
    const url = `https://${src.domain}/resource/${src.dataset_id}.json` +
      `?$limit=${PAGE_SIZE}&$offset=${off}&$order=${encodeURIComponent(src.order_field)}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    // Socrata app token raises rate limits; the NY token works on any Socrata domain.
    if (NY_APP_TOKEN) headers["X-App-Token"] = NY_APP_TOKEN;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${src.domain}/${src.dataset_id} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = await res.json() as Record<string, unknown>[];
    for (const row of rows) records.push(src.map(row));
    if (rows.length < PAGE_SIZE) { exhausted = true; break; }
  }
  return { records, exhausted };
}

async function runWindow(
  sb: ReturnType<typeof createClient>,
  liveSources: LiveSource[],
  wantedStates: string[] | undefined,
  offset: number,
  pages: number,
  logPending: boolean,
): Promise<{ results: unknown[]; anyLiveMore: boolean }> {
  const results: unknown[] = [];
  let anyLiveMore = false;
  const logBase = { auto_id: AUTO_ID, crawler_id: CRAWLER_ID };

  if (logPending) {
    const pendings = wantedStates
      ? PENDING_SOURCES.filter((p) => wantedStates.includes(p.state_abbr))
      : PENDING_SOURCES;
    for (const p of pendings) {
      const now = new Date().toISOString();
      await sb.from("automation_health_log").insert({
        log_id: crypto.randomUUID(), ...logBase,
        run_started_at: now, run_completed_at: now,
        artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: true,
        notes: JSON.stringify({ state: p.state_abbr, status: "pending_source_confirmation",
                                source_key: p.source_key, source_url: p.source_url, note: p.note }),
      });
      results.push({ state: p.state_abbr, source_key: p.source_key, status: "pending_source_confirmation" });
    }
  }

  const touchedStates = new Set<string>();
  for (const src of liveSources) {
    const started = new Date().toISOString();
    try {
      const { records, exhausted } = await fetchSocrataWindow(src, offset, pages);
      if (!exhausted) anyLiveMore = true;

      let inserted = 0;
      const seen = new Set<string>();
      for (let i = 0; i < records.length; i += PAGE_SIZE) {
        const slice = records.slice(i, i + PAGE_SIZE);
        const rows: Record<string, unknown>[] = [];
        for (const r of slice) {
          const hash = await contentHash(r);
          if (seen.has(hash)) continue;
          seen.add(hash);
          rows.push({ ...r, state_source_schema_version: SCHEMA_VERSION, content_hash: hash });
        }
        if (!rows.length) continue;
        const { data, error } = await sb
          .from("state_incentive_disclosures")
          .upsert(rows, { onConflict: "content_hash", ignoreDuplicates: true })
          .select("id");
        if (error) throw new Error(`upsert: ${error.message}`);
        inserted += data?.length ?? 0;
      }
      touchedStates.add(src.state_abbr);

      const next_offset = exhausted ? null : offset + pages * PAGE_SIZE;
      await sb.from("automation_health_log").insert({
        log_id: crypto.randomUUID(), ...logBase,
        run_started_at: started, run_completed_at: new Date().toISOString(),
        artifacts_found: records.length,
        artifacts_new: inserted,
        artifacts_duped: records.length - inserted,
        success: true,
        notes: JSON.stringify({ state: src.state_abbr, status: "live", source_key: src.source_key,
                                dataset: src.dataset_id, offset, next_offset }),
      });
      results.push({ state: src.state_abbr, source_key: src.source_key, status: "live",
                     offset, found: records.length, new: inserted, next_offset });
    } catch (e) {
      await sb.from("automation_health_log").insert({
        log_id: crypto.randomUUID(), ...logBase,
        run_started_at: started, run_completed_at: new Date().toISOString(),
        artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: false,
        errors: { message: String(e instanceof Error ? e.message : e) },
        notes: JSON.stringify({ state: src.state_abbr, status: "error",
                                source_key: src.source_key, offset }),
      });
      results.push({ state: src.state_abbr, source_key: src.source_key, status: "error",
                     error: String(e instanceof Error ? e.message : e) });
    }
  }

  // Resolve + INC-score once per touched state (idempotent; window-scoped work only).
  for (const st of touchedStates) {
    const { data: rpc, error: rpcErr } = await sb
      .rpc("fn_state_incentives_resolve_and_score", { p_state_abbr: st });
    if (rpcErr) {
      results.push({ state: st, status: "resolve_error", error: rpcErr.message });
    } else {
      results.push({ state: st, status: "resolved", resolve: rpc });
    }
  }

  return { results, anyLiveMore };
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  let body: { states?: string[]; sources?: string[]; secret?: string;
              offset?: number; pages?: number; chain?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }

  if (INGEST_SECRET && body.secret !== INGEST_SECRET) return json({ error: "unauthorized" }, 401);

  const offset = Math.max(0, body.offset ?? 0);
  const pages = Math.max(1, body.pages ?? DEFAULT_PAGES_PER_CALL);
  const chain = body.chain === true;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const wantedStates = body.states?.map((s) => s.toUpperCase());
  const wantedSources = body.sources?.map((s) => s.toLowerCase());
  let live = wantedStates ? LIVE_SOURCES.filter((a) => wantedStates.includes(a.state_abbr)) : LIVE_SOURCES;
  if (wantedSources) live = live.filter((a) => wantedSources.includes(a.source_key));

  if (chain) {
    const selfUrl = `${SUPABASE_URL}/functions/v1/ingest-state-incentives`;
    EdgeRuntime.waitUntil((async () => {
      const { anyLiveMore } = await runWindow(sb, live, wantedStates, offset, pages, offset === 0);
      if (anyLiveMore) {
        await fetch(selfUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${ANON_KEY}`,
            "apikey": ANON_KEY,
          },
          body: JSON.stringify({
            states: wantedStates, sources: wantedSources,
            offset: offset + pages * PAGE_SIZE, pages, chain: true,
            ...(INGEST_SECRET ? { secret: INGEST_SECRET } : {}),
          }),
        }).catch(() => {/* next hop failure is captured by its own telemetry */});
      }
    })());
    return json({ ok: true, mode: "chain", auto_id: AUTO_ID, offset, dispatched: true }, 202);
  }

  const { results } = await runWindow(sb, live, wantedStates, offset, pages, offset === 0);
  return json({ ok: true, crawler_id: CRAWLER_ID, auto_id: AUTO_ID, ran: results.length, results });
});
