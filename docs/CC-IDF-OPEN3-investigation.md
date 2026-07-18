# CC-IDF-OPEN3 — Investigation & Remediation Report

**Date:** 2026-07-18 · **Scope:** the three open items on the IDF 4.0 Coverage Matrix & Bridge page (Notion `38889a0c-1680-81d5-83e8-d02f1cc3b12a`) · **Mode:** investigate & recommend only — no production writes performed.

Sources inspected: Airtable Automation Registry (`appxfti7VuoHYUeu6` / `tbl1ef6FgxUc3Uevg`, 187 rows) and IDF Sub-Domain Registry (`tbla7rtRY9AaeoWhu`, 61 rows); IDF 4.0 canon (Notion `37189a0c-1680-8199-bca1-cf304a45bbde`); Supabase project `ycadmmngkdhvpcsrcuaq` (`faraday_domains`, `faraday_subdomains`, migration history); deployed `faraday-crawl` edge function v10 incl. its bundled `coverage-bridge.ts`; Industry Conferences table (`tblb1S5IKFBPEmUJL`).

---

## Item 1 — Stale IDF 3.x domain tags on AUTO-028…032

### Root cause

`IFS Domains` (**field `fldhu5bKICVhzh8wb`**) is **neither a manual field, a lookup, nor a formula — it is an Airtable `aiText` (AI-generated) field.** Its config references three input fields:

| referenced field | id | type |
|---|---|---|
| Auto Name | `fldMo8drJopsNm6wB` | singleLineText |
| Auto ID | `fldUqqRnGeOQzyr7j` | singleLineText |
| Category | `fldZMOESvUUK7sSO3` | multilineText |

The D-tags the AI emits are simply extracted from the **Category** free-text field, whose trailing segment still carries the IDF **3.x** tags (e.g. AUTO-028 Category = `Intelligence Crawl | Sprint 2 | web_news | D10, D6, D4`). So the stale value is *upstream of* the AI field: editing the `IFS Domains` cell is impossible (aiText is not writable) and regenerating it without fixing Category would re-derive the same stale tags. Every `IFS Domains` value in the table is currently flagged `isStale: true` by Airtable itself.

Two corroborating facts:

- The deployed `faraday-crawl` v10 config already carries the **4.0** tags operationally (comment in source: *"4.0 tag fix (FAR-204, approved 2026-06-24): primary domain renumbered from the stale 3.x value … the Airtable IFS Domains aiText is derived/cosmetic"*). Artifacts are being written with correct 4.0 `ifs_domains`; only the Airtable annotation layer is stale.
- The aiText prompt itself is not readable via API (only `referencedFieldIds` are exposed); if the prompt names the 3.x taxonomy, it needs a one-time UI edit to reference IDF 4.0 (D1–D23).

### Proposed field-level fix (the source, not the cell)

Edit **Category (`fldZMOESvUUK7sSO3`)** on the 5 rows — replacing only the trailing domain segment, matching the already-deployed crawl config — then force-regenerate `IFS Domains` (Airtable UI). Expected before/after:

| Auto ID | record | Category (before) | Category (after) | IFS Domains after regen |
|---|---|---|---|---|
| AUTO-028 | `recEJu4kE4Zh0Q4TD` | `…web_news \| D10, D6, D4` | `…web_news \| D12, D6, D4` | `D12, D6, D4` |
| AUTO-029 | `recqSKjLVzRPQJ5hm` | `…regulatory \| D11, D3` | `…regulatory \| D13, D3` | `D13, D3` |
| AUTO-030 | `reciKxw8SwSv9x8aU` | `…permit_utility, financial \| D12, D4, D5` | `… \| D14, D4, D5` | `D14, D4, D5` |
| AUTO-031 | `recA7E7OMyJrcPYIg` | `…web_news \| D13, D7, D3` | `…web_news \| D11, D7, D3` | `D11, D7, D3` |
| AUTO-032 | `recZRQhhqlRsLWRG2` | `…web_news \| D14, D5, D6` | `…web_news \| D17, D5, D6` | `D17, D5, D6` |

