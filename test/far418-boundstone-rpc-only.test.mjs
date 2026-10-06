// CC-BOUNDSTONE-INGEST-1.1 §6.5, rebuilt onto Boundstone migration 0042 (FAR-418).
//
// THE GUARANTEE THIS FILE ENFORCES
// boundstone-candidates holds a SERVICE-ROLE key for the Boundstone project. A
// service-role key can write any table in it. The only thing standing between
// that key and `boundstone.records` is a decision, so the decision is tested
// rather than trusted:
//
//   1. Every call this function makes against the Boundstone client is `.rpc()`.
//      Not one `.from(` exists against it, anywhere, in any file.
//   2. The payload carries exactly the keys bs_record_candidate_propose reads —
//      no review_state, no reviewed_by, no created_at, no confidence_grade.
//   3. `action:'duplicate'` is a no-op and a success, not an error and not a write.
//   4. Promotion to a published record is not expressible from here at all.
//
// Points 1 is checked two ways, because either alone is weak: a RECORDING STUB
// that captures the calls actually made (the compiled call list), and a static
// scan of the shipped source for a `.from(` whose receiver is the Boundstone
// client. The stub cannot see a code path the tests do not exercise; the scan
// cannot see a dynamically-built call. Together they close both holes.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AUTHORITY_LEVELS,
  buildCandidatePayload,
  canaryPayload,
  FN_PROPOSE,
  FN_WATERMARK_GET,
  FN_WATERMARK_SET,
  FORBIDDEN_PAYLOAD_KEYS,
  INSTRUMENT_TYPES,
  PAYLOAD_KEYS,
  proposeCandidate,
  WATERMARK_KEY,
  watermarkGet,
  watermarkSet,
} from "../supabase/functions/boundstone-candidates/boundstone-rpc.ts";
import { BLOCKED_SOURCE_DOMAINS } from "../supabase/functions/boundstone-candidates/primary-source.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const INDEX = "supabase/functions/boundstone-candidates/index.ts";
const RPC_MODULE = "supabase/functions/boundstone-candidates/boundstone-rpc.ts";

// ---------------------------------------------------------------------------
// 1a. The compiled call list — a recording stub.
// ---------------------------------------------------------------------------

/**
 * Records every method invoked on the Boundstone client. `from` is present and
 * records itself rather than being omitted: a stub that lacks `from` would make
 * an illegal call throw, and "it threw" is a much weaker statement than "it was
 * never called".
 */
function recordingBoundstone(rpcResult = { data: null, error: null }) {
  const calls = [];
  return {
    calls,
    rpc(fn, args) {
      calls.push({ method: "rpc", fn, args });
      return Promise.resolve(
        typeof rpcResult === "function" ? rpcResult(fn, args) : rpcResult,
      );
    },
    from(table) {
      calls.push({ method: "from", table });
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
        upsert: () => Promise.resolve({ data: null, error: null }),
      };
    },
  };
}

test("every Boundstone call in the write surface is .rpc() — the call list has no 'from'", async () => {
  const client = recordingBoundstone((fn) =>
    fn === FN_PROPOSE
      ? { data: { action: "inserted", candidate_id: "11111111-1111-1111-1111-111111111111" }, error: null }
      : { data: "2026-10-06T00:00:00Z", error: null }
  );

  await watermarkGet(client, WATERMARK_KEY);
  const built = buildCandidatePayload(sampleInput());
  assert.ok(built.ok, built.reason);
  await proposeCandidate(client, built.payload);
  await watermarkSet(client, "2026-10-06T01:00:00Z", WATERMARK_KEY);

  assert.ok(client.calls.length >= 3, "the stub recorded nothing — the test proves nothing");
  for (const c of client.calls) {
    assert.equal(c.method, "rpc", `table call against Boundstone: ${JSON.stringify(c)}`);
  }
  assert.deepEqual(
    client.calls.map((c) => c.fn),
    [FN_WATERMARK_GET, FN_PROPOSE, FN_WATERMARK_SET],
  );
});

