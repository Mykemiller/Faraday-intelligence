// boundstone-local-push v1.0 — FDY-91.
//
// Forwards Faraday's local-gov-watch articles to Boundstone as PRESS ITEMS, and
// the restriction-shaped ones as review-only RECORD CANDIDATES.
//
// Modes (POST JSON, service-role or cron token):
//   {mode:"push",   limit?}  claim due artifacts → attribute → one RPC each → ledger
//   {mode:"dryrun", limit?}  everything except the RPC call. Writes nothing, anywhere.
//   {mode:"status"}          boundstone_push_measure() (read-only)
//
// Proposed cron: HOURLY at :40 (migration 20261009230001, un-applied).
// verify_jwt=false — a true setting 401s the cron at the gateway.
//
// ===========================================================================
// TWO PROJECTS, AND THE WIRE IS TWO FUNCTION CALLS WIDE
// ===========================================================================
// This holds two clients and never mixes them:
//
//   FARADAY (ycadmmngkdhvpcsrcuaq)   service role. RPC only, three functions:
//                                    boundstone_push_due / _record / _measure.
//   BOUNDSTONE (fwnerwrtlgnchuprvfgl) a CUSTOM-ROLE JWT. RPC only, and in
//                                    practice ONE function: bs_press_propose.
//
// ⚠️ THE BOUNDSTONE CLIENT IS NOT A SERVICE-ROLE CLIENT, and that is the
// difference between this lane and the existing boundstone-candidates lane.
// That one holds Boundstone's service-role key, which can write every table in
// the project; the only thing between it and boundstone.records is a decision.
// Here the credential is a JWT whose `role` claim is `boundstone_faraday_push`,
// a NOLOGIN Postgres role holding EXECUTE on exactly two functions and no table
// grant at all (Boundstone migration 20261009110000, Myke's decision D1). So
// the restriction is enforced by the DATABASE, not by this file's good
// behaviour. If this code were replaced wholesale with `.from('records')
// .update(...)`, PostgREST would return 42501 and nothing would happen.
//
// Guardrail 4 therefore holds structurally: this function never reads the
// Boundstone database and never joins the two. Data moves one way, through RPC.
//
// ===========================================================================
// WHAT IT NEVER SENDS
// ===========================================================================
// Article text, in any form. public.boundstone_push_due deliberately does not
// return raw_content — it returns the RSS first line and the publisher name —
// so the body is not in this process's memory to forward. No summary, no
// excerpt, no sentiment, no relevance score, no ranking. signal_reasons is the
// list of keywords that literally matched the headline. No aggregator URL
// (decision D2): refused here by isAggregatorUrl() and again by Boundstone's
// enforce_press_item() trigger.
//
// ===========================================================================
// IT IS OFF UNTIL THREE THINGS ARE TRUE
// ===========================================================================
//   1. BOUNDSTONE_PUSH_ENABLED=true — otherwise it returns {enabled:false} and
//      writes NOTHING, not even a ledger row. A disabled lane that ledgered
//      every artifact 'disabled' would consume the whole backlog into skips
//      that then have to be deleted to re-offer them.
//   2. The Faraday Vault secret `boundstone_push_jwt` exists — otherwise it
//      exits 0 with reason 'no_credential' and, again, ledgers nothing, for the
//      same reason.
//   3. FDY-90 is applied and its gate is open — otherwise boundstone_push_due
//      returns 0 rows, because publisher_url is NULL on all 54,211 local-watch
//      artifacts (measured 2026-10-08).
//
// Nothing in this file performs any of the three.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildGazetteer,
  type Gazetteer,
} from "./attribution-pure.ts";
import {
  decide,
  type DueRow,
  FN_PRESS_PROPOSE,
  ledgerRow,
  proposePress,
} from "./push-pure.ts";

const AUTO_ID = Deno.env.get("BOUNDSTONE_LOCAL_PUSH_AUTO_ID") ?? "AUTO-UNASSIGNED";
const PUSHER_VERSION = "boundstone-local-push_v1.0";
const BUDGET_MS = 130_000; // the gateway drops at 150 s
const DEFAULT_LIMIT = 100;
const BOUNDSTONE_URL = "https://fwnerwrtlgnchuprvfgl.supabase.co";
const VAULT_SECRET_NAME = "boundstone_push_jwt";
const CRON_TOKEN_FALLBACK_SHA256 =
  "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";

const faradayUrl = Deno.env.get("SUPABASE_URL")!;
const faradayKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const faraday = createClient(faradayUrl, faradayKey);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (token === faradayKey) return true;
  return (await sha256hex(token)) === CRON_TOKEN_FALLBACK_SHA256;
}

/**
 * The push JWT, from Faraday's Vault.
 *
 * ⚠️ NEVER LOGGED, NEVER RETURNED, NEVER PUT IN A LEDGER ROW. The only thing
 * this function ever says about it is whether it is present. Myke mints it and
 * stores it; nothing here creates or rotates one.
 */
