// poller-schedule.ts — fair due-selection for the source-poller (FDY-89).
// Deno-free (ext-pure pattern) so tests import it directly.
//
// WHY THIS MODULE EXISTS — the starvation it undoes
// ------------------------------------------------------------------
// Up to v1.8 the run lane selected rows like this:
//
//   prio = 320 stalest rows WHERE cadence IN ('hourly','daily','event_driven')
//   rest = 320 stalest rows (all cadences)
//   candidates = dedupe(prio ++ rest)        <-- prio ALWAYS first
//   sources    = candidates.filter(isDue).slice(0, limit)
//
// Two independent defects compound:
//
//   (1) `prio` is concatenated AHEAD of `rest` with no ceiling. The priority
//       cohort is 1,312 rows on a 20-hour due interval, i.e. ~1,566 due
//       events/day against 1,920 slots/day — so in almost every run at least
//       `limit` priority rows are already due and `rest` is never reached.
//       Measured live on 2026-10-07 by replaying this exact selection
//       read-only: all 80 slots went to daily segments (dc_operators 61,
//       hyperscalers 18, federal_gov 1) and ZERO to any weekly segment, while
//       895 local_gov rows were due and 873 were more than 2x overdue.
//
//   (2) isDue() only FILTERS; it never ORDERS. The ordering is absolute
//       `last_fetch_at ASC`, which is staleness in wall-clock seconds, not
//       staleness relative to the cadence that was promised. A daily row 21
//       hours old (1.05x its interval) therefore outranks a weekly row 38 days
//       old (5.9x its interval) — and inside the priority lane itself the 7
//       hourly rows at 10x overdue lost to 320 daily rows at 1.05x.
//
// The fix is to rank by OVERDUE RATIO — how many cadence-lengths late a row is
// — and to give named segments a per-run floor so no segment can ever be
// crowded out by an arithmetically larger cohort. Unused floor spills.
//
// This module is the reference implementation. `public.poller_select_due(int)`
// (migration 20261009210000) implements the identical spec in SQL and is the
// production path; this module is the fallback used when that migration has not
// been applied yet, and is what the deterministic simulation in
// test/source-poller-fair-sim.test.mjs drives.
// test/source-poller-schedule.test.mjs asserts the two cannot drift apart.

/** Cadence -> minimum interval between polls, in minutes, with slack so a run
 * that fires slightly early still picks the source up. Unknown cadences poll
 * daily. CANONICAL: poller-relevance.ts imports this, and
 * public.poller_cadence_interval() must mirror it exactly. */
export const CADENCE_MINUTES: Record<string, number> = {
  hourly: 50,
  daily: 20 * 60,
  weekly: 6.5 * 24 * 60, // 9360
  event_driven: 20 * 60,
  archival_refresh: 27 * 24 * 60,
  one_time: 365 * 24 * 60,
};

/** Fallback for a cadence we do not know — treat it as daily, never as "skip". */
export const DEFAULT_CADENCE = "daily";

/** Minimum share of each run's slots reserved for a segment, applied as a FLOOR
 * (never a cap) and only while that segment actually has due rows. Unused
 * reservation spills to the global overdue ranking.
 *
 * local_gov is the 1,000-row gsearch:loc-% watch of county/city governments —
 * the segment this module exists to un-starve. 25% of 80 = 20 slots/run =
 * 480/day against a steady-state demand of 1000/6.5d = 154/day, so the floor is
 * ~3x the segment's own need and most of it spills in steady state. */
export const SEGMENT_FLOORS: Record<string, number> = {
  local_gov: 0.25,
};

/** Rank assigned to a never-fetched row. The spec is "NULL (never fetched) =
 * most overdue", so this must dominate any real ratio; 1e9 cadence-lengths is
 * 18,000 years at the weekly cadence. A finite sentinel (rather than Infinity)
 * keeps the value storable in `numeric` on the SQL side. */
export const NEVER_FETCHED_RATIO = 1e9;

export interface DueRow {
  source_key: string;
  cadence: string;
  /** ISO timestamp, or null for a never-fetched source. */
  last_fetch_at: string | null;
  /** fetch_config.segment, normalised. Null/absent is its own bucket. */
  segment?: string | null;
  /** FIFO tie-break among never-fetched rows. Optional. */
  created_at?: string | null;
}

export function cadenceMinutes(cadence: string | null | undefined): number {
  return CADENCE_MINUTES[cadence ?? ""] ?? CADENCE_MINUTES[DEFAULT_CADENCE];
}

/** Normalise a segment for bucketing. Mirrors
 * coalesce(fetch_config->>'segment','(none)') in SQL. */
export function segmentOf(row: DueRow): string {
  const s = row.segment;
  return s === null || s === undefined || s === "" ? "(none)" : s;
}

/** due_at = last_fetch_at + interval(cadence), in epoch ms. Null when the
 * source has never been fetched (it is due now and then some). */
export function dueAtMs(cadence: string, lastFetchAt: string | null): number | null {
  if (!lastFetchAt) return null;
  const t = Date.parse(lastFetchAt);
  if (Number.isNaN(t)) return null; // unparseable == treat as never fetched
  return t + cadenceMinutes(cadence) * 60_000;
}

/** (now - due_at) / interval(cadence): how many cadence-lengths late this row
 * is. 0 means due exactly now, negative means not yet due, NEVER_FETCHED_RATIO
 * means never fetched. */
