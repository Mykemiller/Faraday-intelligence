// Faraday — Daily Todo Digest (AUTO-050)
// Supabase Edge Function — POST /functions/v1/faraday-todo-daily
//
// Pulls Jira + GitHub state, snapshots to register_daily_snapshot, diffs vs
// yesterday, and emails "Myke's Faraday todo list" at 05:00 CT.
//
// Schedule: pg_cron fires at 10:00 UTC and 11:00 UTC; the function proceeds
// only when it's 05:xx America/Chicago so 5am CT holds across CDT/CST.
// Idempotent: exactly one email per CT calendar-day (register_daily_snapshot
// unique on snapshot_date; email_sent=true short-circuits re-runs).
// On failure: sends a short "digest failed" notice + logs a health-log row.
// Read-only against Jira + GitHub — no writes/transitions from this job.
//
// CC-FAR-OPS-RESTORE-1.0 (2026-07-24): FROM_EMAIL repointed off the apex
// faraday-intelligence.ai (Google Workspace corporate mail; lost Resend
// verification 2026-07-23) onto the verified transactional subdomain
// send.faraday-intelligence.ai.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ───────────────────────────────────────────────────────────────────
const AUTO_ID = "AUTO-050";
const CRAWLER_ID = "faraday-todo-daily_v1.0";
const TO_EMAIL = "mykemiller@gmail.com";
const FROM_EMAIL = "challenge@send.faraday-intelligence.ai";
const JIRA_CLOUD_ID = "2cdbb127-783f-4329-bec5-26223393fcfe";
const JIRA_BASE = `https://api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}/rest/api/3`;
const GITHUB_ORG = "mykemiller";
const GITHUB_REPOS = [
  "v0-faraday-daily-challenge",
  "Faraday-intelligence",
  "Faraday-Signal-Room",
  "faraday-jurisdiction-watch",
  "Faraday-Briefing-Library-",
  "Faraday",
];
const CT_ZONE = "America/Chicago";
const JIRA_ISSUE_URL = "https://mykemiller.atlassian.net/browse";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  band: "P1" | "P2" | "P3" | "P4";
  assignee: string | null;
  labels: string[];
  blockedBy: string[];
  ccBundle: string[];
}

export interface JiraTransition {
  key: string;
  summary: string;
  fromStatus: string;
  toStatus: string;
  timestamp: string;
}

export interface GithubCommit {
  repo: string;
  sha: string;
  message: string;
  author: string;
  url: string;
  timestamp: string;
}

export interface GithubPR {
  repo: string;
  number: number;
  title: string;
  state: "open" | "merged";
  url: string;
  updatedAt: string;
}

export interface EngineHealth {
  artifactsLast24h: number;
  staleAutoIds: string[];
  healthLogCount: number;
}

export interface DigestData {
  date: string;
  p1Issues: JiraIssue[];
  allOpenIssues: JiraIssue[];
  transitions: JiraTransition[];
  openPRs: GithubPR[];
  mergedPRs: GithubPR[];
  notableCommits: GithubCommit[];
  blockedIssues: JiraIssue[];
  engineHealth: EngineHealth;
  counts: Record<string, number>;
  errors: string[];
}

// ─── Utilities (exported for tests) ──────────────────────────────────────────

export function ctDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CT_ZONE }).format(date);
}

export function ctHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CT_ZONE,
      hour: "numeric",
      hour12: false,
    }).format(date),
  );
}

export function isCtHour5(date: Date): boolean {
  return ctHour(date) === 5;
}

export function jiraBasicAuth(email: string, token: string): string {
  const str = `${email}:${token}`;
  // btoa only handles Latin1; encode to UTF-8 bytes first
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return "Basic " + btoa(binary);
}

export function priorityBand(jiraPriority: string, labels: string[]): "P1" | "P2" | "P3" | "P4" {
  const p = jiraPriority.toLowerCase();
  const l = labels.map((x) => x.toLowerCase());
  if (p === "highest" || p === "critical" || l.includes("p1")) return "P1";
  if (p === "high" || l.includes("p2")) return "P2";
  if (p === "medium" || l.includes("p3")) return "P3";
  return "P4";
}

