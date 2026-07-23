// grid-buildout-sync — FAR-379 ISO/RTO transmission-plan adapter. Lands rich
// project records into grid_buildout_projects and projects each named substation
// endpoint into substation_source_mentions, then calls far379_resolve_and_grade
// to write commissioned_year for the high-confidence actual-date cohort.
//
// Registry-driven sibling of source-poller / dc-hub-sync; same auth + health-log
// posture. Pure normalization/classification lives in adapters-pure.ts.
//
// Modes (POST JSON):
//   {mode:"status"}                       — gbp counts + last run (no writes)
//   {mode:"run", source:"ercot",          — ingest a batch. `projects` may be
//     projects?[], resolve?:true}           supplied inline (replay/seed); when
//                                            absent the handler fetches the live
//                                            TPIT workbook (deploy-gated below).
//
// Auth: fcron house token (SHA-256 compare) or service-role key. verify_jwt=false.
// Boundaries: writes ONLY grid_buildout_projects, substation_source_mentions,
//   substations.commissioned_year (via far379_resolve_and_grade), and
//   automation_health_log. Zero JPAS/JPS/JDS writes.
//
// ── DEPLOY GATE ─────────────────────────────────────────────────────────────
// NOT cron-wired / NOT deployed by this PR. Blocked on:
//   1. Live TPIT workbook fetch: ERCOT.com 403s automated fetchers in-session;
//      production pulls pg7-048-m server-side (allow-listed egress) or via the
//      Postgres http extension. xlsx parsing is stubbed (fetchLiveProjects).
//   2. MISO (Appendix A) + PJM (RTEP) adapters are phase-2 (normalizeMiso/Pjm).
//   3. An AUTO id in the Airtable Automation Registry (AUTO_ID placeholder).

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  GridBuildoutProject,
  normalizeErcotTpit,
  projectFingerprint,
  SubstationMention,
} from "./adapters-pure.ts";

const CRAWLER_ID = "grid-buildout-sync_v0.1";
const AUTO_ID = Deno.env.get("GRID_BUILDOUT_AUTO_ID") ?? "AUTO-FAR379-UNREGISTERED";
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

/** county_raw ("Dickens") + state → 5-digit FIPS, via the ref_counties lookup. */
async function resolveCountyFips(state: string | null, countyRaw: string | null): Promise<string | null> {
  if (!state || !countyRaw) return null;
  const { data } = await supabase
    .from("ref_counties")
    .select("county_fips")
    .eq("state_abbr", state)
    .ilike("county_name", countyRaw)
    .limit(1);
  return data?.[0]?.county_fips ?? null;
}

/**
 * Live TPIT fetch — DEPLOY-GATED. ERCOT.com 403s in-session; production reads
 * data product pg7-048-m (xlsx: Future/Completed/Cancelled/RTP tabs) from an
 * allow-listed egress and maps each tab through normalizeErcotTpit(row, tab).
 * Left unimplemented on purpose so the gate is explicit, not silent.
 */
async function fetchLiveProjects(_source: string): Promise<{ project: GridBuildoutProject; mentions: SubstationMention[] }[]> {
  throw new Error("live TPIT fetch is deploy-gated (see header) — supply `projects` inline to run");
}

async function runSync(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const startedIso = new Date().toISOString();
  const source = String(body.source ?? "ercot");
  const errors: string[] = [];
  let found = 0, inserted = 0, skipped = 0, mentionsLanded = 0;

  try {
    // Inline projects (replay/seed) or live fetch (gated).
    let batch: { project: GridBuildoutProject; mentions: SubstationMention[] }[];
    if (Array.isArray(body.projects)) {
      batch = (body.projects as Record<string, unknown>[])
        .map((r) => normalizeErcotTpit(r, String(r.__section ?? r.section ?? "future")))
        .filter((x): x is NonNullable<typeof x> => x !== null);
    } else {
      batch = await fetchLiveProjects(source);
    }
    found = batch.length;

    for (const { project, mentions } of batch) {
      const hash = await sha256hex(projectFingerprint(project));
      const { data: prior } = await supabase
        .from("grid_buildout_projects")
        .select("id, content_hash")
        .eq("source_key", project.source_key)
        .eq("source_ref", project.source_ref)
        .limit(1);
      if (prior?.[0]?.content_hash === hash) { skipped++; continue; }

      const countyFips = await resolveCountyFips(project.state_abbr, project.county_raw);
      const { data: up, error } = await supabase
        .from("grid_buildout_projects")
        .upsert({ ...project, county_fips: countyFips, content_hash: hash, last_seen_at: new Date().toISOString() },
                { onConflict: "source_key,source_ref" })
        .select("id")
        .limit(1);
      if (error) { errors.push(`gbp ${project.source_ref}: ${error.message.slice(0, 160)}`); continue; }
      inserted++;
      const gbpId = up?.[0]?.id;

      for (const mn of mentions) {
        const mHash = await sha256hex(`${project.source_key}|${project.source_ref}|${mn.extracted_name_frag}`);
        const { error: mErr } = await supabase.from("substation_source_mentions").upsert({
          source_type: "iso_transmission_plan",
          source_table: "grid_buildout_projects",
          source_record_id: project.source_ref,
          grid_buildout_project_id: gbpId,
          raw_mention_text: project.project_name,
          extracted_name_frag: mn.extracted_name_frag,
          extracted_voltage_kv: mn.extracted_voltage_kv,
          county_fips_hint: countyFips,
          state_abbr_hint: mn.state_abbr_hint,
          extracted_inservice_date: mn.extracted_inservice_date,
          extracted_date_type: mn.extracted_date_type,
          extraction_confidence: mn.extraction_confidence,
          resolution_status: "pending",
          content_hash: mHash,
        }, { onConflict: "content_hash" });
        if (mErr) { errors.push(`mention ${mn.extracted_name_frag}: ${mErr.message.slice(0, 120)}`); continue; }
        mentionsLanded++;
      }
    }

    if (body.resolve !== false) {
      await supabase.rpc("far379_resolve_and_grade", { p_source_type: "iso_transmission_plan" });
    }
  } catch (e) {
    errors.push(String((e as Error).message ?? e));
  }

  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID, crawler_id: CRAWLER_ID,
    run_started_at: startedIso, run_completed_at: new Date().toISOString(),
    artifacts_found: found, artifacts_new: inserted, artifacts_duped: skipped,
    errors, success: errors.length === 0,
    notes: `grid-buildout-sync source=${source} found=${found} gbp=${inserted} skipped=${skipped} mentions=${mentionsLanded}`,
  });

  return { ok: errors.length === 0, source, found, gbp_upserted: inserted, skipped, mentions: mentionsLanded, errors };
}

async function status(): Promise<Record<string, unknown>> {
  const { count } = await supabase
    .from("grid_buildout_projects").select("id", { count: "exact", head: true });
  const { data: lastRun } = await supabase
    .from("automation_health_log").select("run_completed_at, success, notes")
    .eq("auto_id", AUTO_ID).order("run_completed_at", { ascending: false }).limit(1);
  return { ok: true, grid_buildout_projects: count ?? 0, last_run: lastRun?.[0] ?? null, auto_id: AUTO_ID };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode = String(body.mode ?? "status");
  if (mode === "status") return j(await status());
  if (mode === "run") return j(await runSync(body));
  return j({ error: `unknown mode: ${mode}` }, 400);
});
