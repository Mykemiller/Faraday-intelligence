/**
 * jurisdiction-demote-sweeper  — STREAM F
 * Deno edge function. Daily demote + archive sweeper for the editorial working set.
 *
 * Schedule: 0 9 * * * UTC (= 03:00 America/Chicago) via pg_cron.
 * Soft demote at 30 days inactive. Hard archive (Airtable DELETE) at 120 days demoted.
 * Manual-pin jurisdictions are never auto-demoted until manually unpinned.
 * L4 hyperscaler activity jurisdictions (jds_l4_count > 0) are never auto-demoted.
 * CC-CRON-GUC-VAULT-REMEDIATION-1.0 (2026-07-16): added inbound shared-secret auth check.
 *   Caller must send Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>. Previously this
 *   function was verify_jwt=false with zero inbound auth check of any kind.
 * CC-FAR-OPS-RESTORE-1.0 (2026-07-24): also accept the fcron house token
 *   (cron_caller_token, sha256 match — enrich-artifacts pattern). The pg_cron job
 *   was migrated onto public.cron_http_post(..., 'cron_caller_token', ...), which
 *   sends the house token, not the service-role key.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AIRTABLE_KEY  = Deno.env.get('AIRTABLE_API_KEY')!;
const AIRTABLE_BASE = 'appxfti7VuoHYUeu6';
const AIRTABLE_TABLE = 'tblAZB4CjCBGHREKi';
const WORKING_SET_WATCHDOG_THRESHOLD = 5000;
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

// ── Types ────────────────────────────────────────────────────────────

interface DemoteCandidate {
  id: string;
  airtable_record_id: string;
  name: string;
  state_abbr: string;
  airtable_promoted_at: string;
  last_editorial_activity_at: string | null;
}
interface ArchiveCandidate {
  id: string;
  airtable_record_id: string;
  airtable_demoted_at: string;
}

// ── DEMOTE: 30-day inactive query ────────────────────────────────────────────

async function fetchDemoteCandidates(): Promise<DemoteCandidate[]> {
  const { data, error } = await db.rpc('fn_demote_candidates') as { data: DemoteCandidate[] | null; error: unknown };

  if (error) {
    // Fallback: raw query if RPC not yet defined
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await db.from('jurisdictions')
      .select('id, airtable_record_id, name, state_abbr, airtable_promoted_at, last_editorial_activity_at')
      .eq('editorial_status', 'promoted')
      .lt('airtable_promoted_at', thirtyDaysAgo)
      .eq('jds_l4_count', 0)
      .not('airtable_record_id', 'is', null);

    // Filter: no recent editorial activity, no pending proposals, no recent signals, no manual pin
    const candidates: DemoteCandidate[] = [];
    for (const row of rows ?? []) {
      const lastActivity = row.last_editorial_activity_at ?? row.airtable_promoted_at;
      if (new Date(lastActivity) >= new Date(thirtyDaysAgo)) continue;

      // Check no pending proposals
      const { count: proposalCount } = await db.from('jw_posture_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('jurisdiction_id', row.id)
        .eq('status', 'pending');
      if (proposalCount && proposalCount > 0) continue;

      // Check no recent signals (60 days)
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { count: signalCount } = await db.from('jurisdiction_signals')
        .select('id', { count: 'exact', head: true })
        .eq('jurisdiction_id', row.id)
        .gte('detected_at', sixtyDaysAgo);
      if (signalCount && signalCount > 0) continue;

      // Check no active manual pin
      const { data: pinEvents } = await db.from('jw_editorial_events')
        .select('id, created_at')
        .eq('jurisdiction_id', row.id)
        .eq('event_type', 'manual_pin')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1);
      if (pinEvents?.length) {
        const { count: unpinCount } = await db.from('jw_editorial_events')
          .select('id', { count: 'exact', head: true })
          .eq('jurisdiction_id', row.id)
          .eq('event_type', 'manual_unpin')
          .gt('created_at', pinEvents[0].created_at);
        if (!unpinCount || unpinCount === 0) continue; // still pinned
      }

      candidates.push(row as DemoteCandidate);
    }
    return candidates;
  }

  return data ?? [];
}

// ── ARCHIVE: 120-day demoted query ─────────────────────────────────────────────

async function fetchArchiveCandidates(): Promise<ArchiveCandidate[]> {
  const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db.from('jurisdictions')
    .select('id, airtable_record_id, airtable_demoted_at')
    .eq('editorial_status', 'demoted')
    .lt('airtable_demoted_at', cutoff)
    .not('airtable_record_id', 'is', null);
  return (data ?? []) as ArchiveCandidate[];
}

// ── Airtable PATCH ──────────────────────────────────────────────────────

async function patchAirtableRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordId}`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields }),
    }
  );
  if (!res.ok) throw new Error(`Airtable PATCH ${recordId} failed ${res.status}: ${await res.text()}`);
}

// ── Airtable DELETE ─────────────────────────────────────────────────────

async function deleteAirtableRecord(recordId: string): Promise<void> {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
  );
  if (!res.ok) throw new Error(`Airtable DELETE ${recordId} failed ${res.status}: ${await res.text()}`);
}

// ── Demote action ──────────────────────────────────────────────────────────

async function demoteJurisdiction(candidate: DemoteCandidate, reason: string): Promise<void> {
  const today = new Date().toISOString().substring(0, 10);

  // Log event
  const { data: event } = await db.from('jw_editorial_events').insert({
    jurisdiction_id: candidate.id,
    event_type:      'demote',
    status:          'processing',
    reason,
    triggered_by:    'cron:demote_sweeper',
  }).select('id').single();

  try {
    // Patch Airtable record (soft — keep the row as a frozen reference)
    await patchAirtableRecord(candidate.airtable_record_id, {
      'Editorial Status': 'Demoted',
      'Demoted At':       today,
      'Demote Reason':    reason,
    });

    // Update Supabase
    await db.from('jurisdictions').update({
      editorial_status:     'demoted',
      airtable_demoted_at:  new Date().toISOString(),
      demote_reason:        reason,
    }).eq('id', candidate.id);

    // Complete event
    if (event?.id) {
      await db.from('jw_editorial_events').update({
        status:       'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', event.id);
    }
  } catch (err) {
    if (event?.id) {
      await db.from('jw_editorial_events').update({
        status:        'failed',
        error_message: String(err),
      }).eq('id', event.id);
    }
    throw err;
  }
}

// ── Archive action ────────────────────────────────────────────────────

async function archiveJurisdiction(candidate: ArchiveCandidate): Promise<void> {
  const { data: event } = await db.from('jw_editorial_events').insert({
    jurisdiction_id: candidate.id,
    event_type:      'archive',
    status:          'processing',
    reason:          'demoted_120d_elapsed',
    triggered_by:    'cron:demote_sweeper',
  }).select('id').single();

  try {
    await deleteAirtableRecord(candidate.airtable_record_id);

    await db.from('jurisdictions').update({
      editorial_status:      'archived',
      airtable_record_id:    null,
      airtable_archived_at:  new Date().toISOString(),
    }).eq('id', candidate.id);

    if (event?.id) {
      await db.from('jw_editorial_events').update({
        status:       'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', event.id);
    }
  } catch (err) {
    if (event?.id) {
      await db.from('jw_editorial_events').update({
        status:        'failed',
        error_message: String(err),
      }).eq('id', event.id);
    }
    throw err;
  }
}

// ── Working set watchdog ───────────────────────────────────────────────────

async function checkWorkingSetBound(): Promise<number> {
  const { count } = await db.from('jurisdictions')
    .select('id', { count: 'exact', head: true })
    .eq('editorial_status', 'promoted');
  const n = count ?? 0;
  if (n > WORKING_SET_WATCHDOG_THRESHOLD) {
    await db.from('watchdog_events').insert({
      event_type: 'jurisdiction_working_set_high',
      payload:    JSON.stringify({ count: n, threshold: WORKING_SET_WATCHDOG_THRESHOLD }),
    }).then(() => {}).catch(() => {});  // best-effort
    console.warn(`WATCHDOG: working set ${n} > ${WORKING_SET_WATCHDOG_THRESHOLD}`);
  }
  return n;
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const demoted: string[] = [], archived: string[] = [], errors: string[] = [];

  try {
    // PHASE 1: Demote
    const demoteCandidates = await fetchDemoteCandidates();
    console.log(`Demote candidates: ${demoteCandidates.length}`);

    for (const c of demoteCandidates) {
      try {
        const reason = [
          'no_activity_30d',
          'no_pending_proposal',
          'no_recent_signal',
        ].join('+');
        await demoteJurisdiction(c, reason);
        demoted.push(c.id);
        console.log(`Demoted: ${c.name}, ${c.state_abbr}`);
      } catch (err) {
        errors.push(`demote:${c.id}:${err}`);
        console.error(`Failed to demote ${c.id}:`, err);
      }
    }

    // PHASE 2: Archive (120 days demoted)
    const archiveCandidates = await fetchArchiveCandidates();
    console.log(`Archive candidates: ${archiveCandidates.length}`);

    for (const c of archiveCandidates) {
      try {
        await archiveJurisdiction(c);
        archived.push(c.id);
        console.log(`Archived: ${c.id}`);
      } catch (err) {
        errors.push(`archive:${c.id}:${err}`);
        console.error(`Failed to archive ${c.id}:`, err);
      }
    }

    // PHASE 3: Working set bound check
    const workingSetCount = await checkWorkingSetBound();

    const summary = {
      promoted_count:    workingSetCount,
      demoted_this_run:  demoted.length,
      archived_this_run: archived.length,
      current_working_set: workingSetCount - demoted.length,
      errors:            errors.length,
    };
    console.log('jurisdiction-demote-sweeper:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), { status: 200 });

  } catch (err) {
    console.error('jurisdiction-demote-sweeper fatal:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
