#!/usr/bin/env node --experimental-strip-types
// boundstone-local-backfill.ts — FDY-92.
//
// The one-off, resumable backfill that walks Faraday's local-gov-watch
// artifacts from 2026-07-01 to today in weekly slices and pushes them to
// Boundstone through FDY-91's bridge.
//
// DRY RUN BY DEFAULT. `--apply` additionally requires
// BOUNDSTONE_BACKFILL_CONFIRM=1, so neither a stray flag in shell history nor
// an exported env var is enough on its own. It has never been run with
// --apply: FDY-92's guardrail 2 forbids it, and today it could not succeed
// anyway — see "IT CANNOT PUSH YET" below.
//
//   node --experimental-strip-types scripts/boundstone-local-backfill.ts
//   … --since 2026-09-01 --until 2026-10-01
//   … --limit 50 --json
//   … --apply                      (with BOUNDSTONE_BACKFILL_CONFIRM=1)
//
// ===========================================================================
// EVERY DECISION IS IMPORTED, NOT RE-DECIDED
// ===========================================================================
// This file contains no attribution, no headline rule, no restriction keyword
// and no payload shape. All four live in FDY-91's modules and are imported:
//
//   attribution-pure.ts  buildGazetteer, attributeHeadline (via decide)
//   headline-pure.ts     headlineFromParts, isAggregatorUrl (via decide)
//   push-pure.ts         decide, proposePress, ledgerRow, FN_PRESS_PROPOSE
//
// A backfill that attributed states differently from the hourly lane would put
// the same article under two different states on boundstone.org depending on
// which code happened to see it first. So `decide(row, gazetteer, opts)` is the
// only verdict in this file, and test/boundstone-local-backfill.test.mjs §7
// asserts statically that this file declares no second copy of any of them.
//
// ⚠️ attributeHeadline() takes the HEADLINE and the GAZETTEER, and nothing
// else. It cannot see the feed, and that is the whole point of FDY-88 and
// FDY-91: Google News files articles under the wrong place often enough that
// the feed's own state would put press items on the wrong state's public page.
// Nothing here passes a third argument or recovers the feed's state by any
// other route.
//
// ===========================================================================
// ONE RPC PER ARTICLE. NEVER bs_record_candidate_propose.
// ===========================================================================
// FDY-77 owns the candidate key in Boundstone (`news:` || md5(canonical url))
// and bs_press_propose proposes the candidate itself from the
// `propose_candidate` key. A second call to bs_record_candidate_propose with a
// different hash scheme is how one article becomes two rows in a queue a human
// reads. This script therefore computes no candidate hash and makes no second
// call — the same deviation from the original brief that FDY-91 documents, for
// the same reason. §7 of the test asserts the forbidden name never appears.
//
// ===========================================================================
// ⚠️ IT CANNOT PUSH YET, AND THE REFUSAL IS THE FEATURE
// ===========================================================================
// Measured read-only 2026-10-09 20:27 CT:
//
//   Boundstone (fwnerwrtlgnchuprvfgl)
//     to_regprocedure('public.bs_press_propose(jsonb)')             NULL
//     to_regprocedure('public.bs_record_candidate_propose(jsonb)')  exists
//     pg_roles 'boundstone_faraday_push'                            0 rows
//   Faraday (ycadmmngkdhvpcsrcuaq)
//     max applied migration                              20261009090756
//     local-watch artifacts with publisher_url                      0 of 54,231
//
// So all four preflight conditions fail today: no credential, no ledger table,
// no selector, and bs_press_propose does not exist. `--apply` stops before it
// reads a single artifact and exits 0 — not 1. A one-off operator script that
// exits non-zero when its dependencies are merely not yet applied teaches the
// operator to ignore its exit code.
//
// ===========================================================================
// WHAT IS NEVER SENT, AND WHY A BACKFILL IS A SPECIAL RISK HERE
// ===========================================================================
// * No article text. The selector returns the RSS first line and the publisher
//   name, never raw_content, so the body is not in this process's memory to
//   forward. buildPressPayload() is a key-by-key whitelist on top of that.
// * No aggregator URL. decide() refuses on isAggregatorUrl() before a payload
//   exists; Boundstone's enforce_press_item() refuses again on insert.
// * No score, no summary, no ranking. `signal_reasons` is the list of keywords
//   that literally matched the headline.
// * ⚠️ NO FABRICATED retrieved_at. This is the one guardrail-7 hazard that is
//   specific to a backfill. press_items.retrieved_at exists so Boundstone never
//   publishes a link nobody fetched; the hourly lane sends now() because it is
//   pushing an article resolved minutes ago. A backfill pushing a 12 July
//   article cannot say that. So retrieved_at is TRANSCRIBED from
//   public.artifacts.body_fetched_at, and a row with no successful body fetch
//   is DEFERRED rather than sent with a plausible timestamp.
//
// ===========================================================================
// ⚠️ A DEFERRAL IS NOT A SKIP, AND THE DIFFERENCE IS A LEDGER ROW
// ===========================================================================
// boundstone_push_ledger's primary key means a row is FOREVER: a ledgered
// artifact is never offered to any lane again. That is right for a permanent
// verdict — this headline names no state, this URL is an aggregator — and wrong
// for a transient one.
//
// `not_retrieved` is transient. It means FDY-90 resolved the publisher URL but
// the body fetch has not succeeded YET. Ledgering it would delete the article
// from the hourly lane's future for good, to record a fact that may stop being
// true an hour later. So this script DEFERS those rows: counts them, reports
// them, writes nothing. Every other refusal is ledgered exactly as the hourly
// lane ledgers it, through the same ledgerRow() and the same
// boundstone_push_record.
//
// This is a deliberate difference from supabase/functions/.../index.ts, which
// defaults http_status to 200 when the column is absent and therefore never
// reaches `not_retrieved` at all. The hourly lane gets away with that because
// it only ever sees fresh rows. A backfill does not.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGazetteer, type Gazetteer } from "../supabase/functions/boundstone-local-push/attribution-pure.ts";
import {
  decide,
  type Decision,
  type DueRow,
  FN_PRESS_PROPOSE,
  ledgerRow,
  type PressResult,
  proposePress,
  type RpcClientLike,
} from "../supabase/functions/boundstone-local-push/push-pure.ts";

