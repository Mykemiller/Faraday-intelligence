// eia-retired-sync — CC-RSC-STRANDED-INDUSTRIAL-1.0. Lands the EIA-860M "Retired"
// tab (comprehensive back-list of grid generators retired since 2002) into
// eia_retired_generators. A stranded-power-plant proxy — retired >=1MW GRID units,
// NOT captive industrial powerhouses (EIA-860 reporting threshold). Free / public
// domain. Sibling of grid-buildout-sync; same auth + health-log posture.
//
// Modes (POST JSON):
//   {mode:"status"}                     — counts + last run (no writes)
//   {mode:"run", rows?:[...], url?}     — ingest. `rows` (parsed retired-tab objects)
//                                         may be supplied inline for replay/validation;
//                                         when absent the handler fetches + parses the
//                                         live 860M workbook (deploy-gated).
//
// Auth: fcron house token (SHA-256) or service-role key. verify_jwt=false.
// Boundaries: writes ONLY eia_retired_generators + automation_health_log.
//
// ── DEPLOY GATE ─────────────────────────────────────────────────────────────
// NOT cron-wired / NOT deployed by this PR. Blocked on:
//   1. Egress to eia.gov (denied to in-session fetchers; Edge runtime egress is
//      server-side). Validate with a {mode:"run", rows:[...]} seed first.
//   2. Live workbook URL + sheet name confirmed against the current 860M vintage
//      (EIA_860M_URL env). County→FIPS resolved via ref_counties (like grid-buildout).
//   3. XLSX parse via npm:xlsx — PROVISIONAL header mapping in pure.ts.

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { EiaRetiredRow, normalizeRetired, retiredBasis } from "./pure.ts";

const CRAWLER_ID = "eia-retired-sync_v0.1";
const AUTO_ID = Deno.env.get("EIA_RETIRED_AUTO_ID") ?? "AUTO-EIARE-UNREGISTERED";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const EIA_860M_URL = Deno.env.get("EIA_860M_URL") ?? "https://www.eia.gov/electricity/data/eia860m/xls/august_generator2026.xlsx";
const RETIRED_SHEET = "Retired";

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
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

async function logHealth(status: string, found: number, extra: Record<string, unknown> = {}) {
  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID, crawler_id: CRAWLER_ID, status, records_found: found,
    detail: extra, ran_at: new Date().toISOString(),
  });
}

/** county name + state → 5-digit FIPS via ref_counties (repo convention). */
async function resolveFips(state: string | null, county: string | null): Promise<string | null> {
  if (!state || !county) return null;
  const { data } = await supabase.from("ref_counties").select("county_fips")
    .eq("state_abbr", state).ilike("county_name", county).maybeSingle();
  return (data?.county_fips as string) ?? null;
}

async function ingest(rows: EiaRetiredRow[]): Promise<number> {
  const out: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const n = normalizeRetired(raw);
    if (!n) continue;
    out.push({ ...n, county_fips: await resolveFips(n.state, n.county), source: "eia:860m", source_hash: await sha256hex(retiredBasis(n)) });
  }
  // Chunked upsert to stay within statement limits.
  for (let i = 0; i < out.length; i += 500) {
    await supabase.from("eia_retired_generators")
      .upsert(out.slice(i, i + 500), { onConflict: "plant_code,generator_id", ignoreDuplicates: false });
  }
  return out.length;
}

async function fetchLive(url: string): Promise<EiaRetiredRow[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`eia fetch http_${res.status}`);
  const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
  const sheet = wb.Sheets[RETIRED_SHEET] ?? wb.Sheets[wb.SheetNames.find((s) => /retire/i.test(s)) ?? ""];
  if (!sheet) throw new Error("Retired sheet not found");
  // 860M tabs carry a 1-row banner above headers → range offset 1.
  return XLSX.utils.sheet_to_json<EiaRetiredRow>(sheet, { range: 1, defval: null });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "status";

  if (mode === "status") {
    const { count } = await supabase.from("eia_retired_generators").select("*", { count: "exact", head: true });
    return j({ mode, rows: count ?? 0 });
  }
  if (mode !== "run") return j({ error: "unknown mode" }, 400);

  if (Array.isArray(body.rows)) {   // replay/validation seed — no egress
    const n = await ingest(body.rows as EiaRetiredRow[]);
    await logHealth("success_seed", n, { seeded: true });
    return j({ mode, seeded: n });
  }
  try {                             // live — deploy-gated on eia.gov egress
    const rows = await fetchLive(body.url ?? EIA_860M_URL);
    const n = await ingest(rows);
    await logHealth("success", n, { url: body.url ?? EIA_860M_URL });
    return j({ mode, ingested: n });
  } catch (e) {
    await logHealth("error", 0, { error: String(e) });
    return j({ error: String(e) }, 502);
  }
});
