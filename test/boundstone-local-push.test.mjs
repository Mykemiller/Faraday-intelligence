/**
 * boundstone-local-push — FDY-91.
 *
 * The bridge from Faraday's local-gov-watch artifacts to Boundstone press items
 * and review-only record candidates.
 *
 * NO NETWORK AND NO DATABASE. Every number quoted below was measured read-only
 * against production (ycadmmngkdhvpcsrcuaq) on 2026-10-07/08 and committed as a
 * fixture; nothing here opens a connection.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TESTS ARE FOR
 * ---------------------------------------------------------------------------
 * Four claims in the PR body cannot be checked by reading code, and these are
 * the four:
 *
 *  1. THE ATTRIBUTION IS RIGHT ON REAL HEADLINES, NOT TIDY ONES. §1 is
 *     table-driven over 41 headlines captured from the corpus, including the
 *     one the whole module exists for ("Michigan City Council…", which is
 *     INDIANA and must therefore DECLINE) and one that is a whole paragraph
 *     rather than a headline. The expected verdicts are not hand-written: they
 *     are the output of scripts/boundstone-local-push-dryrun.sql, the SQL
 *     mirror used to measure all 6,157 rows. So §1 is simultaneously a test of
 *     the TypeScript and the thing that keeps the PR's totals quotable — if the
 *     two implementations ever drift, this goes red.
 *
 *  2. NO ARTICLE TEXT CAN REACH BOUNDSTONE. §3 checks the payload builder is a
 *     whitelist, that the SQL never returns raw_content, and that the ledger
 *     refuses an article-text key. Three layers, because guardrail 7 is the one
 *     a refactor would break by accident.
 *
 *  3. THE WIRE IS .rpc() ONLY. §4 drives the write surface with a recording
 *     stub whose `from` exists and records itself — "it was never called" is a
 *     much stronger statement than "it threw" — and statically scans the
 *     shipped function for a `.from(` whose receiver is the Boundstone client.
 *
 *  4. IT IS IDEMPOTENT. §5 proves the ledger's primary key and bs_press_propose
 *     are two independent keys, and that a `duplicate` reply is a success.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";

import {
  attributeHeadline,
  buildGazetteer,
  extractPhrases,
  foldHeadline,
  normalizeJurisdiction,
} from "../supabase/functions/boundstone-local-push/attribution-pure.ts";
import {
  extractHeadline,
  gnewsToken,
  headlineFromParts,
  hostOf,
  isAggregatorUrl,
} from "../supabase/functions/boundstone-local-push/headline-pure.ts";
import {
  buildPressPayload,
  decide,
  FN_FORBIDDEN_DIRECT_CANDIDATE,
  FN_PRESS_PROPOSE,
  FORBIDDEN_PAYLOAD_KEYS,
  LEDGER_REASONS,
  ledgerRow,
  PAYLOAD_KEYS,
  proposePress,
  publishedDate,
  restrictionKeywords,
} from "../supabase/functions/boundstone-local-push/push-pure.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const tsv = (rel) =>
  read(rel).split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#")).map((l) => l.split("\t"));

const INDEX = "supabase/functions/boundstone-local-push/index.ts";
const PUSH_MODULE = "supabase/functions/boundstone-local-push/push-pure.ts";
const LEDGER_MIG = "supabase/migrations/20261009230000_boundstone_push_ledger.sql";
const SCHEDULE_MIG = "supabase/migrations/20261009230001_boundstone_push_schedule.sql";
const DRYRUN_SQL = "scripts/boundstone-local-push-dryrun.sql";

// ---------------------------------------------------------------------------
// The gazetteer, from the committed 293-row slice of public.jurisdictions.
// ---------------------------------------------------------------------------
const gaz = buildGazetteer(
  tsv("test/fixtures/local-watch-jurisdictions.tsv").map(([name, state_abbr, level]) => ({
    name,
    state_abbr,
    level,
  })),
  tsv("test/fixtures/local-watch-states.tsv").map(([name, state_abbr]) => ({ name, state_abbr })),
);

const cases = tsv("test/fixtures/local-watch-attribution.tsv").map(
  ([headline, state_abbr, jurisdiction_name, state_rule, reason]) => ({
    headline,
    state_abbr: state_abbr || null,
    jurisdiction_name: jurisdiction_name || null,
    state_rule: state_rule || null,
    reason: reason || null,
  }),
);

/* =========================================================================
   §0 the fixture is what the PR says it is
   ========================================================================= */

test("§0 the fixture carries at least 30 real headlines, as the brief requires", () => {
  assert.ok(cases.length >= 30, `only ${cases.length} fixture rows`);
  assert.equal(cases.length, 41);
  // Every verdict column is internally consistent: a state XOR a reason.
  for (const c of cases) {
    assert.equal(
      c.state_abbr === null,
      c.reason !== null,
      `${c.headline}: state and reason must be exactly one of the two`,
    );
    if (c.state_abbr) assert.match(c.state_abbr, /^[A-Z]{2}$/);
    if (c.jurisdiction_name) assert.ok(c.state_abbr, "a jurisdiction without a state is not expressible");
  }
});

