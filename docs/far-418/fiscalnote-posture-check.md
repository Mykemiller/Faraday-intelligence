# FAR-418 §7.5 — FiscalNote posture check

**CC:** CC-BOUNDSTONE-INGEST-1.1 §7.5 (Decision 6) · **Checked:** 2026-08-06, against
project `ycadmmngkdhvpcsrcuaq`. Every figure below is measured, not inferred.

## Verdict on the licence posture: leave it alone

`license_status = 'blocked'` on all five `fiscalnote:*` rows is **correct and deliberate**,
and this CC changes none of them. Any change is a licensing decision, not an engineering one.

## The three items §7.5 assigns

### 1. Four of five lanes have never run. Diagnosed, not forced.

| source_key | status | license_status | last_ok_at | last_artifact_at | auto_id |
|---|---|---|---|---|---|
| `fiscalnote:curate-snippets` | active | blocked | 2026-08-06 15:10:46Z | 2026-08-06 15:10:46Z | AUTO-207 |
| `fiscalnote:curate-locations` | active | blocked | — | — | *(none)* |
| `fiscalnote:curate-topics` | active | blocked | — | — | *(none)* |
| `fiscalnote:legislation` | active | blocked | — | — | *(none)* |
| `fiscalnote:regulations` | active | blocked | — | — | *(none)* |

**Diagnosis: the four silent lanes have no automation attached.** Only
`curate-snippets` carries an `auto_id` (AUTO-207). The other four are registry rows
with a `fetcher` name and nothing that invokes them. They are not failing, not
rate-limited and not blocked — nothing has ever asked them to run. That is a
registration-without-wiring gap, and it is the same shape as the 24 commissions
that had never produced.

Not forced, per instruction. The fix is an automation registration, which is a
Registry decision.

### 2. The licence bypass is a **gate, but an implicit one** — and it hides a worse defect

`source-poller` enforces `ACTIVATABLE = ['cleared','attribution_required']`, and
`'blocked'` is not in it. That rule is intact. It does not govern these rows at all:
they carry `subsystem='fiscalnote'` and `fetcher='fiscalnote-probe'`, and `source-poller`
only ever selects `subsystem='poller'`. So the five rows are `status='active'` while
`license_status='blocked'` not because a gate leaked, but because **a different function
owns them**.

That is a gate by subsystem separation. It is not *named* anywhere, which is what §7.5
asked to confirm — so it is recorded here, and the PR carries it as a finding.

**The defect found while checking.** `fiscalnote-probe_v1.1` (AUTO-207) ran at
15:10:46Z: `consumed=3970 calls=91 new_rows=2930`. In the same window:

```
artifacts WHERE signal_envelope->>'source_key' LIKE 'fiscalnote:%'  →  0 rows
```

The probe writes 2,930 rows to the FiscalNote **ledger**, not to `artifacts` — but it
sets `source_registry.last_artifact_at` on the registry row anyway. Two consequences,
both live today:

- **`last_artifact_at` is overloaded and now lies.** Every consumer reading it as
  "this source put something in the artifact stream" is wrong for these five rows.
  That includes `source-poller.refreshCountable()` and the new §8 coverage block,
  which counts a source as `producing` from this column. The staleness monitor will
  score `curate-snippets` as healthy and producing while it has contributed nothing
  to the corpus.
- **A timestamp ordering that cannot happen on the normal path.** `last_ok_at`
  (15:10:46Z) is *later* than `last_fetch_at` (13:40:46Z). On the poller path
  `last_ok_at` is only ever written together with `last_fetch_at`. Another writer is
  setting these fields.

Neither is fixed here — both are outside this CC's scope and one of them (what
`last_artifact_at` means) is a definition change that other systems read. Recorded for
the next CC.

### 3. FiscalNote can never become a primary source — now enforced, not conventional

§7.5 requires this be a constraint rather than a convention. It is:

```sql
constraint candidates_primary_not_monitor check (
  primary_source_url is null
  or boundstone.url_host(primary_source_url) not in
     ('fiscalnote.com','policynote.com','app.policynote.com','data.policynote.com','legiscan.com')
)
```
— `boundstone/supabase/migrations/0018_far418_candidates.sql`

Belt and braces, both already true:

- `boundstone.blocked_source_domains` holds the three monitor vendors, and
  `is_quotable_source_host()` checks the blocklist **first**, so Gate 2 cannot return a
  monitor URL as quotable even if one were reachable.
- Today the question is moot in a way worth stating: because the probe writes to the
  ledger and never to `artifacts`, no FiscalNote content reaches
  `boundstone-candidates` at all — that function reads `artifacts`. The constraint
  exists for the day the probe starts writing artifacts, which is exactly when a
  convention would have been forgotten.

## What this does not resolve

FAR-413 / D4 redistribution rights remain counsel-blocked. Nothing above changes what
may be **published**; it constrains what may be **built**, which is all this CC touches.
