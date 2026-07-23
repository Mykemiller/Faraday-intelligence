// puc-substation-extract — FAR-379 PUC source (D1-refined). Screens
// puc_dockets for substation-vintage candidates off docket_title, lands rich
// records into grid_buildout_projects + mentions into
// substation_source_mentions, and (deploy-gated) fetches the filing PDF to
// upgrade projected → actual dates before far379_resolve_and_grade runs.
//
// Registry-driven sibling of source-poller; same auth + health-log posture.
// Deterministic screening/parsing lives in puc-pure.ts.
//
// Modes (POST JSON):
//   {mode:"status"}                    — candidate/gbp counts + last run
//   {mode:"run", limit?, fetch_pdf?}   — screen candidate dockets, land records
//
// Auth: fcron house token (SHA-256) or service-role key. verify_jwt=false.
// Boundaries: writes ONLY grid_buildout_projects, substation_source_mentions,
//   substations.commissioned_year (via RPC), automation_health_log. Zero
//   JPAS/JPS/JDS writes.
//
// ── DEPLOY GATE ─────────────────────────────────────────────────────────────
//   1. PDF actual-date extraction (fetchActualDate) is stubbed: needs an LLM
//      key + the Postgres http extension to fetch source_url server-side
//      (session egress 403s PUCT). Without it, candidates land as
//      approved/projected (EST) → no grade, which is correct for the
//      application-stage corpus today (I4).
//   2. An AUTO id in the Airtable Automation Registry (AUTO_ID placeholder).

import { createClient } from "npm:@supabase/supabase-js@2";
import { docketToMentions, screenDocket } from "./puc-pure.ts";

const CRAWLER_ID = "puc-substation-extract_v0.1";
const AUTO_ID = Deno.env.get("PUC_SUBSTATION_AUTO_ID") ?? "AUTO-FAR379-PUC-UNREGISTERED";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";

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
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const envToken = Deno.env.get("CRON_TOKEN");
  if (envToken && token === envToken) return true;
  return (await sha256hex(token)) === CRON_TOKEN_FALLBACK_SHA256;
}
function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// state FIPS (puc_dockets.state_fips) → USPS abbr for the mention hints.
const STATE_ABBR: Record<string, string> = { "48": "TX", "51": "VA" };

async function resolveCountyFips(state: string | null, countyRaw: string | null): Promise<string | null> {
  if (!state || !countyRaw) return null;
  const { data } = await supabase
    .from("ref_counties").select("county_fips")
    .eq("state_abbr", state).ilike("county_name", countyRaw).limit(1);
  return data?.[0]?.county_fips ?? null;
}

/** DEPLOY-GATED: fetch source_url PDF and LLM-extract an actual energization date. */
async function fetchActualDate(_sourceUrl: string | null): Promise<{ date: string; type: "actual" } | null> {
  return null; // gate: no LLM key / egress in-session — see header
}

