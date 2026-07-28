// ingest-state-incentives-push (CC-INGEST-STATE-INCENTIVE-ALL-WAVES, Wave 3 headless-scraper path)
// Accepts recipient rows ALREADY parsed by the Playwright scraper (which runs in
// GitHub Actions — a real browser with open egress — because the JS/bot-gated
// Tier-B portals can't be fetched by the edge runtime). Runs the SAME
// content-hash upsert into state_incentive_disclosures + fn_state_incentives_
// resolve_and_score (INC-01..05) as the fetch-based ingest-state-incentives fn.
//
// Scraped sources are registered at confidence_cap='INF' (migration 0036), so
// they score INF/0.60, never SRC. Idempotent (content_hash). Auth: verify_jwt=
// false + STATE_INCENTIVE_INGEST_SECRET in the body (same gate as the fetch fn).
//
// Body: { source_key, state_abbr, rows: PushRow[], secret, run_id? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildPushRow, contentHash, validatePushBody } from "./push-pure.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_SECRET = Deno.env.get("STATE_INCENTIVE_INGEST_SECRET") ?? "";

const AUTO_ID = "AUTO-204";
const CRAWLER_ID = "ingest-state-incentives-push_v1";
const SCHEMA_VERSION = "v1";
const CHUNK = 1000;

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  let body: {
    source_key?: string; state_abbr?: string; rows?: Record<string, unknown>[];
    secret?: string; run_id?: string;
  } = {};
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  if (INGEST_SECRET && body.secret !== INGEST_SECRET) return json({ error: "unauthorized" }, 401);

  const verr = validatePushBody(body);
  if (verr) return json({ error: verr }, 400);

  const sourceKey = body.source_key!;
  const stateAbbr = body.state_abbr!.toUpperCase();
  const rawRows = body.rows!;
  const started = new Date().toISOString();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    // Confirm the source is registered (and, ideally, as INF). We don't reject on
    // an unregistered source — the resolve/score fn defaults it to EST/0.40 — but
    // we surface it so an unregistered scrape is visible, not silently downgraded.
    const { data: reg } = await sb.from("jw_data_source_registry")
      .select("confidence_cap, feed_status").eq("source_key", sourceKey).maybeSingle();

    let inserted = 0, found = 0;
    const seen = new Set<string>();
    for (let i = 0; i < rawRows.length; i += CHUNK) {
      const slice = rawRows.slice(i, i + CHUNK);
      const rows: Record<string, unknown>[] = [];
      for (const raw of slice) {
        const rec = buildPushRow(raw ?? {}, sourceKey, stateAbbr);
        if (!rec.recipient_name && !rec.project_name) continue; // skip empty rows
        found++;
        const hash = await contentHash(rec);
        if (seen.has(hash)) continue;
        seen.add(hash);
        rows.push({ ...rec, state_source_schema_version: SCHEMA_VERSION, content_hash: hash });
      }
      if (!rows.length) continue;
      const { data, error } = await sb.from("state_incentive_disclosures")
        .upsert(rows, { onConflict: "content_hash", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(`upsert: ${error.message}`);
      inserted += data?.length ?? 0;
    }

    const { data: rpc, error: rpcErr } = await sb
      .rpc("fn_state_incentives_resolve_and_score", { p_state_abbr: stateAbbr });

    await sb.from("automation_health_log").insert({
      log_id: crypto.randomUUID(), auto_id: AUTO_ID, crawler_id: CRAWLER_ID,
      run_started_at: started, run_completed_at: new Date().toISOString(),
      artifacts_found: found, artifacts_new: inserted, artifacts_duped: found - inserted,
      success: !rpcErr,
      errors: rpcErr ? { message: rpcErr.message } : null,
      notes: JSON.stringify({
        state: stateAbbr, source_key: sourceKey, mode: "push", run_id: body.run_id ?? null,
        registered_cap: reg?.confidence_cap ?? "UNREGISTERED", resolve: rpc ?? null,
      }),
    });

    return json({
      ok: true, crawler_id: CRAWLER_ID, auto_id: AUTO_ID, state: stateAbbr, source_key: sourceKey,
      found, new: inserted, duped: found - inserted,
      registered_cap: reg?.confidence_cap ?? "UNREGISTERED",
      resolve: rpcErr ? { error: rpcErr.message } : rpc,
    });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    await sb.from("automation_health_log").insert({
      log_id: crypto.randomUUID(), auto_id: AUTO_ID, crawler_id: CRAWLER_ID,
      run_started_at: started, run_completed_at: new Date().toISOString(),
      artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: false,
      errors: { message: msg },
      notes: JSON.stringify({ state: stateAbbr, source_key: sourceKey, mode: "push", run_id: body.run_id ?? null }),
    }).catch(() => {});
    return json({ ok: false, error: msg }, 500);
  }
});
