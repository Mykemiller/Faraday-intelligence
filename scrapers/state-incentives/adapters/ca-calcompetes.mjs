// CA — California Competes Tax Credit (CalCompetes) awardee list.
// GO-Biz publishes recipient-level awards as a JS-rendered Ninja Tables / FooTable
// AJAX widget (#footable_73522) on business.ca.gov. Primary GO-Biz disclosure,
// but captured by headless render → registered INF (not SRC).
//
// Real columns (verified via `--mode dump`, 2026-07-28):
//   0 Name · 1 Download Link · 2 Primary Location(s) · 3 Industry ·
//   4 Net Increase of Full-Time Employees · 5 Investments · 6 Grant Amount ·
//   7 Date Agreement Approved (yyyy/mm/dd) · 8 Amount Recaptured
// "Grant Amount" is the CalCompetes CREDIT (the incentive). Location is city-level
// and often multi-city → county_name is left null (like OK); rows land but write
// no INC-* attribute until a city→county resolver exists (documented, not fabricated).
const TABLE = "#footable_73522";

export default {
  source_key: "ca_calcompetes",
  state_abbr: "CA",
  url: "https://business.ca.gov/california-competes-tax-credit/grant-awardee-list/",

  async load(page) {
    await page.goto(this.url, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector(`${TABLE} tbody tr td`, { timeout: 60000 });
    // The FooTable pager renders a beat after the rows; wait for it so the first
    // pagination attempt doesn't see an empty pager and stop after page 1.
    await page.waitForSelector(`${TABLE} tr.footable-paging li[data-page="next"]`, { timeout: 30000 }).catch(() => {});
  },

  async extract(page) {
    const seen = new Set();
    const rows = [];
    const money = (s) => (s ? s.replace(/[$,]/g, "").trim() : null);
    const date = (s) => {
      const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s || "");
      return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
    };

    for (let guard = 0; guard < 400; guard++) {
      const pageRows = await page.$$eval(
        `${TABLE} tbody tr`,
        (trs) => trs
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
          county_name: null, // city-level / multi-city — resolved only once a city→county map exists
          incentive_type: "credit",
          raw_incentive_type: "California Competes Tax Credit",
          program_name: "California Competes Tax Credit",
          statute_citation: "Cal. R&TC §§17059.2, 23689",
          award_value_usd: money(c[6]),
          term_start: date(c[7]),
          source_record_id: `${c[0]}:${c[7]}`,
          source_url: "https://business.ca.gov/california-competes-tax-credit/grant-awardee-list/",
          raw: {
            name: c[0], location: c[2], industry: c[3], net_new_ft: c[4],
            investments: c[5], grant_amount: c[6], date_approved: c[7], amount_recaptured: c[8] ?? null,
          },
        });
      }

      // Advance the canonical FooTable bottom pager (tr.footable-paging). Click
      // its "next" anchor via direct DOM .click() (fires FooTable's handler). Stop
      // when it's disabled/absent OR the first row stops changing (last page).
      const NEXT = `${TABLE} tr.footable-paging li.footable-page-nav[data-page="next"]`;
      if (guard === 0) {
        const diag = await page.evaluate((s) => {
          const li = document.querySelector(s);
          return { found: !!li, disabled: li ? li.classList.contains("disabled") : null };
        }, NEXT);
        console.log(`ca_calcompetes pager diag: ${JSON.stringify(diag)}`);
      }
      const before = pageRows[0]?.[0] ?? "";
      const state = await page.evaluate((s) => {
        const li = document.querySelector(s);
        if (!li) return "no-pager";
        if (li.classList.contains("disabled")) return "disabled";
        (li.querySelector("a") || li).click();
        return "clicked";
      }, NEXT);
      if (state !== "clicked") break;
      await page.waitForFunction(
        ([sel, prev]) => {
          const tr = document.querySelector(`${sel} tbody tr`);
          const first = tr ? (tr.querySelector("td")?.innerText || "").trim() : "";
          return first && first !== prev;
        },
        [TABLE, before],
        { timeout: 12000 },
      ).catch(() => {});
      const after = await page.$eval(`${TABLE} tbody tr td`, (td) => (td.innerText || "").trim()).catch(() => "");
      if (after === before) break; // first row didn't change → last page reached
      if (guard % 10 === 0) console.log(`  …page ${guard + 1}, ${rows.length} rows so far`);
    }
    console.log(`ca_calcompetes: paginated ${rows.length} rows`);
    return rows;
  },
};