(Primary-domain remap per the approved mapping 028→D12 / 029→D13 / 030→D14 / 031→D11 / 032→D17; secondary tags are unchanged because D3/D4/D5/D6/D7 kept their numbers in 4.0 — this matches the live crawl config exactly.)

**Also recommended (durable fix):** review the aiText prompt in the UI and anchor it to IDF 4.0; longer-term, consider replacing aiText with a governed field (link to the IDF Domain Registry table or plain text mirrored from `faraday-crawl` config), since an AI-generated tag field will drift again on the next taxonomy rev. Note the staleness is registry-wide (e.g. AUTO-039 still says "All 16 Domains (D1–D16)") — the 5 rows above are just the Active-crawler subset in scope.

---

## Item 2 — AUTO-028/029 × Industry Conferences collision

### Inventory of conference references

- **Automation Registry rows AUTO-028/029:** clean. The task pointed at "Description field `fldk6NPtWxxhcH5Qi`" — that field ID is actually the **Status** single-select; the registry has **no Description field** (descriptive text lives in Category `fldZMOESvUUK7sSO3`). Neither row's Name/Category/linked feeds contain any conference reference.
- **Industry Conferences table (`tblb1S5IKFBPEmUJL`), Description `fld5IpTsjYfcntaik`:** 6 records (DCW POWER, DCW, OCP Summit, DCD>Connect NY, NVIDIA GTC, Yotta) — **all 6 already repointed**: each carries "AUTO-168 (D8.2 Conference Intelligence) primary target. \[repointed from AUTO-028 (+ AUTO-029) — FAR-204]".
- **`faraday-crawl` v10 config:** AUTO-028/029 query sets contain no conference queries (networking/interconnect and community-relations only). The only conference references are on the AUTO-168 definition.
- **`coverage-bridge.ts` (bundled in deployed v10):** defines **AUTO-168** = D8.2 Conference Intelligence & Speaking Circuit, mechanism `cowork`, weekly Fri 09:00 America/Chicago, writes `artifacts(synthesis; ifs_domains=['D8.2'])`, primary source = Industry Conferences table — currently **inert and explicitly "gated on AUTO-028/029 ID conflict resolution."**

### Repoint plan

**A D8.2 AUTO-ID already exists in the approved AUTO-137→175 block: `AUTO-168`** (Airtable `reciuRSrF86BsjmMh`, Status=Designed, note "Resolves the AUTO-028/029 conference-target ID collision"). No new assignment is needed. Remaining steps (pending go):

1. Declare the collision resolved on the Coverage Matrix page (all annotations already point at AUTO-168).
2. Remove the "gated on AUTO-028/029" note from `coverage-bridge.ts` on next deploy.
3. Build/schedule the AUTO-168 weekly cowork routine and flip it Designed→Active per the normal dry-run-first gate.

### ⚠ Adjacent finding — duplicate AUTO-137

Two registry rows share `AUTO-137`: `recA0MfRNVGMvmRJp` ("D7.1 Direct-to-Chip Liquid Cooling \[crawler]", Designed, 06-24 scaffold) and `recZcrT6vh9dkcqcX` ("Community Opposition Tracker — Municipal Agenda Monitor (D18.1)", **Active**, 07-05). The Notion 07-05 approval assigned the Opposition Tracker to AUTO-137, but `coverage-bridge.ts` says the reassigned Opposition Tracker is **AUTO-176** and that AUTO-137 belongs to the D7.1 scaffold. `mergeApproved` throws on duplicate auto_ids, so this will bite the next bridge merge. Needs an ID ruling (renumber the D7.1 scaffold, or renumber the tracker) — flagged for Myke, not fixed.

---

## Item 3 — IDF 4.0 registry sync gap

### (a) Airtable IDF Sub-Domain Registry (`tbla7rtRY9AaeoWhu`) vs canon

The Notion page's framing ("59 Coming-Soon rows w/o stable IDs") is **stale**. Actual state: **61 rows** (55 Active / 6 Candidate); the Lifecycle State select has **no "Coming Soon" choice**; and the table has **no D#.# ID field at all** — rows are identified by name only. Name-matching against the 116-entry canon:

