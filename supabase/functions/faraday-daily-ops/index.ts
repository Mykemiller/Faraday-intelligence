// faraday-daily-ops — daily internal ops email to Myke: pipeline health check +
// 24h activity digest. Sends via Resend from the brand domain. Invoked daily by
// pg_cron (see migration). Reads metrics from public.faraday_ops_snapshot().
//
// Auth: verify_jwt = true — the cron caller passes the project's anon JWT, which
// blocks anonymous internet callers. All data access uses the service role.
//
// CC-FAR-OPS-RESTORE-1.0 (2026-07-24):
//   (1) FROM repointed off the apex faraday-intelligence.ai (Google Workspace
//       corporate mail; lost Resend verification 2026-07-23) onto the verified
//       transactional subdomain send.faraday-intelligence.ai.
//   (2) On send failure this function now writes an automation_health_log row
//       before returning 502 — previously it returned 502 and persisted nothing,
//       so the 2026-07-23 outage left no forensic record on this function at all.
// CC-FAR-OPS-RESTORE-1.0 follow-up (2026-07-24): registered in the Automation
//       Registry as AUTO-203 ("Daily Faraday Ops Email"), replacing the interim
//       AUTO-DAILYOPS-UNREGISTERED sentinel. (AUTO-051 was already the "Local
//       Government Data Center Action Crawler".)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TO = "mykemiller@gmail.com";
const FROM = "Faraday Ops <ops@send.faraday-intelligence.ai>";
const STALE_HOURS = 36; // crawler/automation registry is expected to run ~daily
// Automation Registry: AUTO-203 "Daily Faraday Ops Email" (Active), registered
// under CC-FAR-OPS-RESTORE-1.0 to replace the interim AUTO-DAILYOPS-UNREGISTERED
// sentinel (AUTO-051 was already taken by the Local Government DC Action Crawler).
const AUTO_ID = "AUTO-203";
const CRAWLER_ID = "faraday-daily-ops_v1.0";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fmtAge(hours: number | null): string {
  if (hours == null) return "never";
  if (hours < 48) return `${hours}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

function buildEmail(s: Record<string, unknown>): { subject: string; html: string } {
  const artifactHours = s.artifact_hours as number | null;
  const healthHours = s.health_hours as number | null;
  const failed = Number(s.health_fail_24h ?? 0);

  const stale =
    artifactHours == null || artifactHours > STALE_HOURS ||
    healthHours == null || healthHours > STALE_HOURS;
  const ok = !stale && failed === 0;

  const flag = ok ? "✅" : "⚠️";
  const headline = ok
    ? "Faraday pipeline healthy"
    : "Faraday pipeline needs attention";
  const subject = `${flag} Faraday daily — ${ok ? "healthy" : "STALE"} · ${s.artifacts_24h ?? 0} new (24h)`;

  const warnings: string[] = [];
  if (artifactHours == null || artifactHours > STALE_HOURS) {
    warnings.push(`No new artifacts in ${fmtAge(artifactHours)} (threshold ${STALE_HOURS}h) — the crawler / automation registry may be dark.`);
  }
  if (healthHours == null || healthHours > STALE_HOURS) {
    warnings.push(`No automation run logged in ${fmtAge(healthHours)} — nothing is writing to automation_health_log.`);
  }
  if (failed > 0) {
    warnings.push(`${failed} automation run(s) failed in the last 24h.`);
  }

  const row = (k: string, v: unknown) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#6B6560;">${k}</td><td style="padding:4px 0;color:#141210;font-weight:600;">${v ?? "—"}</td></tr>`;

  const warnHtml = warnings.length
    ? `<div style="background:#FBEEE0;border-left:3px solid #C4922A;padding:12px 16px;margin:16px 0;border-radius:4px;">
         <strong style="color:#8A5A00;">Warnings</strong>
         <ul style="margin:8px 0 0;padding-left:18px;color:#5A4A2A;">${warnings.map((w) => `<li style="margin:4px 0;">${w}</li>`).join("")}</ul>
       </div>`
    : `<p style="color:#2E7D32;margin:16px 0;">All systems nominal — no warnings.</p>`;

  const html = `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#F8F5F0;color:#141210;padding:32px;max-width:600px;margin:0 auto;">
  <div style="font-size:12px;color:#C4922A;letter-spacing:0.12em;text-transform:uppercase;">FARADAY INTELLIGENCE · DAILY OPS</div>
  <h1 style="font-size:22px;margin:8px 0 4px;">${flag} ${headline}</h1>
  <p style="font-size:12px;color:#6B6560;margin:0 0 8px;">Snapshot at ${s.now}</p>
  ${warnHtml}
  <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#6B6560;margin:24px 0 8px;">Pipeline health</h2>
  <table style="font-size:14px;border-collapse:collapse;">
    ${row("Last artifact discovered", `${s.artifact_last ?? "—"} (${fmtAge(artifactHours)})`)}
    ${row("Last enrichment", s.enrich_last)}
    ${row("Last automation run", `${s.health_last ?? "—"} (${fmtAge(healthHours)})`)}
    ${row("Automation runs (24h)", `${s.health_runs_24h ?? 0} (${failed} failed)`)}
  </table>
  <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#6B6560;margin:24px 0 8px;">Last 24 hours</h2>
  <table style="font-size:14px;border-collapse:collapse;">
    ${row("New artifacts", s.artifacts_24h)}
    ${row("New enrichments", s.enrich_24h)}
    ${row("Signals fired", s.signals_24h)}
    ${row("Jurisdiction signals", s.jsignals_24h)}
    ${row("Artifacts (total)", s.artifacts_total)}
  </table>
  <p style="font-size:11px;color:#9B958E;margin-top:32px;">Automated by faraday-daily-ops · Supabase pg_cron · ${s.now}</p>
</body></html>`;

  return { subject, html };
}

Deno.serve(async (_req: Request) => {
  const runStarted = new Date().toISOString();
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not set" }, 500);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await sb.rpc("faraday_ops_snapshot");
  if (error) {
    console.error("snapshot rpc failed:", error);
    return json({ error: "snapshot failed", detail: error.message }, 500);
  }

  const { subject, html } = buildEmail(data as Record<string, unknown>);

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: TO, subject, html }),
  });

  if (!resendRes.ok) {
    const body = await resendRes.text();
    console.error("Resend send failed:", resendRes.status, body);
    // CC-FAR-OPS-RESTORE-1.0: persist a forensic record of the send failure.
    // (Previously this branch returned 502 and wrote nothing.)
    await sb.from("automation_health_log").insert({
      log_id: crypto.randomUUID(),
      auto_id: AUTO_ID,
      crawler_id: CRAWLER_ID,
      run_started_at: runStarted,
      run_completed_at: new Date().toISOString(),
      artifacts_found: 0,
      artifacts_new: 0,
      artifacts_duped: 0,
      success: false,
      errors: { stage: "resend_send", status: resendRes.status, body: body.slice(0, 500) },
      notes: `faraday-daily-ops send failed from ${FROM}: Resend ${resendRes.status}`,
    }).then(() => {}).catch((e) => console.error("health-log insert failed:", e));
    return json({ error: "send failed", status: resendRes.status, body }, 502);
  }

  const sent = await resendRes.json();
  return json({ ok: true, id: sent?.id, subject, snapshot: data });
});
