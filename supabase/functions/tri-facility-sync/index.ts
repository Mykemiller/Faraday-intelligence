// tri-facility-sync — CC-RSC-STRANDED-INDUSTRIAL-1.0. Lands EPA TRI facility-year
// presence (2014→present) into tri_facility_history, for national industrial-site
// DISCOVERY and closure INFERENCE (last-reporting-year gap — noisy, never SRC).
// Free / public domain. Sibling of grid-buildout-sync; same auth + health posture.
//
// Modes (POST JSON):
//   {mode:"status"}                        — counts + years present (no writes)
//   {mode:"run", year, rows?:[...]}        — ingest one reporting year. `rows` may be
//                                            supplied inline (replay/validation); when
//                                            absent, pulls that year from Envirofacts
//                                            (deploy-gated). Loop years 2014..2025.
//
// Auth: fcron house token (SHA-256) or service-role key. verify_jwt=false.
// Boundaries: writes ONLY tri_facility_history + automation_health_log.
//
// ── DEPLOY GATE ─────────────────────────────────────────────────────────────
// NOT cron-wired / NOT deployed by this PR. Blocked on:
//   1. Egress to data.epa.gov (denied to in-session fetchers; Edge egress is
//      server-side). Validate with {mode:"run", year, rows:[...]} first.
//   2. Envirofacts TRI table/field names confirmed live (normalizeFacility mapping
//      is PROVISIONAL). County FIPS via TRI fields; FRS_ID carried as the join spine.
//   3. Closure is INFERRED downstream from year-presence gaps — never asserted here.

import { createClient } from "npm:@supabase/supabase-js@2";
import { facilityBasis, normalizeFacility, TriRow } from "./pure.ts";

const CRAWLER_ID = "tri-facility-sync_v0.1";
const AUTO_ID = Deno.env.get("TRI_FACILITY_AUTO_ID") ?? "AUTO-TRI-UNREGISTERED";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const EF_BASE = Deno.env.get("ENVIROFACTS_BASE") ?? "https://data.epa.gov/efservice";

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

async function ingest(rows: TriRow[], year: number): Promise<number> {
  const out: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const n = normalizeFacility(raw, year);
    if (!n) continue;
    out.push({ ...n, content_hash: await sha256hex(facilityBasis(n)) });
  }
  for (let i = 0; i < out.length; i += 500) {
    await supabase.from("tri_facility_history")
      .upsert(out.slice(i, i + 500), { onConflict: "tri_facility_id,reporting_year", ignoreDuplicates: false });
  }
  return out.length;
}

/** Envirofacts paged pull of one reporting year's TRI facilities. */
async function fetchYear(year: number): Promise<TriRow[]> {
  const all: TriRow[] = [];
  const PAGE = 10000;
  for (let start = 0; ; start += PAGE) {
    const url = `${EF_BASE}/tri_facility/reporting_year/${year}/rows/${start}:${start + PAGE - 1}/JSON`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`envirofacts http_${res.status}`);
    const batch = (await res.json()) as TriRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

Deno.serve(async (req: Request) => {
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

  if (Array.isArray(body.rows)) {   // replay/validation seed — no egress
    const n = await ingest(body.rows as TriRow[], year);
    await logHealth("success_seed", n, { year, seeded: true });
    return j({ mode, year, seeded: n });
  }
  try {                             // live — deploy-gated on data.epa.gov egress
    const rows = await fetchYear(year);
    const n = await ingest(rows, year);
    await logHealth("success", n, { year });
    return j({ mode, year, ingested: n });
  } catch (e) {
    await logHealth("error", 0, { year, error: String(e) });
    return j({ error: String(e) }, 502);
  }
});