test("§0 the gazetteer slice is big enough to answer the ambiguity questions", () => {
  assert.equal(gaz.stateNames.size, 52, "50 states + DC + PR");
  // "union" must be ambiguous — if the slice dropped states, S2 would wrongly
  // resolve it, which is the dangerous direction.
  const union = gaz.byName.get("union") ?? [];
  assert.ok(new Set(union.map((r) => r.state_abbr)).size > 5, "the Union slice is too thin to be ambiguous");
  // …and "michigan city" must be present in both IN and ND, or the compound
  // guard in §1's first case passes for the wrong reason.
  const mc = gaz.byName.get("michigan city") ?? [];
  assert.deepEqual(new Set(mc.map((r) => r.state_abbr)), new Set(["IN", "ND"]));
});

/* =========================================================================
   §1 attribution over 41 real headlines — TypeScript vs the SQL mirror
   ========================================================================= */

for (const c of cases) {
  const label = c.headline.length > 70 ? `${c.headline.slice(0, 67)}...` : c.headline;
  test(`§1 ${label}`, () => {
    const got = attributeHeadline(c.headline, gaz);
    assert.equal(got.state_abbr, c.state_abbr, `state_abbr for: ${c.headline}`);
    assert.equal(got.state_rule, c.state_rule, `state_rule for: ${c.headline}`);
    assert.equal(got.reason, c.reason, `reason for: ${c.headline}`);
    assert.equal(
      got.jurisdiction_name,
      c.jurisdiction_name,
      `jurisdiction_name for: ${c.headline}`,
    );
  });
}

test("§1 the fixture exercises every rule and every refusal, not just the easy ones", () => {
  const seen = new Set(cases.map((c) => c.state_rule ?? c.reason));
  for (const expected of [
    "s1_state_name",
    "s2_unique_jurisdiction",
    "s3_abbr_agrees",
    "no_honest_state",
    "ambiguous_jurisdiction",
    "ambiguous_state_named",
  ]) {
    assert.ok(seen.has(expected), `no fixture row exercises ${expected}`);
  }
});

test("§1 ⚠️ Michigan City is Indiana, so the row DECLINES rather than filing under MI", () => {
  const got = attributeHeadline("Michigan City Council to consider data center moratorium", gaz);
  assert.equal(got.state_abbr, null, "a bare state name inside a compound place is not a state");
  assert.equal(got.reason, "no_honest_state");
  // The guard is the registry, not an exception list — so it must also hold for
  // places nobody wrote down here.
  for (const h of [
    "Kansas City Council weighs data center rules",
    "Iowa City approves data center moratorium",
    "Texas City Commission pauses data center permits",
    "Oklahoma City Council to consider data center ordinance",
    "Nevada City weighs a data center ban",
  ]) {
    assert.equal(attributeHeadline(h, gaz).state_rule, null, `S1 fired on a compound place: ${h}`);
  }
});

test("§1 the feed is not a parameter — attributeHeadline cannot even see it", () => {
  assert.equal(attributeHeadline.length, 2, "attributeHeadline takes (headline, gazetteer) only");
  const src = read("supabase/functions/boundstone-local-push/attribution-pure.ts");
  const body = src.slice(src.indexOf("export function attributeHeadline"));
  for (const f of ["feed_url", "source_key", "source_url", "gsearch:"]) {
    assert.ok(!body.includes(f), `attributeHeadline reads ${f}; the feed is not evidence`);
  }
});

test("§1 a state is never scored — 'probably Ohio' is not representable", () => {
  const src = read("supabase/functions/boundstone-local-push/attribution-pure.ts");
  for (const k of ["confidence", "probability", "score", "weight", "likelihood"]) {
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")).join("\n");
    assert.ok(!new RegExp(`\\b${k}\\b`).test(code), `attribution carries a ${k}`);
  }
});

/* =========================================================================
   §2 the headline is the publisher's, not Google's
   ========================================================================= */

test("§2 Google's ' - <outlet>' suffix is stripped, by measurement not by guess", () => {
  const raw =
    "St. Croix County Board approves data center moratorium - Hudson Star-Observer\n\n" +
    "St. Croix County Board approves data center moratorium&nbsp;&nbsp;Hudson Star-Observer";
  assert.deepEqual(extractHeadline(raw), {
    headline: "St. Croix County Board approves data center moratorium",
    publisher: "Hudson Star-Observer",
  });
});

test("§2 a shape we have never measured returns null instead of a plausible cut", () => {
  // No separator at all.
  assert.equal(extractHeadline("Some headline with no publisher marker"), null);
  // Separator present, but line 1 does not end in ' - ' + publisher.
  assert.equal(
    extractHeadline("A headline - The Wrong Outlet\n\nA headline&nbsp;&nbsp;The Right Outlet"),
    null,
  );
  // Nothing survives the suffix.
  assert.equal(extractHeadline("- Outlet\n\n- Outlet&nbsp;&nbsp;Outlet"), null);
  assert.equal(extractHeadline(null), null);
  assert.equal(extractHeadline(42), null);
});

