# FAR-154 — LearnWorlds School Configuration Checklist

> **Purpose:** Stand up the Faraday Academy LearnWorlds school production foundation.
> **Audience:** Myke (run each step in the LearnWorlds admin dashboard — Claude cannot
> access the LW UI).
> **Status when complete:** Move FAR-154 → Done in Jira.
> **Decision basis:** LearnWorlds selected April 4, 2026 (Academy Overview, "Option B").
> Commercial model is à la carte (June 11, 2026): $4.99 per 101 course · $9.99 per
> all other courses · $99 flat per certification · passing any cert grants 5,000 tokens.

Work top-to-bottom. Each item has a **Verify** line — don't check the box until the
verify passes. Boxes are for Myke to tick in the dashboard.

---

## 0. Pre-flight

- [ ] Confirm you are the **school owner / admin** on the LearnWorlds account.
- [ ] Confirm the plan tier supports: custom domain, white-label email, the **API**
      (Settings → Developers → API), and **user groups / access rules**. (Gutenberg
      publishing in FAR-156 requires the API add-on.)
- [ ] Note the school's base URL — `https://<school>.learnworlds.com` — you'll need the
      `<school>` slug (this is `LW_SCHOOL_ID`) and an API client/token (`LW_API_KEY`)
      for FAR-156.

**Verify:** Settings → Developers → API shows an **API client** you can generate a token
for. Capture both values for the Vercel env step (FAR-156).

---

## 1. Custom domain binding

Target domain: **`academy.faraday-intelligence.ai`**

- [ ] LearnWorlds **Settings → Site → Domain → Custom domain**: enter
      `academy.faraday-intelligence.ai`.
- [ ] LearnWorlds shows a target host (typically a CNAME like `sites.learnworlds.com`
      or a school-specific value). Copy it.
- [ ] In the DNS provider for `faraday-intelligence.ai` add the record LearnWorlds
      specifies:
      - **Type:** CNAME · **Host/Name:** `academy` · **Value:** *(the LW-provided target)*
      - TTL: default (e.g. 3600).
- [ ] Back in LearnWorlds, click **Verify / Connect domain** and wait for SSL to issue
      (LW provisions a certificate automatically; can take up to ~24h).

> ⚠️ `academy.faraday-intelligence.ai` is a **subdomain of the apex** that already serves
> the storefront/engine site on Vercel (`v0-faraday-daily-challenge`). A CNAME on the
> `academy` host does **not** affect the apex or `www` — leave those Vercel records
> untouched.

**Verify:** `https://academy.faraday-intelligence.ai` loads the LearnWorlds school over
HTTPS with a valid certificate (no browser warning).

---

## 2. Brand kit (colors + fonts)

Apply via **Site Builder → Theme / Branding** (and **Settings → Site → Branding** for
logo/favicon).

### Color palette

| Token | Hex | Use in LearnWorlds |
|---|---|---|
| Forest (primary) | `#1C3424` | Primary brand color / header / primary buttons |
| Gold (accent) | `#C4922A` | Accent / call-to-action / links / highlights |
| Cream (surface) | `#EEE6DA` | Page background / light surfaces |
| Sage (secondary) | `#8CA68A` | Secondary accents / progress / tags |
| White | `#F8F5F0` | Cards / content surfaces / body background |

- [ ] Set **Primary color** → `#1C3424` (forest).
- [ ] Set **Accent / secondary color** → `#C4922A` (gold); secondary → `#8CA68A` (sage).
- [ ] Set page/background surfaces → `#EEE6DA` (cream) and `#F8F5F0` (white) per theme
      slot.
- [ ] Upload **logo** and **favicon** (Faraday Academy brand assets — see Academy Brand
      Guide in Notion).

### Typography

| Role | Typeface | LearnWorlds slot |
|---|---|---|
| Display / headings | **IBM Plex Serif** | Heading font |
| Body | **Bricolage Grotesque** | Body / paragraph font |
| Data / mono | **IBM Plex Mono** | Code / data callouts (where supported) |

- [ ] Heading font → **IBM Plex Serif**. If not in the LW font picker, add via **custom
      fonts** (Google Fonts: IBM Plex Serif) or upload web-font files.
- [ ] Body font → **Bricolage Grotesque** (Google Fonts; upload if not listed).
- [ ] Mono/data font → **IBM Plex Mono** where a third font slot exists.

**Verify:** Preview a course page — headings render IBM Plex Serif, body renders
Bricolage Grotesque, primary buttons are forest `#1C3424`, links/CTAs are gold `#C4922A`.

---

## 3. White-label email (sender)

Sender identity: **`academy@faraday-intelligence.ai`** (display name: *Faraday Academy*).

- [ ] **Settings → Communication / Emails → Sender**: set **From name** = `Faraday Academy`,
      **From email** = `academy@faraday-intelligence.ai`.
- [ ] Enable **white-label / custom domain email** (removes "powered by LearnWorlds"
      from transactional mail where the plan allows).