test("the three function names are the ones Boundstone migration 0042 shipped", () => {
  // Read from pg_proc in project fwnerwrtlgnchuprvfgl on 2026-10-06.
  assert.equal(FN_PROPOSE, "bs_record_candidate_propose");
  assert.equal(FN_WATERMARK_GET, "bs_ingest_watermark_get");
  assert.equal(FN_WATERMARK_SET, "bs_ingest_watermark_set");
  assert.equal(WATERMARK_KEY, "boundstone-candidates");
});

test("the RPC argument names match the functions' own parameter names", async () => {
  const client = recordingBoundstone({ data: "2026-10-06T00:00:00Z", error: null });
  await watermarkGet(client, WATERMARK_KEY);
  await watermarkSet(client, "2026-10-06T01:00:00Z", WATERMARK_KEY);
  // bs_ingest_watermark_get(p_key text) / bs_ingest_watermark_set(p_key text, p_at timestamptz)
  assert.deepEqual(Object.keys(client.calls[0].args), ["p_key"]);
  assert.deepEqual(Object.keys(client.calls[1].args).sort(), ["p_at", "p_key"]);

  // bs_record_candidate_propose(p jsonb) — one argument, named p.
  const c2 = recordingBoundstone({ data: { action: "inserted", candidate_id: null }, error: null });
  await proposeCandidate(c2, buildCandidatePayload(sampleInput()).payload);
  assert.deepEqual(Object.keys(c2.calls[0].args), ["p"]);
});

// ---------------------------------------------------------------------------
// 1b. The compiled call list — a static scan of the shipped source.
// ---------------------------------------------------------------------------

/**
 * Blank out comments and string/template literals, so prose about `.from(` can
 * neither satisfy nor trip the check.
 *
 * Written as a single-pass scanner rather than a stack of .replace() calls on
 * purpose: chained regexes get the quote parity wrong the moment a literal
 * contains `//` or a comment contains a quote, and they fail SILENTLY — the
 * scanner returns an empty call list and every assertion built on it passes
 * while proving nothing. That failure mode is worse than no test, so the
 * tokenizer is explicit and the callers assert the list is non-empty.
 */