test("§2 extractHeadline and headlineFromParts are one rule, not two", () => {
  // The SQL hands the two parts over directly, so the two entry points must
  // never be able to disagree.
  for (const [l1, pub] of [
    ["Carlton County passes moratorium - Pine Journal", "Pine Journal"],
    ["A headline - Outlet", "Different Outlet"],
    ["", "Outlet"],
    ["Only a headline", ""],
  ]) {
    assert.deepEqual(
      headlineFromParts(l1, pub),
      extractHeadline(`${l1}\n\n${l1}&nbsp;&nbsp;${pub}`),
      `the two entry points disagree on [${l1}] / [${pub}]`,
    );
  }
});

test("§2 the publisher is taken after the LAST separator, which matters for real outlets", () => {
  // An outlet name containing the entity is exactly the case a '[^&]*$' regex
  // got wrong when this was re-measured; see headline-pure.ts's header.
  const raw =
    "County weighs data center rules - AP &amp; Co\n\n" +
    "County weighs data center rules&nbsp;&nbsp;AP &amp; Co";
  assert.equal(extractHeadline(raw)?.publisher, "AP &amp; Co");
});

test("§2 an aggregator URL is recognised, and a publisher URL is not mistaken for one", () => {
  for (const u of [
    "https://news.google.com/rss/articles/AU_yqLabc",
    "http://NEWS.GOOGLE.COM/rss/articles/x",
    "https://google.com/anything",
    "https://www.google.co.uk/x",
  ]) {
    assert.equal(isAggregatorUrl(u), true, u);
  }
  for (const u of [
    "https://hudsonstarobserver.com/2026/08/moratorium",
    "https://www.kansas.com/news/article1.html",
    "https://googlesheets-blog.example.com/x",
  ]) {
    assert.equal(isAggregatorUrl(u), false, u);
  }
  assert.equal(hostOf("https://User@Example.COM:8443/path?q=1"), "example.com");
  assert.equal(gnewsToken("https://news.google.com/rss/articles/AU_yqLabc?oc=5"), "AU_yqLabc");
  assert.equal(gnewsToken("https://publisher.example.com/a"), null);
});

/* =========================================================================
   §3 guardrail 7 — article text cannot reach Boundstone
   ========================================================================= */

const DUE_ROW = {
  artifact_id: "11111111-2222-4333-8444-555555555555",
  published_at: "2026-08-14T18:00:00.000Z",
  publisher_url: "https://hudsonstarobserver.com/2026/08/moratorium",
  publisher_domain: "hudsonstarobserver.com",
  rss_line1:
    "St. Croix County Board of Supervisors unanimously approves data center moratorium - Hudson Star-Observer",
  rss_publisher: "Hudson Star-Observer",
};

test("§3 the payload has exactly the keys bs_press_propose reads, and no others", () => {
  const d = decide(DUE_ROW, gaz, { httpStatus: 200, retrievedAt: "2026-08-14T18:00:00.000Z" });
  assert.equal(d.send, true);
  const payload = buildPressPayload(d.payload);
  for (const k of Object.keys(payload)) {
    assert.ok(PAYLOAD_KEYS.includes(k), `payload carries unknown key ${k}`);
  }
  for (const k of FORBIDDEN_PAYLOAD_KEYS) {
    assert.ok(!(k in payload), `payload carries forbidden key ${k}`);
  }
  // And it is the real values, not placeholders.
  assert.equal(payload.state_abbr, "WI");
  assert.equal(payload.jurisdiction_name, "St. Croix County");
  assert.equal(payload.published_date, "2026-08-14");
  assert.equal(payload.url, DUE_ROW.publisher_url);
  assert.equal(
    payload.headline,
    "St. Croix County Board of Supervisors unanimously approves data center moratorium",
  );
});

test("§3 no payload from any fixture headline carries article text", () => {
  let built = 0;
  for (const c of cases) {
    const d = decide({ ...DUE_ROW, rss_line1: `${c.headline} - Outlet`, rss_publisher: "Outlet" }, gaz, {
      httpStatus: 200,
    });
    if (!d.send) continue;
    built += 1;
    const payload = buildPressPayload(d.payload);
    for (const k of FORBIDDEN_PAYLOAD_KEYS) assert.ok(!(k in payload), `${c.headline}: ${k}`);
    // The headline is the ONLY prose in the payload, and it is verbatim.
    assert.equal(payload.headline, c.headline);
    for (const [k, v] of Object.entries(payload)) {
      if (k === "headline" || k === "signal_reasons") continue;
      assert.ok(
        typeof v !== "string" || v.length < 300,
        `${k} is ${String(v).length} chars — that is not a URL, a date or a host`,
      );
    }
  }
  assert.ok(built >= 20, `only ${built} fixture rows produced a payload`);
});

