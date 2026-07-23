// dc-hub-sync — mirrors DC Hub's facility layer into dc_facilities, the shared
// data-plane read-model the storefronts consume. Registry-driven sibling of
// source-poller; same auth + health-log posture.
//
// Modes (POST JSON):
//   {mode:"status"}                         — row counts + last run (no writes)
//   {mode:"run", limit?, country?, min_mw?, offset?}
//                                           — pull a page of DC Hub facilities,
//                                             upsert changed rows (content_hash
//                                             skip-unchanged), resolve operators
//
// Auth: fcron house token (SHA-256 compare — census-backfill pattern) or the
// service-role key. verify_jwt=false.
//
// Boundaries: writes ONLY dc_facilities, dc_facility_unmapped_operators,
// automation_health_log. Never touches scoring/artifacts/source_registry.
//
// DC Hub is CC-BY-4.0 (attribution required) — rows carry source_attribution.
// `raw` holds only the shareable projection (see sync-pure.ts); gated paid-tier
// fields are never persisted into this anon-readable table.
//
// ── DEPLOY GATE ─────────────────────────────────────────────────────────────
// NOT cron-wired and NOT deployed by this PR. Blocked on:
//   1. DC_HUB_API_KEY set to Myke's DC Hub account key (Supabase function secret)
//   2. Live validation of the DC Hub REST field shape (endpoints below are
//      PROVISIONAL, coded defensively in normalizeFacility)
//   3. An AUTO id + crawler registered in the Airtable Automation Registry
//      (DC_HUB_AUTO_ID below is a placeholder pending Registry assignment)

import { createClient } from "npm:@supabase/supabase-js@2";
import { facilityFingerprint, normalizeFacility, normalizeOperatorName } from "./sync-pure.ts";

const CRAWLER_ID = "dc-hub-sync_v0.1";
const AUTO_ID = Deno.env.get("DC_HUB_AUTO_ID") ?? "AUTO-DCHUB-UNREGISTERED"; // pending Registry assignment
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
const DC_HUB_BASE = Deno.env.get("DC_HUB_API_BASE") ?? "https://dchub.cloud/api/v1"; // PROVISIONAL
const FETCH_TIMEOUT_MS = 10_000;
const WALL_BUDGET_MS = 95_000;

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
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const envToken = Deno.env.get("CRON_TOKEN");
  if (envToken && token === envToken) return true;
  return (await sha256hex(token)) === CRON_TOKEN_FALLBACK_SHA256;
}

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** GET a page of facilities from DC Hub. PROVISIONAL shape — validated at deploy. */
async function fetchFacilityPage(
  key: string,
  opts: { limit: number; offset: number; country?: string; minMw?: number },
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({ limit: String(opts.limit), offset: String(opts.offset) });
  if (opts.country) qs.set("country", opts.country);
  if (opts.minMw != null) qs.set("min_capacity_mw", String(opts.minMw));
  const res = await timedFetch(`${DC_HUB_BASE}/facilities?${qs.toString()}`, {
    headers: { "X-API-Key": key, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`DC Hub /facilities ${res.status}`);
  const body = await res.json();
  // Accept {results:[…]}, {facilities:[…]}, {data:[…]}, or a bare array.
  const arr = Array.isArray(body)
    ? body
    : (body.results ?? body.facilities ?? body.data ?? []);
  return Array.isArray(arr) ? arr : [];
}

/** Best-effort operator → tracking_companies.company_id via normalized name. */
async function resolveOperator(operator: string | null): Promise<string | null> {
  const norm = normalizeOperatorName(operator);
  if (!norm) return null;
  const { data } = await supabase
    .from("tracking_companies")
    .select("company_id, name")
    .limit(500);
  if (!data) return null;
  const hit = data.find((c: { name?: string }) => normalizeOperatorName(c.name) === norm);
  return hit?.company_id ?? null;
}

async function runSync(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const startedIso = new Date().toISOString();
  const startMs = Date.now();
  const key = Deno.env.get("DC_HUB_API_KEY");
  if (!key) {
    return { ok: false, error: "DC_HUB_API_KEY not set — sync is deploy-gated (see header)" };
  }

  const limit = Math.min(Number(body.limit ?? 50), 200);
  const offset = Number(body.offset ?? 0);
  const country = body.country ? String(body.country) : undefined;
  const minMw = body.min_mw != null ? Number(body.min_mw) : undefined;

  const errors: string[] = [];
  let found = 0, inserted = 0, skipped = 0, unmapped = 0;

  try {
    const page = await fetchFacilityPage(key, { limit, offset, country, minMw });
    found = page.length;

    // Existing hashes for the ids in this page → skip unchanged.
    const rows = page.map(normalizeFacility).filter((r): r is NonNullable<typeof r> => r !== null);
    const ids = rows.map((r) => r.facility_id);
    const { data: existing } = await supabase
      .from("dc_facilities")
      .select("facility_id, content_hash")
      .in("facility_id", ids.length ? ids : ["__none__"]);
    const priorHash = new Map((existing ?? []).map((e: any) => [e.facility_id, e.content_hash]));

    for (const row of rows) {
      if (Date.now() - startMs > WALL_BUDGET_MS) { errors.push("wall budget hit"); break; }
      const hash = await sha256hex(facilityFingerprint(row));
      if (priorHash.get(row.facility_id) === hash) { skipped++; continue; }

      const companyId = await resolveOperator(row.operator);
      const { raw, ...cols } = row;
      const { error } = await supabase.from("dc_facilities").upsert({
        ...cols,
        raw,
        operator_company_id: companyId,
        content_hash: hash,
        source: "dc_hub",
        updated_at: new Date().toISOString(),
      }, { onConflict: "facility_id" });
      if (error) { errors.push(`upsert ${row.facility_id}: ${error.message.slice(0, 160)}`); continue; }
      inserted++;

      if (row.operator && !companyId) {
        unmapped++;
        await supabase.from("dc_facility_unmapped_operators")
          .upsert({ facility_id: row.facility_id, operator: row.operator }, { onConflict: "facility_id" });
      }
    }
  } catch (e) {
    errors.push(String((e as Error).message ?? e));
  }

  await supabase.from("automation_health_log").insert({
    auto_id: AUTO_ID,
    crawler_id: CRAWLER_ID,
    run_started_at: startedIso,
    run_completed_at: new Date().toISOString(),
    artifacts_found: found,
    artifacts_new: inserted,
    artifacts_duped: skipped,
    errors,
    success: errors.length === 0,
    notes: `dc-hub-sync found=${found} upserted=${inserted} skipped=${skipped} unmapped=${unmapped} offset=${offset}`,
  });

  return { ok: errors.length === 0, found, upserted: inserted, skipped, unmapped, offset, errors };
}

async function status(): Promise<Record<string, unknown>> {
  const { count } = await supabase
    .from("dc_facilities")
    .select("facility_id", { count: "exact", head: true });
  const { data: lastRun } = await supabase
    .from("automation_health_log")
    .select("run_completed_at, success, notes")
    .eq("auto_id", AUTO_ID)
    .order("run_completed_at", { ascending: false })
    .limit(1);
  return { ok: true, facilities: count ?? 0, last_run: lastRun?.[0] ?? null, auto_id: AUTO_ID };
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