- [ ] Add the **SPF / DKIM** records LearnWorlds provides for `faraday-intelligence.ai`
      to DNS so mail authenticates (avoids spam folder).
      - SPF: ensure the LW sending domain is included in the existing `faraday-intelligence.ai`
        SPF record (do not create a second SPF record — merge includes).
      - DKIM: add the LW-provided `CNAME`/`TXT` selector record(s).
- [ ] Send a **test transactional email** (e.g. trigger a test enrollment) and confirm it
      arrives from `academy@faraday-intelligence.ai`.

> Note: `ops@faraday-intelligence.ai` (Resend) remains the engine's transactional ops
> sender. The Academy's learner-facing mail is a **separate** identity
> (`academy@faraday-intelligence.ai`) configured here in LearnWorlds.

**Verify:** Test email header shows `From: Faraday Academy <academy@faraday-intelligence.ai>`
and passes SPF + DKIM (check "show original" in Gmail → SPF=PASS, DKIM=PASS).

---

## 4. Learner groups (tier-mapped)

Create **user groups** under **Users → User Groups** (or **Settings → Access → Groups**).
These four groups map to the subscription tier ladder; gate course access with **Access
rules / bundles**, not by hardcoding prices on the course.

| Group | Maps to tier | Intended access | Notes |
|---|---|---|---|
| **Free** | Free / no subscription | Marketing pages, free promos only | No paid course access by default; à la carte purchases still allowed per-course. |
| **Signal** | Signal (entry paid) | 101-level + Signal-tier content | |
| **Core** | Core (mid) | 101–301 content | |
| **Premier** | Premier (top) | All course levels incl. 401 + certification tracks | |

- [ ] Create group **Free**.
- [ ] Create group **Signal**.
- [ ] Create group **Core**.
- [ ] Create group **Premier**.
- [ ] For each group, define an **Access rule** (or bundle) scoping which courses/levels
      members can open. Leave per-course à la carte purchase enabled regardless of group.

> ⚠️ **Pricing is à la carte, not tier-bundled** (Academy Overview, June 11 2026). Groups
> govern *access scope / cohorts*, **not** price. Do **not** hardcode course prices into
> group definitions — prices are set per course ($4.99 for 101, $9.99 otherwise, $99 per
> certification). Tokens are granted on certification pass (5,000), handled by the token
> economy, not LearnWorlds.

**Verify:** Users → User Groups lists exactly the four groups; a test user added to
**Premier** can open a 401 course, a test user in **Free** cannot.

---

## 5. SSO preparation (webhook + endpoint placeholders)

The Academy will federate identity with the Faraday subscriber base (Supabase magic-link +
`subscribers`). LearnWorlds supports **SSO (JWT / OAuth)** and **webhooks**; capture the
placeholders now so FAR-1xx SSO work can wire them later.

- [ ] **Settings → Developers → SSO**: choose **SSO via JWT/SSO link** (Faraday issues a
      signed token from the subscriber session). Record the **SSO endpoint** LearnWorlds
      expects to call / accept.
- [ ] Generate and **securely store the SSO secret / signing key** (used to sign the SSO
      JWT from the Faraday side). Do **not** commit it — it goes in Vercel/Supabase secrets.
- [ ] **Settings → Developers → Webhooks**: register a placeholder callback for
      enrollment + certification events:
      - **Webhook URL (placeholder):** `https://faraday-intelligence.ai/api/learnworlds/webhook`
        *(create/confirm this route in a later story; LW will POST course-completed /
        certificate-issued events here so passing a cert can grant 5,000 tokens).*
      - Subscribe to events: **user.enrolled**, **course.completed**, **certificate.issued**.
- [ ] Record the **redirect / login URL** for SSO return:
      `https://academy.faraday-intelligence.ai/` (post-auth landing).

**Verify:** SSO config is saved with a signing secret stored in the Faraday secret store
(not in LearnWorlds notes); the webhook endpoint is registered (it may 404 until the route
ships — that's expected at this stage; just confirm LW accepted the URL).

---

## 6. API access for Gutenberg (FAR-156 hand-off)

- [ ] **Settings → Developers → API**: create an **API client** and generate a token.
- [ ] Capture:
      - `LW_SCHOOL_ID` = the `<school>` slug from `https://<school>.learnworlds.com`
      - `LW_API_KEY` = the generated API token (Bearer)
      - (If LW issues a separate **client id** header `Lw-Client`, capture it too.)
- [ ] Hand these to the Vercel env step (FAR-156): add `LW_API_KEY` and `LW_SCHOOL_ID`
      (and `LW_CLIENT_ID` if applicable) to the project environment. **Never commit them.**

**Verify:** A simple authenticated `GET /admin/api/v2/courses` against the school base URL
returns `200` (Gutenberg's dry-run does not need this; live publish does).

---

## Completion summary

- [ ] §1 Custom domain live over HTTPS
- [ ] §2 Brand colors + fonts applied
- [ ] §3 White-label email sending + authenticated (SPF/DKIM pass)
- [ ] §4 Four tier-mapped learner groups + access rules
- [ ] §5 SSO + webhook placeholders captured (secret stored securely)
- [ ] §6 API client created; `LW_API_KEY` + `LW_SCHOOL_ID` handed to Vercel env

When all six sections verify → set **FAR-154 → Done**.