test("§3 the SQL never hands the function raw_content", () => {
  const mig = read(LEDGER_MIG);
  const due = /create or replace function public\.boundstone_push_due[\s\S]*?\n\$\$;/.exec(mig);
  assert.ok(due, "boundstone_push_due is gone");
  // raw_content is READ (to split it and to match 'data ?cent') but never
  // RETURNED — the returns-table is the contract and this is the assertion.
  const returns = /returns table \(([\s\S]*?)\)\nlanguage/.exec(due[0]);
  assert.ok(returns, "the returns-table signature is gone");
  for (const forbidden of ["raw_content", "signal_envelope", "body_text", "body_"]) {
    assert.ok(
      !returns[1].includes(forbidden),
      `boundstone_push_due returns ${forbidden}; a body it holds is a body it could forward`,
    );
  }
  assert.match(returns[1], /rss_line1/);
  assert.match(returns[1], /rss_publisher/);
});

test("§3 the ledger refuses an article-text key and an oversized response", () => {
  const mig = read(LEDGER_MIG);
  const fn = /create or replace function public\.boundstone_push_record[\s\S]*?\n\$\$;/.exec(mig);
  assert.ok(fn, "boundstone_push_record is gone");
  for (const k of ["body", "extract", "summary", "snippet", "signal_score"]) {
    assert.ok(fn[0].includes(`'${k}'`), `the response key refusal does not list ${k}`);
  }
  assert.match(fn[0], /guardrail 7/);
  assert.match(fn[0], /> 4000/, "there is no size ceiling on response");
  // And the gate proves it rather than the comment claiming it.
  assert.match(mig, /G4 FAILED: an extract was accepted into the ledger/);
  assert.match(mig, /G4 FAILED: a 4 kB response was accepted into the ledger/);
});

test("§3 only five narrow keys survive from the RPC reply into the ledger", async () => {
  const client = {
    rpc: () =>
      Promise.resolve({
        data: {
          id: "22222222-2222-4222-8222-222222222222",
          status: "inserted",
          is_published: true,
          unpublished_reason: null,
          // a hostile reply, to prove the narrowing is real
          extract: "the article text",
          candidate: { extract: "more text" },
          summary: "a summary nobody asked for",
        },
        error: null,
      }),
  };
  const d = decide(DUE_ROW, gaz, { httpStatus: 200 });
  const r = await proposePress(client, d.payload);
  assert.deepEqual(Object.keys(r.response).sort(), [
    "id",
    "is_published",
    "reason",
    "status",
    "unpublished_reason",
  ]);
  for (const k of ["extract", "summary", "candidate"]) assert.ok(!(k in r.response), k);
});

/* =========================================================================
   §4 the wire is .rpc() only, and it is ONE function
   ========================================================================= */

function recordingBoundstone(reply = { data: { id: "33333333-3333-4333-8333-333333333333", status: "inserted" }, error: null }) {
  const calls = [];
  return {
    calls,
    rpc(fn, args) {
      calls.push({ method: "rpc", fn, args });
      return Promise.resolve(typeof reply === "function" ? reply(fn, args) : reply);
    },
    // `from` EXISTS and records itself. A stub without it would make an illegal
    // call throw, and "it threw" is much weaker than "it was never called".
    from(table) {
      calls.push({ method: "from", table });
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
        update: () => Promise.resolve({ data: null, error: null }),
        upsert: () => Promise.resolve({ data: null, error: null }),
        delete: () => Promise.resolve({ data: null, error: null }),
      };
    },
  };
}

test("§4 the call list has no 'from' and names exactly one function", async () => {
  const client = recordingBoundstone();
  for (const c of cases.slice(0, 12)) {
    const d = decide({ ...DUE_ROW, rss_line1: `${c.headline} - Outlet`, rss_publisher: "Outlet" }, gaz, {
      httpStatus: 200,
    });
    if (d.send) await proposePress(client, d.payload);
  }
  assert.ok(client.calls.length > 0, "nothing was sent, so the assertion is vacuous");
  assert.deepEqual([...new Set(client.calls.map((c) => c.method))], ["rpc"]);
  assert.deepEqual([...new Set(client.calls.map((c) => c.fn))], [FN_PRESS_PROPOSE]);
});

test("§4 ⚠️ bs_record_candidate_propose is never called from this lane", async () => {
  // The push role CAN execute it (decision D1), and calling it would open a
  // SECOND candidate row for one article under a different content_hash. The
  // candidate is proposed inside bs_press_propose, on FDY-77's key.
  const client = recordingBoundstone();
  const restriction = decide(
    {
      ...DUE_ROW,
      rss_line1: "Carlton County passes one-year moratorium on creation of data centers - Pine Journal",
      rss_publisher: "Pine Journal",
    },
    gaz,
    { httpStatus: 200 },
  );
  assert.equal(restriction.send, true);
  assert.equal(restriction.kind, "both", "a restriction headline must ask for a candidate");
  assert.equal(restriction.payload.propose_candidate, true);
  await proposePress(client, restriction.payload);
  assert.equal(
    client.calls.filter((c) => c.fn === FN_FORBIDDEN_DIRECT_CANDIDATE).length,
    0,
    "this lane called bs_record_candidate_propose directly",
  );
  // And no second hash scheme exists to key it with.
  const src = read(PUSH_MODULE);
  const code = src.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")).join("\n");
  for (const k of ["sha256", "content_hash", "md5", "createHash"]) {
    assert.ok(!code.includes(k), `push-pure computes ${k}; FDY-77 owns the candidate key`);
  }
});

