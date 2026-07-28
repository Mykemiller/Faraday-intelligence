# CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 — Wave 3 investigation

_2026-07-28. Wave 3 = Tier-B scrape states: AL, CA, PA, MO, IL, NJ, MI, IN, KY,
ID, NM, MT, CO, WA._

## Finding: no Wave-3 state exposes server-side-fetchable recipient data

Every Wave-3 source was probed live server-side (Postgres `pg_net`). The result
is uniform and evidence-backed: **none of the 14 states publish recipient-level
incentive data in a form the available infrastructure can fetch and parse.** They
split into three unscrapeable shapes:

| Shape | States (probed 2026-07-28) | Why it can't be ingested here |
|---|---|---|
| **JS-rendered dashboard** (table loads via client JS; HTML has an empty `<table>`) | **CA** CalCompetes awardee list (1 `<table>`, 0 `<tr>`, WordPress widget), **PA** DCED Investment Tracker (Google-Maps JS app, no data API) | the Supabase edge runtime fetches raw HTML but **cannot execute JS**, so the rows never materialize |
| **Cloudflare / bot-gated** | **ID** Idaho Commerce ("Just a moment…" CF challenge, HTTP 403) | CF interstitial blocks non-browser clients |
| **Moved / 404 / 403 / unresolved / PDF** | **WA** (disclosure app 404; DOR page has only worksheet templates), **NJ** (404), **MI** (404, no data files), **MT** (404), **CO** (403), **IN** (MPH hub is CKAN but 0 incentive datasets), **AL**/**NM** (host did not resolve), **KY**/**MO**/**IL** (PDF / no on-domain dataset) | nothing machine-readable at the documented URL |

### State open-data portals are dry too
On-domain Socrata/CKAN catalog searches (with `search_context` to defeat Socrata's
global federation) found **no per-recipient incentive dataset** on any of:
`data.wa.gov`, `data.illinois.gov`, `data.colorado.gov`, `data.nj.gov`,
`data.mo.gov`, `data.pa.gov`, `data.ca.gov` (CKAN), `hub.mph.in.gov` (CKAN).
This confirms the earlier Wave-1 "ABSENT from Socrata" notes for these states.

## Root cause is infrastructure, not effort

Two fetch paths exist in this session, and **neither can reach Wave-3 data**:
- **Supabase edge runtime** — open egress, but **no JS engine** and no way past a
  Cloudflare challenge. Fine for JSON/CSV/ArcGIS APIs (that's how Waves 1–2 and DC
  work); useless against JS dashboards (CA, PA) and CF gates (ID).
- **This container** — has Chromium + Playwright pre-installed, but its egress is
  **proxy-blocked** to these portals (403 at the gateway). So a local headless
  scrape can't reach them either.

Building blind HTML scrapers against these portals would return empty results or,
worse, invite fabricated rows — which the ticket explicitly forbids ("do not claim
SRC for scraped HTML"; "rather than fabricating recipient rows"). So **zero
Wave-3 adapters were written.** This is a capability gap, not a coverage decision.

## What would unblock Wave 3

1. **A headless-browser scraping worker with open egress** (Playwright/Chromium in
   a service that CAN reach these hosts — a dedicated scraper box, a GitHub Action,
   or a browserless endpoint). It renders each dashboard, reads the table (or
   triggers the "export"), and hands clean rows to the existing `ingest-state-incentives`
   pipeline. This is the general solution and would cover CA/PA + most others.
2. **Per-portal export URLs / data endpoints, browser-discovered** (fastest for the
   big markets): e.g. the CalCompetes awardee export, the PA tracker's XHR data URL,
   WA DOR's actual disclosure data file. Hand me those and each becomes a Wave-1-style
   drop-in (probe → adapter → seed) in minutes, at the correct tier.
3. **Aggregate/program-level capture only** where recipient data is JS-locked — the
   ticket's documented fallback. Low value here: aggregate totals carry no county,
   so they resolve to no jurisdiction and write no INC-* attribute.

Confidence for any Wave-3 source, when it lands, is **INF** (0.60) — the migration
`0036` tiering already supports this, so a scraped source registers honestly below
the SRC primary-API feeds.

## Recommendation

Hold recipient-level Wave-3 ingest pending option 1 or 2. The confidence-tiering
groundwork (0036) and the multi-protocol engine are ready to receive these sources
the moment a fetch path exists. Meanwhile the two unblockable big markets — CA
(CalCompetes) and PA (Investment Tracker) — are the highest-value first targets if
export URLs can be supplied.
