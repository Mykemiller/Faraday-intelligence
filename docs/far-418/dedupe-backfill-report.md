# FAR-418 §4 — dedupe backfill report

**CC:** CC-BOUNDSTONE-INGEST-1.1 §4 · **Measured:** 2026-08-06 against project
`ycadmmngkdhvpcsrcuaq`. **Rows deleted: 0.** Deleting historical duplicates changes
counts, and counts are Myke's — a separate, gated decision (§12).

## The measurement

Trailing 90 days, `public.artifacts`:

| Metric | Value |
|---|---|
| Rows | 334,029 |
| Distinct `source_url` | 278,464 |
| Distinct canonicalized URL | 278,358 |
| **Excess rows under the new `(crawler_id, raw_hash)` key** | **52,126 (15.6%)** |
| Excess rows under `(crawler_id, source_url)` alone | 52,077 |
| Largest single duplicate group | 67 copies |
| Longest duplicate span | 89 days |

## The finding that changes the fix

§0 diagnoses the cause as "`content_hash` is computed downstream of enrichment, over LLM
summary text that re-words itself on every run". **That is not what the code does.**
`source-poller` computes `content_hash = sha256(source_key | link)` at fetch time, and
`enrich-artifacts` never writes `content_hash` at all. The hash was already stable.

The actual mechanism is in the key's *shape*, not its timing:

> **`source_key` is IN the dedupe key.** So the same document arriving through 20
> different discovery lanes produces 20 different hashes and 20 artifact rows, and no
> amount of hashing earlier fixes that.

Measured: of 31,922 duplicated URLs in the trailing 30 days, **30,681 span multiple
`source_key`s** and only 2,978 span multiple `crawler_id`s. This is a fleet of ~10,027
query lanes all finding the same press release, not one lane re-emitting.

That is why the CC's own remedy — scoping the unique index to `(crawler_id, raw_hash)`
with `source_key` **absent** — is right, and it is the single change that recovers the
52,126 rows. The diagnosis in §0 was wrong about the mechanism and right about the cure.

## What `raw_hash` actually hashes, and why that deviates from §4.2

§4.2 specifies `sha256(normalize(fetched_bytes))`. That assumes the poller fetches each
item's document. **It does not** — it fetches a feed or an index page and extracts links,
so "the fetched bytes" is one body shared by up to 50 items. Hashing it would give every
item on a page the same hash and collapse a whole feed into one row.

Implemented instead:

- **`raw_hash = sha256("url:" + canonical_url)`** when the item has a link. The canonical
  URL *is* the document's identity, and it is what collapses the cross-lane duplication.
- **`raw_hash = sha256("txt:" + normalizeDocument(title + summary))`** when it does not.
  Without this fallback every link-less item on a source would collapse onto the feed URL.

`normalizeDocument()` — the §4.2 stripper — is still used, in the two places that
genuinely hold a document: the fallback above, and the classifier's Gate 2 fetcher.

## Canonicalization is correct and, in this corpus, marginal

Canonicalization (§4.1: lowercase host, strip `utm_*`/`_sp`/`fbclid`/`gclid`/`mc_cid`/
`mc_eid`, strip fragment and trailing slash, resolve one redirect-wrapper hop) merges
only **106 additional URLs** across 90 days — 52,126 vs 52,077 excess rows, a difference
of 49.

Stated plainly so nobody reads the 15.6% as a canonicalization win: **the key change does
essentially all the work today.** Canonicalization is retained because it is cheap, it is
correct, and it protects the *citation-matching* path — a wrapper URL will never match the
canonical URL a human cites, so a correction filed against one would miss the other. Its
value is in matching, not in volume.

## Where the long-tail duplication actually lives

| crawler_id | dup groups | excess rows | worst | max span |
|---|---|---|---|---|
| `source-poller_v1.3` | 27,868 | 39,258 | 67 | 15 days |
| `source-poller_v1.4` | 1,077 | 1,311 | 10 | 4 days |
| `AUTO-002_v1.0` | 58 | 302 | 47 | 33 days |
| `AUTO-031_v1.0` | 24 | 175 | 36 | 57 days |
| `AUTO-013_v1.0` | 21 | 168 | 28 | 77 days |
| `AUTO-038_v1.0` | 17 | 168 | 33 | 67 days |
| `AUTO-028_v1.0` | 24 | 161 | 35 | 89 days |

The poller's duplication is wide and short-lived (many lanes, one day). The `AUTO-0xx`
sub-domain crawlers' duplication is narrow and *long*-lived — 28 to 47 copies of one
document spread over 33 to 89 days. That second pattern is Appendix A.1 item 2 exactly,
and it is what §4.4's `published_at` gate addresses.

## Repo drift found while doing this

**The checkout is behind production for edge functions.** `source-poller` was at v1.3 in
git while production ran **v1.4** (CC-INGEST-METADATA-EXTRACTION-1.0's canonical envelope
keys); `enrich-artifacts` was at v2.1 in git while production ran **v2.2**
(CC-FAR-OPS-RESTORE-1.1). Editing the checked-out files would have silently reverted both.

Both branches are rebased on the **deployed** source, with the missing work restored
verbatim, and this branch's versions become `source-poller_v1.5` / `AUTO-030_v2.3`.
`v1.4` was not reused — production has already logged 30,467 artifacts under that id and
reusing it would make two different functions indistinguishable in the health log.

This is the same class of problem the boundstone README documents ("the site's source was
never committed"). Worth its own CC.

## Running the backfill

`scripts/far418-dedupe-backfill.mjs` computes both columns, reports duplicates, and
**writes nothing by default**. Applying requires `--apply` *and*
`FAR418_BACKFILL_CONFIRM=1`, because writing ~334k production rows is a production write
this CC does not authorize.

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/far418-dedupe-backfill.mjs --days 90
```

It imports the canonicalizer from the poller's own module rather than reimplementing it:
a backfill that canonicalizes differently from the live poller produces hashes that never
match new rows, which is worse than no backfill.

## Migration note

`0030` creates the unique index **without** `CONCURRENTLY`, deliberately: `CONCURRENTLY`
cannot run inside a transaction block and every Supabase migration is one. It costs
nothing here — `raw_hash` is added in the same file, so the *partial* index
(`where raw_hash is not null`) indexes zero rows at creation and builds instantly. If the
column is ever populated before the index exists, reissue it by hand outside a migration.
