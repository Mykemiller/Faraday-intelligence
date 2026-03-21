# ⚡ Faraday — Data Center Intelligence Dashboard

A live React dashboard tracking the AI infrastructure and data center market.
Built by Myke. For friends following the data center market.

## Stack
- React 18 + Vite
- Deployed on Vercel (free tier)
- Live grid data via Anthropic API (web_search tool)

## Local Development

```bash
npm install
npm run dev
# Opens at http://localhost:5173
```

## Deploy to Vercel

### Option 1 — Vercel CLI (fastest)
```bash
npm install -g vercel
vercel login
vercel --prod
```
Your dashboard is live at `https://faraday-dashboard.vercel.app` (or custom domain).

### Option 2 — GitHub + Vercel UI (recommended for ongoing updates)
1. Push this repo to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial Faraday dashboard"
   git remote add origin https://github.com/YOUR_USERNAME/faraday-dashboard.git
   git push -u origin main
   ```
2. Go to vercel.com → New Project → Import from GitHub
3. Select your repo → Framework: Vite → Deploy
4. Done. Every `git push` auto-deploys.

## Adding a Custom Domain
In Vercel dashboard → Project → Settings → Domains
Add: `faraday.yourdomain.com`
Point DNS CNAME to `cname.vercel-dns.com`

## Updating the Dashboard
Edit `src/App.jsx` — the entire dashboard lives in this one file.
Commit and push → Vercel auto-deploys in ~30 seconds.

## Connecting to Ghost (Subscription Paywall)
1. Deploy this dashboard to Vercel → get your URL
2. In Ghost admin → Pages → Create a "Dashboard" page
3. Paste your Vercel URL as a button/link, set visibility to "Members only"
4. Paid subscribers see the button; free visitors see the teaser

## Environment Variables (optional)
If you want to protect the Anthropic API key server-side in the future:
- In Vercel dashboard → Project → Settings → Environment Variables
- Add: `VITE_ANTHROPIC_API_KEY=your_key_here`
- Reference in code: `import.meta.env.VITE_ANTHROPIC_API_KEY`

## File Structure
```
faraday-deploy/
├── index.html          # HTML entry point
├── vite.config.js      # Vite config
├── vercel.json         # Vercel routing + headers
├── package.json        # Dependencies
├── .gitignore
├── README.md           # This file
└── src/
    ├── main.jsx        # React root mount
    └── App.jsx         # ← ENTIRE DASHBOARD LIVES HERE
```
