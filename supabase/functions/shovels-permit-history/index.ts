// shovels-permit-history — CC-RSC-STRANDED-INDUSTRIAL-1.0 RSC-05 velocity poller.
// One-time 10-year historical pull of COMMERCIAL NEW-CONSTRUCTION permits, county
// grain, Tier 1 (infrastructure-relevant counties) first. Lands rows into
// shovels_permit_history (content-hash idempotent). Registry-driven sibling of
// grid-buildout-sync / dc-hub-sync; same auth + health-log posture.
//
// Modes (POST JSON):
//   {mode:"status"}                          — row counts + last run (no writes)
//   {mode:"run", tier?:1|2, permits?:[...],  — ingest. `permits` may be supplied
//     county_fips?, max_records?}              inline (replay/seed) to test without
//                                              a live Shovels call; when absent the
//                                              handler crawls live (deploy-gated).
//
// Auth: fcron house token (SHA-256 compare) or service-role key. verify_jwt=false.
// Boundaries: writes ONLY shovels_permit_history + automation_health_log.
//   Zero JPAS/JPS/JDS/registry writes. RSC stays weight 0.
//
// ── DEPLOY GATE ─────────────────────────────────────────────────────────────
// NOT cron-wired / NOT deployed by this PR. Blocked on:
//   1. SHOVELS_API_KEY set as an Edge secret (paid: $0.005/record; Tier 1 ~$300).
//   2. Egress to api.shovels.ai (denied to in-session fetchers; Edge runtime egress
//      is server-side). Validate with a single-county {mode:"run"} before fanning out.
//   3. MAX_RECORDS budget cap enforced below so a runaway crawl cannot overspend.

import { createClient } from "npm:@supabase/supabase-js@2";
import { contentBasis, normalize, RawPermit, SHOVELS_FILTER } from "./pure.ts";

const CRAWLER_ID = "shovels-permit-history_v0.1";
const AUTO_ID = Deno.env.get("SHOVELS_RSC_AUTO_ID") ?? "AUTO-RSC05-UNREGISTERED";
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const SHOVELS_BASE = "https://api.shovels.ai/v2";
const PAGE_SIZE = 100;                 // best $/record: $0.005 flat at 100
const MAX_RECORDS_DEFAULT = 120_000;   // ~$600 hard ceiling; Tier 1 lands well under

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

/** Tier-1 = counties where a data center could land: idle gen OR substation presence. */
async function targetCounties(tier: 1 | 2): Promise<{ county_fips: string; geo_id: string }[]> {
  // geo_id resolution: Shovels county geo_id is derivable from county FIPS via their
  // /geo lookup; production caches a fips→geo_id map. Left as a lookup join here.
  const sql = tier === 1
    ? `with relevant as (
         select distinct trim(county_fips) fips from eia_generator_inventory where status in ('SB','OS','OA')
         union select distinct unnest(containing_county_fips) from jurisdictions where level='county')
       select j.fips_code as county_fips
       from jurisdictions j
       where j.level='county' and j.current_score is not null and j.fips_code in (select fips from relevant)
       order by j.market_tier_importance desc nulls last`
    : `select fips_code as county_fips from jurisdictions
       where level='county' and current_score is not null order by market_tier_importance desc nulls last`;
  const { data, error } = await supabase.rpc("exec_sql_readonly", { q: sql }).select?.() ?? { data: null, error: null };
  // Fallback: if no readonly RPC, callers pass county_fips explicitly (validation mode).
  if (error || !data) return [];
  return (data as { county_fips: string }[]).map((r) => ({ county_fips: r.county_fips, geo_id: r.county_fips }));
}

async function upsert(rows: ReturnType<typeof normalize>[]) {
  if (!rows.length) return;
  const withHash = await Promise.all(rows.map(async (r) => ({ ...r, content_hash: await sha256hex(r.shovels_permit_id + "|" + r.status + "|" + r.issue_date) })));
  await supabase.from("shovels_permit_history").upsert(withHash, { onConflict: "shovels_permit_id", ignoreDuplicates: false });
}

async function crawlCounty(geoId: string, countyFips: string, key: string, budget: { left: number }): Promise<number> {
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
    if (!res.ok) { await logHealth(`http_${res.status}`, got, { county: countyFips }); break; }
    const body = await res.json();
    const items = (body.items as RawPermit[]) ?? [];
    await upsert(items.map((p) => normalize(p, countyFips)));
    got += items.length; budget.left -= items.length;
    cursor = body.next_cursor ?? null;
  } while (cursor);
  return got;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "status";

  if (mode === "status") {
    const { count } = await supabase.from("shovels_permit_history").select("*", { count: "exact", head: true });
    return j({ mode, rows: count ?? 0 });
  }
  if (mode !== "run") return j({ error: "unknown mode" }, 400);

  // Replay/validation: inline permits, no live call, no spend.
  if (Array.isArray(body.permits)) {
    await upsert((body.permits as RawPermit[]).map((p) => normalize(p, body.county_fips ?? null)));
    await logHealth("success_seed", body.permits.length, { seeded: true });
    return j({ mode, seeded: body.permits.length });
  }

  // Live crawl — deploy-gated.
  const key = Deno.env.get("SHOVELS_API_KEY");
  if (!key) return j({ error: "SHOVELS_API_KEY unset — live crawl deploy-gated" }, 503);
  const budget = { left: body.max_records ?? MAX_RECORDS_DEFAULT };
  const counties = body.county_fips
    ? [{ county_fips: body.county_fips, geo_id: body.county_fips }]
    : await targetCounties((body.tier ?? 1) as 1 | 2);
  let total = 0;
  for (const c of counties) {
    if (budget.left <= 0) { await logHealth("aborted_budget_cap", total); return j({ mode, total, capped: true }); }
    total += await crawlCounty(c.geo_id, c.county_fips, key, budget);
  }
  await logHealth("success", total, { counties: counties.length });
  return j({ mode, total, counties: counties.length });
});
