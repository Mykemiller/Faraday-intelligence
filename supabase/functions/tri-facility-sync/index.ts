// tri-facility-sync — CC-RSC-STRANDED-INDUSTRIAL-1.0. Lands EPA TRI tri_facility
// year presence (2014→) into tri_facility_history for national site DISCOVERY +
// closure (fac_closed_ind, direct — no inference). Free/public. Streams Envirofacts
// page-by-page (bounded memory). NAICS/industry_class enriched downstream (absent
// on tri_facility). VALIDATED live 2026-07: 6k+ rows/year, 100% county FIPS.
//
// Modes: {mode:"status"} | {mode:"run", year, rows?[], max_pages?}
// Auth: fcron house token (SHA-256) or service-role key. verify_jwt=false.

import { createClient } from "npm:@supabase/supabase-js@2";
import { facilityBasis, normalizeFacility, TriRow } from "./pure.ts";

const CRAWLER_ID = "tri-facility-sync_v0.4";
const AUTO_ID = Deno.env.get("TRI_FACILITY_AUTO_ID") ?? "AUTO-TRI-UNREGISTERED";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const EF_BASE = Deno.env.get("ENVIROFACTS_BASE") ?? "https://data.epa.gov/efservice";
const PAGE = 2000;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

async function logHealth(startIso: string, ok: boolean, found: number, notes: string, errors: unknown = null) {
  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID, crawler_id: CRAWLER_ID, run_started_at: startIso, run_completed_at: new Date().toISOString(),
    artifacts_found: found, artifacts_new: found, success: ok, errors: errors ? { e: String(errors) } : null, notes,
  });
}
async function upsertPage(rows: TriRow[], year: number): Promise<number> {
  const out: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const n = normalizeFacility(raw, year);
    if (!n) continue;
    out.push({ ...n, content_hash: facilityBasis(n) });
  }
  for (let i = 0; i < out.length; i += 1000) {
    await supabase.from("tri_facility_history").upsert(out.slice(i, i + 1000), { onConflict: "tri_facility_id,reporting_year", ignoreDuplicates: false });
  }
  return out.length;
}
async function streamYear(year: number, maxPages: number): Promise<number> {
  let landed = 0, pages = 0;
  for (let start = 0; pages < maxPages; start += PAGE, pages++) {
    const url = `${EF_BASE}/tri_facility/reporting_year/${year}/rows/${start}:${start + PAGE - 1}/JSON`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`envirofacts http_${res.status}`);
    const batch = (await res.json()) as TriRow[];
    landed += await upsertPage(batch, year);
    if (batch.length < PAGE) break;
  }
  return landed;
}
Deno.serve(async (req: Request) => {
  const startIso = new Date().toISOString();
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "status";
  if (mode === "status") {
    const { count } = await supabase.from("tri_facility_history").select("*", { count: "exact", head: true });
    return j({ mode, rows: count ?? 0 });
  }
  if (mode !== "run") return j({ error: "unknown mode" }, 400);
  const year = Number(body.year);
  if (!year || year < 2014) return j({ error: "year >= 2014 required" }, 400);
  if (Array.isArray(body.rows)) {
    const n = await upsertPage(body.rows as TriRow[], year);
    await logHealth(startIso, true, n, `seed ${year}`);
    return j({ mode, year, seeded: n });
  }
  try {
    const n = await streamYear(year, body.max_pages ?? 100);
    await logHealth(startIso, true, n, `live ${year}`);
    return j({ mode, year, ingested: n });
  } catch (e) {
    await logHealth(startIso, false, 0, `live ${year}`, e);
    return j({ error: String(e) }, 502);
  }
});
