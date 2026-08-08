// Pure helpers for ingest-staleness-healthcheck — no Deno/network imports, so the
// Node test runner can strip-type-import this directly (repo convention: *-pure.ts).

export interface WatchResult {
  watch_key: string;
  label: string;
  check_mode: string;
  expected_cadence: string;
  threshold: string | null;
  last_event_at: string | null;
  age: string | null;
  breached: boolean;
  detail: string | null;
}

export function breachedOnly(rows: WatchResult[]): WatchResult[] {
  return rows.filter((r) => r.breached);
}

// Group breaches by the lane prefix of the watch key ("state_incentives:ny_esd_dei"
// → "state_incentives") so an email about 10 dead sources in one lane reads as one
// lane, not ten unrelated alarms. Largest lane first — that is the one to act on.
export function groupByLane(rows: WatchResult[]): Array<{ lane: string; items: WatchResult[] }> {
  const map = new Map<string, WatchResult[]>();
  for (const r of rows) {
    const lane = r.watch_key.includes(":") ? r.watch_key.split(":")[0] : r.watch_key;
    if (!map.has(lane)) map.set(lane, []);
    map.get(lane)!.push(r);
  }
  return Array.from(map, ([lane, items]) => ({ lane, items }))
    .sort((a, b) => b.items.length - a.items.length || a.lane.localeCompare(b.lane));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildSubject(breaches: WatchResult[]): string {
  const lanes = groupByLane(breaches).map((l) => l.lane).join(", ");
  return `🚨 Faraday ingest — ${breaches.length} stale/failing source${
    breaches.length === 1 ? "" : "s"} (${lanes})`;
}

export function buildAlertHtml(args: {
  breaches: WatchResult[];
  totalWatches: number;
  now: string;
}): string {
  const { breaches, totalWatches, now } = args;
  const laneHtml = groupByLane(breaches).map((l) => `
    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#6B6560;margin:22px 0 6px;">
      ${escapeHtml(l.lane)} · ${l.items.length} source${l.items.length === 1 ? "" : "s"}
    </h2>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      ${l.items.map((i) => `
        <tr>
          <td style="padding:4px 8px 4px 0;vertical-align:top;font-family:monospace;color:#141210;white-space:nowrap;">
            ${escapeHtml(i.watch_key)}
          </td>
          <td style="padding:4px 0;vertical-align:top;color:#5A4A2A;">
            <span style="display:inline-block;padding:0 6px;border-radius:3px;background:#FBEEE0;color:#8A5A00;font-size:10px;text-transform:uppercase;">
              ${escapeHtml(i.check_mode)}
            </span>
            ${escapeHtml(i.detail ?? "breached")}
          </td>
        </tr>`).join("")}
    </table>`).join("");

  return `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#F8F5F0;color:#141210;padding:32px;max-width:680px;margin:0 auto;">
  <div style="font-size:12px;color:#C4922A;letter-spacing:0.12em;text-transform:uppercase;">FARADAY INTELLIGENCE · INGEST STALENESS</div>
  <h1 style="font-size:22px;margin:8px 0 4px;">🚨 ${breaches.length} of ${totalWatches} watched sources are stale or failing</h1>
  <p style="font-size:12px;color:#6B6560;margin:0 0 8px;">Checked at ${escapeHtml(now)}</p>
  <div style="background:#FBEEE0;border-left:3px solid #C4922A;padding:12px 16px;margin:16px 0;border-radius:4px;">
    <p style="margin:0;color:#5A4A2A;">
      <strong>A green pg_cron history does not mean these ran.</strong> These jobs call
      <code>cron_http_post()</code>, which returns as soon as the request is queued —
      <code>cron.job_run_details</code> reads <em>succeeded</em> even when the function 401s,
      throws, or is killed mid-run.
    </p>
  </div>
  ${laneHtml}
  <p style="font-size:11px;color:#9B958E;margin-top:32px;">
    Automated by ingest-staleness-healthcheck · watches live in <code>ingest_staleness_watch</code> · ${escapeHtml(now)}
  </p>
</body></html>`;
}
