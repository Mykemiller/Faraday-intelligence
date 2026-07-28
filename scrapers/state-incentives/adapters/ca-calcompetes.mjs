// CA — California Competes Tax Credit (CalCompetes) awardee list.
// GO-Biz publishes recipient-level awards as a JS-rendered Ninja Tables / FooTable
// AJAX widget (#footable_73522) on business.ca.gov. Primary GO-Biz disclosure,
// but captured by headless render → registered INF (not SRC).
//
// Extraction strategy — go to the source, not the pager. Ninja Tables holds only
// the current page (~10 rows) in the DOM and client-paginates via FooTable, so
// scraping the rendered <tbody> and clicking "next" is both slow and lossy (it
// truncated at 23 rows). Instead we call the plugin's own WordPress AJAX endpoint
// (admin-ajax.php, target_action=get-all-data) from inside the page context
// (same-origin, carries the page cookies). That returns EVERY awardee as JSON in
// one request. DOM pagination is kept as a fallback if the endpoint shape changes.
//
// Columns (verified via `--mode dump`, 2026-07-28):
//   Name · Download Link · Primary Location(s) · Industry ·
//   Net Increase of Full-Time Employees · Investments · Grant Amount ·
//   Date Agreement Approved (yyyy/mm/dd) · Amount Recaptured
// "Grant Amount" is the CalCompetes CREDIT (the incentive). Location is city-level
// and often multi-city → county_name is left null (like OK); rows land but write
// no INC-* attribute until a city→county resolver exists (documented, not fabricated).
const TABLE = "#footable_73522";
const TABLE_ID = 73522;

const stripTags = (v) =>
  v == null ? null : String(v).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() || null;
const money = (s) => {
  const t = stripTags(s);
  return t ? t.replace(/[$,]/g, "").trim() : null;
};
const toIsoDate = (s) => {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(stripTags(s) || "");
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const m2 = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(stripTags(s) || ""); // m/d/yyyy fallback
  return m2 ? `${m2[3]}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}` : null;
};

