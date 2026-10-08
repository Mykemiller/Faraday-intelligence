// FDY-88 — unit tests for the "local gov watch" v2 query builder and the
// per-item jurisdiction attribution flag (local-query.ts).
//
// WHAT MAKES THIS WORTH ANYTHING: the v1 strings asserted here are VERBATIM
// fetch_config.query values read read-only from production (project
// ycadmmngkdhvpcsrcuaq, public.source_registry) on 2026-10-07. They are not
// guesses about what the old generator probably produced. The Oregon case in
// particular — where the state abbreviation IS the OR operator — is the live
// value, and it is the reason the Redmond / Klamath Falls feeds filled with
// Kansas and Indiana stories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATE_NAMES,
  attributionNames,
  baseVariants,
  buildLocalQuery,
  buildLocalQueryV1,
  classifyLocalName,
  googleNewsFeedUrl,
  gsearchSeedUrl,
  hasTopLevelBareOr,
  localAttribution,
  localJurisdictionFromEntity,
  localSourceKey,
  stripKindSuffix,
} from "../supabase/functions/source-poller/local-query.ts";
import { parseFeed } from "../supabase/functions/source-poller/poller-pure.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER = resolve(ROOT, "docs/far-88/loc-watch-entities.txt");

const PLACE_TOPIC = '("data center" OR "data centers" OR "data centre")';
const AREA_TOPIC = '("data center" OR "data centers")';
const CITY_ACTION =
  '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council")';
const AREA_ACTION =
  "(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)";

const jur = (name, stateAbbr) => ({ name, stateAbbr });

// ── v1, verbatim from production ──────────────────────────────────────────────
// select fetch_config->>'query' from public.source_registry where source_key in (…)
const LIVE_V1 = {
  "gsearch:loc-redmond-city-or":
    '"Redmond city" OR data center OR rezoning OR zoning OR moratorium',
  "gsearch:loc-klamath-falls-city-or":
    '"Klamath Falls city" OR data center OR rezoning OR zoning OR moratorium',
  "gsearch:loc-assumption-parish-la":
    '"Assumption Parish" LA data center OR rezoning OR zoning OR moratorium',
  "gsearch:loc-alvan-alvin-village-il":
    '"Alvan (Alvin) village" IL data center OR rezoning OR zoning OR moratorium',
  "gsearch:loc-archbold-village-oh":
    '"Archbold village" OH data center OR rezoning OR zoning OR moratorium',
  "gsearch:loc-alicia-town-ar":
    '"Alicia town" AR data center OR rezoning OR zoning OR moratorium',
};

test("buildLocalQueryV1 reproduces the live v1 strings exactly", () => {
  const entities = {
    "gsearch:loc-redmond-city-or": "Redmond city, OR",
    "gsearch:loc-klamath-falls-city-or": "Klamath Falls city, OR",
    "gsearch:loc-assumption-parish-la": "Assumption Parish, LA",
    "gsearch:loc-alvan-alvin-village-il": "Alvan (Alvin) village, IL",
    "gsearch:loc-archbold-village-oh": "Archbold village, OH",
    "gsearch:loc-alicia-town-ar": "Alicia town, AR",
  };
  for (const [key, entity] of Object.entries(entities)) {
    assert.equal(localSourceKey(entity), key, `source_key for ${entity}`);
    assert.equal(buildLocalQueryV1(localJurisdictionFromEntity(entity)), LIVE_V1[key]);
  }
});

test("every live v1 query has a top-level bare OR — the defect under repair", () => {
  for (const [key, q] of Object.entries(LIVE_V1)) {
    assert.ok(hasTopLevelBareOr(q), `${key} should be flagged: ${q}`);
  }
});

test("Oregon regression: the state abbreviation was being read as the operator", () => {
  // Live production value. 'OR' here is the state, but Google parses it as the
  // alternation operator, which is what diluted the Redmond feed nationally.
  const v1 = LIVE_V1["gsearch:loc-redmond-city-or"];
  assert.match(v1, /^"Redmond city" OR /);
  const v2 = buildLocalQuery(jur("Redmond city", "OR"));
  assert.ok(!hasTopLevelBareOr(v2), v2);
  assert.ok(v2.includes('"Oregon"'), "state is spelled out and quoted");
  assert.ok(!v2.includes("Redmond city"), "the Census LSAD suffix is gone");
  assert.ok(!/\bOR\b/.test(v2.replace(/\([^()]*\)/g, " ")), "no OR survives outside a group");
});

// ── per-kind shapes ───────────────────────────────────────────────────────────
test("place/city query has the specified shape", () => {
  assert.equal(
    buildLocalQuery(jur("Acworth city", "GA")),
    `("Acworth" OR "City of Acworth") ${PLACE_TOPIC} ${CITY_ACTION} "Georgia"`,
  );
});

