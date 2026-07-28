// Wave-3 headless scraper runner (CC-INGEST-STATE-INCENTIVE-ALL-WAVES).
//
// Runs in GitHub Actions (a real Chromium + open egress) because the Tier-B
// state-incentive portals are JS-rendered or bot-gated and cannot be fetched by
// the Supabase edge runtime. Per-portal adapters live in ./adapters. Each
// adapter renders its page and returns rows in the state_incentive_disclosures
// "CommonRecord" shape; this runner pushes them to the ingest-state-incentives-push
// edge function (INF confidence).
//
// Usage:
//   node scrape.mjs --source ca_calcompetes --mode dump   # render + print DOM (no secrets, no writes)
//   node scrape.mjs --source ca_calcompetes --mode push   # extract + POST to Supabase (needs secrets)
//
// Env (push mode): SUPABASE_FUNCTIONS_URL (e.g. https://<ref>.supabase.co/functions/v1),
//                  STATE_INCENTIVE_INGEST_SECRET, SUPABASE_ANON_KEY (gateway apikey).
import { chromium } from "playwright";
import { ADAPTERS } from "./adapters/index.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const source = arg("source");
const mode = arg("mode", "dump");
if (!source || !ADAPTERS[source]) {
  console.error(`Unknown --source. Known: ${Object.keys(ADAPTERS).join(", ")}`);
  process.exit(2);
}
const adapter = ADAPTERS[source];

// Generic DOM dump so selectors are written from real rendered output, not guesses.
async function dump(page) {
  const info = await page.evaluate(() => {
    const tables = [...document.querySelectorAll("table")].map((t, i) => {
      const rows = [...t.querySelectorAll("tr")];
      const cellText = (r) => [...r.querySelectorAll("th,td")].map((c) => (c.innerText || "").trim().slice(0, 40));
      return {
        tableIndex: i,
        classes: t.className,
        id: t.id,
        rowCount: rows.length,
        header: rows[0] ? cellText(rows[0]) : [],
        sampleRows: rows.slice(1, 4).map(cellText),
      };
    });
    const iframes = [...document.querySelectorAll("iframe")].map((f) => f.src).filter(Boolean);
    // Capture pagination markup so pager selectors are written from real HTML.
    const pager = [...document.querySelectorAll('ul.pagination, .footable-paging, [class*="paging"], [class*="pagination"]')]
      .slice(0, 3).map((el) => el.outerHTML.slice(0, 1200));
    return { title: document.title, tableCount: tables.length, tables, iframes, pager };
  });
  console.log("=== DUMP", adapter.source_key, "===");
  console.log(JSON.stringify(info, null, 2));
}

async function push(rows) {
  const base = process.env.SUPABASE_FUNCTIONS_URL;
  const secret = process.env.STATE_INCENTIVE_INGEST_SECRET ?? "";
  const anon = process.env.SUPABASE_ANON_KEY ?? "";
  if (!base) throw new Error("SUPABASE_FUNCTIONS_URL not set");
  const res = await fetch(`${base}/ingest-state-incentives-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(anon ? { Authorization: `Bearer ${anon}`, apikey: anon } : {}),
    },
    body: JSON.stringify({
      source_key: adapter.source_key,
      state_abbr: adapter.state_abbr,
      run_id: process.env.GITHUB_RUN_ID ?? null,
      secret,
      rows,
    }),
  });
  const text = await res.text();
  console.log(`push -> HTTP ${res.status}: ${text}`);
  if (!res.ok) process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  // Wide viewport so responsive tables (e.g. FooTable breakpoint-lg) don't
  // collapse overflow columns into hidden detail rows.
  viewport: { width: 2400, height: 1400 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
});
const page = await context.newPage();
try {
  await adapter.load(page); // navigate + wait for data
  if (mode === "dump") {
    await dump(page);
  } else if (mode === "test") {
    // extract + print (no secrets, no writes) — validates an adapter's mapping in CI
    const rows = await adapter.extract(page);
    console.log(`extracted ${rows.length} rows from ${adapter.source_key}`);
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  } else if (mode === "push") {
    const rows = await adapter.extract(page);
    console.log(`extracted ${rows.length} rows from ${adapter.source_key}`);
    if (rows.length) console.log("first row:", JSON.stringify(rows[0]));
    if (!rows.length) { console.error("0 rows extracted — refusing to push (no fabricated/empty writes)"); process.exit(1); }
    await push(rows);
  } else {
    console.error(`Unknown --mode ${mode}`); process.exit(2);
  }
} finally {
  await browser.close();
}