export function overdueRatio(cadence: string, lastFetchAt: string | null, nowMs: number): number {
  const due = dueAtMs(cadence, lastFetchAt);
  if (due === null) return NEVER_FETCHED_RATIO;
  return (nowMs - due) / (cadenceMinutes(cadence) * 60_000);
}

export function isDueRow(row: DueRow, nowMs: number): boolean {
  return overdueRatio(row.cadence, row.last_fetch_at, nowMs) >= 0;
}

/** A row decorated with its sort keys, computed once per selection pass. The
 * simulation runs this 336 times over 10,400 rows, so re-deriving the ratio
 * inside the comparator (O(n log n) Date.parse calls) is not affordable. */
interface Decorated {
  row: DueRow;
  ratio: number;
  created: number;
  segment: string;
}

/** Deterministic total order: most overdue first, then FIFO by created_at, then
 * source_key. Identical to the ORDER BY in public.poller_select_due. */
function compareDecorated(a: Decorated, b: Decorated): number {
  if (a.ratio !== b.ratio) return b.ratio - a.ratio;
  if (a.created !== b.created) return a.created - b.created;
  return a.row.source_key < b.row.source_key
    ? -1
    : a.row.source_key > b.row.source_key
    ? 1
    : 0;
}

export interface SelectOptions {
  limit: number;
  nowMs: number;
  /** Segment -> minimum share of the run's slots. Defaults to SEGMENT_FLOORS. */
  floors?: Record<string, number>;
}

export interface SelectResult {
  /** The chosen rows, most-overdue first. Length <= limit. */
  picked: DueRow[];
  /** source_key -> 'floor:<segment>' | 'overdue_rank'. Which lane won the slot. */
  lanes: Record<string, string>;
  /** segment -> slots reserved by the floor and actually filled. */
  floorFilled: Record<string, number>;
  /** How many rows were due at nowMs (before the limit was applied). */
  dueTotal: number;
}

/**
 * Fair due-selection.
 *
 * 1. Keep only rows that are due (overdue_ratio >= 0; never-fetched always is).
 * 2. For each floor segment, take ceil(limit * share) of ITS most-overdue rows,
 *    or all of them if it has fewer. That is a floor, not a cap.
 * 3. Fill the remaining slots from the global most-overdue ranking, skipping
 *    rows already taken. Unused floor therefore spills automatically, and a
 *    floor segment can also win ordinary slots on merit.
 *
 * Deterministic for a fixed (rows, limit, nowMs).
 */
export function selectDueFair(rows: DueRow[], opts: SelectOptions): SelectResult {
  const { nowMs } = opts;
  const limit = Math.max(0, Math.floor(opts.limit));
  const floors = opts.floors ?? SEGMENT_FLOORS;

  const due: Decorated[] = [];
  for (const row of rows) {
    const ratio = overdueRatio(row.cadence, row.last_fetch_at, nowMs);
    if (ratio < 0) continue; // not due yet
    due.push({
      row,
      ratio,
      created: row.created_at ? Date.parse(row.created_at) : -Infinity,
      segment: segmentOf(row),
    });
  }
  due.sort(compareDecorated);
  const lanes: Record<string, string> = {};
  const floorFilled: Record<string, number> = {};
  const taken = new Set<string>();
  const chosen: Decorated[] = [];

  // Floor lanes first, in a stable order so the result never depends on key
  // enumeration order.
  for (const segment of Object.keys(floors).sort()) {
    const share = floors[segment];
    if (!(share > 0)) continue;
    const want = Math.min(Math.ceil(limit * share), limit - chosen.length);
    if (want <= 0) continue;
    let got = 0;
    for (const d of due) {
      if (got >= want) break;
      if (d.segment !== segment) continue;
      if (taken.has(d.row.source_key)) continue;
      taken.add(d.row.source_key);
      lanes[d.row.source_key] = `floor:${segment}`;
      chosen.push(d);
      got++;
    }
    floorFilled[segment] = got;
  }

  // Remaining slots: global overdue ranking.
  for (const d of due) {
    if (chosen.length >= limit) break;
    if (taken.has(d.row.source_key)) continue;
    taken.add(d.row.source_key);
    lanes[d.row.source_key] = "overdue_rank";
    chosen.push(d);
  }

  chosen.sort(compareDecorated);
  return { picked: chosen.map((d) => d.row), lanes, floorFilled, dueTotal: due.length };
}

// ---------- politeness ----------

/** At most one request per second per host. news.google.com is ONE host, which
 * is the whole gsearch query lane (9,000+ rows), so this gate is what keeps the
 * fairer selection from turning into a burst against a single upstream that
 * already answers 429 under load (see the v1.7/v1.8 transient-guard notes). */
export const MIN_HOST_GAP_MS = 1000;

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/** How long to wait before requesting `host` again, given the epoch-ms of the
 * last request to each host. Pure so it can be tested without timers. */
export function hostDelayMs(
  lastByHost: Map<string, number>,
  host: string,
  nowMs: number,
  minGapMs = MIN_HOST_GAP_MS,
): number {
  const last = lastByHost.get(host);
  if (last === undefined) return 0;
  const wait = last + minGapMs - nowMs;
  return wait > 0 ? wait : 0;
}
