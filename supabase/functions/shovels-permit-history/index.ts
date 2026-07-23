// shovels-permit-history — CC-RSC-STRANDED-INDUSTRIAL-1.0 RSC-05 velocity poller.
// Lands COMMERCIAL NEW-CONSTRUCTION permits, county grain, into shovels_permit_history.
// County FIPS → Shovels geo_id resolved via /counties/search (validated 2026-07).
//
// Modes: {mode:"status"} | {mode:"run", tier?, permits?[], county_fips?, geo_id?, max_records?}
//        {mode:"probe", path, query?}  — raw authenticated GET passthrough
// Auth: fcron house token (SHA-256) or service-role key. verify_jwt=false.

import { createClient } from "npm:@supabase/supabase-js@2";
import { normalize, RawPermit, SHOVELS_FILTER } from "./pure.ts";

const CRAWLER_ID = "shovels-permit-history_v0.4";
const AUTO_ID = Deno.env.get("SHOVELS_RSC_AUTO_ID") ?? "AUTO-RSC05-UNREGISTERED";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const SHOVELS_BASE = "https://api.shovels.ai/v2";
const PAGE_SIZE = 100;
const MAX_RECORDS_DEFAULT = 120_000;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const stripSuffix = (s: string) => s.replace(/\s+(county|parish|borough|census area|municipio|city and borough|municipality)$/i, "").trim();

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

async function logHealth(ok: boolean, found: number, notes: string, errors: unknown = null) {
  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID, crawler_id: CRAWLER_ID, run_started_at: new Date().toISOString(),
    run_completed_at: new Date().toISOString(), artifacts_found: found, artifacts_new: found,
    success: ok, errors: errors ? { e: String(errors) } : null, notes,
  });
}

async function countyMeta(fips: string): Promise<{ name: string; state: string } | null> {
  const { data } = await supabase.from("jurisdictions").select("name,state_abbr")
    .eq("level", "county").eq("fips_code", fips).maybeSingle();
  return data ? { name: data.name as string, state: data.state_abbr as string } : null;
}

/** County FIPS → Shovels geo_id via /counties/search (fuzzy → match on name+state). */
async function resolveGeoId(fips: string, key: string): Promise<string | null> {
  const meta = await countyMeta(fips);
  if (!meta) return null;
  const q = stripSuffix(meta.name);
  const u = new URL(`${SHOVELS_BASE}/counties/search`);
  u.searchParams.set("q", q);
  const res = await fetch(u, { headers: { "X-API-Key": key } });
  if (!res.ok) return null;
  const items = ((await res.json()).items ?? []) as { geo_id: string; name: string; state: string }[];
  const hit = items.find((it) => it.state === meta.state && norm((it.name.split(",")[0] ?? "")) === norm(q));
  return hit?.geo_id ?? null;
}

async function upsert(rows: ReturnType<typeof normalize>[]) {
  if (!rows.length) return;
  const withHash = rows.map((r) => ({ ...r, content_hash: `${r.shovels_permit_id}|${r.status}|${r.issue_date}` }));
  await supabase.from("shovels_permit_history").upsert(withHash, { onConflict: "shovels_permit_id", ignoreDuplicates: false });
}

async function crawlGeo(geoId: string, countyFips: string, key: string, budget: { left: number }): Promise<number> {
  let cursor: string | null = null, got = 0;
  do {
    if (budget.left <= 0) break;
    const u = new URL(`${SHOVELS_BASE}/permits/search`);
    u.searchParams.set("geo_id", geoId);
    u.searchParams.set("property_type", SHOVELS_FILTER.property_type);
    u.searchParams.set("tag", SHOVELS_FILTER.tag);
    u.searchParams.set("permit_from", SHOVELS_FILTER.permit_from);
    u.searchParams.set("permit_to", SHOVELS_FILTER.permit_to);
    u.searchParams.set("size", String(PAGE_SIZE));
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u, { headers: { "X-API-Key": key } });
    if (!res.ok) { await logHealth(false, got, `http_${res.status} ${countyFips}`); break; }
    const body = await res.json();
    const items = (body.items as RawPermit[]) ?? [];
    await upsert(items.map((p) => normalize(p, countyFips)));
    got += items.length; budget.left -= items.length;
    cursor = body.next_cursor ?? null;
  } while (cursor);
  return got;
}

async function tier1Counties(): Promise<string[]> {
  const { data } = await supabase.rpc("rsc_tier1_counties");
  return data ? (data as { county_fips: string }[]).map((r) => r.county_fips) : [];
}
async function allScoredCounties(): Promise<string[]> {
  const { data } = await supabase.from("jurisdictions").select("fips_code")
    .eq("level", "county").not("current_score", "is", null)
    .order("market_tier_importance", { ascending: false });
  return data ? (data as { fips_code: string }[]).map((r) => r.fips_code) : [];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "status";
  const key = Deno.env.get("SHOVELS_API_KEY");

  if (mode === "status") {
    const { count } = await supabase.from("shovels_permit_history").select("*", { count: "exact", head: true });
    return j({ mode, rows: count ?? 0 });
  }
  if (mode === "probe") {
    if (!key) return j({ error: "SHOVELS_API_KEY unset" }, 503);
    const u = new URL(`${SHOVELS_BASE}${body.path}`);
    for (const [k, v] of Object.entries(body.query ?? {})) u.searchParams.set(k, String(v));
    const res = await fetch(u, { headers: { "X-API-Key": key } });
    return j({ status: res.status, url: u.toString(), body: (await res.text()).slice(0, 1500) });
  }
  if (mode !== "run") return j({ error: "unknown mode" }, 400);

  if (Array.isArray(body.permits)) {
    await upsert((body.permits as RawPermit[]).map((p) => normalize(p, body.county_fips ?? null)));
    await logHealth(true, body.permits.length, "seed");
    return j({ mode, seeded: body.permits.length });
  }

  if (!key) return j({ error: "SHOVELS_API_KEY unset — live crawl deploy-gated" }, 503);
  const budget = { left: body.max_records ?? MAX_RECORDS_DEFAULT };

  if (body.county_fips) {
    const geoId = body.geo_id ?? await resolveGeoId(body.county_fips, key);
    if (!geoId) { await logHealth(false, 0, `geo_unresolved ${body.county_fips}`); return j({ mode, total: 0, geo_unresolved: body.county_fips }); }
    const total = await crawlGeo(geoId, body.county_fips, key, budget);
    await logHealth(true, total, `county ${body.county_fips} geo ${geoId}`);
    return j({ mode, total, county: body.county_fips, geo_id: geoId });
  }

  const counties = body.tier === 2 ? await allScoredCounties() : await tier1Counties();
  let total = 0, resolved = 0;
  for (const fips of counties) {
    if (budget.left <= 0) { await logHealth(false, total, "budget_cap"); return j({ mode, total, resolved, capped: true }); }
    const geoId = await resolveGeoId(fips, key);
    if (!geoId) continue;
    resolved++;
    total += await crawlGeo(geoId, fips, key, budget);
  }
  await logHealth(true, total, `fleet ${resolved}/${counties.length}`);
  return j({ mode, total, resolved, counties: counties.length });
});
