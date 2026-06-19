# CLAUDE.md — Faraday-intelligence (brand site)

Static site served at `faraday-intelligence.ai`: `vercel.json` v2 `builds` + `routes`
serving `public/` (HTML) and `api/` (`@vercel/node`). Not a live Vite build despite
the Vercel project framework label.

## Daily Challenge canon (set 2026-06-19, reverses Decision Log D2 — approved by Myke)

The **canonical Daily Challenge is the Next.js engine** in the separate repo
**`v0-faraday-daily-challenge`** (project `v0-faraday-daily-challenge-n2u5`,
`prj_A7MhvdAWivMLOccGMTp6AFYZQ1s1`), mounted under `basePath:/daily-challenge`.

- This repo **only proxies** it: `vercel.json` rewrites `/daily-challenge` and
  `/daily-challenge/:path*` → the engine's production deployment. Do **not**
  re-create a Daily Challenge surface here. The old in-repo Babel-standalone files
  (`public/daily-challenge-index.html`, `public/faraday-daily-challenge*.jsx`) were
  retired (FAR-63).
- `faradaydailychallenge.com` 301s to `faraday-intelligence.ai/daily-challenge`
  (redirect lives on the engine project, not here).
- The proxy targets the engine's production alias and requires that project's
  production URL to stay public (its Deployment Protection = *Only Preview Deployments*).