test("place/town uses Town of and adds the town council term", () => {
  assert.equal(
    buildLocalQuery(jur("Alicia town", "AR")),
    `("Alicia" OR "Town of Alicia") ${PLACE_TOPIC} ` +
      '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council" OR "town council") ' +
      '"Arkansas"',
  );
});

test("place/village uses Village of and adds the village board term", () => {
  assert.equal(
    buildLocalQuery(jur("Archbold village", "OH")),
    `("Archbold" OR "Village of Archbold") ${PLACE_TOPIC} ` +
      '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council" OR "village board") ' +
      '"Ohio"',
  );
});

test("place/borough (lowercase LSAD) uses Borough of", () => {
  const q = buildLocalQuery(jur("Dillsburg borough", "PA"));
  assert.ok(q.startsWith('("Dillsburg" OR "Borough of Dillsburg") '), q);
  assert.ok(q.includes('"borough council"'), q);
  assert.ok(q.endsWith('"Pennsylvania"'), q);
});

test("place/CDP and place/municipality degrade to the bare base name", () => {
  assert.equal(
    buildLocalQuery(jur("Reston CDP", "VA")),
    `("Reston") ${PLACE_TOPIC} ${CITY_ACTION} "Virginia"`,
  );
  assert.equal(
    buildLocalQuery(jur("Monroeville municipality", "PA")),
    `("Monroeville" OR "Municipality of Monroeville") ${PLACE_TOPIC} ${CITY_ACTION} "Pennsylvania"`,
  );
});

test("county query has the specified shape", () => {
  assert.equal(
    buildLocalQuery(jur("Cobb County", "GA")),
    `("Cobb County") ${AREA_TOPIC} ${AREA_ACTION} "Georgia"`,
  );
});

test("parish query keeps the parish name whole", () => {
  assert.equal(
    buildLocalQuery(jur("Assumption Parish", "LA")),
    `("Assumption Parish") ${AREA_TOPIC} ${AREA_ACTION} "Louisiana"`,
  );
});

test("Alaska borough-county (capitalised Borough) is treated as an area, not a place", () => {
  assert.equal(classifyLocalName("Kodiak Island Borough"), "borough_county");
  assert.equal(
    buildLocalQuery(jur("Kodiak Island Borough", "AK")),
    `("Kodiak Island Borough") ${AREA_TOPIC} ${AREA_ACTION} "Alaska"`,
  );
});

test("Puerto Rico municipio gets the Spanish form too", () => {
  assert.equal(
    buildLocalQuery(jur("Cataño Municipio", "PR")),
    `("Cataño Municipio" OR "Municipio de Cataño") ${AREA_TOPIC} ${AREA_ACTION} "Puerto Rico"`,
  );
});

test("township (cousub) covers the charter-township variant either way round", () => {
  const expected =
    '("Allendale Township" OR "Allendale Charter Township") ' +
    `${AREA_TOPIC} ` +
    '(moratorium OR rezoning OR zoning OR ordinance OR "township board") ' +
    '"Michigan"';
  assert.equal(buildLocalQuery(jur("Allendale charter township", "MI")), expected);
  assert.equal(buildLocalQuery(jur("Allendale township", "MI")), expected);
});

// ── base-name handling ───────────────────────────────────────────────────────
test("only the trailing LSAD word is stripped", () => {
  assert.equal(stripKindSuffix("Forrest City city", "city"), "Forrest City");
  assert.equal(stripKindSuffix("Cave City city", "city"), "Cave City");
  assert.equal(stripKindSuffix("Wiederkehr Village city", "city"), "Wiederkehr Village");
  assert.equal(stripKindSuffix("Junction City village", "village"), "Junction City");
  assert.equal(stripKindSuffix("Central City town", "town"), "Central City");
  assert.equal(stripKindSuffix("Cobb County", "county"), "Cobb");
  assert.equal(stripKindSuffix("Allendale charter township", "township"), "Allendale");
});

test("Census parenthetical alternates become extra quoted variants", () => {
  assert.deepEqual(baseVariants("Alvan (Alvin) village", "village"), ["Alvan", "Alvin"]);
  assert.deepEqual(baseVariants("Fredonia (Biscoe) town", "town"), ["Fredonia", "Biscoe"]);
  assert.equal(
    buildLocalQuery(jur("Alvan (Alvin) village", "IL")),
    '("Alvan" OR "Village of Alvan" OR "Alvin" OR "Village of Alvin") ' +
      `${PLACE_TOPIC} ` +
      '(moratorium OR rezoning OR zoning OR ordinance OR "planning commission" OR "city council" OR "village board") ' +
      '"Illinois"',
  );
});

