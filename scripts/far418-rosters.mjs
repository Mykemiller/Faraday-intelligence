// far418-rosters.mjs — CC-BOUNDSTONE-INGEST-1.1 §7 (FAR-418).
// ONE roster, two generated outputs: the source_registry seed (engine) and the
// boundstone.allowed_source_domains seed. Generating both from the same file is
// what keeps the allowlist complete as sources are added, instead of relying on
// somebody remembering a state (§3.2).
//
// Nothing here is hand-entered per state where a list already existed:
//   * STATES        — the 50 states + DC. Fixed, closed, and the spine of §7.1/§7.2.
//   * MARKETS       — the 7 US organized markets. Fixed and closed.
//   * PUC_EXISTING  — read from the live registry by the generator, not typed here.
//   * IOUS          — read from eia_utility_territories by the generator (§7.4).
//
// URL PROVENANCE IS RECORDED, NOT ASSUMED. Every emitted row carries
// fetch_config.url_provenance:
//   'known'   — the endpoint is already in the registry and has been probed
//   'pattern' — derived from the dominant naming convention, NOT yet verified
// A 'pattern' row is registered, never activated. `source-poller verify` is the
// only thing that may activate it, and a wrong guess ends in status='error' and
// is reported by the §8 staleness monitor rather than sitting silently. That is
// the design: a URL we could not confirm must fail loudly, not look like
// coverage. See docs/far-418/source-expansion-report.md.

/** 50 states + DC. abbr → { name, govHost } */
export const STATES = {
  AL: { name: "Alabama", govHost: "governor.alabama.gov" },
  AK: { name: "Alaska", govHost: "gov.alaska.gov" },
  AZ: { name: "Arizona", govHost: "azgovernor.gov" },
  AR: { name: "Arkansas", govHost: "governor.arkansas.gov" },
  CA: { name: "California", govHost: "www.gov.ca.gov" },
  CO: { name: "Colorado", govHost: "www.colorado.gov/governor" },
  CT: { name: "Connecticut", govHost: "portal.ct.gov/office-of-the-governor" },
  DE: { name: "Delaware", govHost: "governor.delaware.gov" },
  DC: { name: "District of Columbia", govHost: "mayor.dc.gov" },
  FL: { name: "Florida", govHost: "www.flgov.com" },
  GA: { name: "Georgia", govHost: "gov.georgia.gov" },
  HI: { name: "Hawaii", govHost: "governor.hawaii.gov" },
  ID: { name: "Idaho", govHost: "gov.idaho.gov" },
  IL: { name: "Illinois", govHost: "www.illinois.gov/government/executive-branch/governor" },
  IN: { name: "Indiana", govHost: "www.in.gov/gov" },
  IA: { name: "Iowa", govHost: "governor.iowa.gov" },
  KS: { name: "Kansas", govHost: "governor.kansas.gov" },
  KY: { name: "Kentucky", govHost: "www.kentucky.gov/Pages/governor.aspx" },
  LA: { name: "Louisiana", govHost: "gov.louisiana.gov" },
  ME: { name: "Maine", govHost: "www.maine.gov/governor" },
  MD: { name: "Maryland", govHost: "governor.maryland.gov" },
  MA: { name: "Massachusetts", govHost: "www.mass.gov/orgs/office-of-the-governor" },
  MI: { name: "Michigan", govHost: "www.michigan.gov/whitmer" },
  MN: { name: "Minnesota", govHost: "mn.gov/governor" },
  MS: { name: "Mississippi", govHost: "governorreeves.ms.gov" },
  MO: { name: "Missouri", govHost: "governor.mo.gov" },
  MT: { name: "Montana", govHost: "governor.mt.gov" },
  NE: { name: "Nebraska", govHost: "governor.nebraska.gov" },
  NV: { name: "Nevada", govHost: "gov.nv.gov" },
  NH: { name: "New Hampshire", govHost: "www.governor.nh.gov" },
  NJ: { name: "New Jersey", govHost: "www.nj.gov/governor" },
  NM: { name: "New Mexico", govHost: "www.governor.state.nm.us" },
  NY: { name: "New York", govHost: "www.governor.ny.gov" },
  NC: { name: "North Carolina", govHost: "governor.nc.gov" },
  ND: { name: "North Dakota", govHost: "www.governor.nd.gov" },
  OH: { name: "Ohio", govHost: "governor.ohio.gov" },
  OK: { name: "Oklahoma", govHost: "oklahoma.gov/governor.html" },
  OR: { name: "Oregon", govHost: "www.oregon.gov/gov" },
  PA: { name: "Pennsylvania", govHost: "www.pa.gov/governor" },
  RI: { name: "Rhode Island", govHost: "governor.ri.gov" },
  SC: { name: "South Carolina", govHost: "governor.sc.gov" },
  SD: { name: "South Dakota", govHost: "governor.sd.gov" },
  TN: { name: "Tennessee", govHost: "www.tn.gov/governor" },
  TX: { name: "Texas", govHost: "gov.texas.gov" },
  UT: { name: "Utah", govHost: "governor.utah.gov" },
  VT: { name: "Vermont", govHost: "governor.vermont.gov" },
  VA: { name: "Virginia", govHost: "www.governor.virginia.gov" },
  WA: { name: "Washington", govHost: "governor.wa.gov" },
  WV: { name: "West Virginia", govHost: "governor.wv.gov" },
  WI: { name: "Wisconsin", govHost: "evers.wi.gov" },
  WY: { name: "Wyoming", govHost: "governor.wyo.gov" },
};