export function isBlockedIssue(status: string, labels: string[]): boolean {
  const s = status.toLowerCase();
  const l = labels.map((x) => x.toLowerCase());
  return (
    s === "blocked" ||
    s.includes("blocked") ||
    l.includes("blocked") ||
    l.includes("needs-myke") ||
    l.includes("decision-needed") ||
    l.includes("governance")
  );
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Jira ─────────────────────────────────────────────────────────────────────

function parseJiraIssue(i: Record<string, unknown>): JiraIssue {
  const f = (i.fields ?? {}) as Record<string, unknown>;
  const labels = Array.isArray(f.labels) ? f.labels.map(String) : [];
  const priority = ((f.priority as Record<string, unknown>)?.name as string) ?? "Medium";
  const statusName = ((f.status as Record<string, unknown>)?.name as string) ?? "Unknown";
  const assignee =
    ((f.assignee as Record<string, unknown>)?.displayName as string) ?? null;

  const blockedBy: string[] = [];
  const ccBundle: string[] = [];
  const issueLinks = Array.isArray(f.issuelinks)
    ? (f.issuelinks as Record<string, unknown>[])
    : [];

  for (const link of issueLinks) {
    const type = ((link.type as Record<string, unknown>)?.inward as string) ?? "";
    const inwardIssue = link.inwardIssue as Record<string, unknown> | undefined;
    const outwardIssue = link.outwardIssue as Record<string, unknown> | undefined;

    if (type.toLowerCase().includes("blocked") && inwardIssue?.key) {
      blockedBy.push(String(inwardIssue.key));
    }
    for (const issueRef of [inwardIssue, outwardIssue]) {
      const k = issueRef?.key ? String(issueRef.key) : null;
      if (k?.startsWith("CC-")) ccBundle.push(k);
    }
  }

  return {
    key: String(i.key),
    summary: String(f.summary ?? "").slice(0, 200),
    status: statusName,
    priority,
    band: priorityBand(priority, labels),
    assignee,
    labels,
    blockedBy,
    ccBundle: [...new Set(ccBundle)],
  };
}

function extractTransitions(issues: unknown[]): JiraTransition[] {
  const result: JiraTransition[] = [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const rawIssue of issues) {
    const issue = rawIssue as Record<string, unknown>;
    const key = String(issue.key);
    const summary = String(
      ((issue.fields as Record<string, unknown>)?.summary as string) ?? "",
    ).slice(0, 120);
    const changelog = ((issue.changelog as Record<string, unknown>)?.histories as unknown[]) ?? [];

    for (const rawHistory of changelog) {
      const h = rawHistory as Record<string, unknown>;
      const created = new Date(String(h.created)).getTime();
      if (created < cutoff) continue;

      const items = (h.items as Array<Record<string, unknown>>) ?? [];
      for (const item of items) {
        if (item.field === "status") {
          result.push({
            key,
            summary,
            fromStatus: String(item.fromString ?? ""),
            toStatus: String(item.toString ?? ""),
            timestamp: String(h.created),
          });
        }
      }
    }
  }
  return result;
}

async function fetchJiraIssues(
  auth: string,
): Promise<{ open: JiraIssue[]; transitions: JiraTransition[] }> {
  const headers = {
    Authorization: auth,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const [openRes, transRes] = await Promise.allSettled([
    fetch(`${JIRA_BASE}/search/jql`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jql: "project=FAR AND statusCategory != Done ORDER BY priority ASC, updated DESC",
        maxResults: 100,
        fields: ["summary", "status", "priority", "assignee", "labels", "issuelinks", "issuetype"],
      }),
    }),
    fetch(`${JIRA_BASE}/search/jql`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jql: "project=FAR AND updated >= -24h ORDER BY updated DESC",
        maxResults: 50,
        expand: ["changelog"],
        fields: ["summary", "status", "priority"],
      }),
    }),
  ]);

  let open: JiraIssue[] = [];
  if (openRes.status === "fulfilled" && openRes.value.ok) {
    const data = await openRes.value.json();
    open = (data.issues ?? []).map((i: unknown) =>
      parseJiraIssue(i as Record<string, unknown>),
    );
  } else if (openRes.status === "fulfilled") {
    const txt = await openRes.value.text();
    throw new Error(`Jira open issues HTTP ${openRes.value.status}: ${txt.slice(0, 300)}`);
  } else {
    throw new Error(`Jira open issues network error: ${openRes.reason}`);
  }

  let transitions: JiraTransition[] = [];
  if (transRes.status === "fulfilled" && transRes.value.ok) {
    const data = await transRes.value.json();
    transitions = extractTransitions(data.issues ?? []);
  } else if (transRes.status === "fulfilled") {
    const txt = await transRes.value.text();
    console.error("Jira transitions HTTP error:", transRes.value.status, txt.slice(0, 200));
  } else {
    console.error("Jira transitions network error:", transRes.reason);
  }

  return { open, transitions };
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