test("apostrophes and hyphens survive intact", () => {
  assert.ok(buildLocalQuery(jur("Reile's Acres city", "ND")).startsWith('("Reile\'s Acres" OR '));
  assert.equal(
    buildLocalQuery(jur("Miami-Dade County", "FL")),
    `("Miami-Dade County") ${AREA_TOPIC} ${AREA_ACTION} "Florida"`,
  );
});

test("an unknown state abbreviation is omitted, never interpolated bare", () => {
  const q = buildLocalQuery(jur("Nowhere city", "ZZ"));
  assert.equal(q, `("Nowhere" OR "City of Nowhere") ${PLACE_TOPIC} ${CITY_ACTION}`);
  assert.ok(!hasTopLevelBareOr(q));
  assert.ok(!/\bZZ\b/.test(q));
});

test("STATE_NAMES covers the 50 states plus DC and PR", () => {
  assert.equal(Object.keys(STATE_NAMES).length, 52);
  assert.equal(STATE_NAMES.OR, "Oregon");
  assert.equal(STATE_NAMES.IN, "Indiana");
  assert.equal(STATE_NAMES.PR, "Puerto Rico");
});

// ── the invariant, across the whole live roster ───────────────────────────────
test("hasTopLevelBareOr distinguishes top level from inside a group or a phrase", () => {
  assert.ok(hasTopLevelBareOr('"a" OR "b"'));
  assert.ok(hasTopLevelBareOr('("a" OR "b") OR zoning'));
  assert.ok(hasTopLevelBareOr("data center OR zoning"));
  assert.ok(!hasTopLevelBareOr('("a" OR "b") ("c" OR "d") "Oregon"'));
  assert.ok(!hasTopLevelBareOr('("ORLANDO" OR "City of ORLANDO") "Florida"'));
  assert.ok(!hasTopLevelBareOr('"Oregon OR Washington"'), "an OR inside a phrase is literal");
  assert.ok(hasTopLevelBareOr("zoning OR"), "a trailing OR counts");
});