test("§4 the shipped function has no table write against the Boundstone client", () => {
  const src = read(INDEX);
  // Every `.from(` in the file must be on the Faraday client.
  for (const m of src.matchAll(/(\w[\w!.]*)\s*\n?\s*\.from\(/g)) {
    assert.ok(
      !/boundstone/i.test(m[1]),
      `a table call is made on the Boundstone client: ${m[0]}`,
    );
  }
  assert.ok(src.includes("boundstone"), "the scan is vacuous — no Boundstone client exists");
  // db:{schema:'boundstone'} would reach tables without the word `from` nearby.
  assert.ok(!/schema:\s*["']boundstone["']/.test(src), "a boundstone schema client is constructed");
  // Guardrail 4: Faraday is never read FROM Boundstone, and Boundstone is never
  // read at all. There is no select against that project anywhere.
  assert.ok(!/boundstone\w*\.(select|from)\(/i.test(src));
});

test("§4 the credential is never logged, returned or ledgered", () => {
  const src = read(INDEX);
  // The JWT lives in exactly one local and is passed to createClient. It must
  // not appear in any json(), console or health detail.
  for (const m of src.matchAll(/(?:console\.\w+|json|health)\([^)]*\bjwt\b[^)]*\)/g)) {
    assert.fail(`the JWT reaches an output path: ${m[0]}`);
  }
  assert.ok(!/console\.log/.test(src), "the function logs; a log is an output path for a secret");
  // No hard-coded credential of any shape.
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(src), "a JWT literal is committed");
  assert.ok(!/sb_secret_|service_role_key\s*=\s*["']/.test(src));
  assert.match(src, /boundstone_push_jwt/, "the secret is read from the Vault by name");
});

/* =========================================================================
   §5 idempotency, and what a refusal looks like
   ========================================================================= */

test("§5 a 'duplicate' reply is a SUCCESS and is ledgered as what it would have been", async () => {
  const client = recordingBoundstone({
    data: { id: "44444444-4444-4444-8444-444444444444", status: "duplicate" },
    error: null,
  });
  const d = decide(DUE_ROW, gaz, { httpStatus: 200 });
  const r = await proposePress(client, d.payload);
  assert.equal(r.ok, true, "a duplicate must not be treated as an error to retry");
  assert.equal(r.status, "duplicate");

  const row = ledgerRow(DUE_ROW.artifact_id, d, r);
  // NOT 'skipped'. The press item is on boundstone.org and this artifact is why.
  assert.equal(row.kind, d.kind);
  assert.equal(row.boundstone_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(row.reason, undefined);
});

test("§5 a refusal is ledgered with a reason from the closed vocabulary", () => {
  const cases2 = [
    [{ ...DUE_ROW, publisher_url: null }, "no_publisher_url"],
    [{ ...DUE_ROW, publisher_url: "https://news.google.com/rss/articles/AU_yqL" }, "aggregator_url"],
    [{ ...DUE_ROW, publisher_url: "not-a-url" }, "aggregator_url"],
    [{ ...DUE_ROW, rss_line1: "no suffix here", rss_publisher: "Outlet" }, "no_headline"],
    [
      { ...DUE_ROW, rss_line1: "Atlanta will consider data center task force - AJC", rss_publisher: "AJC" },
      "no_honest_state",
    ],
    [
      { ...DUE_ROW, rss_line1: "Johnson County tackles data center zoning policy - X", rss_publisher: "X" },
      "ambiguous_jurisdiction",
    ],
  ];
  for (const [row, expected] of cases2) {
    const d = decide(row, gaz, { httpStatus: 200 });
    assert.equal(d.send, false, `${expected} should not send`);
    assert.equal(d.reason, expected);
    assert.ok(LEDGER_REASONS.includes(d.reason), `${d.reason} is outside the vocabulary`);
    const l = ledgerRow(row.artifact_id, d, null);
    assert.equal(l.kind, "skipped");
    assert.equal(l.reason, expected);
  }
});

test("§5 an unfetched link is refused — retrieved_at is not a formality", () => {
  for (const status of [null, undefined, 0, 404, 403, 500, 301]) {
    const d = decide(DUE_ROW, gaz, { httpStatus: status });
    assert.equal(d.send, false, `http_status ${status} was accepted`);
    assert.equal(d.reason, "not_retrieved");
  }
  assert.equal(decide(DUE_ROW, gaz, { httpStatus: 200 }).send, true);
});

test("§5 the ledger's primary key IS the idempotency guarantee", () => {
  const mig = read(LEDGER_MIG);
  assert.match(mig, /artifact_id\s+uuid primary key/);
  assert.match(mig, /on conflict \(artifact_id\) do nothing/);
  // And the gate proves a second call is a reported no-op that does not
  // overwrite the first verdict.
  assert.match(mig, /G3 FAILED: a second record for one artifact returned/);
  assert.match(mig, /G3 FAILED: a second call rewrote kind to/);
  assert.match(mig, /G3 FAILED: a ledgered artifact is still due/);
  // due excludes anything already ledgered.
  assert.match(mig, /not exists \(\s*\n\s*select 1 from public\.boundstone_push_ledger/);
});

test("§5 a skip without a reason is refused by a CHECK, not by convention", () => {
  const mig = read(LEDGER_MIG);
  assert.match(mig, /check \(\(kind = 'skipped'\) = \(reason is not null\)\)/);
  assert.match(mig, /G4 FAILED: a reasonless skip was stored/);
});

/* =========================================================================
   §6 the restriction test — a shortlist, never a verdict
   ========================================================================= */

test("§6 both halves are required: a restriction verb AND a local-government noun", () => {
  assert.deepEqual(restrictionKeywords("Carlton County passes one-year moratorium on data centers"), ["moratori"]);
  assert.deepEqual(
    restrictionKeywords("Sarasota County bans data center applications for one year"),
    ["ban"],
  );
  // Verb with no government noun — a corporate decision, not a government act.
  assert.deepEqual(restrictionKeywords("Microsoft pauses construction on three data centers"), []);
  // Government noun with no restriction verb.
  assert.deepEqual(restrictionKeywords("County commission tours new data center campus"), []);
});

test("§6 ⚠️ 'ban' is word-bounded, or Albany becomes a moratorium", () => {
  for (const h of [
    "Albany County board reviews data center plans",
    "Urban county planners discuss data centers",
    "City council sees abandoned data center site",
    "County commission unveils new banner for the data center park",
  ]) {
    assert.ok(
      !restrictionKeywords(h).includes("ban"),
      `'ban' matched inside a word: ${h}`,
    );
  }
  assert.ok(restrictionKeywords("County bans data centers").includes("ban"));
  assert.ok(restrictionKeywords("County banned data centers").includes("ban"));
  assert.ok(restrictionKeywords("County banning data centers").includes("ban"));
});

test("§6 signal_reasons is the matched keywords, never a score or a ranking", () => {
  const d = decide(
    {
      ...DUE_ROW,
      rss_line1: "Pulaski County Quorum Court advances ordinance to rezone data center site - X",
      rss_publisher: "X",
    },
    gaz,
    { httpStatus: 200 },
  );
  if (d.send) {
    for (const r of d.payload.signal_reasons) {
      assert.equal(typeof r, "string");
      assert.ok(["moratori", "ban", "pause", "ordinance", "rezon", "prohibit"].includes(r), r);
    }
    assert.ok(!("signal_score" in buildPressPayload(d.payload)));
  }
  // The fixture's own candidate count, so the PR's 232 is not a free-floating
  // number: every restriction-shaped fixture row must produce kind 'both'.
  let both = 0;
  for (const c of cases) {
    if (!c.state_abbr) continue;
    const dd = decide({ ...DUE_ROW, rss_line1: `${c.headline} - Outlet`, rss_publisher: "Outlet" }, gaz, {
      httpStatus: 200,
    });
    if (dd.send && dd.kind === "both") both += 1;
  }
  assert.ok(both > 0, "no fixture row is restriction-shaped; §6 proves nothing");
});

/* =========================================================================
   §7 the migrations say they are un-applied, and refuse to half-apply
   ========================================================================= */

test("§7 both migrations say UN-APPLIED on line 1", () => {
  for (const f of [LEDGER_MIG, SCHEDULE_MIG]) {
    assert.equal(read(f).split("\n")[0], "-- UN-APPLIED — applied by Myke on merge", f);
  }
});

/**
 * ⚠️ AMENDED on the second rebase, 2026-10-08. This test used to assert
 * "20261009230001 is the newest prefix in the tree". That was true when it was
 * written and is now false: FDY-88/89/93 merged to main between this branch's
 * two rebases, bringing 20261009200000, 20261009210000 and — the one that
 * breaks the old claim — 20261010100000 (local_watch_county_complete).
 *
 * Re-numbering upwards to restore the assertion would be chasing the assertion
 * instead of the invariant, and would do it every time a sibling lands. The two
 * things that were ever actually being protected are asserted instead:
 *
 *   (i)  both files sort AFTER 20261009220000 (FDY-90), which they depend on and
 *        whose absence §0 refuses over, and the schedule sorts after the ledger
 *        it schedules. That is the ordering that would really break.
 *   (ii) nothing that sorts after them is named in either $ordering$ block. This
 *        file sorting before FDY-93's 20261010100000 is harmless precisely
 *        because neither calls the other — checked here rather than assumed.
 *
 *   (iii) no two files in the tree share a prefix, which is the collision this
 *         numbering convention exists to prevent and the one real hazard a
 *         sibling branch can create.
 */
test("§7 (i) the versions sort after FDY-90, and the schedule after the ledger", () => {
  assert.ok("20261009230000" > "20261009220000", "the ledger must sort after FDY-90");
  assert.ok("20261009230001" > "20261009230000", "the schedule must sort after the ledger");
});

test("§7 (ii) nothing either file sorts before is a dependency of it", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const later = readdirSync(dir)
    .filter((n) => n.endsWith(".sql") && /^\d{14}_/.test(n))
    .map((n) => n.split("_")[0])
    .filter((p) => p > "20261009230001")
    .sort();
  assert.ok(later.length > 0, "nothing sorts after these files; the test is not exercising anything");
  for (const f of [LEDGER_MIG, SCHEDULE_MIG]) {
    const sql = read(f);
    const guard = /do \$ordering\$[\s\S]*?\$ordering\$;/.exec(sql);
    assert.ok(guard, `${f} lost its ordering guard`);
    for (const prefix of later) {
      assert.ok(
        !guard[0].includes(prefix),
        `${prefix} sorts after ${f} but its $ordering$ block requires it — the guard would refuse`,
      );
    }
  }
});

test("§7 (iii) no two migration files share a numeric prefix", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const seen = new Map();
  const collisions = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql") && /^\d{14}_/.test(n)).sort()) {
    const p = name.split("_")[0];
    if (seen.has(p)) collisions.push(`${p}: ${seen.get(p)} and ${name}`);
    else seen.set(p, name);
  }
  assert.deepEqual(collisions, [], `migration numbers collide:\n  ${collisions.join("\n  ")}`);
  // And ours are both in there exactly once.
  assert.equal(seen.get("20261009230000"), "20261009230000_boundstone_push_ledger.sql");
  assert.equal(seen.get("20261009230001"), "20261009230001_boundstone_push_schedule.sql");
});

test("§7 the ledger migration refuses to apply before FDY-90", () => {
  const mig = read(LEDGER_MIG);
  assert.match(mig, /do \$ordering\$/);
  assert.match(mig, /to_regprocedure\('public\.gnews_resolve_measure\(\)'\) is null/);
  assert.match(mig, /20261009220000_gnews_resolve_schedule\.sql/);
  // The guard is OUTSIDE the transaction, so a refusal does not leave an
  // operator applying by hand stuck at 25P02.
  assert.ok(mig.indexOf("$ordering$;") < mig.indexOf("\nbegin;"), "the ordering guard is inside begin");
});

test("§7 the schedule migration installs one hourly job and embeds no credential", () => {
  const mig = read(SCHEDULE_MIG);
  assert.match(mig, /cron\.schedule\('boundstone-local-push-hourly', '40 \* \* \* \*'/);
  assert.match(mig, /cron\.unschedule\(jobid\) from cron\.job where jobname = 'boundstone-local-push-hourly'/);
  assert.match(mig, /cron_http_post/);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(mig), "a JWT literal is in the migration");
  assert.match(mig, /'cron_caller_token'/, "the token is passed by NAME, not by value");
  // It must not reschedule FDY-90's jobs.
  assert.ok(
    !/unschedule[\s\S]{0,200}gnews-(resolve|body)/.test(mig),
    "the schedule migration unschedules another lane's jobs",
  );
});

test("§7 neither migration writes public.artifacts", () => {
  for (const f of [LEDGER_MIG, SCHEDULE_MIG]) {
    const sql = read(f)
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    assert.ok(!/update\s+public\.artifacts/i.test(sql), `${f} updates artifacts`);
    assert.ok(!/delete\s+from\s+public\.artifacts/i.test(sql), `${f} deletes artifacts`);
    assert.ok(!/insert\s+into\s+public\.artifacts/i.test(sql), `${f} inserts artifacts`);
    assert.ok(!/alter\s+table\s+public\.artifacts/i.test(sql), `${f} alters artifacts`);
  }
  assert.match(read(LEDGER_MIG), /G6 FAILED: artifacts moved/);
});

/* =========================================================================
   §8 the dry-run SQL is a mirror, and it says so
   ========================================================================= */

test("§8 the dry-run SQL is read-only on its first statement", () => {
  const sql = read(DRYRUN_SQL);
  const first = sql
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trimStart().startsWith("--"))
    .join(" ")
    .trim();
  assert.ok(
    first.startsWith("set default_transaction_read_only = on;"),
    `the dry-run's first statement is: ${first.slice(0, 80)}`,
  );
  // ⚠️ COMMENTS ARE STRIPPED FIRST. The file's header quotes Myke's
  // `update public.artifact_body_fetch_lanes …` in prose, on purpose, so an
  // operator reading the dry-run knows what it is conditional on. A naive
  // substring scan over the whole file reads that explanation as the violation
  // it exists to rule out — which is exactly what the first version of this
  // test did.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--") && !l.trimStart().startsWith("\\echo"))
    .join("\n")
    .toLowerCase();
  for (const w of ["insert into", "update ", "delete from", "alter table", "truncate", "grant ", "drop "]) {
    assert.ok(!statements.includes(w), `the dry-run executes "${w}"`);
  }
  // The only DDL is temporary views, which die with the session.
  assert.ok(sql.includes("create temporary view"), "the dry-run uses temporary views");
  for (const m of statements.matchAll(/create\s+(\w+)/g)) {
    assert.equal(m[1], "temporary", `the dry-run creates a ${m[1]}`);
  }
});

test("§8 the dry-run names the gate it is conditional on, and does not open it", () => {
  const sql = read(DRYRUN_SQL);
  assert.match(sql, /20261009220000/);
  assert.match(sql, /aggregator_robots_ack/);
  assert.match(sql, /decision D5/);
  // The UPDATE appears ONLY inside a comment. If it ever becomes a statement,
  // this fails.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(
    !/update\s+public\.artifact_body_fetch_lanes/i.test(statements),
    "the dry-run would open FDY-90's gate; that is Myke's production write",
  );
});

