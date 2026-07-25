# ISpyaDC Phase 0 — USGS M2M API Credential Runbook (FAR-405 · I3 / D5)

**Audience:** Myke. **Goal:** obtain USGS Machine-to-Machine (M2M) API access so
the Tier‑1 Landsat retrospective can pull the 10‑year monthly archive, and place
the credentials where the pipeline (a Supabase Edge Function) can read them.

This is the **blocking task** for Phase 0. Everything else (site selection,
seasonal baselines, threshold calibration) is designed and ready but cannot pull
Landsat scenes until this access is granted. **Approval is not instant** — USGS
EROS staff review MACHINE requests manually, typically **within a few business
days** (sometimes same‑day, sometimes a week). Start this first.

---

## Step 1 — Create an ERS (EROS Registration System) account  *(~5 min)*

1. Go to **https://ers.cr.usgs.gov/register**.
2. Register with an email you control. **Recommendation:** use
   `mykemiller@gmail.com` (or a Faraday ops address) so the account is
   recoverable and tied to the person who owns billing/relationships — the M2M
   token inherits this identity.
3. Confirm the verification email and complete the profile. The account is free.

> The username you choose here is half of the M2M credential pair. Write it down.

## Step 2 — Request MACHINE (M2M) access  *(~10 min to submit; days to approve)*

ERS accounts can browse EarthExplorer immediately, but the **M2M API** is a
separate, gated grant that must be requested and approved.

1. Sign in at **https://ers.cr.usgs.gov/**.
2. Open your **profile → "Access Request"** (also reachable from
   **https://m2m.cr.usgs.gov/** → *Sign In* → *Access Request*).
3. Submit the **Machine-to-Machine (M2M) API** access request. You'll be asked to
   describe the application and use case. Suggested text:

   > *"Automated retrieval of Landsat Collection 2 Level‑2 surface‑reflectance
   > scenes for a research/analytics pipeline performing NDVI change detection
   > over ~500 fixed US areas of interest, monthly cadence, 2015–2025
   > retrospective. Downloads are deduplicated by scene footprint to minimize
   > volume. Non‑commercial calibration corpus."*

4. Submit. You'll get an on‑screen confirmation and an email when the request is
   **approved** (this is the wait — plan for a few business days).

> **What "MACHINE" unlocks:** the `download-request` / bulk endpoints. Plain
> approved M2M gives search + limited download; the MACHINE role is what allows
> programmatic bulk download-order retrieval without the web UI. The request form
> above covers it — if the approval email mentions only partial access, reply
> asking for the MACHINE role citing the bulk-download use case.

## Step 3 — Generate an Application Token  *(~2 min, after approval)*

USGS moved M2M authentication to **token-based login** (password login for the
API is deprecated). You authenticate with `username` + a long‑lived
**Application Token**, which the pipeline exchanges for a short‑lived session
token at runtime.

1. In your **ERS profile**, find **"Generate Token" / "Application Token"**
   (sometimes under *Manage Credentials* or *Login Tokens*).
2. Generate a token, **label it** `faraday-ispyadc` so it's revocable
   independently later.
3. **Copy it immediately** — it is shown once. This is the value the pipeline
   stores.

You now hold the credential pair:
- **ERS username** (from Step 1)
- **Application Token** (from Step 3)

## Step 4 — Store the credentials as Supabase Edge-Function secrets  *(D5)*

**Placement decision (D5, resolved):** the Landsat puller runs as a **Supabase
Edge Function**, and *edge functions cannot read Vercel env vars* — so these MUST
be Supabase secrets, following the existing `SHOVELS_API_KEY` / `DC_HUB_API_KEY`
convention (`Deno.env.get(...)`). **Do not** put them in Vercel.

Names (matching repo convention):

| Secret | Value |
| --- | --- |
| `USGS_ERS_USERNAME` | your ERS username (Step 1) |
| `USGS_M2M_TOKEN`    | the Application Token (Step 3) |

Set them either way:

**Dashboard:** Supabase → project `ycadmmngkdhvpcsrcuaq` → *Project Settings →
Edge Functions → Secrets → Add new secret* (add both).

**CLI:**
```bash
supabase secrets set USGS_ERS_USERNAME='<your-username>' \
                     USGS_M2M_TOKEN='<application-token>' \
                     --project-ref ycadmmngkdhvpcsrcuaq
```

The pipeline never stores the short‑lived session token — it calls `login-token`
per run to mint a fresh ~2‑hour `X-Auth-Token` from the two secrets above.

## Step 5 — Tell Claude "access granted"

Once the approval email lands and the two secrets are set, reply here. I will:
1. Verify auth end‑to‑end (`login-token` → 2‑hour token, one `scene-search` probe).
2. Proceed with site selection, scene‑footprint dedup, seasonal baselines, and
   the retrospective calibration run.

---

## Reference — what the pipeline will call (no action needed from you)

- **Auth:** `POST https://m2m.cr.usgs.gov/api/api/json/stable/login-token`
  `{ "username": USGS_ERS_USERNAME, "token": USGS_M2M_TOKEN }` → returns
  `X-Auth-Token` (valid ~2 h; sent as a header on every later call).
- **Datasets (surface reflectance for NDVI = Collection 2, Level‑2):**
  - `landsat_ot_c2_l2` — Landsat 8 & 9 (OLI/TIRS), 2013→present
  - `landsat_etm_c2_l2` — Landsat 7 (ETM+)
  - `landsat_tm_c2_l2` — Landsat 4‑5 (TM) *(pre‑window; likely unused for 2015–2025)*
- **Flow:** `scene-search` (spatial bbox + date + cloud filter) → `scene-list-add`
  → `download-options` → `download-request` → `download-retrieve`.
- **Rate/volume:** M2M enforces per‑account concurrency + daily download caps;
  the success‑criteria dedup ("by scene footprint, not per‑site") is what keeps us
  under them — nearby AOIs share WRS‑2 path/row scenes.

## Alternative worth a 2‑minute decision (Google Earth Engine)

The success criteria assume a **download-and-process** architecture (hence the
"dedupe by scene footprint to control download volume" line). **Google Earth
Engine (GEE)** hosts the identical Landsat C2 L2 collections and computes NDVI
**server-side** — no scene downloads, no volume management, and monthly
composites/harmonic fits are a few lines of code. It would **eliminate the M2M
download-volume problem entirely** and is materially less operational work.

Trade-off: GEE needs a Google Cloud project + a service account (its own
credential path, storable the same way as Supabase secrets), and it's a Google
dependency rather than the raw USGS source. **This is a real fork in the road**,
not a detail — the M2M path above is what you asked for and I'll build it, but if
avoiding the download plumbing is attractive, say so and I'll spec the GEE variant
before we commit. Either way the *positive/control corpus, ecoregion strata, and
calibration schema are identical* — only the pixel-fetch layer changes.
