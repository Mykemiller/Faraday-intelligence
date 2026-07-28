// CA — California Competes Tax Credit (CalCompetes) awardee list.
// GO-Biz publishes recipient-level awards (company, county/city, credit amount,
// fiscal year) as a JS-rendered table on business.ca.gov. Primary disclosure,
// but captured by headless render → registered at INF (not SRC).
export default {
  source_key: "ca_calcompetes",
  state_abbr: "CA",
  url: "https://business.ca.gov/california-competes-tax-credit/grant-awardee-list/",

  async load(page) {
    await page.goto(this.url, { waitUntil: "networkidle", timeout: 90000 });
    // The awardee table is populated by client JS; wait until it actually has rows.
    await page
      .waitForFunction(() => {
        const t = document.querySelector("table");
        return t && t.querySelectorAll("tr").length > 3;
      }, { timeout: 60000 })
      .catch(() => { /* dump mode still prints whatever rendered */ });
  },

  // Implemented from the real DOM after a `--mode dump` run (see the GH Actions
  // logs). Guarded until then so we never push guessed/empty data.
  async extract(_page) {
    throw new Error(
      "ca_calcompetes extract() not yet mapped — run `--mode dump` first, then " +
      "implement column mapping from the rendered table structure."
    );
  },
};
