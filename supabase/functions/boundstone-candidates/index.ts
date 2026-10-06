// boundstone-candidates — CC-BOUNDSTONE-INGEST-1.1 §6 (FAR-418).
// Proposed AUTO-<assign>. Cron */30. verify_jwt=false.
//
// Reads enriched artifacts from the Faraday engine, decides which of them
// record a restriction on data center development, and PROPOSES them as
// candidates in the Boundstone database. It never writes boundstone.records
// ([REC-5]) and never publishes anything.
//
// TWO PROJECTS, DELIBERATELY. §2 says do not cross the Supabase projects; this
// function is the one place that must read one and write the other, because
// that is the wire whose absence is the entire finding in §0 ("There is no
// wire"). It holds two clients with two service keys and never mixes them:
//   ENGINE (the Faraday project)     — READ ONLY on artifacts / source_registry,
//                                      plus its own automation_health_log.
//   BOUNDSTONE (fwnerwrtlgnchuprvfgl) — RPC ONLY. Three functions, no tables.
//
// THE BOUNDSTONE SIDE IS A FUNCTION CALL, NOT A TABLE GRANT (Boundstone
// migration 0042, applied). Everything that touches that project goes through
// boundstone-rpc.ts and `.rpc()`:
//   bs_record_candidate_propose(p jsonb) → boundstone.record_candidates
//   bs_ingest_watermark_get(p_key)  / bs_ingest_watermark_set(p_key, p_at)
// There is no `db:{schema:'boundstone'}` and no `.from(...)` on that client.
// The propose function reads its payload KEY BY KEY and never splats it, which
// is precisely what keeps `review_state` out of a caller's reach. Writing the
// table directly with a service-role key would hand Faraday the power to mark
// its own proposals promoted, and PROMOTION IS A HUMAN EDITORIAL ACT. Every row
// lands review_state='pending'. Nothing here writes boundstone.records and
// nothing here writes a confidence_grade (trigger-derived, not ours).
// test/far418-boundstone-rpc-only.test.mjs fails the build if a `.from(` ever
// appears against the Boundstone client.
//
// DECISION 2 IS ENFORCED HERE BY ABSENCE: there is no reference to ifs_domains
// or ifs_subdomains anywhere in the query path. A restriction is a restriction
// whether its feed filed it under D3, D13, D18 or nothing, and pre-filtering by
// domain "to save compute" is the exact bug Decision 2 exists to kill (§12).
// test/far418-no-idf-dependency.test.mjs asserts this against the built query,
// not by reading the code.

import { createClient } from "npm:@supabase/supabase-js@2";
import { gate0 } from "./gate0.ts";
import {
  buildUserPrompt,
  candidateHashInput,
  CLASSIFIER_MODEL,
  type Classification,
  MAX_OUTPUT_TOKENS,
  parseClassifierText,
  SYSTEM_PROMPT,
  validateClassification,
} from "./classify-pure.ts";
import {
  type AuthorityLevel,
  extractAuthorityLinks,
  makeProvenance,
  type Provenance,
  rankAuthorityLinks,
  retrievalPlan,
  urlHost,
} from "./primary-source.ts";
import {
  buildCandidatePayload,
  canaryPayload,
  type CandidatePayload,
  proposeCandidate,
  WATERMARK_KEY,
  watermarkGet,
  watermarkSet,
} from "./boundstone-rpc.ts";
import { buildIntakeQuery, type ClientLike } from "./intake.ts";
import { canonicalizeUrl, normalizeDocument } from "../source-poller/poller-canonical.ts";

const CRAWLER_ID = "boundstone-candidates_v1.1"; // v1.1 = RPC-only write contract (Boundstone migration 0042)
const AUTO_ID = Deno.env.get("BOUNDSTONE_CANDIDATES_AUTO_ID") ?? "AUTO-UNASSIGNED";
const UA = "FaradayIntelligenceBot/1.0 (+https://faraday-intelligence.ai; boundstone candidate ingest)";
const WALL_BUDGET_MS = 95_000;
const FETCH_TIMEOUT_MS = 10_000;
const CRON_TOKEN_FALLBACK_SHA256 = "dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63";
/** Payloads echoed back by a `?dry=1` run. Capped so a dry run over a large
 * backlog stays a readable report rather than a dump. */
const DRY_SAMPLE_MAX = 5;
/** Gate 1 is a model call per surviving artifact; Gate 0 is free. This caps the
 * spend per run, and the watermark makes the cap resumable rather than lossy. */
const MAX_CLASSIFY_PER_RUN = 60;
const MAX_GATE2_FETCHES = 40;