async function fetchGithubActivity(
  pat: string,
): Promise<{ commits: GithubCommit[]; openPRs: GithubPR[]; mergedPRs: GithubPR[] }> {
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const allCommits: GithubCommit[] = [];
  const allOpenPRs: GithubPR[] = [];
  const allMergedPRs: GithubPR[] = [];

  await Promise.allSettled(
    GITHUB_REPOS.map(async (repo) => {
      const [commitRes, openRes, closedRes] = await Promise.allSettled([
        fetch(
          `https://api.github.com/repos/${GITHUB_ORG}/${repo}/commits?since=${since}&per_page=30`,
          { headers },
        ),
        fetch(
          `https://api.github.com/repos/${GITHUB_ORG}/${repo}/pulls?state=open&per_page=20`,
          { headers },
        ),
        fetch(
          `https://api.github.com/repos/${GITHUB_ORG}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`,
          { headers },
        ),
      ]);

      if (commitRes.status === "fulfilled" && commitRes.value.ok) {
        const data = (await commitRes.value.json()) as Array<Record<string, unknown>>;
        for (const c of data) {
          const commit = c.commit as Record<string, unknown>;
          const authorObj = commit.author as Record<string, unknown>;
          allCommits.push({
            repo,
            sha: String(c.sha ?? "").slice(0, 8),
            message: String((commit.message as string ?? "").split("\n")[0]).slice(0, 120),
            author: String(authorObj?.name ?? "unknown"),
            url: String(c.html_url ?? ""),
            timestamp: String(authorObj?.date ?? ""),
          });
        }
      }

      if (openRes.status === "fulfilled" && openRes.value.ok) {
        const data = (await openRes.value.json()) as Array<Record<string, unknown>>;
        for (const pr of data) {
          allOpenPRs.push({
            repo,
            number: Number(pr.number),
            title: String(pr.title ?? "").slice(0, 120),
            state: "open",
            url: String(pr.html_url ?? ""),
            updatedAt: String(pr.updated_at ?? ""),
          });
          }
      }

      if (closedRes.status === "fulfilled" && closedRes.value.ok) {
        const data = (await closedRes.value.json()) as Array<Record<string, unknown>>;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const pr of data) {
          const mergedAt = pr.merged_at as string | null;
          if (!mergedAt || new Date(mergedAt).getTime() < cutoff) continue;
          allMergedPRs.push({
            repo,
            number: Number(pr.number),
            title: String(pr.title ?? "").slice(0, 120),
            state: "merged",
            url: String(pr.html_url ?? ""),
            updatedAt: mergedAt,
          });
        }
      }
    }),
  );

  const notableCommits = allCommits
    .filter(
      (c) =>
        !c.message.startsWith("Merge ") &&
        !c.message.startsWith("chore(deps)") &&
        !c.author.toLowerCase().includes("[bot]"),
    )
    .slice(0, 15);

  return { commits: notableCommits, openPRs: allOpenPRs, mergedPRs: allMergedPRs };
}

// ─── Engine Health ─────────────────────────────────────────────────────────────

