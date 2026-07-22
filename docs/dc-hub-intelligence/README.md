# DC Hub Facility Intelligence — data-plane layer

**Status:** DRAFT / build (branch `claude/dc-hub-facility-info-oklq59`). Migration
un-applied, edge function un-deployed. Ships behind the deploy gates below.

## Why

DC Hub (`dchub.cloud`) is the live infrastructure data layer for AI agents —
21,000+ data-center facilities, 311 DCPI markets, 500k+ mapped power/grid/gas/fiber
assets, per-facility tenants, 1,400+ M&A deals, all cited and machine-readable
(CC-BY-4.0). Faraday's storefronts (Briefing Library, Jurisdiction Watch, …) want
the **physical footprint** behind the companies and themes they already track:
"for operator X, what facilities, how many MW, what fiber, what market verdict."

This layer makes that a **cached read-model in the shared data plane**, not a
hot-path call into DC Hub — the same architecture the Briefing Library uses for
its Airtable catalog (mirror → denormalize → storefront reads the cache).

## Architecture

```
 DC Hub REST (X-API-Key)  ──►  dc-hub-sync (edge fn, cron)  ──►  dc_facilities (cache)
                                       │                              │
                                  content_hash                  RLS: service write,
                                  skip-unchanged                 anon read (shareable cols)
                                       │                              │
                              operator → tracking_companies      dc_facilities_public (view)
                              (best-effort, misses logged)       + read RPCs
                                                                      │
                                              Briefing Library · Jurisdiction Watch · …
```

- **Read-model, never hot-path.** DC Hub is the SOR; `dc_facilities` is the
  denormalized mirror storefronts query. No storefront calls DC Hub directly.
- **Content-addressed.** Each row carries `content_hash` = SHA-256 of a salient-field
  fingerprint. An unchanged facility re-syncs to the same hash → upsert skipped.
  (Same precedent as the Briefing Library Gamma export + the `artifacts` dedupe.)
- **Attribution preserved.** DC Hub is CC-BY-4.0. Every readable row keeps
  `source_attribution = "DC Hub, dchub.cloud"` so surfaces can cite it. `raw` holds
  only the shareable projection — gated paid-tier fields are never persisted into
  this anon-readable table.
- **Operator linkage.** `operator` is resolved to `tracking_companies.company_id`
  by exact normalized-name match (`normalizeOperatorName`). Fuzzy matching is out
  of scope — a wrong link is worse than an unmapped miss; misses land in
  `dc_facility_unmapped_operators` for later editorial reconciliation (mirrors the
  briefing_library `unmapped_links` pattern).

## Objects

| Object | Kind | Notes |
|---|---|---|
| `dc_facilities` | table | Facility cache. RLS-on; service-role writes; column-level anon SELECT (excludes `raw`, `content_hash`). |
| `dc_facility_unmapped_operators` | table | Operator strings that didn't resolve to a tracked company. Service-role only. |
| `dc_facilities_public` | view | `security_invoker`, shareable projection. The storefront read surface. |
| `dc_facility_get(text)` | RPC | One facility by id/slug. |
| `dc_facilities_for_company(text)` | RPC | Facilities for a `tracking_companies.company_id` — the primary storefront join. |
| `dc_facilities_search(...)` | RPC | Faceted (country/market/status/min-MW), keyset-paginated on `(total_power_mw desc, facility_id desc)`. |
| `dc-hub-sync` | edge fn | `status` / `run` modes; source-poller auth + health-log posture. |

All migration DDL: `supabase/migrations/0016_dc_hub_facility_intel.sql`.

## Storefront consumption

Storefronts read the cache through their own Supabase client — the shared contract
is the RPC/view, not shared code. Example (any storefront):

```ts
// facilities for a tracked company (e.g. on a Briefing Library company page)
const { data } = await supabase.rpc("dc_facilities_for_company", { p_company_id: companyId });

// faceted, keyset-paginated shelf
const { data: page } = await supabase.rpc("dc_facilities_search", {
  p_country: "US", p_min_mw: 100, p_limit: 48,
  p_after_mw: cursor?.mw ?? null, p_after_id: cursor?.id ?? null,
});
```

`dc_facilities_public` exposes: identity/location, `total_power_mw` / `used_power_mw`
/ `headroom_mw`, cooling, `fiber_provider_count` / `fiber_carriers`, commission year,
`operational_status`, `dcpi_verdict` / `dcpi_market_rank`, `tenants`, and
`source_attribution`.

## Sync operation

`dc-hub-sync` (POST, `verify_jwt=false`; fcron house token or service-role auth):

- `{mode:"status"}` — row count + last run. No writes.
- `{mode:"run", limit?, offset?, country?, min_mw?}` — pull a page of DC Hub
  facilities, upsert changed rows (content-hash skip), resolve operators, write one
  `automation_health_log` row. Bounded by `WALL_BUDGET_MS`.

Env (Supabase function secrets): `DC_HUB_API_KEY` (Myke's account key),
`DC_HUB_API_BASE` (default `https://dchub.cloud/api/v1`), `DC_HUB_AUTO_ID`
(Registry-assigned), plus the standard `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
/ `CRON_TOKEN`.

## Deploy gates (nothing goes live without Myke)

| Gate | Unblocks | State |
|---|---|---|
| **DC Hub key** — `DC_HUB_API_KEY` = Myke's DC Hub **account** key set as a Supabase function secret | facility fetch (the free key minted in-session was discarded — wrong account) | ⏳ blocked |
| **REST shape validation** — confirm DC Hub `/facilities` field spelling against the live key; `normalizeFacility` is coded defensively but PROVISIONAL | correctness of the mirror | ⏳ |
| **Registry entry** — an AUTO id + crawler row in the Airtable Automation Registry (`DC_HUB_AUTO_ID` is a placeholder) | health-log attribution + fleet run | ⏳ |
| **Migration apply** — `0016_…` applied to `ycadmmngkdhvpcsrcuaq` | tables/RPCs exist | ⏳ (DRAFT, un-applied) |
| **Function deploy + cron** — `supabase functions deploy dc-hub-sync` + cron cadence | scheduled mirror | ⏳ |

## Tests

`test/dc-hub-sync.test.mjs` covers the pure module (`sync-pure.ts`): field mapping,
alternate spellings, status resolution, array coercion, operator normalization, and
fingerprint stability/sensitivity. Run: `npm test`.