const engine = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const boundstoneUrl = Deno.env.get("BOUNDSTONE_SUPABASE_URL");
const boundstoneKey = Deno.env.get("BOUNDSTONE_SERVICE_ROLE_KEY");
// ⚠️ NO `db: { schema: "boundstone" }`. That option exists to make
// `.from("candidates")` resolve to `boundstone.candidates`, and this function
// does not call `.from()` on this client at all — the three RPCs live in
// `public` and are SECURITY DEFINER into `boundstone`. Setting the schema would
// also break `.rpc()`, which resolves against the configured schema.
const boundstone = boundstoneUrl && boundstoneKey
  ? createClient(boundstoneUrl, boundstoneKey, { auth: { persistSession: false } })
  : null;

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

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/pdf,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Provenance — see primary-source.ts.
// ---------------------------------------------------------------------------
//
// ⚠️ PROMPT SAID X, PRODUCTION IS Y. This block used to read
// `boundstone.allowed_source_domains`. That table does not exist in the
// Boundstone project — checked read-only against information_schema on
// 2026-10-06 — and no `bs_*` RPC exposes `blocked_source_domains` either, so
// neither list is reachable from a function-only client. The rule is therefore
// carried in code: `isGovernmentHost()` mirrors `boundstone.is_government_host()`
// character for character, and the blocklist is a pinned snapshot of the live
// table. Both are tested; see primary-source.ts for why the mirror reproduces
// the SQL's case-sensitivity quirk rather than improving on it.
const prov: Provenance = makeProvenance();

// ---------------------------------------------------------------------------
// Gate 1
// ---------------------------------------------------------------------------

async function classifyOne(
  anthropicKey: string,
  art: { source_url: string; published_at: string | null; title: string; body: string },
): Promise<{ ok: boolean; reason?: string; value?: Classification }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(art) }],
    }),
  });
  if (!res.ok) return { ok: false, reason: `anthropic ${res.status}` };
  const body = await res.json();
  const text = body?.content?.[0]?.text ?? "";
  let parsed: unknown;
  try {
    parsed = parseClassifierText(text);
  } catch {
    return { ok: false, reason: "unparseable classifier JSON" };
  }
  // The verbatim check runs against the SAME text the model was shown.
  return validateClassification(parsed, art.body);
}

// ---------------------------------------------------------------------------
// Gate 2 — find the authority's own document. Failure is labelled, not fatal.
// ---------------------------------------------------------------------------