async function fetchEngineHealth(sb: SupabaseClient): Promise<EngineHealth> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [artifactsRes, healthRes] = await Promise.all([
    sb
      .from("artifacts")
      .select("artifact_id", { count: "exact", head: true })
      .gte("discovered_at", since),
    sb
      .from("automation_health_log")
      .select("auto_id,run_completed_at")
      .gte("run_completed_at", since)
      .order("run_completed_at", { ascending: false }),
  ]);

  const artifactsLast24h = artifactsRes.count ?? 0;
  const healthLogs = (healthRes.data ?? []) as Array<{ auto_id: string; run_completed_at: string }>;

  const latestByAuto: Record<string, number> = {};
  for (const row of healthLogs) {
    const ts = new Date(row.run_completed_at).getTime();
    if (!latestByAuto[row.auto_id] || ts > latestByAuto[row.auto_id]) {
      latestByAuto[row.auto_id] = ts;
    }
  }
  const staleThreshold = Date.now() - 25 * 60 * 60 * 1000;
  const staleAutoIds = Object.entries(latestByAuto)
    .filter(([, ts]) => ts < staleThreshold)
    .map(([id]) => id);

  return {
    artifactsLast24h,
    staleAutoIds,
    healthLogCount: healthLogs.length,
  };
}

// ─── Email HTML ───────────────────────────────────────────────────────────────