// ===========================================================================
// CONSTANTS — every one of these is a decision, named
// ===========================================================================

/** The window floor. Boundstone release v2026.07 is `current_as_of 2026-07-31`;
 *  earlier coverage is out of scope (Myke's pre-made decision). The SQL
 *  selector carries the same literal and ignores a p_since below it, so this
 *  constant cannot be loosened from the command line. */
export const WINDOW_START_ISO = "2026-07-01T00:00:00.000Z";

/** Weekly slices, oldest first (brief §2). Seven days, half-open [start, end). */
export const SLICE_DAYS = 7;

/** Brief §4. Boundstone RPC calls only — the Faraday ledger write is a
 *  different project and is not paced, because pacing it would halve the
 *  achievable rate against Boundstone for no reason. */
export const BOUNDSTONE_RPS = 2;

/** Rows per selector page. 500 is the function's own internal ceiling. */
export const DEFAULT_BATCH = 500;

export const VAULT_SECRET_NAME = "boundstone_push_jwt";
export const BOUNDSTONE_URL = "https://fwnerwrtlgnchuprvfgl.supabase.co";
export const SELECTOR_FN = "boundstone_backfill_due";
export const LEDGER_FN = "boundstone_push_record";
export const MEASURE_FN = "boundstone_push_measure";

/**
 * The refusal reasons this script does NOT ledger. See the header: a ledger row
 * is forever, and `not_retrieved` is a statement about what has happened so
 * far, not about the article.
 */
export const DEFERRED_REASONS: readonly string[] = ["not_retrieved"];

/** Attribution refusals that mean "two candidates, no winner" rather than
 *  "nothing named a place". Reported separately because they are the ones a
 *  better gazetteer could convert. */
export const AMBIGUOUS_REASONS: readonly string[] = [
  "ambiguous_state_named",
  "ambiguous_jurisdiction",
];

// ===========================================================================
// ARGUMENTS
// ===========================================================================

export interface Args {
  apply: boolean;
  /** Maximum artifacts CONSIDERED across all slices, not maximum pushed. A
   *  limit on pushes would read the whole corpus to find them. */
  limit: number | null;
  since: string;
  until: string;
  batch: number;
  json: boolean;
  /** True when --since asked for a date before WINDOW_START_ISO. Reported, not
   *  silently honoured: the floor is a decision. */
  sinceClamped: boolean;
}