async function findPrimarySource(
  c: Classification,
  articleUrl: string,
  prov: Provenance,
  registry: Map<string, string>,
  budget: { fetches: number },
): Promise<{ url: string | null; ok: boolean; note: string }> {
  // If the discovery URL is itself on an authority domain, we are already there.
  if (prov.isQuotable(articleUrl)) {
    return { url: articleUrl, ok: true, note: "discovery URL is itself an authority domain" };
  }
  const marketKey = c.signal_reasons.find((r) => r.startsWith("market:"))?.slice(7) ?? null;
  const plan = retrievalPlan(c.authority_level as AuthorityLevel | null, c.state_abbr, marketKey);
  for (const step of plan) {
    if (budget.fetches >= MAX_GATE2_FETCHES) return { url: null, ok: false, note: "fetch budget exhausted" };
    if (step.via === "article") {
      budget.fetches++;
      try {
        const res = await fetchWithTimeout(articleUrl);
        if (!res.ok) {
          await res.body?.cancel();
          continue;
        }
        const html = (await res.text()).slice(0, 800_000);
        const links = rankAuthorityLinks(
          extractAuthorityLinks(html, articleUrl, prov.isQuotable),
          c.instrument_no,
        );
        if (links.length && links[0].score > 0) {
          return { url: links[0].url, ok: true, note: `authority link in article (${step.why})` };
        }
      } catch {
        /* fall through to the registry-resolved paths */
      }
      continue;
    }
    // Registry-resolved paths. We do NOT search a portal here — a docket search
    // is a per-portal-family adapter (§7.2) and belongs with the source, not in
    // the classifier. What we can honestly do is record the portal we would ask,
    // so the digest tells a human where to look in one click.
    const key = step.via.endsWith("*") ? null : step.via;
    const portal = key ? registry.get(key) ?? null : null;
    if (portal) {
      return {
        url: portal,
        ok: false,
        note: `no instrument located; ${step.why} is ${key} — portal search adapter pending (§7.2)`,
      };
    }
  }
  return { url: null, ok: false, note: "no authority document located" };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (!(await authorized(req))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const started = Date.now();
  const startedIso = new Date().toISOString();
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!boundstone) {
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: "BOUNDSTONE_SUPABASE_URL / BOUNDSTONE_SERVICE_ROLE_KEY not set — nothing read, nothing written.",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (!anthropicKey) {
    return new Response(JSON.stringify({ skipped: true, reason: "ANTHROPIC_API_KEY not set" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  let bodyIn: Record<string, unknown> = {};
  try {
    bodyIn = await req.json();
  } catch { /* defaults */ }
  // §5 — two ways in, same mode. `?dry=1` is the one a human can run from a
  // terminal without composing a body; `{"dry_run":true}` is the one the
  // original CC specified and is kept so nothing that already calls it breaks.
  const dryRun = new URL(req.url).searchParams.get("dry") === "1" || bodyIn.dry_run === true;

  // ---- watermark (RPC — bs_ingest_watermark_get) ------------------------
  const wm = await watermarkGet(boundstone, WATERMARK_KEY);
  if (!wm.ok) {
    return new Response(JSON.stringify({ error: `watermark read failed: ${wm.error}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  const since = (bodyIn.since as string | undefined) ?? wm.at ??
    new Date(Date.now() - 7 * 86400_000).toISOString();

  // ---- intake (§6.1) ---------------------------------------------------
  // Every artifact enriched since the watermark. NO domain filter. NO
  // geographic filter. The only narrowing is the enrichment status and the
  // watermark itself.
  const { data: artifacts, error: readErr } = await buildIntakeQuery(
    engine as unknown as ClientLike,
    since,
  ) as unknown as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
  if (readErr) {
    return new Response(JSON.stringify({ error: readErr.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const { data: regRows } = await engine
    .from("source_registry")
    .select("source_key, url")
    .or("source_key.like.puc:%,source_key.like.gov:%,source_key.like.iso:%,source_key.like.legis:%");
  const registry = new Map((regRows ?? []).map((r) => [String(r.source_key), String(r.url)]));

  let gate0Pass = 0, classified = 0, accepted = 0, rejected = 0, written = 0, primaryOk = 0;
  // A duplicate is neither a write nor a failure — it is §6.6 working. Counted
  // on its own line so a healthy steady state does not read as a broken run.
  let duplicates = 0, unmapped = 0;
  const rejectReasons: Record<string, number> = {};
  const errors: unknown[] = [];
  const budget = { fetches: 0 };
  /** §5 — what a `?dry=1` run reports instead of writing. */
  const wouldWrite: CandidatePayload[] = [];
  let watermark = since;

  for (const a of artifacts ?? []) {
    if (Date.now() - started > WALL_BUDGET_MS) break;
    if (classified >= MAX_CLASSIFY_PER_RUN) break;
    watermark = (a.enrich_completed_at as string) ?? watermark;

    const env = (a.signal_envelope ?? {}) as Record<string, unknown>;
    const title = String(env.title ?? "").slice(0, 500);
    const body = String(a.raw_content ?? "");
    const text = `${title}\n${body}`;

    // Gate 0 — free.
    const g0 = gate0(text);
    if (!g0.pass) continue;
    gate0Pass++;

    // Gate 1 — one model call.
    classified++;
    let result;
    try {
      result = await classifyOne(anthropicKey, {
        source_url: String(a.source_url ?? ""),
        published_at: (a.published_at as string | null) ?? null,
        title,
        body,
      });
    } catch (e) {
      errors.push({ artifact_id: a.artifact_id, error: String(e).slice(0, 300) });
      continue;
    }
    if (!result.ok || !result.value) {
      rejected++;
      const r = result.reason ?? "unknown";
      rejectReasons[r] = (rejectReasons[r] ?? 0) + 1;
      continue;
    }
    accepted++;
    const c = result.value;

    // Gate 2 — locate the authority's own document. Never drops the candidate.
    // Canonicalised here rather than read off the artifact: see intake.ts for
    // why `artifacts.canonical_url` is no longer selected.
    const canonical = canonicalizeUrl(String(a.source_url ?? ""));
    const primary = await findPrimarySource(c, String(a.source_url ?? ""), prov, registry, budget);
    if (primary.ok) primaryOk++;

    const hash = await sha256hex(
      candidateHashInput({
        canonical_url: canonical,
        instrument_no: c.instrument_no,
        effective_date: c.effective_date,
        state_abbr: c.state_abbr,
        authority_level: c.authority_level,
      }),
    );

    // THE CONTRACT. Every key below is one bs_record_candidate_propose reads
    // out of `p`; nothing else is sent, and the builder refuses a payload that
    // carries a key the function would ignore. `effective_date` is NOT here —
    // boundstone.record_candidates has no such column, so the classifier's
    // transcribed date feeds the content hash and goes no further. It is
    // transcribed or null either way; it is never computed ([REC-6]).
    const built = buildCandidatePayload({
      artifact_id: a.artifact_id,
      source_url: String(a.source_url ?? ""),
      canonical_url: canonical,
      discovery_host: urlHost(String(a.source_url ?? "")),
      headline: title || normalizeDocument(body).slice(0, 300) || "(untitled)",
      extract: c.extract,
      published_at: a.published_at ?? null,
      authority_level: c.authority_level,
      issuing_authority: c.issuing_authority,
      state_abbr: c.state_abbr,
      jurisdiction_name: c.jurisdiction_name,
      instrument_type: c.instrument_type,
      instrument_no: c.instrument_no,
      signal_score: c.signal_score,
      signal_reasons: [
        ...c.signal_reasons,
        ...g0.verbs.map((v) => `gate0_verb:${v}`),
        ...g0.objects.map((o) => `gate0_object:${o}`),
        `primary_source:${primary.note}`,
      ],
      primary_source_url: primary.url,
      primary_source_ok: primary.ok,
      content_hash: hash,
    });
    if (!built.ok || !built.payload) {
      unmapped++;
      const r = `payload: ${built.reason ?? "unknown"}`;
      rejectReasons[r] = (rejectReasons[r] ?? 0) + 1;
      continue;
    }

    // §5 — DRY. bs_record_candidate_propose has no dry mode (read its
    // definition: a plain INSERT ... ON CONFLICT DO NOTHING), so the dry path
    // does not call it. It reports the payload instead. Calling it "just to
    // see" would write the row, which is the one thing a dry run may not do.
    if (dryRun) {
      if (wouldWrite.length < DRY_SAMPLE_MAX) wouldWrite.push(built.payload);
      written++; // "would have been proposed", reported as would_propose below
      continue;
    }

    // §6.5 — conflict on content_hash is a NO-OP inside the function. Trade-press
    // coverage of a captured instrument lands here and is absorbed, never opening
    // a second row (§6.6). RPC only: see boundstone-rpc.ts.
    const res = await proposeCandidate(boundstone, built.payload);
    if (!res.ok) {
      errors.push({ artifact_id: a.artifact_id, error: (res.error ?? "propose failed").slice(0, 300) });
    } else if (res.action === "duplicate") {
      duplicates++;
    } else if (res.action === "inserted") {
      written++;
    } else {
      errors.push({ artifact_id: a.artifact_id, error: `unexpected propose action '${res.action}'` });
    }
  }

  // The watermark advances only on a real run. A dry run that moved it would
  // skip everything it merely described.
  if (!dryRun && watermark !== since) {
    const set = await watermarkSet(boundstone, watermark, WATERMARK_KEY);
    if (!set.ok) errors.push({ watermark, error: `watermark write failed: ${set.error}` });
  }

  await engine.from("automation_health_log").insert({
    auto_id: AUTO_ID,
    crawler_id: CRAWLER_ID,
    run_started_at: startedIso,
    run_completed_at: new Date().toISOString(),
    artifacts_found: artifacts?.length ?? 0,
    artifacts_new: dryRun ? 0 : written,
    artifacts_duped: duplicates,
    errors,
    success: errors.length === 0,
    notes: `gate0_pass=${gate0Pass} classified=${classified} accepted=${accepted} ` +
      `rejected=${rejected} written=${written} duplicates=${duplicates} unmapped=${unmapped} ` +
      `primary_ok=${primaryOk}${dryRun ? " DRY" : ""}`,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      since,
      watermark,
      examined: artifacts?.length ?? 0,
      gate0_pass: gate0Pass,
      classified,
      accepted,
      rejected,
      reject_reasons: rejectReasons,
      [dryRun ? "would_propose" : "proposed"]: written,
      duplicates,
      unmapped,
      primary_source_located: primaryOk,
      dry_run: dryRun,
      // §5 — a dry run always reports a payload, even over an empty corpus, so
      // "what would this write" is answerable without waiting for a hit.
      ...(dryRun
        ? {
          wrote_nothing: true,
          canary_payload: canaryPayload(startedIso),
          would_write_sample: wouldWrite,
          would_write_sample_truncated: written > wouldWrite.length,
        }
        : {}),
    }),
    { headers: { "content-type": "application/json" } },
  );
});
