# Wave 3 — CA CalCompetes headless-scrape run report

**CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 · FAR-341 · 2026-07-28**

First adapter on the Wave-3 headless-scraper harness (push endpoint + Playwright +
GitHub Actions, shipped in #47). Target: California Competes Tax Credit **Grant
Awardee List** — a JS-rendered Ninja Tables / FooTable widget on business.ca.gov
that the Supabase edge runtime cannot fetch (empty `<table>` server-side).

## How it runs

The Playwright runner (`scrapers/state-incentives`) executes in GitHub Actions (real
Chromium + open egress). Adapters are validated via `--mode dump/probe/test` (no
secrets, no DB writes) before any `push`. The extractor is driven off real rendered
output, never guessed selectors. Runs are triggered and read entirely through the
GitHub MCP tools (`actions_run_trigger` / `get_job_logs`).

## Key finding — go to the data source, not the pager

The rendered table client-paginates via FooTable and only ever holds ~10 rows in the
DOM, so scraping `<tbody>` + clicking "next" was both slow and **lossy** (an early
iteration truncated at 23 rows for the wrong reason — a stalled AJAX page-swap
tripping the first-row-no-change guard). The fix was to stop scraping the rendered
table and call the plugin's own data endpoint:

- Ninja Tables serves the **entire** dataset from one WordPress AJAX call —
  `POST https://business.ca.gov/wp-admin/admin-ajax.php`,
  `action=wp_ajax_ninja_tables_public_action&table_id=73522&target_action=get-all-data`.
- The adapter issues that request **from inside the page context** (`page.evaluate` →
  same-origin `fetch`, carries the page cookies), so one request returns every
  awardee as JSON. FooTable pagination is kept only as a fallback.
- Row-object column keys are author-set slugs discovered at runtime and matched by
  pattern, so a column rename can't silently break the mapping.

## Scope — 23 rows is the *complete* published set (not a truncation)

`--mode probe` enumerated every Ninja Tables widget on the page and each one's true
`get-all-data` count:

```
tableIds: ["73522"]
tables:   [{ id: "73522", ok: true, count: 23 }]
```

There is exactly **one** widget, with **23 rows** — the recent CalCompetes awardee
set (2022–2023 rounds; each row links a per-recipient PDF grant agreement). 23 is the
real, full contents of this page, not a pagination artifact.

The **full historical CCTC awardee database** (thousands of awardees since 2014) is
**not** on this page and **not** available as a clean API:

- data.ca.gov (CKAN) `package_search?q=calcompetes` → **0** results; `q=california
  competes` / `q=go-biz` / `q=tax credit awardee` return only unrelated datasets
  (Franchise Tax Board aggregate tables, CalOSBA inquiries, DWR/CDPH data). Probed
  server-side via `pg_net` (2026-07-28).
- So the historical set would be a separate source (bulk file / FOIA → Wave 4). This
  adapter captures what CA publishes machine-readably today: the 23 recent recipients.

## Extracted shape (validated in `--mode test`, 23/23 rows)

Per recipient: `recipient_name`, `place_name`, `award_value_usd` (the **Amount of Tax
Credit** column — the incentive), `term_start` (Date Agreement Approved), plus
`raw.{industry, net_new_ft, investments, amount_recaptured}`. Spot-checks:

| recipient | place | credit (award_value_usd) | approved |
|---|---|--:|---|
| Snapchat, Inc. | Palo Alto / SF / Santa Monica | (see note) | 2023-11-16 |
| Humane, Inc. | San Francisco | — | 2023-11-16 |
| Tynergy LLC* | Fresno | $15,000,000 | 2023-11-16 |
| Infinera Corporation | San Jose & Sunnyvale | $14,000,000 | 2023-11-16 |

> The credit-amount column key is `amountoftaxcredit`; the first mapping pass missed
> it (all `award_value_usd` came back null) because the grant-amount regexes didn't
> match that slug. Fixed by matching tax-credit patterns first — and never letting a
> bare `/amount/` snag `amountrecaptured`. Post-fix, credit values populate.

## Confidence — INF, not SRC

`ca_calcompetes` is registered (migration 0037) `confidence_cap='INF'`,
`source_level='primary'` → scored **INF / 0.60** by `fn_state_incentives_resolve_and_
score` (fn 0036). It is a first-party GO-Biz disclosure, but **captured by a headless
render rather than a clean API**, so it never scores SRC. No fabrication: `county_name`
is left **null** (locations are city-level and often multi-city), so — exactly like OK
— rows land but write **no INC-\* attribute** until a city→county resolver exists.
That resolver, and the historical CCTC bulk set, are the documented CA follow-ups.

## Status

- Extractor **validated end-to-end in `test` mode** (23/23 rows, all fields correct).
  No production write yet.
- The `push` run (extract + POST to `ingest-state-incentives-push`) lands the 23 rows
  and calls resolve/score. The workflow now defaults the public `SUPABASE_FUNCTIONS_
  URL`, and the fn is `verify_jwt=false` with an unset ingest secret, so `push` needs
  **no** hand-set secret. Held for go-ahead (consistent with the Wave 1–2 seed gate).