export function buildEmailHtml(data: DigestData): string {
  const {
    date, p1Issues, allOpenIssues, transitions,
    openPRs, mergedPRs, notableCommits,
    blockedIssues, engineHealth, counts, errors,
  } = data;

  const issueRow = (issue: JiraIssue) => {
    const blockedStr = issue.blockedBy.length
      ? ` · blocked-by: ${issue.blockedBy.join(", ")}`
      : "";
    const ccStr = issue.ccBundle.length ? ` · CC: ${issue.ccBundle.join(", ")}` : "";
    return `<li style="margin:6px 0;line-height:1.5;"><a href="${JIRA_ISSUE_URL}/${issue.key}" style="color:#C4922A;text-decoration:none;font-weight:600;">[${issue.key}]</a> ${esc(issue.summary)} <span style="color:#9A938C;font-size:12px;">— ${esc(issue.status)}${blockedStr}${ccStr}</span></li>`;
  };

  const transRows = transitions
    .map(
      (t) =>
        `<li style="margin:4px 0;"><a href="${JIRA_ISSUE_URL}/${t.key}" style="color:#C4922A;text-decoration:none;">[${t.key}]</a> ${esc(t.summary)} <span style="color:#9A938C;font-size:12px;">${esc(t.fromStatus)} → <strong>${esc(t.toStatus)}</strong></span></li>`,
    )
    .join("\n");

  const mergedRows = mergedPRs
    .map(
      (pr) =>
        `<li style="margin:4px 0;">Merged <a href="${esc(pr.url)}" style="color:#C4922A;text-decoration:none;">${esc(pr.repo)} #${pr.number}</a>: ${esc(pr.title)}</li>`,
    )
    .join("\n");

  const commitRows = notableCommits
    .slice(0, 8)
    .map(
      (c) =>
        `<li style="margin:3px 0;font-size:12px;color:#9A938C;"><code style="color:#C4922A;">${c.sha}</code> [${esc(c.repo)}] ${esc(c.message)}</li>`,
    )
    .join("\n");

  const openPRRows = openPRs
    .map(
      (pr) =>
        `<li style="margin:4px 0;"><a href="${esc(pr.url)}" style="color:#C4922A;text-decoration:none;">${esc(pr.repo)} #${pr.number}</a>: ${esc(pr.title)}</li>`,
    )
    .join("\n");

  const blockedRows = blockedIssues
    .map((issue) => {
      const blockedStr = issue.blockedBy.length
        ? ` — blocked-by: ${issue.blockedBy.join(", ")}`
        : "";
      const govLabels = issue.labels.filter((l) =>
        ["needs-myke", "decision-needed", "governance", "blocked"].includes(l.toLowerCase()),
      );
      const labelStr = govLabels.length ? ` [${govLabels.join(", ")}]` : "";
      return `<li style="margin:6px 0;"><a href="${JIRA_ISSUE_URL}/${issue.key}" style="color:#C4922A;text-decoration:none;">[${issue.key}]</a> ${esc(issue.summary)}<span style="color:#9A938C;font-size:12px;">${blockedStr}${labelStr}</span></li>`;
    })
    .join("\n");

  const staleHtml = engineHealth.staleAutoIds.length
    ? `<p style="color:#C4922A;margin:4px 0;font-size:13px;">⚠ Stale automations (no run in 25h+): ${engineHealth.staleAutoIds.join(", ")}</p>`
    : `<p style="color:#9A938C;margin:4px 0;font-size:13px;">All tracked automations current.</p>`;

  const countBadges = ["P1", "P2", "P3", "P4"]
    .map((band) => {
      const n = counts[band] ?? 0;
      const color = band === "P1" ? "#C4922A" : "#9A938C";
      return `<span style="margin-right:16px;color:${color};font-weight:600;">${band}: ${n}</span>`;
    })
    .join("");

  const errorBanner =
    errors.length > 0
      ? `<div style="background:#1a0f00;border-left:3px solid #C4922A;padding:10px 14px;margin-bottom:24px;border-radius:4px;font-size:12px;color:#C4922A;">⚠ Partial data — ${errors.length} source(s) unavailable: ${errors.map(esc).join("; ")}</div>`
      : "";

  const section = (title: string, body: string) =>
    `<div style="margin-bottom:32px;"><h2 style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#C4922A;margin:0 0 12px;border-bottom:1px solid #2A2520;padding-bottom:6px;">${title}</h2>${body}</div>`;

  return `<!DOCTYPE html><html><body style="font-family:'IBM Plex Serif',Georgia,serif;background:#0D110E;color:#E8E4DE;padding:40px;max-width:700px;margin:0 auto;">
  <div style="border-bottom:1px solid #2A2520;padding-bottom:20px;margin-bottom:28px;">
    <div style="font-size:11px;color:#C4922A;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">FARADAY INTELLIGENCE</div>
    <h1 style="font-size:24px;font-weight:700;color:#F8F5F0;margin:0;">Myke's Faraday Todo List</h1>
    <div style="font-size:12px;color:#9A938C;margin-top:6px;">${date} · ${counts.P1 ?? 0} P1s open · ${allOpenIssues.length} total open</div>
  </div>
  ${errorBanner}

  ${section(
    "1 · P1 Today",
    p1Issues.length
      ? `<ul style="list-style:none;padding:0;margin:0;">${p1Issues.map(issueRow).join("\n")}</ul>`
      : `<p style="color:#9A938C;margin:0;font-style:italic;">No open P1 issues — 🟢</p>`,
  )}

  ${section(
    "2 · Moved Since Yesterday",
    [
      transitions.length
        ? `<p style="color:#9A938C;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.08em;">Jira transitions</p><ul style="list-style:none;padding:0;margin:0 0 14px;">${transRows}</ul>`
        : `<p style="color:#9A938C;margin:0 0 10px;font-size:13px;">No Jira transitions in last 24h.</p>`,
      mergedPRs.length
        ? `<p style="color:#9A938C;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.08em;">Merged PRs</p><ul style="list-style:none;padding:0;margin:0 0 14px;">${mergedRows}</ul>`
        : "",
      notableCommits.length
        ? `<p style="color:#9A938C;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.08em;">Notable commits</p><ul style="list-style:none;padding:0;margin:0;">${commitRows}</ul>`
        : "",
    ].join(""),
  )}

  ${section(
    "3 · Blocked / Needs Myke",
    blockedIssues.length
      ? `<ul style="list-style:none;padding:0;margin:0;">${blockedRows}</ul>`
      : `<p style="color:#9A938C;margin:0;font-style:italic;">No blocked or decision-pending items.</p>`,
  )}

  ${section(
    "4 · Open PRs",
    openPRs.length
      ? `<ul style="list-style:none;padding:0;margin:0;">${openPRRows}</ul>`
      : `<p style="color:#9A938C;margin:0;font-style:italic;">No open PRs.</p>`,
  )}

  ${section(
    "5 · Engine Freshness Watch",
    `<p style="margin:0 0 6px;font-size:13px;">Artifacts ingested in last 24h: <strong>${engineHealth.artifactsLast24h}</strong> · Health-log events: <strong>${engineHealth.healthLogCount}</strong></p>${staleHtml}`,
  )}

  ${section(
    "6 · Counts",
    `<div style="margin:0;">${countBadges}<span style="color:#9A938C;font-size:13px;">total open: ${allOpenIssues.length}</span></div>`,
  )}

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #2A2520;font-size:11px;color:#6B6560;">
    AUTO-050 · faraday-todo-daily_v1.0 · ${new Date().toUTCString()}
  </div>
</body></html>`;
}

