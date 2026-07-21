# CLAUDE.md — Faraday-intelligence (RETIRED static site / LIVE data plane)

As of 2026-06-19 this static site is **retired** (FAR-119). `faraday-intelligence.ai`
(+ `www`) was moved to the Next.js engine project **`v0-faraday-daily-challenge`**
(`v0-faraday-daily-challenge-n2u5`), which now serves the **entire** site —
homepage, all 8 storefronts, Daily Challenge, leaderboard, and the APIs ported
from here (Ask Faraday, waitlist/subscribe, lexicon).

- This project **no longer holds a production domain**. Do **not** build new
  surfaces here — the canonical site lives in `v0-faraday-daily-challenge` (see
  that repo's CLAUDE.md).
- Historical: this was a `vercel.json` v2 static site (`public/*.html`) that
  briefly proxied `/daily-challenge` to the engine (FAR-63); superseded by the
  full engine-as-site migration (FAR-119).

> **Still live here:** the Supabase data plane — `supabase/functions/*` (incl.
> `faraday-crawl` + `coverage-bridge.ts`, the roster-driven daily Automation-Registry
> crawler) and `supabase/migrations/*` (project `ycadmmngkdhvpcsrcuaq`). These are
> active and unrelated to the retired static site.

## Changelog

### CC-IDF4-ACTIVATE-1.0 — 2026-07-21 (Lane A sub-domain crawler activation)
- **26 `[crawler]` D#.# sub-domain routines activated** (AUTO-138,139,141–157,159–163,167,172):
  rostered into `faraday-crawl` via a new `LANE_A_ACTIVATION` array in `coverage-bridge.ts`;
  each passed a bounded (cap-4) healthy-run test (`automation_health_log`, 26/26 success, 4/4
  found, D#.#-tagged artifacts) before its Airtable Registry Status flipped Designed→Active.
  See `docs/idf4-activate/`. Live-fleet crawl of these 26 begins at the next 07:00 UTC
  `faraday-crawl-daily` cron **after this PR merges + `faraday-crawl` redeploys**.
- **AUTO-138 root-caused:** the ~1.14M-new "runaway" attributed to D7.2 Immersion Cooling was an
  `auto_id` mislabel by `ingest-sdwis-baseline` / `ingest-bls-labor` (bulk backfill, already
  complete/stopped), **not** the immersion crawler. Follow-up: relabel those ingesters' health
  rows off `auto_id='AUTO-138'`.
- **Verified:** AUTO-060→119 dedicated sub-domain crawlers are genuinely Active (13/13 healthy,
  last 2026-07-21 07:00 UTC) — corrects the stale "AUTO-060→119 dormant" claim in the IDF 4.0
  Coverage Matrix.
- **Held:** Lane B (140,158,169,170,171,173,174,175; 168 dry-run-only), Lane C gates
  (129–133, 186, 198), Lane D (185,187), Lane E (053–058,128,179), ambiguous (051,052,059,120).
