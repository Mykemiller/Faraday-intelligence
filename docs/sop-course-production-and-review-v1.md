# SOP — Course Production & Review, v1

| Field | Value |
|---|---|
| **SOP ID** | FA-SOP-001 |
| **Version** | 1.0 (Draft — awaiting Myke approval) |
| **Owner** | Myke Miller (Founder / Editor-in-Chief) |
| **Status** | Draft for review — **not yet published to Notion** |
| **Effective date** | *TBD on approval* |
| **Last updated** | 2026-07-18 |
| **Applies to** | All Faraday Academy courses across the 9 Domain Towers (D1–D9) |

> **Purpose:** Standardize how every Faraday Academy course moves from a first
> draft to a live, purchasable course — so quality, IDF-schema fidelity, and the
> Faraday voice are consistent across all 9 Domain Towers, and **no course ever
> reaches learners without Myke's explicit sign-off.**

---

## 1. Purpose & scope

### In scope
This SOP governs the production lifecycle of a **single course** as it moves
through the four-stage pipeline:

**`Draft → Awaiting Review → Approved → Published`**

It covers the workflow, the roles and hand-offs (RACI), the mandatory sign-off
gate, and how both the SOP and the course artifacts are versioned. It applies
equally to all 36 baseline courses (4 levels × 9 Domain Towers) and to any new
course added later.

### Explicitly out of scope
- **Curriculum strategy** — which courses exist, pricing, and IDF 4.0 tagging
  (governed separately; see FAR-149 re-tag manifest and the Curriculum 4.0
  commercial rules). This SOP starts once a course *exists* as a Draft.
- **LearnWorlds school configuration** — domain, branding, groups, API setup
  (FAR-154 checklist). This SOP consumes that configuration; it does not change
  it.
- **The mechanics of the Notion→LearnWorlds publish tool** (`scripts/gutenberg.ts`,
  FAR-156). This SOP *invokes* Gutenberg at the Publish stage but does not
  document its internals.
- **Marketing, launch comms, and storefront placement** on the engine site
  (`v0-faraday-daily-challenge`).

---

## 2. Definitions — the pipeline stages

The course's **Status** property in the Course Production Notion database is the
single source of truth for where a course is. There are exactly four states:

| Stage | Meaning | System of record |
|---|---|---|
| **Draft** | Content is being authored or revised. Not ready for another set of eyes. | Notion course page |
| **Awaiting Review** | Author considers the course complete and IDF-compliant; it is queued for a reviewer. | Notion `Status` = *Awaiting Review* |
| **Approved** | Reviewer + Myke have signed off. The course is publish-eligible but not yet live. | Notion `Status` = *Approved* |
| **Published** | The course is live in LearnWorlds and purchasable by learners. | LearnWorlds (course = live) + Notion `Status` = *Published* |

**State transitions are one-directional in the happy path** but a course can be
sent *back* to Draft at any review point (see the Review and Sign-off steps). A
course may never skip a stage — in particular, **nothing goes from Draft or
Awaiting Review straight to Published.**

Roles referenced throughout:
- **Writer** — the person (or Claude session under human direction) authoring the
  course content in Notion.
- **Reviewer** — a second person/agent who checks quality, accuracy, and IDF
  schema fidelity. Must not be the same identity as the Writer for that course.
- **Myke** — Founder; holds the sole publish sign-off authority.

---

## 3. Workflow

Steps are grouped by the stage transition they drive. **Every approval gate is
in bold.** No step may be skipped.

### Stage A — Draft → Awaiting Review

1. **(Writer)** Author the course in its Notion course page: sections → modules,
   following the IDF 4.0 structure the course was tagged with (domain, sub-domain,
   themes, difficulty, format). Entry condition: the course row exists in the
   Course Production database with a `Draft` status.
2. **(Writer)** Self-check against the **Production Checklist** (Appendix A):
   learning objectives present, module tree complete, sources cited, Faraday
   voice, `FA-###-##` course code in the title, difficulty/format match the tag.
3. **(Writer)** Run the Gutenberg **dry-run** to confirm the page extracts to a
   valid LearnWorlds payload with no errors:
   `npx tsx scripts/gutenberg.ts <notion-page-id>` (no `--publish`). A page that
   raises a `GutenbergError` (no extractable sections) is **not** ready.
   *Exit artifact:* a clean dry-run payload.
