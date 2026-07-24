/**
 * jurisdiction-promote-worker  — STREAM E
 * Deno edge function. Processes pending promote events from jw_editorial_events,
 * creates Airtable records, and updates jurisdictions.editorial_status = 'promoted'.
 *
 * Schedule: every 5 min via pg_cron.
 * Gated by Sprint 0 crawler health — aborts if faraday-crawl-daily failed in last 24h.
 * CC-JPS-SCALE-MIGRATION-1.0 (2026-07-13): JPS is 0–100; narrative renders 1 decimal.
 * CC-CRON-GUC-VAULT-REMEDIATION-1.0 (2026-07-16): added inbound shared-secret auth check.
 *   Caller must send Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>. Previously this
 *   function was verify_jwt=false with zero inbound auth check of any kind.
 * CC-FAR-OPS-RESTORE-1.0 (2026-07-24): also accept the fcron house token
 *   (cron_caller_token, sha256 match — enrich-artifacts pattern). The pg_cron job
 *   was migrated onto public.cron_http_post(..., 'cron_caller_token', ...), which
 *   sends the house token, not the service-role key. Accepting only the service
 *   key made every scheduled call 401 and starved jw_editorial_events (0 rows).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AIRTABLE_KEY  = Deno.env.get('AIRTABLE_API_KEY')!;
const AIRTABLE_BASE = 'appxfti7VuoHYUeu6';
const AIRTABLE_TABLE = 'tblAZB4CjCBGHREKi';
const BATCH_SIZE = 25;
const AIRTABLE_BATCH = 10;         // Airtable max records per POST
const RATE_LIMIT_DELAY = 200;      // ms between Airtable batches (≤5 req/s)
const MAX_ATTEMPTS = 5;
// sha256('fcron_…') — the cron_caller_token house token, compared by hash so the
// plaintext literal never lands in source (enrich-artifacts precedent).
const CRON_TOKEN_SHA256 = 'dd88c73bb785f950802d296ede8541501b486da1c141aef14635680d2780ea63';

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── Inbound auth check ───────────────────────────────────────────────────────

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (token === SERVICE_KEY) return true;
  return (await sha256hex(token)) === CRON_TOKEN_SHA256;
}

// ── Sprint 0 crawler health gate ─────────────────────────────────────────────

async function isCrawlerHealthy(): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('automation_health_log')
    .select('success')
    .eq('crawler_id', 'faraday-crawl-daily')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // If no recent log entry, or the last run failed, gate
  if (!data) return false;
  return data.success === true;
}

async function gateEvents(eventIds: string[]): Promise<void> {
  await db.from('jw_editorial_events')
    .update({ status: 'gated', gated_by: 'sprint-0-crawler' })
    .in('id', eventIds);
}

// ── Fetch pending events ────────────────────────────────────────────────────

interface EditorialEvent {
  id: string;
  jurisdiction_id: string;
  reason: string;
  trigger_payload: Record<string, unknown>;
  attempt_count: number;
}

async function fetchPendingEvents(): Promise<EditorialEvent[]> {
  const { data, error } = await db
    .from('jw_editorial_events')
    .select('id, jurisdiction_id, reason, trigger_payload, attempt_count')
    .eq('status', 'pending')
    .eq('event_type', 'promote')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) throw new Error(`fetchPendingEvents: ${error.message}`);
  return (data ?? []) as EditorialEvent[];
}

// ── Fetch jurisdiction data ─────────────────────────────────────────────────

interface Jurisdiction {
  id: string;
  name: string;
  state_abbr: string;
  fips_code: string;
  level: string;
  current_score: number;
  current_tier: string;
  score_components: Record<string, unknown>;
}

async function fetchJurisdiction(id: string): Promise<Jurisdiction | null> {
  const { data } = await db
    .from('jurisdictions')
    .select('id, name, state_abbr, fips_code, level, current_score, current_tier, score_components')
    .eq('id', id)
    .maybeSingle();
  return data as Jurisdiction | null;
}

// ── Build Airtable payload ──────────────────────────────────────────────────

function buildAirtableFields(
  j: Jurisdiction,
  event: EditorialEvent
): Record<string, unknown> {
  const sc = j.score_components ?? {};
  const tier = j.current_tier ?? (event.trigger_payload?.new_tier as string);
  const score = j.current_score ?? (event.trigger_payload?.new_score as number);

  // JPS narrative — score + delta on the 0–100 scale, 1 decimal (display rule)
  const jpsRecord = [
    `Tier: ${tier ?? 'N/A'} | Score: ${score?.toFixed(1) ?? 'N/A'}`,
    `Promote reason: ${event.reason}`,
    score !== undefined ? `Score delta: ${(event.trigger_payload?.score_delta as number | null)?.toFixed(1) ?? 'first score'}` : '',
    sc ? `Components: ${JSON.stringify(sc)}` : '',
  ].filter(Boolean).join('\n');

  return {
    'Jurisdiction Name':         `${j.name}, ${j.state_abbr}`,
    'FIPS Code':                 j.fips_code ?? '',
    'Supabase Jurisdiction ID':  j.id,
    'JPS Score':                 score ?? null,
    'Posture Label':             tier ?? null,
    'JPS Record':                jpsRecord,
    'Editorial Status':          'Promoted',
    'Promoted At':               new Date().toISOString().substring(0, 10),
    'Promote Reason':            event.reason,
    // D1–D5 score components (write whatever keys the score_components carries)
    ...Object.fromEntries(
      Object.entries(sc).map(([k, v]) => [k, v])
    ),
  };
}

// ── Post batch to Airtable ──────────────────────────────────────────────────

interface AirtableCreateBody {
  records: Array<{ fields: Record<string, unknown> }>;
}

interface AirtableCreateResponse {
  records: Array<{ id: string }>;
}

async function postToAirtable(
  batch: Array<{ event: EditorialEvent; fields: Record<string, unknown> }>
): Promise<string[]> {
  const body: AirtableCreateBody = {
    records: batch.map(b => ({ fields: b.fields })),
  };
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${AIRTABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable POST failed ${res.status}: ${text}`);
  }
  const json = await res.json() as AirtableCreateResponse;
  return json.records.map(r => r.id);
}

// ── Process a single event ──────────────────────────────────────────────────

async function processEvent(event: EditorialEvent): Promise<{ airtableId: string | null; error?: string }> {
  const j = await fetchJurisdiction(event.jurisdiction_id);
  if (!j) return { airtableId: null, error: `jurisdiction ${event.jurisdiction_id} not found` };

  const fields = buildAirtableFields(j, event);

  try {
    const [airtableId] = await postToAirtable([{ event, fields }]);
    return { airtableId };
  } catch (err) {
    return { airtableId: null, error: String(err) };
  }
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Sprint 0 crawler gate
    const healthy = await isCrawlerHealthy();
    if (!healthy) {
      const events = await fetchPendingEvents();
      if (events.length > 0) {
        await gateEvents(events.map(e => e.id));
        console.log(`Sprint 0 crawler gate: ${events.length} events gated`);
      }
      return new Response(JSON.stringify({ gated: true, count: events.length }), { status: 200 });
    }

    const events = await fetchPendingEvents();
    if (!events.length) {
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
    }

    // Mark all as processing
    await db.from('jw_editorial_events')
      .update({ status: 'processing', last_attempted_at: new Date().toISOString() })
      .in('id', events.map(e => e.id));

    let completed = 0, failed = 0;

    // Process in Airtable-size batches (10 at a time)
    for (let i = 0; i < events.length; i += AIRTABLE_BATCH) {
      const chunk = events.slice(i, i + AIRTABLE_BATCH);

      // Build payloads
      const payloads: Array<{ event: EditorialEvent; fields: Record<string, unknown>; j: Jurisdiction | null }> = [];
      for (const event of chunk) {
        const j = await fetchJurisdiction(event.jurisdiction_id);
        if (!j) {
          await db.from('jw_editorial_events').update({
            status: event.attempt_count + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
            attempt_count: event.attempt_count + 1,
            error_message: 'jurisdiction not found',
          }).eq('id', event.id);
          failed++;
          continue;
        }
        payloads.push({ event, fields: buildAirtableFields(j, event), j });
      }

      if (payloads.length === 0) continue;

      try {
        const airtableIds = await postToAirtable(payloads.map(p => ({ event: p.event, fields: p.fields })));

        // Update Supabase for each successful promotion
        for (let k = 0; k < payloads.length; k++) {
          const { event, j } = payloads[k];
          const airtableId = airtableIds[k];
          if (!airtableId) continue;

          await db.from('jurisdictions').update({
            airtable_record_id:   airtableId,
            editorial_status:     'promoted',
            airtable_promoted_at: new Date().toISOString(),
          }).eq('id', j!.id);

          await db.from('jw_editorial_events').update({
            status:            'completed',
            completed_at:      new Date().toISOString(),
            airtable_record_id: airtableId,
          }).eq('id', event.id);

          completed++;
        }
      } catch (err) {
        // Batch failed — update each event
        for (const { event } of payloads) {
          const newCount = event.attempt_count + 1;
          await db.from('jw_editorial_events').update({
            status:        newCount >= MAX_ATTEMPTS ? 'failed' : 'pending',
            attempt_count: newCount,
            error_message: String(err),
          }).eq('id', event.id);
          failed++;
        }
      }

      // Rate limit: ≤5 req/s
      if (i + AIRTABLE_BATCH < events.length) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
      }
    }

    console.log(`jurisdiction-promote-worker: completed=${completed} failed=${failed}`);
    return new Response(JSON.stringify({ completed, failed }), { status: 200 });

  } catch (err) {
    console.error('jurisdiction-promote-worker fatal:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