test("§8 the fixture claims to come from the dry-run, so drift is visible", () => {
  const fixture = read("test/fixtures/local-watch-attribution.tsv");
  assert.match(fixture, /boundstone-local-push-dryrun\.sql/);
  assert.match(fixture, /read-only/);
  assert.match(read(DRYRUN_SQL), /local-watch-attribution\.tsv/);
});

/* =========================================================================
   §9 small things that would be wrong quietly
   ========================================================================= */

test("§9 published_date is transcribed in UTC, never shifted and never computed", () => {
  assert.equal(publishedDate("2026-08-14T18:00:00.000Z"), "2026-08-14");
  assert.equal(publishedDate("2026-08-14T23:59:59.000Z"), "2026-08-14");
  assert.equal(publishedDate("2026-08-15T00:00:00.000Z"), "2026-08-15");
  assert.equal(publishedDate(new Date("2026-01-01T00:00:00Z")), "2026-01-01");
  assert.equal(publishedDate("not a date"), null);
  assert.equal(publishedDate(null), null);
  // No clock-derived default anywhere: a date is the publisher's claim.
  const code = read(PUSH_MODULE);
  const fn = /export function publishedDate[\s\S]*?\n}/.exec(code)[0];
  assert.ok(!/Date\.now|new Date\(\)/.test(fn), "published_date can fall back to the clock");
});