- **59 / 61 rows** map to a canon sub-domain (many with minor name drift; the 6 Candidate rows = the D16 security six).
- **2 / 61 rows** don't match canon naming: "Behind-the-Meter Generation (BYOP/BYOG)" (≈ canon D2.2 "BTM Strategy & Cross-Cutting Economics") and "Jurisdiction Posture Intelligence (JPS)" (occupies canon D18.2's slot — see below). Both divergences also exist in Supabase, indicating a shared non-canon source (the JW-side reconciliation sync of 06-21).
- **57 canon codes have no Airtable row** (D1.4–D1.8, D2.2/D2.5–D2.10, D4.5–D4.6, D5.3–D5.4, D6.3, D7.4, D8.3–D8.5, D9.3–D9.4, D10.4–D10.5, D11.3–D11.6, D12.1–D12.7, D13.1–D13.5, D14.2–D14.7, D15.2–D15.6, D17.1–D17.3, D18.2–D18.3).

Remediation (Airtable side): add a `Sub-Domain ID` single-line field, backfill the 61 rows with their canon codes, insert the 57 missing rows (Lifecycle = Candidate), and normalize the drifted names — a scriptable batch once approved.

### (b) Supabase `faraday_domains` / `faraday_subdomains` vs canon

The "currently 16 / currently 4" figures are **outdated**: migrations `0007b_subdomains_fullseed` (06-24) and `backfill_faraday_subdomains_idf40_full_116` (07-02) already ran. Live state: **23 domains / 116 sub-domains, all active**. Row-by-row diff:

- `faraday_domains`: **23/23 exact match** on code + name. ✅
- `faraday_subdomains`: **116/116 codes present, per-domain counts exactly match canon.** 14 `display_name` deltas: 11 cosmetic (D1.2, D1.3, D10.2, D10.3, D11.2, D14.1, D15.1, D16.1, D21.1, D21.4, D23.4), 3 acceptable canon short-forms (D1.5, D5.2, D14.2), and **2 substantive**:
  - **D18.2** = "Jurisdiction Posture Intelligence (JPS)" vs canon "Regulatory & Permitting Denial Tracking" — a genuine ID conflict against canon's immutability rule; either restore canon and mint a new code for JPS (D18.4 proposed), or amend canon.
  - **D2.2** = "Behind-the-Meter Generation (BYOP/BYOG)" vs canon "BTM Strategy & Cross-Cutting Economics".

### (c) Draft migration

`supabase/migrations/0014_idf4_registry_sync_domains_subdomains.sql` — in this branch, **not applied**. Section 1: 11 idempotent cosmetic name alignments. Section 2: the two substantive fixes (D18.2, D2.2) clearly marked as requiring Myke's ruling, with the amend-canon alternative documented. Section 3: domains no-op.

---

## Myke actions — three go/no-go decisions

1. **Item 1 (stale 3.x tags): GO / NO-GO** on editing Category (`fldZMOESvUUK7sSO3`) on the 5 Active rows exactly per the before/after table above, then regenerating the `IFS Domains` aiText (and checking its prompt references IDF 4.0). Zero operational risk — the crawl config already runs on 4.0 tags; this only fixes the Airtable annotation layer.
2. **Item 2 (conference collision): GO / NO-GO** on declaring the collision resolved as AUTO-168 (already annotated everywhere), removing the gate note from `coverage-bridge.ts`, and building/activating the AUTO-168 weekly D8.2 cowork routine. *(Separate mini-ruling requested: duplicate AUTO-137 — which row keeps the ID?)*
3. **Item 3 (registry sync): GO / NO-GO** on (a) applying the draft `0014` migration — including your ruling on D18.2 (restore canon + mint D18.4 for JPS, or amend canon) and D2.2 naming — and (b) the Airtable batch: add `Sub-Domain ID` field, backfill 61 rows, insert 57 missing Candidate rows. The Coverage Matrix page's "16/4" Supabase claim should be corrected regardless.
