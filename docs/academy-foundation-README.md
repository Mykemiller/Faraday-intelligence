# Faraday Academy — Foundation buildout (FAR-154 / FAR-156 / FAR-149)

This branch (`feat/academy-foundation`) stands up the Faraday Academy production
foundation across three stories.

## FAR-154 — LearnWorlds school configuration
- **Deliverable:** [`docs/learnworlds-configuration-checklist.md`](./learnworlds-configuration-checklist.md)
- A step-by-step checklist Myke runs in the LearnWorlds dashboard (Claude has no
  LW UI access). Covers custom domain `academy.faraday-intelligence.ai`, the brand
  kit (forest/gold/cream/sage/white + IBM Plex Serif / Bricolage Grotesque / IBM
  Plex Mono), white-label email `academy@faraday-intelligence.ai`, the four
  tier-mapped learner groups (Free / Signal / Core / Premier), and SSO + webhook
  placeholders. Each item has a **Verify** line.

## FAR-156 — Gutenberg (Notion → LearnWorlds publish pipeline)
- **Deliverable:** [`scripts/gutenberg.ts`](../scripts/gutenberg.ts) · env template
  [`scripts/.env.example`](../scripts/.env.example) · sample run
  [`docs/far-156-gutenberg-sample-dryrun.txt`](./far-156-gutenberg-sample-dryrun.txt)
- Reads a Notion course page, extracts its section/module tree, maps it to a
  LearnWorlds course payload (**sections → units → drip schedule**), and publishes
  via the LearnWorlds Admin API.
- **Dry-run is the default.** `--publish` is required to mutate LearnWorlds, and
  it refuses to run without `LW_API_KEY` + `LW_SCHOOL_ID`.
- **Idempotent:** upsert is keyed on the course's external id (the `FA-###-##`
  code parsed from the title, falling back to the Notion page id). Re-running the
  same page updates the existing course rather than duplicating it.
- **Error handling:** a page with no extractable sections raises a
  `GutenbergError` (exit 2) instead of publishing an empty shell.

```bash
# dry-run (default) — prints the payload, no network writes to LearnWorlds
npx tsx scripts/gutenberg.ts <notion-page-id>
npx tsx scripts/gutenberg.ts <notion-page-id> --json          # machine-readable
node --experimental-strip-types scripts/gutenberg.ts <id>     # no tsx needed (Node 22+)

# publish (creates or updates the course in LearnWorlds)
npx tsx scripts/gutenberg.ts <notion-page-id> --publish
```

The pure functions (`extractSections`, `buildPayload`, `parseCourseCode`,
`slugify`) are exported for unit testing.

## FAR-149 — Re-tag 36 baseline courses to the IDF 4.0 8-field schema
- **Deliverable:** [`docs/far-149-idf4-course-retag-manifest.csv`](./far-149-idf4-course-retag-manifest.csv)
  (36 rows) + the live tags written to the **Course Production — Faraday Academy**
  Notion database.
- The 36 D1–D9 Tower courses (4 levels × 9 domains) were tagged as **Notion
  properties** on rows in the Course Production database (Sprint = `Re-tag`). Five
  columns were added to that database to complete the 8-field schema:
  `Tower Name`, `Audience Personas`, `Difficulty`, `Format`,
  `Certification Eligible`. The existing standalone course pages were **not**
  edited (content/status untouched — properties only).

### 8-field schema → how each field was derived
All IDs are grounded in the **IDF 4.0 Master Registry**
(`37189a0c-1680-8199-bca1-cf304a45bbde`).

| Field | Source of truth |
|---|---|
| `domain_id` (D1–D9) | The course's Tower (FA-…-0N → D N). |
| `sub_domain_ids[]` | Course content mapped to IDF 4.0 Sub-Domains; 101s default to the Tower's foundational sub-domain, deeper levels add the specific sub-domains the modules cover. |
| `theme_ids[]` | Union of the Theme tags carried by the assigned Sub-Domains in the IDF 4.0 Sub-Domain Registry. (D8.2 "All" collapsed to its dominant T-004.) |
| `tower_name` | IDF 4.0 Domain Registry display name for D1–D9. |
| `audience_personas[]` | Derived from each course's stated audience language in the catalog (Exec / Engineer / Investor / Operator / Policy / Consultant). |
| `difficulty` | 101 → Foundational · 201/301 → Practitioner · 401 → Expert (3-bucket collapse of the 101→401 ladder). |
| `format` | 101 → Video · 201 → Interactive · 301/401 → Workshop (from each course's delivery Format). |
| `certification_eligible` | `true` for 301 + 401 (Academy: certifications are tied to the 301/401 levels), `false` for 101/201. |

Pricing (`$4.99` for 101, `$9.99` otherwise) and `Access Layer = Purchased` were
also set per the Curriculum 4.0 commercial rules (AC-008 / AC-003) as a
convenience; these are properties, not content.

> **Governance:** re-tagging is metadata only. No course was published, and no
> course content, title, or IDF status was changed (always-human carve-out).
> The CSV is for Myke's review/approval.

## Open Myke actions
1. Run the LearnWorlds configuration checklist in the LW dashboard (FAR-154).
2. Add `LW_API_KEY` and `LW_SCHOOL_ID` to the Vercel/project env (FAR-156).
3. Review the 36-course tagging CSV and approve (FAR-149).
4. Review + merge this PR.