test("§9 normalisation strips ONE type word, so 'Rome City town' is not 'rome'", () => {
  assert.equal(normalizeJurisdiction("Rome City town"), "rome city");
  assert.equal(normalizeJurisdiction("St. Croix County"), "st. croix");
  assert.equal(normalizeJurisdiction("Rapides Parish"), "rapides");
  assert.equal(normalizeJurisdiction("Michigan City city"), "michigan city");
  assert.equal(normalizeJurisdiction("O’Brien County"), "o'brien");
  assert.equal(normalizeJurisdiction("  Lac  qui  Parle  County "), "lac qui parle");
  assert.equal(normalizeJurisdiction(null), "");
});

test("§9 a township phrase matches a county subdivision, never a place of the same name", () => {
  // 'Center Township' must not collect every city called Center.
  const phrases = extractPhrases("Augusta Township voters overturn Data Center rezoning");
  assert.deepEqual(phrases, [{ text: "augusta", kind: "township" }]);
  const cityof = extractPhrases("City of Anniston adopts resolution establishing a moratorium");
  assert.deepEqual(cityof, [{ text: "anniston", kind: "cityof" }]);
  const county = extractPhrases("Lac qui Parle County hears a data center plan");
  assert.deepEqual(county, [{ text: "lac qui parle", kind: "county" }]);
});

