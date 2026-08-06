# FAR-418 §7 — source expansion report

**CC:** CC-BOUNDSTONE-INGEST-1.1 §7 · **Measured:** 2026-08-06, project
`ycadmmngkdhvpcsrcuaq`. Migration `0031_far418_source_expansion.sql` is **UN-APPLIED**.
Nothing below is activated: every row lands `status='registered'`, and only
`source-poller verify` may activate one, and only if its feed actually resolved.

## Rows added by class

| Class | Before | After | Added | Notes |
|---|---|---|---|---|
| Governors `gov:*` | **0** | 51 | +51 | Not one governor was monitored. This is why a state executive directive halting approvals could reach nobody. |
| Commissions `puc:*` (state rows) | 25 | 51 | +26 | 25 missing states + DC. `puc:dockets` (the pilot) is separate and unchanged in count. |
| Market operators `iso:*` | 3 | 10+ | +7 notices lanes | All 3 existing rows are generation-queue **data products**. Zero notices lanes existed. |
| Utilities `util:*` | 0 | 0 | **0 — blocked, see below** | |

Plus two corrections applied to existing rows:

- **Decision 4 licence clearance** on every `puc:*` and `iso:*` row. `puc:dockets` moves
  `unreviewed → cleared`; the three ISO queue rows move `unreviewed → cleared`.
- **Error clearance** on `puc:*` rows in `error` (3 at time of writing: `puc:mn`,
  `puc:oh`, `puc:wi`) so the class gets one clean verify pass. Failures after that are
  real and will be reported by the §8 monitor.

## URL provenance — read this before treating the count as coverage

`fetch_config.url_provenance` records how each endpoint was obtained:

| Provenance | Rows | Meaning |
|---|---|---|
| `pattern` | 51 governors, 7 ISO notices | Derived from the dominant naming convention. **Not probed.** |
| `unresolved` | 26 new commissions | No URL at all. Registered so the gap is *counted*. |
| *(existing)* | 25 commissions, 3 ISO queues | Already in the registry. |

The 26 new commission rows carry a **NULL url on purpose**. A null URL cannot be probed
and cannot be activated, which is the correct behaviour — registering a *guessed*
commission portal that happens to resolve to something else is worse than registering
none. What the row buys is that 26 unwatched jurisdictions now appear in the §8 coverage
block as registered-but-not-producing, instead of being invisible. Twenty-five
unregistered states read as quiet states; that is the whole finding in §0.

**§11's "each with a recorded verify-probe result" is NOT satisfied and cannot be by this
CC.** Recording a probe result requires running `source-poller verify`, which activates
sources and writes production data — both outside §2. The probe is the first step of
promotion:

```bash
# after 0031 is applied, per class, before anything is trusted:
curl -sX POST "$FN/source-poller" -H "authorization: Bearer $TOKEN" \
  -d '{"mode":"verify","limit":60}'
```

Expect governor rows to fail at a meaningful rate on the first pass. That is the design
working: a URL we could not confirm fails loudly into `status='error'` and appears in the
next morning's staleness email, rather than sitting in the registry looking like coverage.

## Portal families (§7.2)

Adapters are written **per family**, and states are mapped onto them. Five bespoke
adapters cover the great majority of 51; fifty-one bespoke scrapers would cover about six
before anyone tired. Detection is by URL shape (`scripts/far418-rosters.mjs`
`PORTAL_FAMILIES`), so a state that migrates portals re-classifies itself with no code
change.

Family → state mapping for the 25 commissions whose portal URL is known today:

Computed by `portalFamily()` over the 25 known portal URLs, not asserted by hand:

| Family | n | States |
|---|---|---|
| `static_index` | 20 | AL, AZ, FL, GA, IL, IN, LA, MD, MN, MO, NJ, NV, OH, OR, TN, TX, UT, VA, WA, WI |
| `oracle_apex` | 2 | CA, CO |
| `aspnet_webforms` | 2 | NC, NY |
| `salesforce_experience` | 1 | MI |
| `custom_rest` | 0 | — |

**`static_index` is the fallback bucket and must not be read as "20 states solved."** It
is what `portalFamily()` returns when nothing else matched, and several of those 20 are
search *forms* that need a POST with parameters, not an index that can be read. The honest
position: **three families are confirmed distinct (Oracle APEX, ASP.NET WebForms,
Salesforce Experience Cloud) covering 5 states; `custom_rest` has zero members so far; and
20 states plus the 26 unresolved jurisdictions are unclassified.** No sixth family is
named because the evidence for one does not yet exist — which is itself the argument for
resolving the 26 URLs before writing any adapter.

Query terms are applied uniformly to every commission — `data center`, `large load`,
`interconnection`, `load interconnection`. No state's own tariff name is hardcoded; a term
list that grows a special case per state is a tuning surface (§6.7).

## §7.4 utilities — Phase 1 is BLOCKED, and not on scope

The roster is real and available. `eia_utility_territories` (report_year 2024) holds:

| ownership_type | distinct utility_ids |
|---|---|
| *(null)* | 1,687 |
| COOP | 548 |
| MUNI | 455 |
| **IOU** | **145** |
| POLITICAL_SUBDIVISION | 56 |
| STATE | 9 |
| FEDERAL | 5 |

So the CC's "~180 IOUs" is **145** measured — and separately, 1,687 utility_ids carry a
NULL `ownership_type` and cannot be classified from this table at all, which is a larger
coverage question than the 35-row delta.

**What is missing is the one thing a source row cannot do without: the utility's own
domain.** There is no domain for any of the 145 anywhere in the stack — joining the IOU
roster to `public.companies.website_url` on normalized name matches **0 of 145**. Every
available route to a URL here is a guess, and a guessed utility domain that happens to
resolve is worse than no row.

Phase 1 is therefore reported as blocked on a **domain-resolution pass** (145 lookups,
cheap but not free, and it needs a source of record) rather than seeded with invented
endpoints. Phase 2 (co-ops and municipals intersecting a county that already holds a
Boundstone record) was spec'd, not built, by the CC itself.

Note also §7.4's own rule, which is honoured: utility domains are **not** added to
`boundstone.allowed_source_domains`. A utility press release is discovery; the citable
record is the commission docket.

## Registry hygiene (§7.6)

**2,887 of 10,746 rows are in `error` (26.9%).** Not this CC's job to fix, but §8 now
makes the number visible every morning. Top error clusters by key prefix:

| Prefix | rows | in error | share of all errors |
|---|---|---|---|
| `gsearch:` | 10,027 | 2,638 | 91.4% |
| `feed:` | 578 | 237 | 8.2% |
| `agenda:` | 22 | 9 | 0.3% |
| `puc:` | 26 | 3 | 0.1% |

The error population is overwhelmingly the Google-News query fleet, which is discovery
and never countable. That matters for how the next CC should read the 26.9%: it is not
26.9% of *sources* failing, it is a quarter of a large disposable query fleet failing. The
`agenda:` and `puc:` failures are small in count and far more consequential per row.

## Deliberate non-goals

- No source is activated.
- No `display_allowed=true` on any third-party value.
- No AUTO- id self-assigned; proposals are in the PR body.