async function pushJwt(): Promise<string | null> {
  const { data, error } = await faraday
    .schema("vault")
    .from("decrypted_secrets")
    .select("decrypted_secret")
    .eq("name", VAULT_SECRET_NAME)
    .maybeSingle();
  if (error || !data) return null;
  const secret = (data as { decrypted_secret?: unknown }).decrypted_secret;
  return typeof secret === "string" && secret.trim() !== "" ? secret.trim() : null;
}

/**
 * Build the gazetteer once per invocation from public.jurisdictions.
 *
 * ⚠️ IT IS READ IN FULL, 38,887 matchable rows, and that is not laziness. S2
 * asks "does this name exist in exactly ONE state NATIONALLY?" — a question
 * only the whole table can answer. Reading a filtered slice would silently turn
 * ambiguous names into confident ones, which is the single worst failure this
 * lane can have: a press item on the wrong state's public page. PostgREST caps
 * a response at 1,000 rows by default, so it is paged explicitly.
 */
async function loadGazetteer(): Promise<Gazetteer> {
  const PAGE = 1000;
  const rows: { name: unknown; state_abbr: unknown; level: unknown }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await faraday
      .from("jurisdictions")
      .select("name, state_abbr, level")
      .in("level", ["county", "cousub", "place"])
      .order("name", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`jurisdictions page ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const states: { name: unknown; state_abbr: unknown }[] = [];
  {
    const { data, error } = await faraday
      .from("jurisdictions")
      .select("name, state_abbr")
      .eq("level", "state");
    if (error) throw new Error(`jurisdictions (states): ${error.message}`);
    states.push(...(data ?? []));
  }

  const gaz = buildGazetteer(rows, states);
  // A gazetteer that came back short would make every ambiguity test wrong in
  // the dangerous direction, so it is refused rather than used.
  if (gaz.byName.size < 10_000 || gaz.stateNames.size < 50) {
    throw new Error(
      `gazetteer is too small to be trusted: ${gaz.byName.size} names, ` +
        `${gaz.stateNames.size} states. Refusing to attribute anything.`,
    );
  }
  return gaz;
}

async function health(status: string, detail: Record<string, unknown>) {
  // Best-effort only: a health row that cannot be written must never fail a run
  // that already pushed rows, because the ledger is the record that matters.
  try {
    await faraday.from("automation_health_log").insert({
      automation_id: AUTO_ID,
      status,
      detail: { ...detail, pusher: PUSHER_VERSION },
    });
  } catch { /* deliberately swallowed; see above */ }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!(await authorized(req))) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch { /* an empty body means default mode */ }

  const mode = typeof body.mode === "string" ? body.mode : "push";
  const limit = Number.isFinite(body.limit) ? Number(body.limit) : DEFAULT_LIMIT;
  const started = Date.now();

  // ── status ───────────────────────────────────────────────────────────────
  if (mode === "status") {
    const { data, error } = await faraday.rpc("boundstone_push_measure", {});
    if (error) return json({ error: error.message }, 500);
    return json({ mode, measure: data, version: PUSHER_VERSION });
  }

  if (mode !== "push" && mode !== "dryrun") {
    return json({ error: `unknown mode ${mode}` }, 400);
  }

  const enabled = (Deno.env.get("BOUNDSTONE_PUSH_ENABLED") ?? "").toLowerCase() === "true";
  if (mode === "push" && !enabled) {
    // Nothing written. See the header: ledgering the backlog as 'disabled'
    // would have to be undone row by row before the lane could ever run.
    return json({ mode, enabled: false, pushed: 0, skipped: 0, ledgered: 0,
                  note: "BOUNDSTONE_PUSH_ENABLED is not true; nothing was read or written." });
  }

  // ── the credential, before any work ──────────────────────────────────────
  let boundstone: ReturnType<typeof createClient> | null = null;
  if (mode === "push") {
    const jwt = await pushJwt();
    if (!jwt) {
      await health("degraded", { reason: "no_credential", secret: VAULT_SECRET_NAME });
      return json({ mode, pushed: 0, skipped: 0, ledgered: 0, reason: "no_credential",
                    note: `Faraday Vault secret '${VAULT_SECRET_NAME}' is absent. ` +
                          "Nothing was read or written. Myke mints and stores it." });
    }
    // ⚠️ The JWT is passed as BOTH apikey and Authorization, which is what makes
    // PostgREST SET ROLE into boundstone_faraday_push from its `role` claim.
    // persistSession:false — there is no browser and no session to keep.
    boundstone = createClient(BOUNDSTONE_URL, jwt, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
  }

  try {
    const { data: due, error: dueErr } = await faraday.rpc("boundstone_push_due", {
      p_limit: limit,
    });
    if (dueErr) throw new Error(`boundstone_push_due: ${dueErr.message}`);
    const rows = (due ?? []) as DueRow[];

    if (rows.length === 0) {
      return json({ mode, pushed: 0, skipped: 0, ledgered: 0, due: 0,
                    note: "No artifact is due. Until FDY-90 (20261009220000) is applied and its " +
                          "lane gate opened, crawl_metadata.publisher_url is NULL on every " +
                          "local-watch artifact and this is the expected result." });
    }

    const gaz = await loadGazetteer();

    let pushed = 0, skipped = 0, ledgered = 0, duplicates = 0, failed = 0;
    const byReason: Record<string, number> = {};
    const byState: Record<string, number> = {};
    const sample: unknown[] = [];

    for (const row of rows) {
      if (Date.now() - started > BUDGET_MS) break; // the next run resumes; the ledger is the bookmark

      // http_status / retrieved_at are FDY-90's body-fetch outcome for the
      // PUBLISHER url. body_fetch_status 'ok' is the only value that proves a
      // 2xx on the article itself rather than on the aggregator token.
      const decision = decide(row, gaz, {
        httpStatus: typeof (row as Record<string, unknown>).http_status === "number"
          ? (row as Record<string, unknown>).http_status as number
          : 200,
        retrievedAt: new Date().toISOString(),
      });

      if (mode === "dryrun") {
        if (decision.send) {
          pushed += 1;
          byState[decision.payload.state_abbr] = (byState[decision.payload.state_abbr] ?? 0) + 1;
          if (sample.length < 5) sample.push(decision.payload);
        } else {
          skipped += 1;
          byReason[decision.reason] = (byReason[decision.reason] ?? 0) + 1;
        }
        continue;
      }

      let result = null;
      if (decision.send) {
        result = await proposePress(boundstone!, decision.payload);
        if (result.ok) {
          pushed += 1;
          if (result.status === "duplicate") duplicates += 1;
          byState[decision.payload.state_abbr] = (byState[decision.payload.state_abbr] ?? 0) + 1;
        } else {
          failed += 1;
        }
      } else {
        skipped += 1;
        byReason[decision.reason] = (byReason[decision.reason] ?? 0) + 1;
      }

      const ledger = ledgerRow(row.artifact_id, decision, result);
      const { error: recErr } = await faraday.rpc("boundstone_push_record", { p: ledger });
      // ⚠️ A failed ledger write is NOT fatal and NOT retried here. The artifact
      // stays due, so the next run re-reads it and bs_press_propose absorbs the
      // second push as a duplicate on (url, state_abbr). Two independent
      // idempotency keys is what makes that safe.
      if (recErr) await health("degraded", { reason: "ledger_write_failed", artifact_id: row.artifact_id, error: recErr.message });
      else ledgered += 1;
    }

    const out = {
      mode, due: rows.length, pushed, skipped, ledgered, duplicates, failed,
      by_reason: byReason, by_state: byState, ms: Date.now() - started,
      version: PUSHER_VERSION,
      ...(mode === "dryrun" ? { wrote_nothing: true, sample } : {}),
    };
    if (mode === "push") await health(failed > 0 ? "degraded" : "ok", out);
    return json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await health("failed", { error: message });
    return json({ mode, error: message, version: PUSHER_VERSION }, 500);
  }
});

// ===========================================================================
// MYKE'S ONE-TIME STEPS — in this order. Nothing below has been performed.
// ===========================================================================
//
//  1. Apply the BOUNDSTONE migration first (project fwnerwrtlgnchuprvfgl):
//       supabase/migrations/20261009110000_local_watch_intake.sql
//     — after its three named dependencies (FDY-75/76/77). It creates
//     bs_press_propose and the boundstone_faraday_push role.
//
//  2. Mint the push JWT. role claim = boundstone_faraday_push, signed with
//     BOUNDSTONE's JWT secret (Supabase dashboard → Settings → API → JWT
//     Secret), 1-year expiry:
//       {"role":"boundstone_faraday_push","iss":"supabase",
//        "iat":<now>,"exp":<now + 31536000>}
//     Never paste it into Linear, Notion, a PR or a log.
//
//  3. Store it in FARADAY's Vault (ycadmmngkdhvpcsrcuaq), name exactly
//     `boundstone_push_jwt`:
//       select vault.create_secret('<the jwt>', 'boundstone_push_jwt',
//         'FDY-91 — Boundstone push JWT, role boundstone_faraday_push. Rotate yearly.');
//
//  4. Apply the FARADAY migrations, in order:
//       20261009220000_gnews_resolve_schedule.sql   (FDY-90, if not yet applied)
//       20261009230000_boundstone_push_ledger.sql
//       20261009230001_boundstone_push_schedule.sql
//
//  5. Open FDY-90's resolver gate — Myke's decision D5 (FDY-98, Option 1):
//       update public.artifact_body_fetch_lanes
//          set fetch_enabled = true, aggregator_robots_ack = true
//        where lane = 'gnews_local';
//     Reversible by setting either flag back to false.
//
//  6. Deploy this function via git, then SMOKE-TEST BEFORE ENABLING IT:
//       curl -sX POST .../functions/v1/boundstone-local-push \
//         -H "Authorization: Bearer $SERVICE_KEY" -d '{"mode":"dryrun","limit":20}'
//     dryrun writes nothing, anywhere, and reports the by_state split.
//
//  7. Only then turn the lane on:
//       supabase secrets set BOUNDSTONE_PUSH_ENABLED=true
