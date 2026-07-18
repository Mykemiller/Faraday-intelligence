---
name: sop-builder
description: >-
  Produce standardized Standard Operating Procedures (SOPs) for repeatable
  business processes. Use when the user wants to write, standardize, or version
  an SOP, runbook, or "how we do X" process doc — especially anything with a
  defined pipeline of stages, hand-offs between roles, or a required sign-off /
  approval gate. Triggers on phrases like "write an SOP", "standardize the
  process for", "document the workflow", "build a RACI for", "create a runbook",
  or "how should we run X consistently". Outputs a review-ready SOP document with
  a step-by-step workflow, a RACI responsibility matrix, and an explicit version
  control approach. Does not publish to any live system on its own.
license: Proprietary — vendored for Faraday internal use.
metadata:
  vendored_from: w95/awesome-claude-corporate-skills
  archetype: Consultant
  validity: "100·pass"
  version: "1.0.0"
---

# SOP Builder

Turn a fuzzy "how we do X" into a clean, auditable Standard Operating Procedure
that a new team member could follow without asking questions — and that a manager
can trust to protect the quality bar.

## When to use this skill

Use it whenever a process is (a) repeatable, (b) crosses more than one person or
role, and (c) has a quality or compliance bar that must not be skipped. Classic
cases: content/course production, release pipelines, onboarding, incident
response, procurement approvals, publishing workflows.

Do **not** use it for one-off tasks, purely personal checklists with no
hand-offs, or anything where inventing a "standard" would be premature.

## Operating principles

1. **Ground it in reality first.** Before drafting, learn the actual current
   process — the real stages, tools, artifacts, roles, and people. Read the
   surrounding docs, repos, and systems. An SOP that contradicts how the work
   actually happens is worse than no SOP.
2. **Stages are the spine.** Every SOP is organized around a named,
   ordered pipeline of states (e.g. `Draft → Review → Approved → Published`).
   Each stage has an owner, an entry condition, exit criteria, and the artifact
   it produces.
3. **Encode the guardrails explicitly.** Any "must never happen without X" rule
   (a sign-off, a second review, a legal check) gets its own named gate in the
   workflow AND a line in the RACI. Never leave a critical control implicit.
4. **RACI, not vibes.** Responsibility is stated per step with a Responsible /
   Accountable / Consulted / Informed matrix. Exactly one Accountable per step.
5. **Versioned and dated.** An SOP is a living document. It carries a version,
   an owner, a change log, and a defined review cadence.
6. **Human-review by default.** Deliver the SOP as a document for a human to
   approve. Do not write it into a live system of record (Notion, a wiki, an
   LMS) until a human has explicitly approved both the content and the publish.

## Required sections of every SOP

Produce a Markdown document with these sections, in this order:

1. **Header block** — title, version, owner, status, effective date, last
   updated, and a one-line purpose.
2. **Purpose & scope** — what this SOP covers and, just as important, what it
   explicitly does *not* cover (out-of-scope boundaries).
3. **Definitions** — the pipeline stages/states and any domain terms, defined
   once so the rest of the doc can use them precisely.
4. **The workflow** — the numbered, step-by-step procedure, organized by
   pipeline stage. Each step: who does it, the action, the entry/exit criteria,
   and the artifact produced. Call out every approval gate in bold.
5. **RACI matrix** — a table of steps × roles. R = does the work, A =
   accountable/owns the outcome (exactly one per row), C = consulted before,
   I = informed after.
6. **Sign-off & guardrails** — restate the non-negotiable controls (the
   "never publish without X" rules) as their own short section so they can't be
   missed.
7. **Version control approach** — how the SOP itself and the artifacts it
   governs are versioned: semantic version scheme, change log location, where
   the source of truth lives, branch/PR or page-history conventions, and the
   review cadence.
8. **Change log** — a dated table of revisions to the SOP.

## Method

1. **Discover.** Identify the process, its current stages, the systems of
   record, the artifacts at each stage, and the real people/roles. Read
   everything relevant before writing a line.
2. **Name the pipeline.** Lock the ordered list of states and their transitions.
   This is the skeleton everything hangs on.
3. **Map roles to RACI.** For each step, assign R/A/C/I. Resolve any step with
   zero or two Accountables — that's a process bug to surface, not paper over.
4. **Surface the gates.** Make every mandatory control an explicit, named,
   blocking step. If a sign-off is required, the prior stage cannot exit without
   it, and the workflow must say so in bold.
5. **Define versioning.** State how the SOP and its governed artifacts are
   versioned and where the source of truth lives.
6. **Draft, then stop for review.** Write the full document, then hand it to the
   human for approval. Note clearly that nothing has been written to any live
   system, and list the explicit approvals you need to proceed.

## Output contract

- One self-contained Markdown SOP document following the section order above.
- A short "Actions needed from the approver" list at the end: the specific
  human decisions required (approve content, approve publish, etc.).
- No writes to any live system of record without explicit human approval.
