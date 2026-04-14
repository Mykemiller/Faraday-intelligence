// ── Faraday Teams API client ─────────────────────────────────────────────────
// Thin wrapper over Supabase RPCs for the Teams capability.
// No npm deps — uses fetch + the anon publishable key.
//
// Env override (recommended for prod):
//   window.__FARADAY_SUPABASE__ = { url, anonKey }
// set from a <script> tag before the app boots, OR replace the
// DEFAULTS below with process.env in a bundler setup.

const DEFAULTS = {
  url:     "https://ycadmmngkdhvpcsrcuaq.supabase.co",
  // Legacy anon JWT (PostgREST-compatible). Override via window.__FARADAY_SUPABASE__
  // or swap this for a publishable key once the site has RLS + a Supabase Auth session.
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljYWRtbW5na2RodnBjc3JjdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzYzMDIsImV4cCI6MjA5MTA1MjMwMn0.SOc6LZRpB-GIFe0-pZuW8K4nNIx6Ssl30yFv89HR0DE",
};

function cfg() {
  if (typeof window !== "undefined" && window.__FARADAY_SUPABASE__) {
    return { ...DEFAULTS, ...window.__FARADAY_SUPABASE__ };
  }
  return DEFAULTS;
}

async function rpc(name, body) {
  const { url, anonKey } = cfg();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": anonKey,
      "Authorization": `Bearer ${anonKey}`,
      "Prefer": "params=single-object",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (json && (json.message || json.error || json.hint)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// Returns a team row: { id, code, name, season, created_by_email, mw_total, created_at }
export function teamCreate({ email, name, code }) {
  return rpc("team_create", { p_email: email, p_name: name, p_code: code || null });
}

// Returns the joined team row
export function teamJoin({ email, code }) {
  return rpc("team_join", { p_email: email, p_code: code });
}

export function teamLeave({ email }) {
  return rpc("team_leave", { p_email: email });
}

// Returns an array; empty if the member isn't on a team.
// Row shape: { team_id, code, name, season, role, my_mw, mw_total, members, joined_at }
export function teamGetMyTeam({ email }) {
  return rpc("team_get_my_team", { p_email: email });
}

// Row shape: { rank, team_id, code, name, members, mw }
export function teamLeaderboard({ season, limit } = {}) {
  return rpc("team_leaderboard", { p_season: season || null, p_limit: limit || 20 });
}