4. **(Writer)** Set the Notion `Status` to **Awaiting Review** and assign a
   Reviewer. This is the hand-off. *Exit criteria for Stage A:* checklist passes
   and dry-run is clean.

### Stage B — Awaiting Review → Approved

5. **(Reviewer)** Review the course against the **Review Rubric** (Appendix B):
   factual accuracy, IDF 4.0 schema fidelity (domain/sub-domain/theme/difficulty/
   format/certification-eligibility all correct), pedagogical quality, voice, and
   a fresh Gutenberg dry-run.
6. **(Reviewer)** Record the outcome as a review note on the Notion page:
   - **Changes requested** → set `Status` back to **Draft**, hand back to Writer.
     Return to step 1. (This loop may repeat.)
   - **Recommend approve** → leave `Status` at *Awaiting Review* and flag for
     Myke's sign-off. The reviewer does **not** move the course to Approved.
7. **(Myke) — MANDATORY SIGN-OFF GATE.** Myke reviews the reviewer's
   recommendation and the course. **Only Myke may move a course to `Approved`.**
   - **Approve** → Myke sets `Status` = **Approved** and records the sign-off
     (dated note / approver initials on the Notion page).
   - **Reject / needs work** → `Status` back to **Draft**; return to step 1.
   *Exit criteria for Stage B:* Myke's recorded approval exists on the page.

### Stage C — Approved → Published

8. **(Writer or Reviewer)** Confirm the course is still in `Approved` and that no
   content has changed since sign-off. **If the content changed after Myke's
   sign-off, the approval is void** — return to Stage B for re-review and
   re-sign-off. (Sign-off applies to the exact reviewed version, not the page in
   perpetuity.)