export interface ArgError {
  error: string;
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a `--since`/`--until` value. A bare date is midnight UTC — never a
 *  local midnight, which would shift the window by the operator's timezone. */
export function parseWhen(raw: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const s = raw.trim();
  const d = new Date(isoDay.test(s) ? `${s}T00:00:00.000Z` : s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function parseArgs(argv: readonly string[], nowIso?: string): Args | ArgError {
  const now = nowIso ?? new Date().toISOString();
  const out: Args = {
    apply: false,
    limit: null,
    since: WINDOW_START_ISO,
    until: now,
    batch: DEFAULT_BATCH,
    json: false,
    sinceClamped: false,
  };
  let sawDryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => argv[i + 1];
    switch (a) {
      case "--apply":
        out.apply = true;
        break;
      case "--dry-run":
        sawDryRun = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--limit": {
        const n = Number(value());
        if (!Number.isInteger(n) || n <= 0) return { error: `--limit needs a positive integer, got ${value()}` };
        out.limit = n;
        i += 1;
        break;
      }
      case "--batch": {
        const n = Number(value());
        if (!Number.isInteger(n) || n <= 0 || n > 500) {
          return { error: `--batch needs an integer 1..500, got ${value()}` };
        }
        out.batch = n;
        i += 1;
        break;
      }
      case "--since": {
        const t = parseWhen(value());
        if (!t) return { error: `--since is not a date: ${value()}` };
        out.since = t;
        i += 1;
        break;
      }
      case "--until": {
        const t = parseWhen(value());
        if (!t) return { error: `--until is not a date: ${value()}` };
        out.until = t;
        i += 1;
        break;
      }
      default:
        return { error: `unknown argument ${a}` };
    }
  }

  // ⚠️ Both flags together is a contradiction, not a precedence puzzle. The
  // operator who types both does not know which one wins, and guessing for them
  // is how a dry run becomes a push.
  if (out.apply && sawDryRun) {
    return { error: "--apply and --dry-run are mutually exclusive. Pass one." };
  }
  if (out.since < WINDOW_START_ISO) {
    out.since = WINDOW_START_ISO;
    out.sinceClamped = true;
  }
  return out;
}

// ===========================================================================
// WEEKLY SLICES
// ===========================================================================

export interface Slice {
  index: number;
  /** inclusive */
  start: string;
  /** exclusive */
  end: string;
}

/**
 * The window as consecutive half-open weekly slices, oldest first.
 *
 * Slices are anchored on `since`, NOT on the calendar week. date_trunc('week')
 * would bucket the first three days of the window into a Monday that precedes
 * it, so a report keyed that way starts with a partial week labelled 2026-06-29
 * and nothing in the window is actually that old. Anchoring on `since` makes
 * every label a date the window contains.
 *
 * The last slice is clipped to `until`, so the slices tile [since, until)
 * exactly: no gap, no overlap, and an artifact belongs to exactly one.
 */
export function weeklySlices(
  sinceIso: string,
  untilIso: string,
  days: number = SLICE_DAYS,
): Slice[] {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  if (!Number.isFinite(since) || !Number.isFinite(until)) return [];
  if (!Number.isInteger(days) || days <= 0) return [];
  if (until <= since) return [];
  const step = days * 86_400_000;
  const out: Slice[] = [];
  for (let t = since, i = 0; t < until; t += step, i += 1) {
    out.push({
      index: i,
      start: new Date(t).toISOString(),
      end: new Date(Math.min(t + step, until)).toISOString(),
    });
  }
  return out;
}

/** The slice a timestamp falls in, by label — the report's grouping key. */
export function sliceLabel(slices: readonly Slice[], publishedAt: string): string {
  const t = Date.parse(publishedAt);
  for (const s of slices) {
    if (t >= Date.parse(s.start) && t < Date.parse(s.end)) return s.start.slice(0, 10);
  }
  return "out-of-window";
}

// ===========================================================================
// RATE LIMIT
// ===========================================================================

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * A minimum-interval pacer. Brief §4: at most 2 RPC calls per second to
 * Boundstone.
 *
 * ⚠️ MINIMUM INTERVAL, NOT A TOKEN BUCKET, AND THAT IS THE STRICTER CHOICE. A
 * 2-token bucket permits two calls in the same millisecond and then a pause;
 * averaged over a second that is still "2 per second", but it is a burst
 * against someone else's database. 500 ms between calls can never burst, which
 * is what a one-off backfill of thousands of rows should look like from the
 * receiving end.
 *
 * The clock is injected so the test can prove the spacing without waiting.
 */
export function createPacer(ratePerSec: number = BOUNDSTONE_RPS, clock: Clock = realClock) {
  const interval = 1000 / ratePerSec;
  let nextAt = -Infinity;
  return {
    intervalMs: interval,
    async take(): Promise<void> {
      const now = clock.now();
      const at = Math.max(now, nextAt);
      if (at > now) await clock.sleep(at - now);
      nextAt = at + interval;
    },
  };
}

// ===========================================================================
// PREFLIGHT — the refusal the brief asks for (§5)
// ===========================================================================

export type ProbeClass = "healthy" | "missing" | "forbidden" | "unreachable";

/**
 * What a reply to the no-op health probe means.
 *
 * ⚠️ THE PROBE IS A CALL THAT CANNOT WRITE. bs_press_propose has no dry_run
 * key — its payload keys are fixed — so the probe sends `{}` and expects the
 * function to RAISE on the first missing required key. A raise is the healthy
 * answer: it proves the function exists, that PostgREST routed to it, and that
 * the push role may execute it, while writing nothing at all. A HEAD or OPTIONS
 * request would prove only that the gateway is up.
 *
 * The three failures are distinguished because they need different fixes:
 *   missing      Boundstone PR #63 is not merged/applied. Myke applies it.
 *   forbidden    the JWT's role has no EXECUTE. Myke re-mints it.
 *   unreachable  network or wrong URL. Nothing to do with this PR.
 */
export function classifyProbe(reply: {
  status?: number | null;
  code?: string | null;
  message?: string | null;
}): ProbeClass {
  const code = (reply.code ?? "").toUpperCase();
  const status = reply.status ?? 0;
  const msg = (reply.message ?? "").toLowerCase();

  // PostgREST: no function matching the signature in the exposed schema.
  if (code === "PGRST202" || code === "PGRST302" || status === 404) return "missing";
  if (/could not find the function|does not exist/.test(msg)) return "missing";
  // 42501 insufficient_privilege — the role cannot EXECUTE it.
  if (code === "42501" || status === 401 || status === 403) return "forbidden";
  if (status === 0 || status >= 500) return "unreachable";
  // Anything else is the function's own objection to an empty payload, which
  // is exactly what a reachable, executable bs_press_propose does.
  return "healthy";
}

export interface PreflightState {
  apply: boolean;
  credential: boolean;
  selectorExists: boolean;
  ledgerTableExists: boolean;
  probe: ProbeClass | null;
}

export interface PreflightResult {
  ok: boolean;
  /** From push-pure's LEDGER_REASONS where one applies, so an operator reading
   *  this and reading the ledger sees the same vocabulary. */
  reason: string | null;
  detail: string;
}

export function preflight(s: PreflightState): PreflightResult {
  if (!s.selectorExists) {
    return {
      ok: false,
      reason: "disabled",
      detail:
        `public.${SELECTOR_FN} does not exist. Apply ` +
        "supabase/migrations/20261010110000_boundstone_backfill_due.sql (which refuses " +
        "without FDY-91's 20261009230000, which refuses without FDY-90's 20261009220000).",
    };
  }
  if (!s.apply) {
    // A dry run needs nothing else: it never reads a credential and never
    // touches Boundstone.
    return { ok: true, reason: null, detail: "dry run — Boundstone is not contacted at all." };
  }
  if (!s.ledgerTableExists) {
    return {
      ok: false,
      reason: "disabled",
      detail:
        "public.boundstone_push_ledger does not exist. Without it a push cannot be recorded, " +
        "and an unrecorded push is one that repeats on the next run.",
    };
  }
  if (!s.credential) {
    return {
      ok: false,
      reason: "no_credential",
      detail:
        `Faraday Vault secret '${VAULT_SECRET_NAME}' is absent. Nothing was read and nothing ` +
        "was written. Myke mints and stores it (decision D1).",
    };
  }
  if (s.probe === "missing") {
    return {
      ok: false,
      reason: "disabled",
      detail:
        `Boundstone's public.${FN_PRESS_PROPOSE}(jsonb) does not exist. Merge and apply ` +
        "Boundstone PR #63 (migration 20261009110000_local_watch_intake.sql) first.",
    };
  }
  if (s.probe === "forbidden") {
    return {
      ok: false,
      reason: "no_credential",
      detail:
        `The push JWT cannot EXECUTE public.${FN_PRESS_PROPOSE}(jsonb). Its \`role\` claim must ` +
        "be boundstone_faraday_push and that role must hold the grant (decision D1).",
    };
  }
  if (s.probe !== "healthy") {
    return {
      ok: false,
      reason: "disabled",
      detail: `Boundstone did not answer the health probe (${s.probe ?? "no probe run"}).`,
    };
  }
  return { ok: true, reason: null, detail: "preflight passed; the lane may push." };
}

// ===========================================================================
// THE REPORT
// ===========================================================================

export type Outcome = "pushed" | "duplicate" | "deferred" | "skipped" | "failed";

export interface Report {
  mode: "dry-run" | "apply";
  since: string;
  until: string;
  measured_at: string;
  /** Read-only context from boundstone_push_measure(), so the report can say
   *  what the resolver has not done yet rather than leaving a silent zero. */
  corpus: {
    local_watch_artifacts: number | null;
    relevant_window: number | null;
    resolved_in_window: number | null;
    /** The brief's "items skipped for no publisher_url". They never reach this
     *  script — the selector's predicate excludes them — so the number comes
     *  from the corpus measurement and is labelled as such. */
    awaiting_publisher_url: number | null;
    ledgered: number | null;
  };
  totals: {
    considered: number;
    press_items: number;
    record_candidates: number;
    with_jurisdiction_name: number;
    state_only: number;
    deferred: number;
    skipped: number;
    duplicates: number;
    failed: number;
    ledger_rows_written: number;
    boundstone_calls: number;
  };
  by_state: Record<string, { press: number; candidates: number; jurisdiction: number }>;
  by_week: Record<
    string,
    { considered: number; press: number; candidates: number; declined: number; deferred: number }
  >;
  by_reason: Record<string, number>;
  ambiguous: number;
  slices: number;
  sample: unknown[];
}

export function newReport(mode: Report["mode"], since: string, until: string, measuredAt: string): Report {
  return {
    mode,
    since,
    until,
    measured_at: measuredAt,
    corpus: {
      local_watch_artifacts: null,
      relevant_window: null,
      resolved_in_window: null,
      awaiting_publisher_url: null,
      ledgered: null,
    },
    totals: {
      considered: 0,
      press_items: 0,
      record_candidates: 0,
      with_jurisdiction_name: 0,
      state_only: 0,
      deferred: 0,
      skipped: 0,
      duplicates: 0,
      failed: 0,
      ledger_rows_written: 0,
      boundstone_calls: 0,
    },
    by_state: {},
    by_week: {},
    by_reason: {},
    ambiguous: 0,
    slices: 0,
    sample: [],
  };
}

const bump = <T extends Record<string, number>>(o: Record<string, T>, k: string, seed: T): T => {
  if (!o[k]) o[k] = { ...seed };
  return o[k];
};

const WEEK_SEED = { considered: 0, press: 0, candidates: 0, declined: 0, deferred: 0 };
const STATE_SEED = { press: 0, candidates: 0, jurisdiction: 0 };

/**
 * Pre-create a row for every slice, so a week in which nothing happened prints
 * as a line of zeroes instead of vanishing.
 *
 * ⚠️ A MISSING WEEK AND A ZERO WEEK LOOK THE SAME IN A SPARSE TABLE AND MEAN
 * OPPOSITE THINGS. "The resolver has nothing from that week" is a finding; "the
 * report skipped that week" is a bug. Seeding makes the two distinguishable
 * without the reader counting rows against a calendar.
 */
export function seedWeeks(report: Report, slices: readonly Slice[]): void {
  for (const s of slices) bump(report.by_week, s.start.slice(0, 10), WEEK_SEED);
}

/**
 * Fold one decided artifact into the report.
 *
 * `outcome` is the fate, which in a dry run is always the hypothetical one. The
 * aggregation is identical in both modes on purpose: a dry-run report that
 * counted differently from the apply it predicts would be worthless.
 */
export function recordDecision(
  report: Report,
  weekLabel: string,
  decision: Decision,
  outcome: Outcome,
): void {
  report.totals.considered += 1;
  const wk = bump(report.by_week, weekLabel, WEEK_SEED);
  wk.considered += 1;

  if (!decision.send) {
    report.by_reason[decision.reason] = (report.by_reason[decision.reason] ?? 0) + 1;
    if (AMBIGUOUS_REASONS.includes(decision.reason)) report.ambiguous += 1;
    if (outcome === "deferred") {
      report.totals.deferred += 1;
      wk.deferred += 1;
    } else {
      report.totals.skipped += 1;
      wk.declined += 1;
    }
    return;
  }

  if (outcome === "failed") {
    report.totals.failed += 1;
    report.by_reason.rejected_by_boundstone = (report.by_reason.rejected_by_boundstone ?? 0) + 1;
    wk.declined += 1;
    return;
  }

  const p = decision.payload;
  report.totals.press_items += 1;
  wk.press += 1;
  const st = bump(report.by_state, p.state_abbr, STATE_SEED);
  st.press += 1;
  if (p.propose_candidate) {
    report.totals.record_candidates += 1;
    wk.candidates += 1;
    st.candidates += 1;
  }
  if (p.jurisdiction_name) {
    report.totals.with_jurisdiction_name += 1;
    st.jurisdiction += 1;
  } else {
    report.totals.state_only += 1;
  }
  if (outcome === "duplicate") report.totals.duplicates += 1;
  if (report.sample.length < 5) {
    report.sample.push({
      headline: p.headline,
      state_abbr: p.state_abbr,
      jurisdiction_name: p.jurisdiction_name,
      published_date: p.published_date,
      propose_candidate: p.propose_candidate,
      signal_reasons: p.signal_reasons,
      discovery_host: p.discovery_host,
      retrieved_at: p.retrieved_at,
    });
  }
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

/**
 * The report as text.
 *
 * ⚠️ REFUSALS ARE A COLUMN, NOT A FOOTNOTE. FDY-91's headline-only attribution
 * declines roughly three quarters of the window on purpose, because the feed's
 * own state is wrong often enough to put press items on the wrong state's
 * public page. A report that printed only what it would push would read as a
 * bug the first time somebody compared it with the corpus size.
 */
export function renderReport(r: Report): string {
  const L: string[] = [];
  const t = r.totals;
  L.push(`boundstone-local-backfill — ${r.mode.toUpperCase()}`);
  L.push(`window ${r.since.slice(0, 10)} → ${r.until.slice(0, 10)} · ${r.slices} weekly slices · measured ${r.measured_at}`);
  if (r.mode === "dry-run") L.push("NOTHING WAS WRITTEN, to either project.");
  L.push("");

  L.push("== corpus (read-only, public.boundstone_push_measure) ==");
  L.push(`  local-watch artifacts            ${lpad(num(r.corpus.local_watch_artifacts), 9)}`);
  L.push(`  in the window, 'data ?cent'      ${lpad(num(r.corpus.relevant_window), 9)}`);
  L.push(`  ... publisher_url resolved       ${lpad(num(r.corpus.resolved_in_window), 9)}  <- eligible`);
  L.push(`  ... awaiting publisher_url       ${lpad(num(r.corpus.awaiting_publisher_url), 9)}  <- skipped for no publisher_url (FDY-90 gate)`);
  L.push(`  already in the push ledger       ${lpad(num(r.corpus.ledgered), 9)}  <- resumed past, not re-read`);
  L.push("");

  L.push("== what the backfill would do ==");
  L.push(`  artifacts considered             ${lpad(num(t.considered), 9)}`);
  L.push(`  press items                      ${lpad(num(t.press_items), 9)}`);
  L.push(`    ... also a record candidate    ${lpad(num(t.record_candidates), 9)}  (review-only; no record changes)`);
  L.push(`    ... with a jurisdiction name   ${lpad(num(t.with_jurisdiction_name), 9)}`);
  L.push(`    ... state only                 ${lpad(num(t.state_only), 9)}`);
  L.push(`  REFUSED (ledgered with a reason) ${lpad(num(t.skipped), 9)}`);
  L.push(`    ... of which ambiguous         ${lpad(num(r.ambiguous), 9)}`);
  L.push(`  DEFERRED (not ledgered)          ${lpad(num(t.deferred), 9)}  (no successful body fetch yet)`);
  if (r.mode === "apply") {
    L.push(`  duplicates absorbed              ${lpad(num(t.duplicates), 9)}  (idempotent on (url, state_abbr))`);
    L.push(`  Boundstone refusals/failures     ${lpad(num(t.failed), 9)}`);
    L.push(`  ledger rows written              ${lpad(num(t.ledger_rows_written), 9)}`);
    L.push(`  Boundstone RPC calls             ${lpad(num(t.boundstone_calls), 9)}  (<= ${BOUNDSTONE_RPS}/s)`);
  }
  L.push("");

  const states = Object.keys(r.by_state).sort(
    (a, b) => r.by_state[b].press - r.by_state[a].press || a.localeCompare(b),
  );
  L.push(`== by state (${states.length}) ==`);
  L.push(`  ${pad("st", 4)}${lpad("press", 8)}${lpad("cand", 8)}${lpad("named", 8)}`);
  for (const s of states) {
    const v = r.by_state[s];
    L.push(`  ${pad(s, 4)}${lpad(String(v.press), 8)}${lpad(String(v.candidates), 8)}${lpad(String(v.jurisdiction), 8)}`);
  }
  L.push("");

  const weeks = Object.keys(r.by_week).sort();
  L.push(`== by week (slice start, ${weeks.length}) ==`);
  L.push(`  ${pad("week", 12)}${lpad("seen", 8)}${lpad("press", 8)}${lpad("cand", 8)}${lpad("refused", 9)}${lpad("defer", 8)}`);
  for (const w of weeks) {
    const v = r.by_week[w];
    L.push(
      `  ${pad(w, 12)}${lpad(String(v.considered), 8)}${lpad(String(v.press), 8)}` +
        `${lpad(String(v.candidates), 8)}${lpad(String(v.declined), 9)}${lpad(String(v.deferred), 8)}`,
    );
  }
  L.push("");

  const reasons = Object.keys(r.by_reason).sort((a, b) => r.by_reason[b] - r.by_reason[a]);
  L.push("== why rows were refused or deferred ==");
  if (reasons.length === 0) L.push("  (none)");
  for (const k of reasons) {
    const note = DEFERRED_REASONS.includes(k) ? "  (deferred, NOT ledgered)" : "";
    L.push(`  ${pad(k, 26)}${lpad(String(r.by_reason[k]), 8)}${note}`);
  }
  return L.join("\n");
}

// ===========================================================================
// RETRIEVAL EVIDENCE
// ===========================================================================

export interface SelectorRow extends DueRow {
  body_fetch_status: string | null;
  body_fetched_at: string | null;
}

/**
 * The proof that somebody fetched the publisher URL, as FDY-90 recorded it.
 *
 * `body_fetch_status = 'ok'` is the only value that means a 2xx on the article
 * itself rather than on the aggregator token, and `body_fetched_at` is when.
 * Anything else yields a null status, which `decide()` turns into
 * `not_retrieved` — and this script defers rather than ledgers that. Never
 * now(): see the header.
 */
export function mapRetrieval(row: SelectorRow): { httpStatus: number | null; retrievedAt: string | null } {
  if (row.body_fetch_status === "ok" && typeof row.body_fetched_at === "string" && row.body_fetched_at !== "") {
    return { httpStatus: 200, retrievedAt: row.body_fetched_at };
  }
  return { httpStatus: null, retrievedAt: null };
}

/** Whether a refusal is deferred (left for the hourly lane) or ledgered. */
export function outcomeForRefusal(reason: string): Outcome {
  return DEFERRED_REASONS.includes(reason) ? "deferred" : "skipped";
}

// ===========================================================================
// IO — nothing below runs on import
// ===========================================================================

interface Env {
  faradayUrl: string;
  faradayKey: string;
}

function readEnv(): Env | ArgError {
  const faradayUrl = process.env.SUPABASE_URL ?? "";
  const faradayKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!faradayUrl || !faradayKey) {
    return { error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (Faraday, ycadmmngkdhvpcsrcuaq)." };
  }
  return { faradayUrl, faradayKey };
}

async function faradayFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.faradayUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.faradayKey,
      authorization: `Bearer ${env.faradayKey}`,
      "content-type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

async function faradayRpc(env: Env, fn: string, args: Record<string, unknown>): Promise<{
  data: unknown;
  error: { message: string; code?: string; status?: number } | null;
}> {
  const res = await faradayFetch(env, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    let message = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      code = j.code;
      message = j.message ?? message;
    } catch { /* a non-JSON body is its own message */ }
    return { data: null, error: { message, code, status: res.status } };
  }
  try {
    return { data: text === "" ? null : JSON.parse(text), error: null };
  } catch {
    return { data: null, error: { message: `unparseable reply from ${fn}`, status: res.status } };
  }
}

/**
 * The gazetteer, read in full and paged explicitly.
 *
 * ⚠️ IN FULL — 38,887 matchable rows of a 39,507-row table. S2 asks "does this
 * name exist in exactly ONE state NATIONALLY?", a question only the whole table
 * answers. A filtered slice would silently turn ambiguous names into confident
 * ones, which is the single worst failure available here: a press item on the
 * wrong state's page. PostgREST caps a reply at 1,000 rows, hence the paging.
 */
async function loadGazetteer(env: Env): Promise<Gazetteer> {
  const PAGE = 1000;
  const rows: { name: unknown; state_abbr: unknown; level: unknown }[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await faradayFetch(
      env,
      `jurisdictions?select=name,state_abbr,level&level=in.(county,cousub,place)&order=name.asc`,
      { headers: { range: `${from}-${from + PAGE - 1}` } },
    );
    if (!res.ok) throw new Error(`jurisdictions page ${from}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const sres = await faradayFetch(env, `jurisdictions?select=name,state_abbr&level=eq.state`);
  if (!sres.ok) throw new Error(`jurisdictions (states): ${sres.status}`);
  const states = (await sres.json()) as { name: unknown; state_abbr: unknown }[];

  const gaz = buildGazetteer(rows, states);
  // Refused rather than used: a short gazetteer makes every ambiguity test
  // wrong in the dangerous direction.
  if (gaz.byName.size < 10_000 || gaz.stateNames.size < 50) {
    throw new Error(
      `gazetteer is too small to be trusted: ${gaz.byName.size} names, ${gaz.stateNames.size} states. ` +
        "Refusing to attribute anything.",
    );
  }
  return gaz;
}

/**
 * The push JWT, from Faraday's Vault.
 *
 * ⚠️ NEVER PRINTED, NEVER LOGGED, NEVER PUT IN A REPORT OR A LEDGER ROW. The
 * only thing this script ever says about it is whether it is present. Myke
 * mints and stores it; nothing here creates or rotates one.
 */
async function pushJwt(env: Env): Promise<string | null> {
  try {
    const res = await faradayFetch(
      env,
      `decrypted_secrets?select=decrypted_secret&name=eq.${VAULT_SECRET_NAME}&limit=1`,
      { headers: { "accept-profile": "vault" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { decrypted_secret?: unknown }[];
    const s = rows?.[0]?.decrypted_secret;
    return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
  } catch {
    return null;
  }
}

/** A PostgREST RPC client for Boundstone, satisfying push-pure's RpcClientLike.
 *  NOTE WHAT IS ABSENT: no `from`. This object cannot express a table write
 *  against Boundstone, which is guardrail 4 as a type rather than a promise. */
function boundstoneClient(jwt: string): RpcClientLike {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      const res = await fetch(`${BOUNDSTONE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: jwt,
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args),
      });
      const text = await res.text();
      if (!res.ok) {
        let code: string | undefined;
        let message = text.slice(0, 400);
        try {
          const j = JSON.parse(text);
          code = j.code;
          message = j.message ?? message;
        } catch { /* non-JSON body */ }
        return { data: null, error: { message, code } };
      }
      try {
        return { data: text === "" ? null : JSON.parse(text), error: null };
      } catch {
        return { data: null, error: { message: `unparseable reply from ${fn}` } };
      }
    },
  };
}

