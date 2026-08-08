// ingest-staleness-healthcheck — CC-INGEST-STALLED-LANES-1.0 (D3)
// Supabase Edge Function — POST /functions/v1/ingest-staleness-healthcheck
//
// PURPOSE
//   Four ingest lanes ran for 11–32 days writing nothing, with `active` pg_cron
//   jobs the whole time, and nothing alerted. This is the alert.
//
//   It is deliberately GENERIC: every lane it watches is a row in
//   public.ingest_staleness_watch, and public.fn_ingest_staleness_check() does the
//   evaluation in SQL. Adding a lane is one INSERT — no change to this file.
//
// WHY pg_cron's own status is worthless here
//   Every one of these jobs calls public.cron_http_post(), which returns a pg_net
//   request id as soon as the request is QUEUED. cron.job_run_details therefore
//   shows status='succeeded' / "1 row" even when the edge function 401s, throws,
//   or is killed mid-run. net._http_response keeps the real outcome ~6h. So a
//   green cron history proves only that a request was enqueued.
//
// AUTH: mirrors faraday-crawl-healthcheck — verify_jwt=false, accepting either the
//   service-role key or the internal CRON_TOKEN. The cron sends the CRON_TOKEN,
//   not a JWT, so verify_jwt MUST stay false (a true setting 401s the cron at the
//   gateway — the faraday-crawl v2 trap).
//
// NOTE: never writes automation_health_log. Several watches READ that table for
//   their poll signal; writing to it here would contaminate the signal.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  breachedOnly, buildAlertHtml, buildSubject, type WatchResult,
} from "./alert-pure.ts";

const CRON_TOKEN = "fcron_9mK3pX7qR2vN8wYz4tB6sL1dH5jG0aE";
const TO = "mykemiller@gmail.com";
const FROM = "Faraday Ops <ops@faraday-intelligence.ai>";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Handler ─────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (provided !== serviceKey && provided !== CRON_TOKEN) return json({ error: "Unauthorized" }, 401);

  // ?dry=1 returns the evaluation without sending mail — used to prove the alert
  // fires against a deliberately stale source without spamming the inbox.
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  const sb = createClient(supabaseUrl, serviceKey);
  const now = new Date().toISOString();

  const { data, error } = await sb.rpc("fn_ingest_staleness_check");
  if (error) return json({ error: "staleness check failed", detail: error.message }, 500);

  const rows = (data ?? []) as WatchResult[];
  const breaches = breachedOnly(rows);

  if (breaches.length === 0) {
    return json({ ok: true, alert: false, watches: rows.length, breaches: 0 });
  }

  const subject = buildSubject(breaches);
  const html = buildAlertHtml({ breaches, totalWatches: rows.length, now });

  if (dry) {
    return json({
      ok: true, alert: true, sent: false, dry_run: true, watches: rows.length,
      breaches: breaches.length, subject,
      detail: breaches.map((b) => ({ watch_key: b.watch_key, mode: b.check_mode, detail: b.detail })),
    });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    // Surface the alert even if email transport is unconfigured — never silent.
    console.error("ingest-staleness-healthcheck ALERT (RESEND_API_KEY unset):", subject);
    return json({ ok: false, alert: true, sent: false, reason: "RESEND_API_KEY not set",
      watches: rows.length, breaches: breaches.length,
      detail: breaches.map((b) => b.watch_key) }, 500);
  }

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO, subject, html }),
  });
  if (!resendRes.ok) {
    const body = (await resendRes.text()).slice(0, 500);
    console.error("ingest-staleness-healthcheck Resend send failed:", resendRes.status, body);
    return json({ ok: false, alert: true, sent: false, status: resendRes.status, body }, 502);
  }

  const sent = await resendRes.json();
  return json({ ok: true, alert: true, sent: true, id: sent?.id, subject,
    watches: rows.length, breaches: breaches.length });
});