/**
 * The 7 US organized markets. Every one is a PRIVATE CORPORATION, so not one
 * passes boundstone.is_government_host() — which is exactly why Decision 4
 * (they are legitimate, quotable sources) needs an allowlist rather than a
 * widened TLD regex ([REC-2]).
 *
 * `queueKey` marks the three rows that ALREADY exist in the registry. All three
 * are generation-queue DATA PRODUCTS, not notices lanes — that is the §0
 * finding "0 of 7 organizations produce notices". The notices lane is the new
 * thing here; the queue lane is a licence-status correction.
 */
export const MARKETS = [
  { key: "caiso", name: "California ISO", domain: "caiso.com", noticesPath: "/informed/Pages/Notifications/Default.aspx", queueKey: null },
  { key: "ercot", name: "Electric Reliability Council of Texas", domain: "ercot.com", noticesPath: "/services/comm/mkt_notices", queueKey: "iso:ercot-gis" },
  { key: "isone", name: "ISO New England", domain: "iso-ne.com", noticesPath: "/participate/participant-readiness/", queueKey: null },
  { key: "miso", name: "Midcontinent ISO", domain: "misoenergy.org", noticesPath: "/markets-and-operations/communications/", queueKey: "iso:miso-queue" },
  { key: "nyiso", name: "New York ISO", domain: "nyiso.com", noticesPath: "/market-notices", queueKey: null },
  { key: "pjm", name: "PJM Interconnection", domain: "pjm.com", noticesPath: "/markets-and-operations/etools/oasis/system-information", queueKey: "iso:pjm-queue" },
  { key: "spp", name: "Southwest Power Pool", domain: "spp.org", noticesPath: "/news-list/", queueKey: null },
];

/** Portal software families for §7.2. Adapters are written PER FAMILY and
 * states are mapped onto them — five adapters cover the great majority of 51,
 * where fifty-one bespoke scrapers would cover about six before anyone tired.
 * Detection is by URL shape, so a state that migrates portals re-classifies
 * itself without a code change. */
export const PORTAL_FAMILIES = [
  { family: "salesforce_experience", match: /\.my\.site\.com|force\.com|\.my\.salesforce\.com/i },
  { family: "oracle_apex", match: /\/apex\/|\/pls\//i },
  { family: "aspnet_webforms", match: /\.aspx(\?|$)/i },
  { family: "custom_rest", match: /\/api\/|\/rest\/|\/services\//i },
  { family: "static_index", match: /.*/ },
];

export function portalFamily(url) {
  for (const f of PORTAL_FAMILIES) if (f.match.test(url ?? "")) return f.family;
  return "static_index";
}

/** Docket-search terms, applied uniformly to every commission (§7.2). Generic
 * instrument vocabulary only — no state's own tariff name is hardcoded, because
 * a term list that grows a special case per state is a tuning surface (§6.7). */
export const PUC_QUERY_TERMS = ["data center", "large load", "interconnection", "load interconnection"];

export const STATE_ABBRS = Object.keys(STATES);

/** SQL string literal escaping. */
export const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
