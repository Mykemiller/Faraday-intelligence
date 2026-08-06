// CC-BOUNDSTONE-INGEST-1.1 §5.1 / Decision 2 / §11 (FAR-418).
//
// "boundstone-candidates selects with no reference to ifs_domains or
//  ifs_subdomains anywhere in its query path — assert with a test that inspects
//  the compiled query, not by code review."
//
// So this drives the real intake builder with a recording stub and asserts
// against the calls that were ACTUALLY made. A grep over the source would be
// code review wearing a test's clothes.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildIntakeQuery,
  INTAKE_COLUMNS,
} from "../supabase/functions/boundstone-candidates/intake.ts";

/** Records every call and argument, and returns itself so the chain builds. */
function recordingClient() {
  const calls = [];
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === "__calls") return calls;
      return (...args) => {
        calls.push({ method: String(prop), args });
        return builder;
      };
    },
  });
  return {
    from(table) {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
    __calls: calls,
  };
}

const FORBIDDEN = /ifs_domains|ifs_subdomains|idf_domains|idf_subdomains/i;

test("§5.1 the compiled intake query names no IDF column, anywhere", () => {
  const client = recordingClient();
  buildIntakeQuery(client, "2026-08-01T00:00:00Z");
  const calls = client.__calls;

  assert.ok(calls.length > 0, "the builder produced no calls at all");
  for (const c of calls) {
    const rendered = `${c.method}(${c.args.map((a) => JSON.stringify(a)).join(", ")})`;
    assert.ok(!FORBIDDEN.test(rendered), `IDF reference in the query path: ${rendered}`);
  }
});

test("§5.1 the intake reads artifacts and narrows ONLY on status and watermark", () => {
  const client = recordingClient();
  buildIntakeQuery(client, "2026-08-01T00:00:00Z");
  const calls = client.__calls;

  assert.deepEqual(calls[0], { method: "from", args: ["artifacts"] });

  // Every narrowing predicate, and what it narrows on.
  const filters = calls.filter((c) => ["eq", "gt", "lt", "gte", "lte", "in", "like", "ilike", "filter", "or", "not", "contains", "overlaps"].includes(c.method));
  const columns = filters.map((f) => String(f.args[0]));
  assert.deepEqual(columns.sort(), ["enrich_completed_at", "enrich_status"]);

  // Nothing geographic either — §6.1 says no geographic filter, and a state
  // filter would reintroduce the same blindness by another route.
  for (const col of columns) {
    assert.ok(!/state|jurisdiction|fips|region|market/i.test(col), `geographic filter on ${col}`);
  }
});

test("§5.1 the selected columns carry no IDF column", () => {
  assert.ok(!FORBIDDEN.test(INTAKE_COLUMNS), INTAKE_COLUMNS);
  // signal_envelope IS selected — it carries the source's declared domains as a
  // prior for OTHER consumers. Boundstone must never read that key, so assert
  // the classifier's own selection does not pull the key out by name.
  assert.ok(INTAKE_COLUMNS.includes("signal_envelope"));
  assert.ok(!INTAKE_COLUMNS.includes("signal_envelope->"));
});

test("§12 a domain pre-filter would be caught, not celebrated as an optimization", () => {
  // Guard the guard: if someone adds .contains('ifs_domains', ...) tomorrow,
  // the first test must fail. Prove the detector actually detects.
  const client = recordingClient();
  client.from("artifacts").select("x").contains("ifs_domains", ["D3"]);
  const offending = client.__calls
    .map((c) => `${c.method}(${c.args.map((a) => JSON.stringify(a)).join(", ")})`)
    .filter((r) => FORBIDDEN.test(r));
  assert.equal(offending.length, 1, "the detector must catch a domain pre-filter");
});
