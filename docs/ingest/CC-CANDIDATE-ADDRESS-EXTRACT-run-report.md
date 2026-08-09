# CC-CANDIDATE-ADDRESS-EXTRACT-1.0 — run report

**Date:** 2026-08-09 · **Project:** `ycadmmngkdhvpcsrcuaq` · **Table:** `public.dc_candidate_facilities`
**Migrations:** `0053` (DDL) · `0054` (backfill) · `0055` (country alias top-up) — **all applied to prod**

Promotes street-address data already held in `raw` into typed columns and normalizes
`country_code`. **No new facts, no external API, zero spend.**

---

## Result

| Column | Filled | Notes |
|---|---:|---|
| `street_address` | 16,275 / 19,151 (85.0%) | |
| `postal_code` | 7,659 | 6,912 from `raw.zip` + 747 from strict US tails |
| `country_iso2` | 18,670 | 152 distinct countries; 220 unresolvable left NULL |
| `address_basis` | 19,138 | every written row carries a stamp |
| `city` | 10,377 → **12,462** | +2,085, NULL-only fills |
| `subdivision_code` | 7,334 → **9,419** | +2,085, NULL-only fills |

**Geo columns untouched, proven:** an `md5` fingerprint over
`(latitude, longitude, geo_precision, geo_basis)` for all 19,151 rows is
`405a6c79818a61fdf660db6eb7d3ac34` **before and after**. `latitude`/`longitude`
remain at 6,122; `geo_precision` at 6,122 municipality / 13,029 none.

**Idempotent:** re-running the two order-sensitive statements changed **0 rows**.

**Advisors:** the only finding on this table is the pre-existing
`rls_enabled_no_policy` INFO (deny-all posture). No tables or functions were
added, so no new lint classes.

## `address_basis` vocabulary

| Basis | Rows | Writes |
|---|---:|---|
| `atlas_presplit` | 9,329 | street + postal |
| `atlas_freetext` | 4,796 | street only |
| `country_only` | 2,847 | country only |
| `atlas_freetext_us` | 2,085 | street + city + subdivision + postal |
| `atlas_freetext_unsegmented` | 65 | street only, low confidence |
| *(none)* | 29 | no address, no resolvable country |

---

## ⚠️ Findings that outlive this pass

**1. `raw.street` is TRUNCATED on ~64% of shape-A rows — `atlas_presplit` is lossy
by construction.** The upstream tokenizer under-consumes the street line and takes
the next single token as the city:

| `raw.address` | `raw.street` | `raw.city` |
|---|---|---|
| `7400 Infantry Ridge Road VA 20109 Manassas United States` | `7400 Infantry Ridge` | `Road` |
| `Av. …Kubitscheck, 1830 1º Andar 04543-900 São Paulo Brazil` | `Av. …1º Andar` | `São` |
| `Oslo Norway +47 400 04 100` | `Oslo Norway +47 400 04` | `100` |

Only 3,347 / 9,329 round-trip. `raw.street` **is** a literal prefix of `raw.address`
on 9,328/9,329 rows, so promoting it fabricates nothing — but **do not treat an
`atlas_presplit` street as complete.**

**2. The corrupt values are already in the typed `city` column** — it is a
byte-identical copy of `raw.city` for all 9,336 shape-A rows. Per Myke's decision
(2026-08-09) they were **left in place**: 297 city values start with a digit or `+`,
36 are domain names, 196 are bare street words (`Road`, `Avenue`, `Park`).
**Repair is an enrichment follow-up, not a repair pass.**

**3. `subdivision_code` has the same disease, independently.** 360 distinct
`dc:atlas` values mixing ISO codes (`AL`), full names (`Alabama`), provinces
(`Alberta`) and **city names** (`Abilene`, `Akron`, `Albany`, `Ann Arbor`). Only
1,409 of 6,286 are code-shaped. Untouched where non-NULL.

**4. Shape B must be parsed RIGHT-TO-LEFT.** Segment 1 is not always the street:
`Historic District, 11680 Hayden Road, Manassas, VA, USA` puts a district first, so
positional left-to-right parsing writes a STREET into `city`. Anchoring on the
country and walking backwards lands `Manassas`/`VA` correctly. 18/18 hand-checked.

**5. `sc:servercountry` (1,048 rows) carries no street data at all** — city/county/
state only, all populated, `country_code` all `US`. It contributes zero street
addresses; it only receives `country_iso2`.

**6. Non-ASCII ≠ junk.** `0054` filtered the country vocabulary to ASCII and
wrongly binned `Canadá`, `México`, `España`, `Türkiye`, `Côte d'Ivoire`, `Россия`,
`香港` as unmappable. `0055` recovered 264 rows. If this map is ever extended,
enumerate the **full** vocabulary, not an ASCII sample.

**7. `raw.city_coords` is an unpromoted municipality-precision `[lat,lon]` array on
9,303 rows.** Deliberately not touched — promoting it is a geocoding decision with
its own precision contract, not part of this extraction.

## Open follow-ups

- Repair corrupt `city` / `subdivision_code` via another enrichment route (Myke).
- Non-US postal codes are not extracted from shape-B free text (US-only pattern).
- The 220 unresolvable `country_code` values remain as junk in the source column.