// Heuristic key lookup over a Ninja Tables row object (column keys are author-set
// slugs, discovered at runtime and matched by pattern so a rename doesn't break us).
const pick = (obj, ...res) => {
  const keys = Object.keys(obj);
  for (const re of res) {
    const k = keys.find((k) => re.test(k));
    if (k != null && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return null;
};

function mapAjaxRow(row) {
  const r = row && typeof row === "object" && row.value && typeof row.value === "object" ? row.value : row;
  if (!r || typeof r !== "object") return null;
  const name = stripTags(pick(r, /^name$/i, /company|recipient|business|taxpayer/i));
  if (!name) return null;
  const location = stripTags(pick(r, /location/i));
  // The credit is the incentive. Real key is "amountoftaxcredit"; match tax-credit
  // patterns FIRST and never let /amount/ alone snag "amountrecaptured".
  const grant = pick(
    r,
    /amountoftaxcredit/i,
    /tax.?credit/i,
    /amount.*credit/i,
    /grant.?amount/i,
    /award.?amount/i,
  );
  const date = pick(r, /date.*(approv|agreement)/i, /agreement.*date/i, /approv/i);
  return {
    recipient_name: name,
    place_name: location,
    county_name: null, // city-level / multi-city — resolved only once a city→county map exists
    incentive_type: "credit",
    raw_incentive_type: "California Competes Tax Credit",
    program_name: "California Competes Tax Credit",
    statute_citation: "Cal. R&TC §§17059.2, 23689",
    award_value_usd: money(grant),
    term_start: toIsoDate(date),
    source_record_id: `${name}:${toIsoDate(date) || ""}`,
    source_url: "https://business.ca.gov/california-competes-tax-credit/grant-awardee-list/",
    raw: {
      name,
      location,
      industry: stripTags(pick(r, /industry/i)),
      net_new_ft: stripTags(pick(r, /employ|full.?time/i)),
      investments: stripTags(pick(r, /investment/i)),
      grant_amount: stripTags(grant),
      date_approved: stripTags(date),
      amount_recaptured: stripTags(pick(r, /recaptur/i)),
    },
  };
}

export default {
  source_key: "ca_calcompetes",
  state_abbr: "CA",
  url: "https://business.ca.gov/california-competes-tax-credit/grant-awardee-list/",

  async load(page) {
    await page.goto(this.url, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector(`${TABLE} tbody tr td`, { timeout: 60000 }).catch(() => {});
  },

  // Diagnostic: enumerate every Ninja Tables widget on the page (its true
  // get-all-data row count) plus any downloadable award files, so we know whether
  // the rendered table is the whole published set or one round of several.
  async probe(page) {
    const info = await page.evaluate(async () => {
      const ajaxUrl =
        window.ajaxurl ||
        (window.ninja_footables && window.ninja_footables.ajax_url) ||
        "/wp-admin/admin-ajax.php";
      const ids = [
        ...new Set(
          [...document.querySelectorAll('table[id^="footable_"], [id^="footable_"]')]
            .map((t) => (t.id.match(/footable_(\d+)/) || [])[1])
            .filter(Boolean),
        ),
      ];
      const tables = [];
      for (const id of ids) {
        try {
          const body = new URLSearchParams({
            action: "wp_ajax_ninja_tables_public_action",
            table_id: id,
            target_action: "get-all-data",
            default_sorting: "old_first",
          });
          const res = await fetch(ajaxUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
            body: body.toString(),
            credentials: "include",
          });
          const j = res.ok ? await res.json() : null;
          const arr = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null;
          tables.push({ id, ok: res.ok, count: arr ? arr.length : null });
        } catch (e) {
          tables.push({ id, error: String(e) });
        }
      }
      const files = [
        ...new Set(
          [...document.querySelectorAll("a[href]")]
            .map((a) => a.href)
            .filter((h) => /\.(xlsx?|csv|pdf)(\?|#|$)/i.test(h)),
        ),
      ];
      return { title: document.title, ajaxUrl, tableIds: ids, tables, files: files.slice(0, 60) };
    });
    console.log("=== PROBE ca_calcompetes ===");
    console.log(JSON.stringify(info, null, 2));
  },

  async extract(page) {
    // --- Primary path: the plugin's own get-all-data AJAX endpoint (all rows). ---
    const ajax = await page.evaluate(async (tableId) => {
      const ajaxUrl =
        window.ajaxurl ||
        (window.ninja_footables && window.ninja_footables.ajax_url) ||
        (window.ninjaTablesAdmin && window.ninjaTablesAdmin.ajax_url) ||
        "/wp-admin/admin-ajax.php";
      const targets = ["get-all-data", "get_all_data"];
      for (const ta of targets) {
        try {
          const body = new URLSearchParams({
            action: "wp_ajax_ninja_tables_public_action",
            table_id: String(tableId),
            target_action: ta,
            default_sorting: "old_first",
          });
          const res = await fetch(ajaxUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: body.toString(),
            credentials: "include",
          });
          if (!res.ok) continue;
          const json = await res.json();
          const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
          if (arr && arr.length) return { ok: true, ajaxUrl, ta, count: arr.length, sample: arr[0], rows: arr };
        } catch (e) {
          /* try next target */
        }
      }
      return { ok: false, ajaxUrl };
    }, TABLE_ID);

    if (ajax.ok) {
      const sampleKeys = ajax.sample && typeof ajax.sample === "object"
        ? Object.keys(ajax.sample.value && typeof ajax.sample.value === "object" ? ajax.sample.value : ajax.sample)
        : [];
      console.log(`ca_calcompetes ajax: ok via ${ajax.ta} (${ajax.ajaxUrl}), ${ajax.count} raw rows`);
      console.log(`ca_calcompetes ajax sample keys: ${JSON.stringify(sampleKeys)}`);
      const seen = new Set();
      const rows = [];
      for (const raw of ajax.rows) {
        const rec = mapAjaxRow(raw);
        if (!rec) continue;
        const key = `${rec.recipient_name}|${rec.term_start}|${rec.award_value_usd}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(rec);
      }
      console.log(`ca_calcompetes: mapped ${rows.length} rows from AJAX`);
      if (rows.length) return rows;
      console.log("ca_calcompetes: AJAX returned rows but none mapped — falling back to DOM pagination");
    } else {
      console.log(`ca_calcompetes ajax: failed (ajaxUrl=${ajax.ajaxUrl}) — falling back to DOM pagination`);
    }

    // --- Fallback path: DOM + FooTable pagination (lossy, kept only as backup). ---
    return await this.extractByPagination(page);
  },

  async extractByPagination(page) {
    await page
      .waitForSelector(`${TABLE} tr.footable-paging li[data-page="next"]`, { timeout: 15000 })
      .catch(() => {});
    const seen = new Set();
    const rows = [];
    for (let guard = 0; guard < 500; guard++) {
      const pageRows = await page.$$eval(`${TABLE} tbody tr`, (trs) =>
        trs
          .filter((tr) => !tr.classList.contains("footable-detail-row") && !tr.classList.contains("footable-empty"))
          .map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.innerText || "").trim())),
      );
      for (const c of pageRows) {
        if (c.length < 8 || !c[0]) continue;
        const key = `${c[0]}|${c[7]}|${c[6]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          recipient_name: c[0],
          place_name: c[2] || null,
          county_name: null,
          incentive_type: "credit",
          raw_incentive_type: "California Competes Tax Credit",
          program_name: "California Competes Tax Credit",
          statute_citation: "Cal. R&TC §§17059.2, 23689",
          award_value_usd: money(c[6]),
          term_start: toIsoDate(c[7]),
          source_record_id: `${c[0]}:${c[7]}`,
          source_url: this.url,
          raw: {
            name: c[0], location: c[2], industry: c[3], net_new_ft: c[4],
            investments: c[5], grant_amount: c[6], date_approved: c[7], amount_recaptured: c[8] ?? null,
          },
        });
      }
      const NEXT = `${TABLE} tr.footable-paging li.footable-page-nav[data-page="next"]`;
      const before = pageRows[0]?.[0] ?? "";
      const state = await page.evaluate((s) => {
        const li = document.querySelector(s);
        if (!li) return "no-pager";
        if (li.classList.contains("disabled")) return "disabled";
        (li.querySelector("a") || li).click();
        return "clicked";
      }, NEXT);
      if (state !== "clicked") break;
      await page
        .waitForFunction(
          ([sel, prev]) => {
            const tr = document.querySelector(`${sel} tbody tr`);
            const first = tr ? (tr.querySelector("td")?.innerText || "").trim() : "";
            return first && first !== prev;
          },
          [TABLE, before],
          { timeout: 12000 },
        )
        .catch(() => {});
      const after = await page.$eval(`${TABLE} tbody tr td`, (td) => (td.innerText || "").trim()).catch(() => "");
      if (after === before) break;
    }
    console.log(`ca_calcompetes: paginated ${rows.length} rows (fallback)`);
    return rows;
  },
};
