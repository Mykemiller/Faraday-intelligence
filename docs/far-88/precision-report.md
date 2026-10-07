# FDY-88 — local gov watch precision: v1 vs v2

Measured **live** against `news.google.com/rss/search` on **2026-10-07 14:50–14:58 CT**
(outbound network to Google News was reachable — HTTP 200, 131 KB on the probe).
Twenty jurisdictions: 10 places, 6 counties/parishes, 4 townships, including the
four the issue names (Redmond city OR, Klamath Falls city OR, Cobb County GA,
Allendale charter township MI).

Reproduce:

```
node scripts/check-local-watch-precision.mjs --live --save /tmp/far88-fixtures \
  --json docs/far-88/precision-report.json
# or re-measure offline from saved bodies, no network:
node scripts/check-local-watch-precision.mjs --fixtures /tmp/far88-fixtures \
  --json docs/far-88/precision-report.json
```

Raw feed bodies are **not committed** (2.5 MB for 40 feeds). `docs/far-88/precision-report.json`
holds every count plus sample titles; `--save` regenerates the bodies.

Metric: the share of returned items whose **title names the jurisdiction's base
name** (word-boundary, case-insensitive) — the same test the poller now records
as `crawl_metadata.attribution`. Google News RSS `<description>` is just the
headline plus the publisher, so "title" and "title or description" give the
identical number on every one of the 40 feeds.

## Totals

| | items returned | titles naming the jurisdiction | feeds pinned at the 100-item cap |
|---|---|---|---|
| **v1 (live today)** | 1,104 | 363 (**32.9 %**) | 7 / 20 |
| **v2 (this PR)** | 698 | 300 (**43.0 %**) | 2 / 20 |

v2 returns 37 % fewer items and a third more of them are about the right place.

## The four broken cases — the headline result

Every Oregon row had the state abbreviation `OR` read as the alternation
operator, so the jurisdiction term was one alternative among five:

| jurisdiction | v1 | v2 |
|---|---|---|
| Redmond city, OR | **0 / 100 (0 %)** | 10 / 38 (26.3 %) |
| Klamath Falls city, OR | **0 / 100 (0 %)** | 2 / 11 (18.2 %) |
| Bend city, OR | **0 / 100 (0 %)** | 17 / 42 (40.5 %) |
| Multnomah County, OR | **0 / 100 (0 %)** | 14 / 45 (31.1 %) |

Four feeds, 400 items, **not one of them naming its own jurisdiction**. v1 filled
them with *"Data center moratorium approved by Oakland"*, *"Google ordered to halt
work on two data centers in 'Texas of Europe'"*, *"Memphis City Council devolves
into chaos after data center moratorium vote"*. v2 returns
*"Redmond Council and Mayor Candidates Weigh in on Growth, Data Centers, Water at
Forum"* and *"Nine months in, Kotek's Data Center Advisory Committee shares many
questions, few answers — Redmond Spokesman"*.

Oregon is not alone in principle: `IN` (Indiana) is the same trap, and so is any
future `AND`. Spelling the state out and quoting it removes the class of bug, not
just the instance.

## Full table

| jurisdiction | v1 named/items | v2 named/items |
|---|---|---|
| Redmond city, OR | 0/100 (0 %) | 10/38 (26.3 %) |
| Klamath Falls city, OR | 0/100 (0 %) | 2/11 (18.2 %) |
| Acworth city, GA | 3/6 (50 %) | 1/11 (9.1 %) |
| Normal town, IL | 22/35 (62.9 %) | 24/76 (31.6 %) |
| Archbold village, OH | 6/9 (66.7 %) | 8/16 (50 %) |
| Forrest City city, AR | 0/0 (empty) | 2/4 (50 %) |
| Mableton city, GA | 8/9 (88.9 %) | 4/9 (44.4 %) |
| New Carlisle city, IN | 7/10 (70 %) | 18/46 (39.1 %) |
| Cedar Rapids city, IA | 41/51 (80.4 %) | 20/51 (39.2 %) |
| Bend city, OR | 0/100 (0 %) | 17/42 (40.5 %) |
| Cobb County, GA | 43/67 (64.2 %) | 18/35 (51.4 %) |
| Loudoun County, VA | 63/100 (63 %) | 54/100 (54 %) |
| Prince William County, VA | 53/100 (53 %) | 54/100 (54 %) |
| Assumption Parish, LA | 12/41 (29.3 %) | 0/0 (empty) |
| Multnomah County, OR | 0/100 (0 %) | 14/45 (31.1 %) |
| Hamilton County, IN | 45/70 (64.3 %) | 5/21 (23.8 %) |
| Allendale charter township, MI | 1/5 (20 %) | 1/5 (20 %) |
| Bloomfield township, MI | 4/53 (7.5 %) | 1/10 (10 %) |
| Saline township, MI | 36/100 (36 %) | 41/69 (59.4 %) |
| Howell township, NJ | 19/48 (39.6 %) | 6/9 (66.7 %) |