async function runExtract(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const startedIso = new Date().toISOString();
  const limit = Math.min(Number(body.limit ?? 200), 1000);
  const doPdf = body.fetch_pdf === true;
  const errors: string[] = [];
  let screened = 0, candidates = 0, gbp = 0, mentions = 0;

  try {
    const { data: dockets, error } = await supabase
      .from("puc_dockets")
      .select("id, state_fips, docket_number, docket_title, docket_type, utility_name, source_url, filed_date")
      .in("docket_type", ["transmission", "interconnection", "other"])
      .limit(limit);
    if (error) throw new Error(error.message);

    for (const d of dockets ?? []) {
      screened++;
      const cand = screenDocket(d);
      if (!cand.is_candidate) continue;
      candidates++;

      const stateAbbr = STATE_ABBR[d.state_fips ?? ""] ?? null;
      const countyFips = await resolveCountyFips(stateAbbr, cand.county_raw);

      let dateType = cand.date_type;
      let actualDate: string | null = null;
      if (doPdf && dateType !== "actual") {
        const got = await fetchActualDate(d.source_url).catch(() => null);
        if (got) { dateType = got.type; actualDate = got.date; }
      }

      const ref = `${d.docket_number}`;
      const hash = await sha256hex([ref, cand.substation_names.join("|"), cand.voltage_kv, dateType].join("|"));
      const { data: up, error: gErr } = await supabase.from("grid_buildout_projects").upsert({
        source_type: "puc_filing",
        source_key: "puc:substation-commission",
        source_ref: ref,
        iso_rto: null,
        state_abbr: stateAbbr,
        county_fips: countyFips,
        county_raw: cand.county_raw,
        project_name: d.docket_title,
        project_description: d.docket_title,
        driver: cand.is_transmission_siting ? "reliability" : null,
        is_large_load_dc: /data center|large load/i.test(d.docket_title ?? ""),
        voltage_kv: cand.voltage_kv,
        substation_names: cand.substation_names,
        tariff_flag: /tariff|rate class|large load/i.test(d.docket_title ?? ""),
        docket_number: d.docket_number,
        utility_name: d.utility_name,
        planned_inservice_date: null,
        actual_inservice_date: actualDate,
        date_type: dateType,
        project_status: cand.is_transmission_siting ? "approved" : null,
        confidence_tier: dateType === "actual" ? "SRC" : "EST",
        raw: { docket_title: d.docket_title, docket_type: d.docket_type, source_url: d.source_url },
        content_hash: hash,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "source_key,source_ref" }).select("id").limit(1);
      if (gErr) { errors.push(`gbp ${ref}: ${gErr.message.slice(0, 120)}`); continue; }
      gbp++;
      const gbpId = up?.[0]?.id;

      for (const mn of docketToMentions(cand, countyFips, stateAbbr)) {
        if (actualDate) { mn.extracted_inservice_date = actualDate; mn.extracted_date_type = "actual"; mn.extraction_confidence = 0.85; }
        const mHash = await sha256hex(`puc|${ref}|${mn.extracted_name_frag}`);
        const { error: mErr } = await supabase.from("substation_source_mentions").upsert({
          source_type: "puc_filing",
          source_table: "puc_dockets",
          source_record_id: d.id,
          grid_buildout_project_id: gbpId,
          raw_mention_text: d.docket_title,
          extracted_name_frag: mn.extracted_name_frag,
          extracted_voltage_kv: mn.extracted_voltage_kv,
          county_fips_hint: mn.county_fips_hint,
          state_abbr_hint: mn.state_abbr_hint,
          extracted_inservice_date: mn.extracted_inservice_date,
          extracted_date_type: mn.extracted_date_type,
          extraction_confidence: mn.extraction_confidence,
          resolution_status: "pending",
          content_hash: mHash,
        }, { onConflict: "content_hash" });
        if (mErr) { errors.push(`mention ${mn.extracted_name_frag}: ${mErr.message.slice(0, 100)}`); continue; }
        mentions++;
      }
    }

    if (body.resolve !== false) {
      await supabase.rpc("far379_resolve_and_grade", { p_source_type: "puc_filing" });
    }
  } catch (e) {
    errors.push(String((e as Error).message ?? e));
  }

  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID, crawler_id: CRAWLER_ID,
    run_started_at: startedIso, run_completed_at: new Date().toISOString(),
    artifacts_found: candidates, artifacts_new: gbp, artifacts_duped: screened - candidates,
    errors, success: errors.length === 0,
    notes: `puc-substation-extract screened=${screened} candidates=${candidates} gbp=${gbp} mentions=${mentions} pdf=${doPdf}`,
  });

  return { ok: errors.length === 0, screened, candidates, gbp_upserted: gbp, mentions, pdf_fetched: doPdf, errors };
}

async function status(): Promise<Record<string, unknown>> {
  const { count } = await supabase
    .from("grid_buildout_projects").select("id", { count: "exact", head: true })
    .eq("source_key", "puc:substation-commission");
  const { data: lastRun } = await supabase
    .from("automation_health_log").select("run_completed_at, success, notes")
    .eq("auto_id", AUTO_ID).order("run_completed_at", { ascending: false }).limit(1);
  return { ok: true, puc_gbp_rows: count ?? 0, last_run: lastRun?.[0] ?? null, auto_id: AUTO_ID };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode = String(body.mode ?? "status");
  if (mode === "status") return j(await status());
  if (mode === "run") return j(await runExtract(body));
  return j({ error: `unknown mode: ${mode}` }, 400);
});
