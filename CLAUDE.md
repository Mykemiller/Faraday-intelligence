# CLAUDE.md — Faraday-intelligence (RETIRED / dormant)

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