test("no built query for any of the 1,000 live roster rows has a top-level bare OR", () => {
  const entities = readFileSync(ROSTER, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  assert.equal(entities.length, 1000, "roster snapshot size");
  const kinds = {};
  for (const entity of entities) {
    const j = localJurisdictionFromEntity(entity);
    assert.ok(j, `parseable: ${entity}`);
    const kind = classifyLocalName(j.name);
    assert.notEqual(kind, "other", `classifiable: ${entity}`);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    const q = buildLocalQuery(j);
    assert.ok(!hasTopLevelBareOr(q), `${entity} → ${q}`);
    assert.ok(q.endsWith('"'), `${entity} ends with the quoted state`);
    assert.ok(!/\bOR\b/.test(q.replace(/\([^()]*\)/g, " ")), `${entity} has an OR outside a group`);
    // For places the Census LSAD suffix must not survive into the query; for
    // counties / parishes / municipios the Census name IS the news name.
    if (["city", "town", "village", "borough", "cdp", "municipality"].includes(kind)) {
      assert.ok(!q.includes(j.name), `${entity} must not carry the raw Census name`);
    }
  }
  // Composition measured read-only against production on 2026-10-07.
  assert.deepEqual(kinds, {
    city: 539,
    county: 267,
    town: 142,
    village: 28,
    parish: 22,
    municipio: 2,
  });
});

// ── attribution ──────────────────────────────────────────────────────────────
// A fixture modelled on the live dilution: stories returned under the Redmond,
// OR feed that are about other jurisdictions entirely.
const REDMOND_FEED_FIXTURE = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>"Redmond city" OR data center OR rezoning OR zoning OR moratorium - Google News</title>
<item><title>Redmond City Council weighs data center moratorium</title>
<link>https://example-news.com/redmond-moratorium</link>
<pubDate>Mon, 05 Oct 2026 09:00:00 GMT</pubDate>
<description><![CDATA[Councillors in Redmond asked staff for a draft ordinance.]]></description></item>
<item><title>Sedgwick County commissioners approve rezoning for data center</title>
<link>https://example-news.com/sedgwick</link>
<description><![CDATA[The Kansas county signed off on a 300-acre campus.]]></description></item>
<item><title>St. Croix County extends zoning moratorium</title>
<link>https://example-news.com/stcroix</link>
<description><![CDATA[Wisconsin supervisors want more study time.]]></description></item>
<item><title>Michigan City weighs its own data center ordinance</title>
<link>https://example-news.com/michigancity</link>
<description><![CDATA[Indiana officials cite grid capacity.]]></description></item>
<item><title>Zoning board notes</title>
<link>https://example-news.com/notes</link>
<description><![CDATA[Coverage of the City of Redmond planning commission agenda.]]></description></item>
</channel></rss>`;

test("attribution flags each item named or unmatched, and drops nothing", () => {
  const items = parseFeed(REDMOND_FEED_FIXTURE);
  assert.equal(items.length, 5, "every item is kept");
  const redmond = jur("Redmond city", "OR");
  const flags = items.map((it) => localAttribution(it, redmond));
  assert.deepEqual(flags, ["named", "unmatched", "unmatched", "unmatched", "named"]);
  // 2 of 5 named: this is the measurable dilution the flag exists to expose.
  assert.equal(flags.filter((f) => f === "named").length, 2);
});

test("attribution matches on the description as well as the title", () => {
  const redmond = jur("Redmond city", "OR");
  assert.equal(
    localAttribution({ title: "Zoning board notes", summary: "the City of Redmond agenda" }, redmond),
    "named",
  );
  assert.equal(localAttribution({ title: "Zoning board notes", summary: "" }, redmond), "unmatched");
});

test("attribution is word-boundary, not substring", () => {
  const normal = jur("Normal town", "IL");
  assert.equal(localAttribution({ title: "Normal residents oppose campus" }, normal), "named");
  assert.equal(localAttribution({ title: "Abnormality in the filing" }, normal), "unmatched");
  const cobb = jur("Cobb County", "GA");
  assert.equal(localAttribution({ title: "Cobb weighs rezoning" }, cobb), "named");
  assert.equal(localAttribution({ title: "Cobbler shop opens" }, cobb), "unmatched");
});

test("attribution is case-insensitive and uses the base name, not the LSAD form", () => {
  const acworth = jur("Acworth city", "GA");
  assert.equal(localAttribution({ title: "ACWORTH approves ordinance" }, acworth), "named");
  // No real headline says "Acworth city" — the base name is what gets matched.
  assert.deepEqual(attributionNames(acworth), ["Acworth"]);
  assert.deepEqual(attributionNames(jur("Alvan (Alvin) village", "IL")), ["Alvan", "Alvin"]);
});

test("attribution never throws on a jurisdiction with regex metacharacters", () => {
  const stCharles = jur("St. Charles town", "AR");
  assert.equal(localAttribution({ title: "St. Charles council" }, stCharles), "named");
  assert.equal(localAttribution({ title: "StXCharles council" }, stCharles), "unmatched");
});

test("localJurisdictionFromEntity parses the lane's entity shape", () => {
  assert.deepEqual(localJurisdictionFromEntity("Acworth city, GA"), {
    name: "Acworth city",
    stateAbbr: "GA",
    entity: "Acworth city, GA",
  });
  assert.deepEqual(localJurisdictionFromEntity("Cataño Municipio, PR"), {
    name: "Cataño Municipio",
    stateAbbr: "PR",
    entity: "Cataño Municipio, PR",
  });
  assert.equal(localJurisdictionFromEntity("Southern California Edison"), null);
  assert.equal(localJurisdictionFromEntity(""), null);
});

// ── URL encoding parity with the SQL that built every other gsearch row ──────
test("gsearchSeedUrl is byte-identical to public.gsearch_seed_url", () => {
  // Both expectations are the LIVE output of
  //   select public.gsearch_seed_url(<the query to the left>)
  // on project ycadmmngkdhvpcsrcuaq, read 2026-10-07.
  assert.equal(
    gsearchSeedUrl(buildLocalQuery(jur("Redmond city", "OR"))),
    "%28%22Redmond%22%20OR%20%22City%20of%20Redmond%22%29%20%28%22data%20center%22%20OR%20%22data%20centers%22%20OR%20%22data%20centre%22%29%20%28moratorium%20OR%20rezoning%20OR%20zoning%20OR%20ordinance%20OR%20%22planning%20commission%22%20OR%20%22city%20council%22%29%20%22Oregon%22",
  );
  assert.equal(
    gsearchSeedUrl(
      '("Reile\'s Acres" OR "City of Reile\'s Acres") ("data center" OR "data centers") (a&b) 100%/50',
    ),
    "%28%22Reile%27s%20Acres%22%20OR%20%22City%20of%20Reile%27s%20Acres%22%29%20%28%22data%20center%22%20OR%20%22data%20centers%22%29%20%28a%26b%29%20100%25%2F50",
  );
});

test("googleNewsFeedUrl keeps the lane's hl/gl/ceid tail", () => {
  const u = googleNewsFeedUrl(buildLocalQuery(jur("Cobb County", "GA")));
  assert.ok(u.startsWith("https://news.google.com/rss/search?q="));
  assert.ok(u.endsWith("&hl=en-US&gl=US&ceid=US:en"));
  assert.ok(u.includes("%22Cobb%20County%22"));
});