test("§9 foldHeadline pads, so a whole-word test cannot match a prefix", () => {
  assert.equal(foldHeadline("Iowa City"), " iowa city ");
  assert.equal(foldHeadline("A — B"), " a - b ");
  assert.equal(foldHeadline(null), " ");
});

test("§9 the ledger reason vocabulary is closed and the migration agrees with it", () => {
  const mig = read(LEDGER_MIG);
  const comment = /comment on column public\.boundstone_push_ledger\.reason is[\s\S]*?;/.exec(mig);
  assert.ok(comment, "the reason column has no comment");
  for (const r of LEDGER_REASONS) {
    assert.ok(comment[0].includes(r), `the migration's reason list omits ${r}`);
  }
  assert.equal(new Set(LEDGER_REASONS).size, LEDGER_REASONS.length, "the vocabulary repeats itself");
});

test("§9 the function is off by default and nothing in it opens the gate", () => {
  const src = read(INDEX);
  assert.match(src, /BOUNDSTONE_PUSH_ENABLED/);
  assert.match(src, /enabled: false/);
  // It must never perform Myke's production write, in any mode.
  const code = src.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  assert.ok(!/artifact_body_fetch_lanes/.test(code), "the function touches FDY-90's lane config");
  assert.ok(!/fetch_enabled/.test(code));
  assert.ok(!/create_secret|vault\.create/.test(code), "the function writes a secret");
  // dryrun writes nothing at all.
  assert.match(src, /wrote_nothing: true/);
});
