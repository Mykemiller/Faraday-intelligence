// CC-INGEST-STATE-INCENTIVE-API-1.0/1.1  (JPAS T7 Incentives, INC-01..05) — AUTO-204
// v1.1 (CC-BULLETIN-INCENTIVE-DIGEST-1.0 expansion, Myke decision 2026-07-08):
// the per-state fetchers became a config-driven Socrata source registry
// (mappers.ts) — 8 LIVE sources across NY/CT/MD/OR/DE + 24 registered-pending
// states with documented sources. Behavior contract unchanged from v1.0:
//   * windowed paging with {offset, pages}; {chain:true} self-invokes until done
//   * content-hash idempotent upsert into state_incentive_disclosures
//   * fn_state_incentives_resolve_and_score() per state each window (INC-01..05)
//   * per-source automation_health_log rows (auto_id AUTO-204; the dedicated
//     "State Incentive Disclosure Ingest" registry id, reassigned off the former
//     AUTO-178 collision with faraday-crawl-healthcheck, Myke-approved 2026-07-26)
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
// NOTE: SUPABASE_ANON_KEY was removed in v1.2. The chain hop used to authenticate
// with it and swallow the result; it now uses SERVICE_ROLE and checks the status.
const INGEST_SECRET = Deno.env.get("STATE_INCENTIVE_INGEST_SECRET") ?? "";
const NY_APP_TOKEN = Deno.env.get("DATA_NY_APP_TOKEN") ?? "";

const AUTO_ID = "AUTO-204";
const CRAWLER_ID = "ingest-state-incentives_v1.2";
const SCHEMA_VERSION = "v1";
const MAX_PER_SOURCE = 200000;
const PAGE_SIZE = 1000;
// v1.2 (CC-INGEST-STALLED-LANES-1.0): 8 → 4. See the chain-cursor note below.
const DEFAULT_PAGES_PER_CALL = 4;
// Hard ceiling on sources per isolate in chain mode. One source per hop is what
// makes each isolate's workload bounded and predictable; see below.
const SOURCES_PER_CHAIN_HOP = 1;

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
type Row = Record<string, unknown>;
// A single page of raw rows. `serverExhausted` is set only where the upstream
// tells us authoritatively there is no more (ArcGIS exceededTransferLimit) —
// needed because a hosted layer's maxRecordCount can be below our PAGE_SIZE.
type PageResult = { rows: Row[]; serverExhausted?: boolean };