export function buildFailureEmailHtml(error: string, date: string): string {
  return `<!DOCTYPE html><html><body style="font-family:'IBM Plex Serif',Georgia,serif;background:#0D110E;color:#E8E4DE;padding:40px;max-width:560px;margin:0 auto;">
  <div style="font-size:11px;color:#C4922A;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:16px;">FARADAY INTELLIGENCE</div>
  <h1 style="font-size:20px;color:#F8F5F0;margin:0 0 12px;">⚠ Daily Digest Failed — ${esc(date)}</h1>
  <p style="color:#9A938C;margin:0 0 16px;">faraday-todo-daily encountered an error and could not produce the full digest.</p>
  <pre style="background:#141210;padding:16px;border-radius:6px;color:#C4922A;font-size:12px;overflow:auto;white-space:pre-wrap;">${esc(error.slice(0, 1200))}</pre>
  <p style="font-size:11px;color:#6B6560;margin-top:32px;">AUTO-050 · faraday-todo-daily_v1.0</p>
</body></html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const runStarted = new Date().toISOString();

  // Auth — accept shared cron token (CRON_SECRET env var) or service role key
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if ((cronSecret && bearer !== cronSecret) && bearer !== serviceKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const now = new Date();
  const today = ctDateString(now);

  // DST-aware guard: proceed only in the 05:xx hour America/Chicago
  if (!force && !isCtHour5(now)) {
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: `not 05:xx CT (CT hour: ${ctHour(now)})`,
        ct_date: today,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // Idempotency: exactly one email per CT calendar-day
  const { data: existing } = await sb
    .from("register_daily_snapshot")
    .select("id,email_sent")
    .eq("snapshot_date", today)
    .maybeSingle();

  if (existing?.email_sent) {
    return new Response(
      JSON.stringify({ skipped: true, reason: `email already sent for ${today}` }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const jiraToken = Deno.env.get("JIRA_API_TOKEN");
  const jiraEmail = Deno.env.get("JIRA_USER_EMAIL") ?? "mykemiller@gmail.com";
  const githubPat = Deno.env.get("GITHUB_READ_PAT");

  const errors: string[] = [];

  // Fetch yesterday's snapshot for status diffing
  const yesterday = ctDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const { data: yesterdaySnap } = await sb
    .from("register_daily_snapshot")
    .select("jira_open")
    .eq("snapshot_date", yesterday)
    .maybeSingle();

  // ── Jira ──────────────────────────────────────────────────────────────────
  let openIssues: JiraIssue[] = [];
  let transitions: JiraTransition[] = [];

  if (jiraToken) {
    try {
      const jira = await fetchJiraIssues(jiraBasicAuth(jiraEmail, jiraToken));
      openIssues = jira.open;
      transitions = jira.transitions;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Jira: ${msg.slice(0, 200)}`);
      console.error("Jira fetch failed:", msg);
    }
  } else {
    errors.push("JIRA_API_TOKEN not set");
  }

  // Augment transitions from yesterday's snapshot diff
  if (yesterdaySnap?.jira_open) {
    const prevStatuses: Record<string, string> = {};
    for (const i of yesterdaySnap.jira_open as JiraIssue[]) {
      prevStatuses[i.key] = i.status;
    }
    const transitionKeys = new Set(transitions.map((t) => t.key));
    for (const issue of openIssues) {
      const prev = prevStatuses[issue.key];
      if (prev && prev !== issue.status && !transitionKeys.has(issue.key)) {
        transitions.push({
          key: issue.key,
          summary: issue.summary,
          fromStatus: prev,
          toStatus: issue.status,
          timestamp: runStarted,
        });
        transitionKeys.add(issue.key);
      }
    }
  }

  // ── GitHub ────────────────────────────────────────────────────────────────
  let ghCommits: GithubCommit[] = [];
  let ghOpenPRs: GithubPR[] = [];
  let ghMergedPRs: GithubPR[] = [];

  if (githubPat) {
    try {
      const gh = await fetchGithubActivity(githubPat);
      ghCommits = gh.commits;
      ghOpenPRs = gh.openPRs;
      ghMergedPRs = gh.mergedPRs;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`GitHub: ${msg.slice(0, 200)}`);
      console.error("GitHub fetch failed:", msg);
    }
  } else {
    errors.push("GITHUB_READ_PAT not set");
  }

  // ── Engine health ─────────────────────────────────────────────────────────
  let engineHealth: EngineHealth = { artifactsLast24h: 0, staleAutoIds: [], healthLogCount: 0 };
  try {
    engineHealth = await fetchEngineHealth(sb);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Engine health: ${msg.slice(0, 200)}`);
    console.error("Engine health fetch failed:", msg);
  }

  // ── Build digest ──────────────────────────────────────────────────────────
  const counts: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const issue of openIssues) counts[issue.band] = (counts[issue.band] ?? 0) + 1;

  const p1Issues = openIssues.filter((i) => i.band === "P1");
  const blockedIssues = openIssues.filter((i) => isBlockedIssue(i.status, i.labels));

  const digestData: DigestData = {
    date: today,
    p1Issues,
    allOpenIssues: openIssues,
    transitions,
    openPRs: ghOpenPRs,
    mergedPRs: ghMergedPRs,
    notableCommits: ghCommits,
    blockedIssues,
    engineHealth,
    counts,
    errors,
  };

  // ── Write snapshot (upsert — idempotent on snapshot_date) ─────────────────
  const { error: snapErr } = await sb.from("register_daily_snapshot").upsert(
    {
      snapshot_date: today,
      jira_open: openIssues,
      jira_transitions: transitions,
      github_commits: ghCommits,
      github_prs: [...ghOpenPRs, ...ghMergedPRs],
      run_started_at: runStarted,
    },
    { onConflict: "snapshot_date" },
  );
  if (snapErr) console.error("Snapshot upsert failed:", snapErr.message);

  // ── Send email ────────────────────────────────────────────────────────────
  let emailOk = false;
  let emailError: string | undefined;

  if (!resendKey) {
    emailError = "RESEND_API_KEY not set";
    errors.push(emailError);
  } else {
    const totalDataPoints = openIssues.length + ghCommits.length + ghOpenPRs.length;
    const isHardFailure = errors.length > 0 && totalDataPoints === 0;

    const html = isHardFailure
      ? buildFailureEmailHtml(errors.join("\n"), today)
      : buildEmailHtml(digestData);

    const subject = isHardFailure
      ? `⚠ Faraday Todo Digest Failed — ${today}`
      : `Faraday Todo · ${today} · ${counts.P1 ?? 0} P1s open`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Faraday Intelligence <${FROM_EMAIL}>`,
          to: TO_EMAIL,
          subject,
          html,
        }),
      });

      if (res.ok) {
        emailOk = true;
      } else {
        const body = await res.text();
        emailError = `Resend ${res.status}: ${body.slice(0, 300)}`;
        errors.push(emailError);
        console.error("Resend failed:", emailError);
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      errors.push(`Resend: ${emailError}`);
      console.error("Resend threw:", emailError);
    }
  }

  // ── Update snapshot with email status ─────────────────────────────────────
  await sb
    .from("register_daily_snapshot")
    .update({
      email_sent: emailOk,
      email_sent_at: emailOk ? new Date().toISOString() : null,
      email_error: emailError ?? null,
    })
    .eq("snapshot_date", today);

  // ── Health log ────────────────────────────────────────────────────────────
  await sb.from("automation_health_log").insert({
    auto_id: AUTO_ID,
    crawler_id: CRAWLER_ID,
    run_started_at: runStarted,
    run_completed_at: new Date().toISOString(),
    artifacts_found: openIssues.length + ghCommits.length,
    artifacts_new: 0,
    artifacts_duped: 0,
    success: emailOk,
    errors,
    notes: emailOk
      ? `digest sent for ${today}: ${openIssues.length} Jira issues (${counts.P1 ?? 0} P1), ${ghCommits.length} commits, ${ghMergedPRs.length} merged PRs`
      : `digest failed for ${today}: ${errors.slice(0, 3).join("; ")}`,
  });

  return new Response(
    JSON.stringify({
      ok: emailOk,
      date: today,
      jira_issues: openIssues.length,
      p1_count: counts.P1 ?? 0,
      transitions: transitions.length,
      commits: ghCommits.length,
      open_prs: ghOpenPRs.length,
      merged_prs: ghMergedPRs.length,
      email_sent: emailOk,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