function stripNonCode(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += quote + quote;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every `<receiver>.from(...)` / `<receiver>.rpc(...)` actually present in the
 * code of a source file. This is the compiled call list the guarantee rests on. */
function callList(src) {
  const code = stripNonCode(src);
  const out = [];
  const re = /(\w+)\s*\.\s*(from|rpc)\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push({ receiver: m[1], method: m[2] });
  return out;
}

test("the shipped source contains no .from(...) against the Boundstone client", () => {
  const src = read(INDEX);
  const calls = callList(src);
  assert.ok(calls.length > 0, "the scanner found no calls at all — it is not working");

  const offending = calls.filter((c) => c.receiver === "boundstone" && c.method === "from");
  assert.deepEqual(offending, [], `Boundstone must be RPC-only: ${JSON.stringify(offending)}`);

  // Every table call that does exist is against the ENGINE client, which is
  // Faraday's own project and is allowed one write: its health log.
  for (const c of calls.filter((x) => x.method === "from")) {
    assert.equal(c.receiver, "engine", `unexpected table call receiver '${c.receiver}'`);
  }
});

test("the RPC module itself cannot express a table call", () => {
  const calls = callList(read(RPC_MODULE));
  assert.deepEqual(calls.filter((c) => c.method === "from"), []);
  assert.ok(calls.some((c) => c.method === "rpc"), "the module must actually call rpc");
  // The client interface it accepts has no `from` member at all, so a client
  // narrowed to it is structurally incapable of a table write.
  assert.ok(!/interface RpcClientLike[\s\S]*?\bfrom\s*\(/.test(read(RPC_MODULE)));
});

test("guard the guard: an injected boundstone.from(...) is caught", () => {
  const poisoned = read(INDEX) + '\nboundstone.from("record_candidates").insert({});\n';
  const offending = callList(poisoned).filter((c) => c.receiver === "boundstone" && c.method === "from");
  assert.equal(offending.length, 1, "the scanner must detect a table call it is meant to forbid");
});

test("the schema override that would make .from() resolve into boundstone is gone", () => {
  // CODE only. The comments in index.ts quote `db:{schema:"boundstone"}` and
  // `allowed_source_domains` while explaining why neither is there any more,
  // and a check that cannot tell prose from code would forbid saying so.
  const code = stripNonCode(read(INDEX));
  assert.ok(!/db\s*:\s*\{\s*schema\s*:/.test(code), "db:{schema:...} must not be set on the Boundstone client");
  assert.ok(!/allowed_source_domains/.test(code), "that table does not exist in Boundstone");
  // The old direct insert, gone: no .from() on the Boundstone client at all,
  // and no .insert( / .upsert( anywhere in the file.
  assert.ok(!/\.\s*insert\s*\(/.test(code.replace(/engine\s*\.\s*from\([\s\S]*?\)\s*\.\s*insert\s*\(/g, "")) ||
    callList(read(INDEX)).filter((c) => c.receiver === "boundstone").every((c) => c.method === "rpc"));
  assert.deepEqual(
    callList(read(INDEX)).filter((c) => c.receiver === "boundstone").map((c) => c.method),
    [],
    "the Boundstone client is never a receiver of from()/rpc() directly — it is handed to boundstone-rpc.ts",
  );
});

test("nothing in this function writes boundstone.records or any confidence_grade", () => {
  for (const f of [INDEX, RPC_MODULE, "supabase/functions/boundstone-candidates/intake.ts"]) {
    const src = read(f);
    assert.ok(!/\bconfidence_grade\b\s*:/.test(src), `${f} assigns a confidence_grade`);
    // `records` must never appear as a table argument or an RPC target.
    assert.ok(!/\.from\(\s*["'`]records["'`]/.test(src), `${f} reads or writes boundstone.records`);
    assert.ok(!/bs_record_publish|bs_record_promote|record_promote/.test(src), `${f} reaches for a promotion path`);
  }
  // confidence_grade appears exactly once in the module — on the forbidden list.
  assert.ok(FORBIDDEN_PAYLOAD_KEYS.includes("confidence_grade"));
});

// ---------------------------------------------------------------------------
// 2. The payload contract — what FDY-63 consumes.
// ---------------------------------------------------------------------------

function sampleInput(over = {}) {
  return {
    artifact_id: "a1b2c3d4-0000-0000-0000-000000000001",
    source_url: "https://puc.texas.gov/docket/56789",
    canonical_url: "https://puc.texas.gov/docket/56789",
    discovery_host: "puc.texas.gov",
    headline: "Commission suspends large load interconnection approvals",
    extract: "the Commission hereby suspends approval of new large load interconnection requests",
    published_at: "2026-09-30T12:00:00Z",
    authority_level: "STATE_AGENCY",
    issuing_authority: "the Commission",
    state_abbr: "tx",
    jurisdiction_name: null,
    instrument_type: "order",
    instrument_no: "56789",
    signal_score: 0.91,
    signal_reasons: ["restriction_verb:suspend", "object:large load"],
    primary_source_url: "https://puc.texas.gov/docket/56789",
    primary_source_ok: true,
    content_hash: "f".repeat(64),
    ...over,
  };
}

test("the payload carries exactly the keys bs_record_candidate_propose reads", () => {
  const { ok, payload } = buildCandidatePayload(sampleInput());
  assert.ok(ok);
  assert.deepEqual(Object.keys(payload).sort(), [...PAYLOAD_KEYS].sort());
  for (const k of FORBIDDEN_PAYLOAD_KEYS) {
    assert.ok(!(k in payload), `payload must never carry ${k}`);
  }
});

test("review_state is not settable from here — the key never reaches the payload", () => {
  const { payload } = buildCandidatePayload(sampleInput({ review_state: "promoted", reviewed_by: "me" }));
  assert.ok(!("review_state" in payload));
  assert.ok(!("reviewed_by" in payload));
  // And the function itself ignores them: it reads p->>'...' key by key.
  // Promotion stays a human editorial act on the Boundstone side.
});

test("state_abbr is uppercased to satisfy record_candidates_state_abbr_ck", () => {
  assert.equal(buildCandidatePayload(sampleInput({ state_abbr: "tx" })).payload.state_abbr, "TX");
  assert.equal(buildCandidatePayload(sampleInput({ state_abbr: "Texas" })).payload.state_abbr, null);
  assert.equal(buildCandidatePayload(sampleInput({ state_abbr: "" })).payload.state_abbr, null);
});

test("the CHECK vocabularies are the live ones, and out-of-vocabulary becomes NULL", () => {
  // Read from pg_constraint on boundstone.record_candidates, 2026-10-06.
  assert.deepEqual([...AUTHORITY_LEVELS], [
    "LOCAL",
    "STATE",
    "STATE_AGENCY",
    "GRID_OPERATOR",
    "UTILITY",
    "FEDERAL",
  ]);
  assert.deepEqual([...INSTRUMENT_TYPES], [
    "ordinance",
    "order",
    "executive_directive",
    "protocol_revision",
    "tariff",
    "resolution",
    "statute",
    "rescission",
  ]);
  // Both columns are nullable under the CHECK, so an unknown label is dropped
  // rather than allowed to abort the row. Losing a real restriction over a
  // label would be the worse failure.
  assert.equal(buildCandidatePayload(sampleInput({ authority_level: "MUNICIPAL" })).payload.authority_level, null);
  assert.equal(buildCandidatePayload(sampleInput({ instrument_type: "memo" })).payload.instrument_type, null);
  assert.equal(buildCandidatePayload(sampleInput({ authority_level: "local" })).payload.authority_level, "LOCAL");
});

test("the classifier's vocabularies and the database's are the same lists", async () => {
  const classify = await import("../supabase/functions/boundstone-candidates/classify-pure.ts");
  assert.deepEqual([...classify.AUTHORITY_LEVELS], [...AUTHORITY_LEVELS]);
  assert.deepEqual([...classify.INSTRUMENT_TYPES], [...INSTRUMENT_TYPES]);
});

test("the four keys the function RAISES on are refused here first", () => {
  for (const k of ["artifact_id", "source_url", "headline", "content_hash"]) {
    const r = buildCandidatePayload(sampleInput({ [k]: "   " }));
    assert.equal(r.ok, false, `${k} blank must be refused`);
    assert.ok(r.reason.includes(k), r.reason);
  }
});

test("signal_reasons is always an array of non-empty strings", () => {
  assert.deepEqual(buildCandidatePayload(sampleInput({ signal_reasons: null })).payload.signal_reasons, []);
  assert.deepEqual(
    buildCandidatePayload(sampleInput({ signal_reasons: ["a", "", 7, "  b  "] })).payload.signal_reasons,
    ["a", "b"],
  );
});

test("signal_score is clamped to 0..1 and null when absent", () => {
  assert.equal(buildCandidatePayload(sampleInput({ signal_score: 2 })).payload.signal_score, 1);
  assert.equal(buildCandidatePayload(sampleInput({ signal_score: -1 })).payload.signal_score, 0);
  assert.equal(buildCandidatePayload(sampleInput({ signal_score: null })).payload.signal_score, null);
  assert.equal(buildCandidatePayload(sampleInput({ signal_score: "abc" })).payload.signal_score, null);
});

test("effective_date is not in the contract — the column does not exist", () => {
  // The classifier transcribes it (never computes it) and it feeds the content
  // hash. boundstone.record_candidates has no effective_date column, read from
  // information_schema on 2026-10-06, so sending it would be a fiction.
  assert.ok(!PAYLOAD_KEYS.includes("effective_date"));
  const { payload } = buildCandidatePayload(sampleInput({ effective_date: "2026-01-01" }));
  assert.ok(!("effective_date" in payload));
});

// ---------------------------------------------------------------------------
// 3. duplicate is a no-op.
// ---------------------------------------------------------------------------

test("action:'duplicate' is a success and writes nothing", async () => {
  const client = recordingBoundstone({
    data: { action: "duplicate", candidate_id: "22222222-2222-2222-2222-222222222222" },
    error: null,
  });
  const res = await proposeCandidate(client, buildCandidatePayload(sampleInput()).payload);
  assert.equal(res.ok, true, "a duplicate is not an error");
  assert.equal(res.action, "duplicate");
  assert.equal(res.candidate_id, "22222222-2222-2222-2222-222222222222");
  assert.equal(client.calls.length, 1, "no retry, no second write");
});

test("an RPC error is reported, not swallowed", async () => {
  const client = recordingBoundstone({ data: null, error: { message: "boom" } });
  const res = await proposeCandidate(client, buildCandidatePayload(sampleInput()).payload);
  assert.equal(res.ok, false);
  assert.equal(res.action, "error");
  assert.equal(res.error, "boom");
});

test("watermarkSet refuses a null timestamp instead of letting the function RAISE", async () => {
  const client = recordingBoundstone();
  const res = await watermarkSet(client, null);
  assert.equal(res.ok, false);
  assert.equal(client.calls.length, 0, "no call should have been made");
});

// ---------------------------------------------------------------------------
// 4. The dry run and the canary.
// ---------------------------------------------------------------------------

test("the canary builds through the real builder and names itself a canary", () => {
  const p = canaryPayload("2026-10-06T22:00:00.000Z");
  assert.deepEqual(Object.keys(p).sort(), [...PAYLOAD_KEYS].sort());
  assert.ok(p.headline.startsWith("CANARY"));
  assert.ok(p.content_hash.startsWith("canary:"));
  assert.ok(p.signal_reasons.includes("canary:dry_run"));
});

test("?dry=1 is a mode of the handler and the dry path never proposes", () => {
  const src = read(INDEX);
  assert.ok(/searchParams\.get\("dry"\)\s*===\s*"1"/.test(src), "?dry=1 must be honoured");
  assert.ok(src.includes("bodyIn.dry_run === true"), "the original {dry_run:true} body must still work");
  // The propose call must sit after the dry-run early return.
  const dryAt = src.indexOf("if (dryRun) {");
  const proposeAt = src.indexOf("await proposeCandidate(");
  assert.ok(dryAt > 0 && proposeAt > dryAt, "the dry branch must short-circuit before proposeCandidate");
  // And the watermark must not advance on a dry run.
  assert.ok(/if \(!dryRun && watermark !== since\)/.test(src));
});

// ---------------------------------------------------------------------------
// 5. The blocklist snapshot.
// ---------------------------------------------------------------------------

test("BLOCKED_SOURCE_DOMAINS equals the live boundstone.blocked_source_domains snapshot", () => {
  const snap = JSON.parse(read("docs/far-418/boundstone-blocked-source-domains.snapshot.json"));
  assert.equal(snap.project_ref, "fwnerwrtlgnchuprvfgl");
  assert.equal(snap.rows.length, snap.row_count);
  assert.deepEqual(
    [...BLOCKED_SOURCE_DOMAINS],
    snap.rows.map((r) => r.domain).sort(),
    "the hardcoded blocklist has drifted from the snapshot of the live table",
  );
  // Four vendors, five domains. Both facts are load-bearing and both are stated.
  assert.equal(snap.row_count, 5);
  for (const vendor of ["legiscan", "fiscalnote", "policynote", "data365"]) {
    assert.ok(
      BLOCKED_SOURCE_DOMAINS.some((d) => d.startsWith(vendor)),
      `${vendor} must be blocked`,
    );
  }
});