/** The no-op probe. See classifyProbe() for why an empty payload is the right
 *  shape and why a raise is the healthy answer. */
async function probeBoundstone(jwt: string): Promise<ProbeClass> {
  try {
    const res = await fetch(`${BOUNDSTONE_URL}/rest/v1/rpc/${FN_PRESS_PROPOSE}`, {
      method: "POST",
      headers: { apikey: jwt, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ p: {} }),
    });
    const text = await res.text();
    let code: string | null = null;
    let message: string | null = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      code = j.code ?? null;
      message = j.message ?? message;
    } catch { /* non-JSON body */ }
    return classifyProbe({ status: res.status, code, message });
  } catch {
    return "unreachable";
  }
}

async function objectExists(env: Env, kind: "function" | "table", name: string): Promise<boolean> {
  // Asked the only way a REST client can ask: call it, or read it, and read the
  // error code. PGRST202 is "no such function"; 42P01 is "no such relation".
  if (kind === "function") {
    const { error } = await faradayRpc(env, name, {});
    if (!error) return true;
    return !(error.code === "PGRST202" || error.status === 404);
  }
  const res = await faradayFetch(env, `${name}?select=artifact_id&limit=1`);
  return res.ok;
}

const HELP = `boundstone-local-backfill — FDY-92

  node --experimental-strip-types scripts/boundstone-local-backfill.ts [flags]

  --dry-run            (default) read-only. Boundstone is not contacted at all.
  --apply              push. Also requires BOUNDSTONE_BACKFILL_CONFIRM=1.
  --since <date>       default ${WINDOW_START_ISO.slice(0, 10)}; earlier is clamped to it.
  --until <date>       default now.
  --limit <n>          maximum artifacts considered.
  --batch <n>          selector page size, 1..500 (default ${DEFAULT_BATCH}).
  --json               emit the report as JSON instead of text.

  env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (Faraday, ycadmmngkdhvpcsrcuaq)
`;

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const args = parseArgs(argv);
  if ("error" in args) {
    process.stderr.write(`${args.error}\n\n${HELP}`);
    return 2;
  }
  if (args.apply && process.env.BOUNDSTONE_BACKFILL_CONFIRM !== "1") {
    process.stderr.write(
      "--apply refused: set BOUNDSTONE_BACKFILL_CONFIRM=1 as well.\n" +
        "Two independent things, so neither a stray flag in shell history nor an exported\n" +
        "env var is enough on its own to write to Boundstone.\n",
    );
    return 2;
  }
  const env = readEnv();
  if ("error" in env) {
    process.stderr.write(`${env.error}\n`);
    return 2;
  }
  if (args.sinceClamped) {
    process.stderr.write(
      `note: --since was before ${WINDOW_START_ISO.slice(0, 10)} and was clamped to it. ` +
        "The floor is Myke's decision (Boundstone release v2026.07), not a default.\n",
    );
  }

  const measuredAt = new Date().toISOString();
  const report = newReport(args.apply ? "apply" : "dry-run", args.since, args.until, measuredAt);
  const slices = weeklySlices(args.since, args.until);
  report.slices = slices.length;
  seedWeeks(report, slices);

  // ── preflight ───────────────────────────────────────────────────────────
  const selectorExists = await objectExists(env, "function", SELECTOR_FN);
  const ledgerTableExists = await objectExists(env, "table", "boundstone_push_ledger");
  let jwt: string | null = null;
  let probe: ProbeClass | null = null;
  if (args.apply) {
    jwt = await pushJwt(env);
    if (jwt) probe = await probeBoundstone(jwt);
  }
  const pf = preflight({
    apply: args.apply,
    credential: jwt !== null,
    selectorExists,
    ledgerTableExists,
    probe,
  });
  if (!pf.ok) {
    // ⚠️ EXIT 0, NOT 1, AND LEDGER NOTHING. A one-off script that exits
    // non-zero because its dependencies are not yet applied teaches the
    // operator to ignore exit codes; and ledgering the backlog as
    // 'no_credential' would have to be deleted row by row before the lane
    // could ever run (FDY-91 made the same call for the same reason).
    process.stdout.write(
      `${report.mode}: refused before reading anything.\n  reason: ${pf.reason}\n  ${pf.detail}\n`,
    );
    return 0;
  }

  // ── corpus context ──────────────────────────────────────────────────────
  const { data: measure } = await faradayRpc(env, MEASURE_FN, {});
  if (measure && typeof measure === "object") {
    const m = measure as Record<string, number>;
    report.corpus.local_watch_artifacts = m.local_watch_artifacts ?? null;
    report.corpus.relevant_window = m.relevant_window ?? null;
    report.corpus.resolved_in_window = m.resolved_in_window ?? null;
    report.corpus.ledgered = m.ledgered ?? null;
    if (typeof m.relevant_window === "number" && typeof m.resolved_in_window === "number") {
      report.corpus.awaiting_publisher_url = m.relevant_window - m.resolved_in_window;
    }
  }

  const gaz = await loadGazetteer(env);
  const pacer = createPacer(BOUNDSTONE_RPS);
  const client = jwt ? boundstoneClient(jwt) : null;

  // ── the walk: weekly slices, oldest first, keyset-paged inside each ─────
  let considered = 0;
  outer: for (const slice of slices) {
    let afterPublished: string | null = null;
    let afterId: string | null = null;
    for (;;) {
      const want = args.limit === null ? args.batch : Math.min(args.batch, args.limit - considered);
      if (want <= 0) break outer;
      const { data, error } = await faradayRpc(env, SELECTOR_FN, {
        p_since: slice.start,
        p_until: slice.end,
        p_limit: want,
        p_after_published: afterPublished,
        p_after_id: afterId,
      });
      if (error) throw new Error(`${SELECTOR_FN}: ${error.message}`);
      const rows = (data ?? []) as SelectorRow[];
      if (rows.length === 0) break;

      for (const row of rows) {
        considered += 1;
        const { httpStatus, retrievedAt } = mapRetrieval(row);
        const decision = decide(row, gaz, { httpStatus, retrievedAt });
        const label = slice.start.slice(0, 10);

        if (!args.apply) {
          recordDecision(
            report,
            label,
            decision,
            decision.send ? "pushed" : outcomeForRefusal(decision.reason),
          );
          continue;
        }

        let result: PressResult | null = null;
        let outcome: Outcome;
        if (decision.send) {
          await pacer.take();
          report.totals.boundstone_calls += 1;
          result = await proposePress(client!, decision.payload);
          outcome = result.ok ? (result.status === "duplicate" ? "duplicate" : "pushed") : "failed";
        } else {
          outcome = outcomeForRefusal(decision.reason);
        }
        recordDecision(report, label, decision, outcome);

        // A deferral writes nothing: that is what makes it a deferral.
        if (outcome === "deferred") continue;

        const ledger = ledgerRow(row.artifact_id, decision, result);
        const { error: recErr } = await faradayRpc(env, LEDGER_FN, { p: ledger });
        // ⚠️ Not fatal and not retried. The artifact stays un-ledgered, so a
        // later run re-reads it and bs_press_propose absorbs the second push as
        // a duplicate on (url, state_abbr). Two independent idempotency keys is
        // what makes that safe.
        if (recErr) process.stderr.write(`ledger write failed for ${row.artifact_id}: ${recErr.message}\n`);
        else report.totals.ledger_rows_written += 1;
      }

      const last = rows[rows.length - 1];
      afterPublished = last.published_at;
      afterId = last.artifact_id;
      if (rows.length < want) break;
    }
  }

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report)}\n`);
  return 0;
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