async function fetchPage(src: LiveSource, off: number): Promise<PageResult> {
  const tag = `${src.state_abbr}/${src.source_key}`;
  if (src.kind === "socrata") {
    const url = `https://${src.domain}/resource/${src.dataset_id}.json` +
      `?$limit=${PAGE_SIZE}&$offset=${off}&$order=${encodeURIComponent(src.order_field ?? ":id")}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    // Socrata app token raises rate limits; the NY token works on any Socrata domain.
    if (NY_APP_TOKEN) headers["X-App-Token"] = NY_APP_TOKEN;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${tag} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { rows: await res.json() as Row[] };
  }
  if (src.kind === "ckan") {
    const url = `https://${src.ckan_domain}/api/3/action/datastore_search` +
      `?resource_id=${src.resource_id}&limit=${PAGE_SIZE}&offset=${off}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${tag} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json() as { success?: boolean; result?: { records?: Row[] }; error?: unknown };
    if (j.success === false) throw new Error(`${tag} ckan error: ${JSON.stringify(j.error).slice(0, 300)}`);
    return { rows: j.result?.records ?? [] };
  }
  if (src.kind === "idh_json") {
    const url = `https://${src.idh_domain}/api/v1/datasets/${src.idh_dataset}/rows.json` +
      `?limit=${PAGE_SIZE}&offset=${off}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${tag} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { rows: await res.json() as Row[] };
  }
  // arcgis (hosted FeatureServer layer) — stable keyset paging via orderByFields.
  const order = src.arcgis_order ?? "ObjectId";
  const url = `${src.arcgis_layer_url}/query?where=1%3D1&outFields=*&returnGeometry=false` +
    `&orderByFields=${encodeURIComponent(order)}&resultOffset=${off}&resultRecordCount=${PAGE_SIZE}&f=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${tag} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json() as { features?: { attributes: Row }[]; exceededTransferLimit?: boolean; error?: unknown };
  if (j.error) throw new Error(`${tag} arcgis error: ${JSON.stringify(j.error).slice(0, 300)}`);
  const rows = (j.features ?? []).map((f) => f.attributes);
  return { rows, serverExhausted: j.exceededTransferLimit !== true };
}

async function fetchWindow(src: LiveSource, offset: number, pages: number): Promise<WindowResult> {
  const records: CommonRecord[] = [];
  let exhausted = false;
  for (let p = 0; p < pages; p++) {
    const off = offset + p * PAGE_SIZE;
    if (off >= MAX_PER_SOURCE) { exhausted = true; break; }
    const { rows, serverExhausted } = await fetchPage(src, off);
    for (const row of rows) records.push(src.map(row));
    // Short page ⇒ end of feed. For ArcGIS, a full page whose response also
    // reports no overflow (serverExhausted) is likewise the last page.
    if (rows.length < PAGE_SIZE || serverExhausted === true) { exhausted = true; break; }
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
      const { records, exhausted } = await fetchWindow(src, offset, pages);
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
                                kind: src.kind,
                                dataset: src.dataset_id ?? src.resource_id ?? src.idh_dataset ?? src.arcgis_layer_url,
                                offset, next_offset }),
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
              offset?: number; pages?: number; chain?: boolean;
              source_index?: number } = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }

  if (INGEST_SECRET && body.secret !== INGEST_SECRET) return json({ error: "unauthorized" }, 401);

  const offset = Math.max(0, body.offset ?? 0);
  const pages = Math.max(1, body.pages ?? DEFAULT_PAGES_PER_CALL);
  const chain = body.chain === true;
  const srcIndex = Math.max(0, body.source_index ?? 0);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const wantedStates = body.states?.map((s) => s.toUpperCase());
  const wantedSources = body.sources?.map((s) => s.toLowerCase());
  let live = wantedStates ? LIVE_SOURCES.filter((a) => wantedStates.includes(a.state_abbr)) : LIVE_SOURCES;
  if (wantedSources) live = live.filter((a) => wantedSources.includes(a.source_key));

  if (chain) {
    // ── v1.2 chain cursor: (source_index, offset), NOT offset alone ────────────
    //
    // THE BUG THIS FIXES (CC-INGEST-STALLED-LANES-1.0, diagnosed 2026-08-08):
    // v1.1 looped over ALL 13 live sources inside a single isolate. Every weekly
    // cron run since 2026-07-12 got through exactly 3 sources / 18,204 records —
    // byte-identical on 07-12, 07-19 and 08-02 — and then stopped. Sources 4..13
    // produced NO health rows at all, not even error rows, even though every
    // source body is individually try/caught. A thrown error would have logged;
    // silence means the isolate was TERMINATED (resource budget) rather than
    // throwing, so no catch block ran and the chain hop was never dispatched.
    // MD, the 4th source, was verified reachable and fast (HTTP 200 in 0.64s), so
    // this was not an upstream hang.
    //
    // Consequence: 10 of the 12 fetchable sources were not polled at all between
    // 2026-07-08 and 2026-08-08, and no source was ever read past offset 0 — on
    // ny_esd_dei that is the first 8,000 rows of a 65,237-row feed.
    //
    // The exposure was LATENT, not realised: a full re-walk on 2026-08-08 (every
    // source to next_offset=null, ny_esd_dei across all 9 windows) inserted ZERO
    // new rows. Do not read a row-count delta as data loss here — ny_esd_dei
    // holds 65,197 against an upstream count of 65,237, but those 40 are
    // duplicate records WITHIN the feed that collapse under the content hash
    // (md_commerce 7,300→7,246 and ok_quality 4,324→4,217 behave the same way).
    // The bug was real and would have lost the next genuine upstream change; it
    // just had not cost anything yet.
    //
    // The fix is to make the unit of work per isolate ONE source (and at most
    // `pages` pages of it), then hop. Work per invocation is now bounded and
    // roughly constant instead of scaling with the size of the source registry,
    // so adding a 14th source can never re-break the 13 before it.
    const selfUrl = `${SUPABASE_URL}/functions/v1/ingest-state-incentives`;

    if (srcIndex >= live.length) {
      return json({ ok: true, mode: "chain", auto_id: AUTO_ID, done: true,
                    sources_total: live.length }, 200);
    }

    const slice = live.slice(srcIndex, srcIndex + SOURCES_PER_CHAIN_HOP);

    EdgeRuntime.waitUntil((async () => {
      const { anyLiveMore } = await runWindow(
        sb, slice, wantedStates, offset, pages,
        /* logPending only on the very first hop */ srcIndex === 0 && offset === 0,
      );

      // More pages of THIS source, else advance to the next source.
      const next = anyLiveMore
        ? { source_index: srcIndex, offset: offset + pages * PAGE_SIZE }
        : { source_index: srcIndex + SOURCES_PER_CHAIN_HOP, offset: 0 };
      if (next.source_index >= live.length) return; // whole registry walked

      // v1.1 authenticated the hop with SUPABASE_ANON_KEY and swallowed every
      // outcome via .catch(() => {}). fetch() only rejects on transport errors, so
      // a 401/5xx hop resolved normally and vanished. Use the service-role key
      // (the same credential this function already runs on) and record a failed
      // hop in automation_health_log — a broken chain must never be silent again.
      try {
        const res = await fetch(selfUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_ROLE}`,
            "apikey": SERVICE_ROLE,
          },
          body: JSON.stringify({
            states: wantedStates, sources: wantedSources,
            ...next, pages, chain: true,
            ...(INGEST_SECRET ? { secret: INGEST_SECRET } : {}),
          }),
        });
        if (!res.ok) throw new Error(`hop ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } catch (e) {
        const nowIso = new Date().toISOString();
        await sb.from("automation_health_log").insert({
          log_id: crypto.randomUUID(), auto_id: AUTO_ID, crawler_id: CRAWLER_ID,
          run_started_at: nowIso, run_completed_at: nowIso,
          artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: false,
          errors: { message: String(e instanceof Error ? e.message : e) },
          notes: JSON.stringify({ status: "chain_hop_failed", ...next }),
        });
      }
    })());

    return json({ ok: true, mode: "chain", auto_id: AUTO_ID,
                  source_index: srcIndex, source_key: slice[0]?.source_key ?? null,
                  offset, sources_total: live.length, dispatched: true }, 202);
  }

  // Non-chain (manual / narrow backfill) keeps v1.1 behaviour: caller controls the
  // scope, so caller owns the workload. Prefer `sources` to keep it small.
  const { results } = await runWindow(sb, live, wantedStates, offset, pages, offset === 0);
  return json({ ok: true, crawler_id: CRAWLER_ID, auto_id: AUTO_ID, ran: results.length, results });
});
