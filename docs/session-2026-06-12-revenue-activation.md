# Session status — 2026-06-12 · Revenue Activation (Claude Code, repo: Mykemiller/Faraday-intelligence)

**Branch:** `claude/faraday-revenue-activation-c6irvb` (contains PR #1 homepage rebrand + this session's commit `cfc3b5b`)
**Prior session today:** first-dollar verification (`docs/session-2026-06-12-first-dollar-status.md` on `claude/faraday-first-live-dollar-durjkk`, repo `Mykemiller/Faraday`) — decisions D1–D6 still open with Myke.

---

## 1. What this session shipped (commit `cfc3b5b`)

All FAR-63 work that lives in THIS repo (the Vite/static site serving faraday-intelligence.ai):

- **`/challenge` → `/daily-challenge` 301** in `vercel.json` (canonical route per 2026-06-10 Decision Log). `/challenge/*` and `/daily-challenge/*` subpaths also 301 to `/daily-challenge`.
- **Homepage links updated** — all 10 `/challenge` hrefs in `public/faraday-home.html` now point at `/daily-challenge`.
- **Daily Challenge static lobby (`public/faraday-daily-challenge-newicons.jsx`) honest-data scrub** (FAR-63 stats acceptance criterion):
  - Removed fabricated community stats: 847 active streaks / 5,065 plays / 23% share rate / per-game play counts (1,240 Rackl etc.).
  - Streak and MW balance now start at 0 (were mock 3 / 487); streak chip hidden at zero.
  - All emoji removed (⚡🔥🏆🌐💡 → typographic glyphs ✦/◈/◎ or plain text).
- **Stale pre-rebrand pages deleted** (near-black + emoji copies that were still publicly addressable): `public/challenge/index.html`, `public/challenge-index.html`, `public/daily-challenge/index.html`, `public/faraday-home 2.html` (62 retired-tier references), and the unused duplicate `public/vercel.json`.
- **Verification:** `npm run build` (vite) clean; JSX syntax-checked with esbuild; `vercel.json` valid JSON; grep confirms zero Starter/Signal/Premier/"Intelligence Tiers"/emoji in `faraday-home.html`.

This branch **supersedes PR #1** (it contains it). Merging this branch closes the homepage drift surface AND the stale-lobby violation in one deploy.

## 2. Independently re-verified in Supabase (project `ycadmmngkdhvpcsrcuaq`, read-only)

Confirms the earlier session's findings with source evidence:

1. **`jw_token_balance()` month-window defect CONFIRMED** — grants and unlocks are summed only where `created_at >= date_trunc('month', now())`: purchased tokens silently vanish at month rollover. Directly contradicts "tokens never expire." **Must be fixed before any real purchase.**
2. **RLS disabled CONFIRMED** on `token_transactions`, `stripe_events`, and `jw_plans` (`relrowsecurity = false`) — anon key can mint grants. Money tables must not go live like this.
3. **`jw_record_stripe_grant()` idempotency is sound** (insert … on conflict do nothing → duplicate short-circuit).
4. **No billing-tier enum exists** in the database (checked all pg_enum types). The naming-drift surface is `jw_plans` rows: `free/professional/institutional/enterprise` with **monthly subscription prices** ($79/$149) — both the retired term and the retired pricing model. Retirement decision = Myke (pricing carve-out, FAR-60).

The staged fix (product-agnostic wallet + RLS + non-expiring balance) is `supabase/migrations/0006_wallet_generalization.staged.sql` on `claude/faraday-first-live-dollar-durjkk` (repo `Mykemiller/Faraday`) — **still staged, not applied**, awaiting Myke review (D1).

## 3. Status vs. the execution prompt

| Item | State | Evidence | Remaining |
|---|---|---|---|
| FAR-63 homepage | Build-complete on this branch | commit `cfc3b5b` (includes PR #1 `a3e5656`) | Myke merges + Vercel deploy |
| FAR-63 `/challenge` 301 | Done on this branch | `vercel.json` | Deploys with merge |
| FAR-63 stats/emoji AC | Done on this branch | JSX scrub in `cfc3b5b` | — |
| FAR-44 Stripe products | NOT started | — | Myke (manual dashboard) |
| FAR-44 wallet generalization | Staged only | `0006_…staged.sql` (other repo) | Myke review → apply (D1) |
| FAR-44 config meters | In staged migration (`product_meters` DRAFT) | same | Lands with D1 |
| FAR-45 test purchase | Blocked | — | Stripe products + secrets + wallet fix + JW deploy |
| `UpgradeRequiredError` fix | **Cannot be done from this repo** | JW Next.js app repo URL recorded nowhere | Myke records repo URL (D5); next session scoped to it |
| Drift: Homepage | Closes on merge of this branch | `cfc3b5b` | Merge |
| Drift: Jira | ✅ (2026-06-10) | FAR-16 rescope | — |
| Drift: Supabase "enum" | No enum exists; `jw_plans` rows are the surface | SQL audit above | Myke decision (D3) |
| Drift: Beehiiv tags | Open — no Beehiiv access in this session | — | Myke or session with Beehiiv tooling |
| Drift: Architecture registries | ✅ (2026-06-10) | Hub | — |
| Drift: Architecture diagram | Open — Hub still lists full manual change list, "Last updated: —" | Hub Visual Architecture section | Myke confirms + checks box (always-human) |

## 4. First-dollar verdict (unchanged from earlier session, re-verified)

**A real purchase cannot clear today.** Chain and owners:

1. Stripe token-bucket products don't exist — **Myke** (dashboard).
2. `STRIPE_SECRET_KEY` + `SUPABASE_SERVICE_ROLE_KEY` not in `.env.local` — **Myke**.
3. Wallet defects (month-expiry + RLS) — fix staged, **Myke approves (D1)**, then Claude Code applies.
4. JW checkout deployed nowhere public + `UpgradeRequiredError` build-breaker — **Claude Code**, but blocked until the JW repo URL is recorded and a session is scoped to it (**Myke, D5**).
5. Homepage/lobby rebrand live — **Myke** merges `claude/faraday-revenue-activation-c6irvb` (or PR #1; this branch is a superset).

## 5. Decisions needed from Myke (consolidated; D1–D6 from earlier session still open)

| # | Decision | Recommendation |
|---|---|---|
| M1 | Merge path: PR #1 alone vs. this branch (PR #1 + 301 + lobby scrub + stale-page removal) | Merge `claude/faraday-revenue-activation-c6irvb` — closes more FAR-63 AC in one deploy |
| D1 | Apply staged wallet migration `0006` | Approve — blocks all money movement |
| D2 | Lobby canonical domain (faradaydailychallenge.com → v0 project) + disable SSO protection | Do it; then point `/daily-challenge` here via 301 in a follow-up |
| D3 | `jw_plans` retirement (enterprise naming + monthly prices) | Retire rows when wallet migration applies; pricing carve-out so your call |
| D4 | Architecture-diagram drift checkbox | Hub shows the manual change list still pending — do NOT check until you've applied it via Gemini |
| D5 | Record the JW frontend repo URL in the Hub | Required before any session can fix `apiClient.ts` |
| D6 | Stripe products + secrets | Create 3 buckets + Academy in test mode; supply keys |

## 6. Out-of-scope drift flagged (not fixed, needs its own pass)

Retired-tier copy still exists in other public-addressable files in this repo: `public/faraday-alert.html` (~53 tier refs), `public/faraday-academy.jsx` (~45), `public/faraday-subscriber-profile-v7.jsx` (~61), `public/faraday-pulse.html` (2), `public/academy/index.html` (~31). These are subscriber-facing surfaces → editorial gate applies; recommend a dedicated FAR story rather than silent rewrites.
