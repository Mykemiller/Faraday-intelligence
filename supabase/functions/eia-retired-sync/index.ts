// eia-retired-sync — CC-RSC-STRANDED-INDUSTRIAL-1.0. Lands the EIA-860M "Retired"
// tab (grid generators retired since 2002) into eia_retired_generators. Retired
// >=1MW GRID units, NOT captive industrial powerhouses. Free / public domain.
//
// Modes: {mode:"status"} | {mode:"run", rows?[], url?}
// Auth: fcron house token (SHA-256) or service-role key. verify_jwt=false.
// Boundaries: writes ONLY eia_retired_generators + automation_health_log.
//
// Live fetch resolves the current 860M workbook link from the EIA index page
// (filenames rotate monthly), then parses the "Retired" sheet.

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { EiaRetiredRow, normalizeRetired, retiredBasis } from "./pure.ts";

// ── DEPLOY GATE (live fetch): the 860M workbook is ~13 MB; SheetJS inflates the
// whole zip and OOMs the edge worker (WORKER_RESOURCE_LIMIT), even parsing only the
// Retired sheet. Land via a higher-memory runtime (Node/Vercel fn or GitHub Action)
// that POSTs parsed rows to {mode:"run", rows:[...]}, or a pre-converted CSV feed.
// Normalization logic is validated; only the in-edge xlsx decode fails.
const CRAWLER_ID = "eia-retired-sync_v0.4";
const AUTO_ID = Deno.env.get("EIA_RETIRED_AUTO_ID") ?? "AUTO-EIARE-UNREGISTERED";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const EIA_860M_INDEX = "https://www.eia.gov/electricity/data/eia860m/";
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

// automation_health_log schema: auto_id, crawler_id, run_started_at, run_completed_at,
// artifacts_found, artifacts_new, artifacts_duped, errors(jsonb), success(bool), notes.
async function logHealth(startIso: string, ok: boolean, found: number, notes: string, errors: unknown = null) {
  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID, crawler_id: CRAWLER_ID, run_started_at: startIso,
    run_completed_at: new Date().toISOString(), artifacts_found: found, artifacts_new: found,
    success: ok, errors: errors ? { e: String(errors) } : null, notes,
  });
}

async function resolveFips(state: string | null, county: string | null): Promise<string | null> {
  if (!state || !county) return null;
  // jurisdictions county names carry a " County"/"Parish" suffix; EIA county does not.
  const { data } = await supabase.from("jurisdictions").select("fips_code")
    .eq("level", "county").eq("state_abbr", state).ilike("name", `${county}%`).limit(1).maybeSingle();
  return (data?.fips_code as string) ?? null;
}

async function ingest(rows: EiaRetiredRow[]): Promise<number> {
  const out: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const n = normalizeRetired(raw);
    if (!n) continue;
    out.push({ ...n, county_fips: await resolveFips(n.state, n.county), source: "eia:860m", source_hash: retiredBasis(n) });
  }
  for (let i = 0; i < out.length; i += 500) {
    await supabase.from("eia_retired_generators")
      .upsert(out.slice(i, i + 500), { onConflict: "plant_code,generator_id", ignoreDuplicates: false });
  }
  return out.length;
}

/** Resolve the current 860M workbook URL from the index page (filenames rotate). */
async function resolveWorkbookUrl(): Promise<string> {
  const res = await fetch(EIA_860M_INDEX);
  if (!res.ok) throw new Error(`eia index http_${res.status}`);
  const html = await res.text();
  // Prefer the CURRENT file under /eia860m/xls/ (not /archive/xls/).
  const m = html.match(/href="([^"]*\/eia860m\/xls\/[a-z]+_generator\d{4}\.xlsx)"/i)
        ?? html.match(/href="([^"]*generator[^"]*\.xlsx)"/i);
  if (!m) throw new Error("860M xlsx link not found on index page");
  return new URL(m[1], EIA_860M_INDEX).href;
}

async function fetchLive(url: string): Promise<EiaRetiredRow[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`eia fetch http_${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  // SINGLE dense parse limited to the Retired sheet — the 860M is ~13MB and a full
  // parse OOMs the worker. `sheets` skips building the big Operating/Planned tabs;
  // `dense` uses the low-overhead cell representation.
  const wb = XLSX.read(data, { type: "array", sheets: "Retired", dense: true });
  const name = wb.SheetNames.find((s) => /retire/i.test(s)) ?? "Retired";
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Retired sheet not found in [${wb.SheetNames.join(", ")}]`);
  // 860M tabs carry a 1-row banner above the header row.
  return XLSX.utils.sheet_to_json<EiaRetiredRow>(sheet, { range: 1, defval: null });
}

Deno.serve(async (req: Request) => {
  const startIso = new Date().toISOString();
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "status";

  if (mode === "status") {
    const { count } = await supabase.from("eia_retired_generators").select("*", { count: "exact", head: true });
    return j({ mode, rows: count ?? 0 });
  }
  if (mode !== "run") return j({ error: "unknown mode" }, 400);

  if (Array.isArray(body.rows)) {
    const n = await ingest(body.rows as EiaRetiredRow[]);
    await logHealth(startIso, true, n, "seed");
    return j({ mode, seeded: n });
  }
  try {
    const url = body.url ?? await resolveWorkbookUrl();
    const rows = await fetchLive(url);
    const n = await ingest(rows);
    await logHealth(startIso, true, n, `live ${url}`);
    return j({ mode, ingested: n, url });
  } catch (e) {
    await logHealth(startIso, false, 0, "live", e);
    return j({ error: String(e) }, 502);
  }
});