## Where v2 scores LOWER, and why that is not a regression

Nine of the twenty score lower. The number is real; the inference "v2 is worse
there" is not. Two things are going on, and both are worth stating plainly rather
than averaging away.

**1. The metric structurally under-counts v2.** A v2 query *requires* the
jurisdiction name as a search term, so every item it returns provably contains
that name in the article. An `unmatched` v2 item means the name is absent from
the ~90-character headline — not from the story. A v1 query had no such
requirement: an `unmatched` v1 item frequently does not mention the jurisdiction
*anywhere*.

**2. What the leftovers are has changed completely.** v1's misses were national;
v2's are the jurisdiction's own neighbours, in its own state, on its own subject:

| feed | v1 misses | v2 misses |
|---|---|---|
| Cedar Rapids city, IA | *Plans for combination Dunkin' and Baskin-Robbins fall through* | *Linn County passes data center moratorium* (Cedar Rapids **is in** Linn County) |
| Mableton city, GA | *Advocates question Georgia Power fuel rates* | *DeKalb County extends data center moratorium* |
| Acworth city, GA | *Man accused of trying to kidnap toddler from Walmart sues city* (KBTX, Texas) | *Commissioner extends data center ban* (The Daily Tribune News, Cartersville GA) |
| Hamilton County, IN | *How Greater Cincinnati is preparing for Ohio's data center boom* | *Boone County considering moratorium on data center development* (IBJ, Indiana) |

Residual v2 leakage has one identified cause: the quoted state name can match the
**publication's** name rather than the story. *"Protests erupt at Memphis City
Council meeting on data centers — Central Oregon Daily"* reached the Redmond, OR
feed that way. That is a far smaller and more tractable failure than v1's.

**3. v1 looked best exactly where it was least useful.** Cedar Rapids 80.4 % and
Mableton 88.9 % come from v1's degenerate parse: the phrase branch
`"Cedar Rapids city" IA data center` matches almost nothing, so the feed is
effectively `zoning OR moratorium OR rezoning` — and Google happens to rank
Iowa/Georgia outlets highly for an Iowa/Georgia-inferred query. The feed was
right by accident, with no term binding it to the jurisdiction. Those are the
same feeds that go to 0 % the moment the state abbreviation is `OR`.

## A measured alternative, if recall matters more than rate

Dropping the action group — name ∧ data-centre ∧ state, three parts — was
measured live on 2026-10-07 across 10 of the sample (the volume-sensitive ones):

| shape | items | titles naming the jurisdiction | rate |
|---|---|---|---|
| v1 | 489 | 244 | 49.9 % |
| v2 (this PR, 4 parts) | 287 | 154 | **53.7 %** |
| v3 (3 parts, no action group) | 565 | 238 | 42.1 % |

v2 has the best precision rate. v3 finds ~55 % more correctly-named items at a
~12-point lower rate (Cedar Rapids 20 → 47 named, Redmond 10 → 25, Assumption
Parish 0 → 3, which is the one feed v2 empties).

**This PR ships v2, the shape the issue specifies.** v3 is a one-line change to
`actionGroup()` plus a regenerated migration if Faraday would rather have the
recall; it belongs with the cadence/expansion work (L2/L6), not here.

## Politeness

Strictly serial, ≥ 1 request/second (1,100 ms floor), honest user agent —
`FaradayIntelligenceBot/1.0 (+https://faraday-intelligence.ai; data-source poller)`,
the same string the source-poller sends. 60 requests total across both runs. No
database was written and no migration was applied.