9. **(Myke, or a delegate with Myke's explicit per-course go-ahead)** Publish via
   Gutenberg: `npx tsx scripts/gutenberg.ts <notion-page-id> --publish`. Publishing
   is idempotent (keyed on the `FA-###-##` code) so re-runs update rather than
   duplicate. **A publish must never be run on a course that is not in `Approved`
   with a recorded Myke sign-off.**
10. **(Publisher)** Verify the course is live and correct in LearnWorlds (title,
    sections, drip schedule, price, access layer). Set Notion `Status` =
    **Published** and record the publish date + LearnWorlds course id.
    *Exit criteria for Stage C:* course live in LearnWorlds and Notion reflects
    Published.

### Post-publish

11. **(Any role)** Substantive changes to a *published* course re-enter the
    pipeline at **Draft** (as a new version — see §6), go through review, and
    require a fresh Myke sign-off before re-publishing. Typo-level fixes may be
    fast-tracked but still require Myke's acknowledgement before republish.

---

## 4. RACI matrix

**R** = Responsible (does the work) · **A** = Accountable (owns the outcome —
exactly one per row) · **C** = Consulted (before) · **I** = Informed (after).

| # | Step | Writer | Reviewer | Myke |
|---|---|:---:|:---:|:---:|
| 1 | Author course content in Notion | **R/A** | I | I |
| 2 | Self-check against Production Checklist | **R/A** | — | — |
| 3 | Gutenberg dry-run (pre-review) | **R/A** | — | — |
| 4 | Move Draft → Awaiting Review, assign reviewer | **R/A** | I | I |
| 5 | Review against rubric | C | **R/A** | I |
| 6 | Record review outcome (changes / recommend) | I | **R/A** | C |
| 7 | **Sign-off gate: move → Approved** | I | C | **R/A** |
| 8 | Confirm no post-sign-off content drift | R | R | **A** |
| 9 | Publish via Gutenberg `--publish` | R | — | **A** |
| 10 | Verify live in LearnWorlds; set Published | **R/A** | I | I |
| 11 | Route post-publish changes back to Draft | R | C | **A** |

**Key accountability rules:**
- Step 7 (Approved) and step 9 (Publish) are **Accountable to Myke and only
  Myke.** No other role may be Accountable for either.
- The Reviewer for a course must be a different identity than its Writer.
- Every row has exactly one **A**.

---

## 5. Sign-off & guardrails (non-negotiable)

These controls exist so quality and brand integrity are protected. They are not
optional and cannot be waived by the Writer or Reviewer.

1. **No direct publish without Myke sign-off.** A course may only reach
   `Published` if it passed through `Approved`, and a course may only reach
   `Approved` via Myke's explicit, recorded sign-off (step 7). No path from
   `Draft` or `Awaiting Review` to `Published` exists.
2. **Sign-off binds to a version, not a page.** If content changes after Myke
   approves, the approval is void and the course returns to review (step 8/11).
3. **`--publish` is gated on `Approved` + recorded sign-off.** Running Gutenberg
   with `--publish` against any course not in that state is a process violation.
4. **Reviewer independence.** Writer ≠ Reviewer for the same course.
5. **Status is the source of truth.** The Notion `Status` property is
   authoritative for pipeline state; keep it accurate at every transition.
6. **Human-in-the-loop for live mutations.** Any agent (Claude included) may
   author, self-check, dry-run, and *recommend*, but the transition to `Approved`
   and the `--publish` action require a human with Myke's authority.

---

## 6. Version control approach

### The SOP itself
- **Source of truth:** this Markdown file in the `Faraday-intelligence` repo
  (`docs/sop-course-production-and-review-v1.md`), version-controlled in git.
- **Versioning scheme:** semantic — `MAJOR.MINOR`. MINOR for clarifications and
  additions that don't change the required workflow; MAJOR when the pipeline,
  the gates, or the RACI change.
- **Change process:** edits land via a branch + PR (like this one); Myke approves
  the PR. The change log (§7) is updated in the same PR.
- **Review cadence:** review at least once per quarter, or whenever the pipeline
  tooling (Gutenberg, LearnWorlds config) or the course statuses change
  materially.
- **Notion mirror (on approval):** once Myke approves, this doc is published as a
  page in the Academy hub in Notion as the canonical operational reference. The
  git file remains the versioned source of truth; the Notion page is a mirror
  that links back to the file and carries the same version number.

### The course artifacts it governs
- **Course content lives in Notion** (the course page) as the authoring source of
  truth; **Notion page history** is the version record during authoring.
- **Course version code:** the `FA-###-##` code in the title is the stable
  external identity; Gutenberg's upsert is keyed on it, so a re-publish updates
  the existing LearnWorlds course rather than duplicating it.
- **Published-version tracking:** on each publish (step 10), record the publish
  date and the reviewed-version reference (Notion page-history timestamp or a
  version note) alongside the LearnWorlds course id, so every live course maps
  back to the exact approved version.
- **Re-publish discipline:** a new substantive version starts a fresh
  `Draft → … → Published` cycle; the sign-off from a prior version does not carry
  forward.

---

## 7. Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 (Draft) | 2026-07-18 | Claude (for Myke) | Initial SOP drafted for review. Not yet published to Notion. |

---

## Appendix A — Production Checklist (Writer, pre-review)

- [ ] Course row exists in Course Production DB with correct IDF 4.0 tags.
- [ ] `FA-###-##` course code present in the title.
- [ ] Learning objectives stated up front.
- [ ] Complete section → module tree; no placeholder/empty modules.
- [ ] Difficulty and format match the course's IDF tag.
- [ ] Sources cited; claims grounded (no stale/unverified data).
- [ ] Faraday voice and formatting conventions applied.
- [ ] Gutenberg **dry-run** produces a valid payload with no `GutenbergError`.

## Appendix B — Review Rubric (Reviewer)

- [ ] **Accuracy** — facts, figures, and claims are correct and current.
- [ ] **IDF fidelity** — domain, sub-domains, themes, difficulty, format, and
      certification-eligibility all match the schema and the actual content.
- [ ] **Pedagogy** — objectives, structure, and progression are sound for the
      stated difficulty level.
- [ ] **Voice & polish** — consistent Faraday tone; no typos/broken formatting.
- [ ] **Publish-readiness** — fresh Gutenberg dry-run is clean.
- [ ] **Verdict recorded** — Changes requested (→ Draft) or Recommend approve
      (→ flag for Myke). Reviewer never moves to Approved.

---

## Actions needed from the approver (Myke)

1. **Approve this SOP** (content + the pipeline/RACI/sign-off model above).
2. **Approve publishing this SOP into Notion** as a page in the Academy hub
   (Notion ID `33589a0c-1680-815a-b48f-efb878600bea`) as the canonical
   operational reference.

> Nothing has been written to Notion or LearnWorlds. This document is a draft in
> the repo for your review only.
