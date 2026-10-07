// local-query.ts — FDY-88: scoped Google News queries for the "local gov watch"
// lane (source_registry.source_key like 'gsearch:loc-%'), plus per-item
// jurisdiction attribution. Deno-free (ext-pure pattern) so `node --test` can
// import it directly.
//
// WHY THIS FILE EXISTS
// The v1 generator (supabase/migrations/0010_wave5_wave6_rosters.sql wave 6a and
// 0014_wave8_sql_extensions.sql wave 8b) built every local query as:
//
//   '"' || j.name || '" ' || j.state_abbr || ' data center OR rezoning OR zoning OR moratorium'
//
// Three separate defects follow from that one line, all confirmed against
// production (project ycadmmngkdhvpcsrcuaq) on 2026-10-07:
//
//  1. TOP-LEVEL BARE `OR`. Google News reads the unparenthesised alternation as
//     `("Acworth city" GA data center) OR rezoning OR zoning OR moratorium`, so
//     any national story containing "zoning" matches. The feed is national noise
//     wearing a local label.
//  2. THE STATE ABBREVIATION IS SOMETIMES THE OPERATOR. For Oregon the literal
//     stored query is:
//       "Redmond city" OR data center OR rezoning OR zoning OR moratorium
//     `OR` is the state, but Google parses it as the operator — the jurisdiction
//     term is reduced to one alternative among five. This is the exact reason
//     the Redmond / Klamath Falls feeds filled with Sedgwick County KS and
//     Michigan City IN stories. (The same trap is latent for `IN` and `AND`.)
//  3. THE CENSUS LSAD SUFFIX IS NOT NEWS LANGUAGE. Reporters write "Acworth" or
//     "City of Acworth", never "Acworth city". Quoting the Census name as a
//     phrase therefore suppresses true local hits.
//
// v2 fixes all three: every alternation is parenthesised, the state is spelled
// out and quoted (so no state name can ever be read as an operator), and the
// jurisdiction term uses news-language variants of the base name.
//
// INVARIANT enforced by hasTopLevelBareOr() and by the unit tests: a built query
// never contains a bare `OR` at parenthesis depth 0 outside a quoted phrase.

/** A jurisdiction as the local-gov lane stores it. `name` is the verbatim
 * Census name ("Acworth city", "Cobb County", "Allendale charter township"). */
export interface LocalJurisdiction {
  name: string;
  stateAbbr: string;
  /** The `fetch_config.entity` value this was parsed from, when applicable. */
  entity?: string;
}

/** Kind of jurisdiction, derived from the trailing word of the Census name. */
export type LocalKind =
  | "city"
  | "town"
  | "village"
  | "borough" // Census place LSAD (lowercase "borough", e.g. PA)
  | "cdp"
  | "municipality"
  | "county"
  | "parish"
  | "municipio"
  | "borough_county" // Alaska county-equivalent (capitalised "Borough")
  | "township"
  | "other";

/** Full state / territory names, keyed by the two-letter abbreviation.
 * VERBATIM from `select state_abbr, name from public.jurisdictions where
 * level='state'` on project ycadmmngkdhvpcsrcuaq, read 2026-10-07 (52 rows:
 * 50 states + DC + PR). Full names are used because news text spells states
 * out — and because a quoted phrase can never be parsed as a Google operator,
 * which an abbreviation like OR / IN can. */
export const STATE_NAMES: Record<string, string> = {
  AK: "Alaska",
  AL: "Alabama",
  AR: "Arkansas",
  AZ: "Arizona",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DC: "District of Columbia",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  PR: "Puerto Rico",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
};

const PLACE_KINDS = new Set<LocalKind>(["city", "town", "village", "borough", "cdp", "municipality"]);

/** Topic group. Places also get the British spelling (local coverage of foreign
 * operators uses it); county/township queries keep the pair the issue specifies. */
const TOPIC_PLACE = '("data center" OR "data centers" OR "data centre")';
const TOPIC_AREA = '("data center" OR "data centers")';

/** Action group per kind. The city group is the issue's specification verbatim;
 * town / village / borough append their own governing-body term. Adding terms
 * INSIDE this group can only widen the subject matter, never the geography —
 * the name group and the quoted state still bound every result. */
const ACTION_CITY_TERMS = [
  "moratorium",
  "rezoning",
  "zoning",
  "ordinance",
  '"planning commission"',
  '"city council"',
];
const ACTION_AREA = '(moratorium OR rezoning OR zoning OR ordinance OR commissioners OR supervisors)';
const ACTION_TOWNSHIP = '(moratorium OR rezoning OR zoning OR ordinance OR "township board")';

function group(terms: string[]): string {
  return `(${terms.join(" OR ")})`;
}

/** Classify a Census name by its trailing word.
 *
 * Case matters for "borough": Census writes place LSADs in lower case
 * ("Dillsburg borough", PA) and county-equivalents capitalised
 * ("Kodiak Island Borough", AK), so the capitalisation is the signal.
 *
 * Production composition of the 1,000 live rows (measured 2026-10-07):
 * city 539 · County 267 · town 142 · village 28 · Parish 22 · Municipio 2.
 * No township / cousub rows exist in the lane today — waves 6a and 8b selected
 * `level in ('county','place')` only — but the township branch is specified,
 * implemented and tested so the L6 expansion lands on working code. */
export function classifyLocalName(name: string): LocalKind {
  const trimmed = name.trim();
  if (/\s(charter\s+)?township$/i.test(trimmed)) return "township";
  const last = trimmed.split(/\s+/).pop() ?? "";
  switch (last) {
    case "city":
      return "city";
    case "town":
      return "town";
    case "village":
      return "village";
    case "borough":
      return "borough";
    case "CDP":
      return "cdp";
    case "municipality":
      return "municipality";
    case "County":
      return "county";
    case "Parish":
      return "parish";
    case "Municipio":
      return "municipio";
    case "Borough":
      return "borough_county";
    default:
      return "other";
  }
}

/** Strip the trailing kind word(s) from a Census name.
 * "Acworth city" → "Acworth"; "Cobb County" → "Cobb";
 * "Allendale charter township" → "Allendale"; "Forrest City city" → "Forrest City". */
export function stripKindSuffix(name: string, kind: LocalKind): string {
  const trimmed = name.trim();
  if (kind === "township") return trimmed.replace(/\s+(charter\s+)?township$/i, "");
  if (kind === "other") return trimmed;
  return trimmed.replace(/\s+\S+$/, "");
}

/** News-language variants of the base name.
 * Census carries alternate names in parentheses ("Alvan (Alvin) village",
 * "Fredonia (Biscoe) town" — the only two such rows in the lane). Both the
 * primary and the alternate are returned, primary first. */
export function baseVariants(name: string, kind: LocalKind): string[] {
  const stem = stripKindSuffix(name, kind);
  const alt = stem.match(/\(([^)]+)\)/)?.[1]?.trim();
  const primary = stem.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const out = [primary];
  if (alt && alt !== primary) out.push(alt);
  return out.filter((s) => s.length > 0);
}

/** Names used for per-item attribution — the base stem(s), with no governing
 * prefix. "Cobb County" attributes on "Cobb"; "Acworth city" on "Acworth". */
export function attributionNames(j: LocalJurisdiction): string[] {
  return baseVariants(j.name, classifyLocalName(j.name));
}

const GOV_PREFIX: Partial<Record<LocalKind, string>> = {
  city: "City of",
  town: "Town of",
  village: "Village of",
  borough: "Borough of",
  municipality: "Municipality of",
};

/** The parenthesised jurisdiction-name group. */
function nameGroup(j: LocalJurisdiction, kind: LocalKind): string {
  const variants = baseVariants(j.name, kind);
  const full = j.name.trim();
  if (PLACE_KINDS.has(kind)) {
    const prefix = GOV_PREFIX[kind];
    const terms: string[] = [];
    for (const v of variants) {
      terms.push(`"${v}"`);
      if (prefix) terms.push(`"${prefix} ${v}"`);
    }
    return group(terms);
  }
  if (kind === "township") {
    const terms: string[] = [];
    for (const v of variants) {
      terms.push(`"${v} Township"`, `"${v} Charter Township"`);
    }
    return group(terms);
  }
  if (kind === "municipio") {
    const terms = [`"${full}"`];
    for (const v of variants) terms.push(`"Municipio de ${v}"`);
    return group(terms);
  }
  // county / parish / borough_county / other: the Census name already carries
  // the governing word ("Cobb County", "Assumption Parish"), and the bare stem
  // alone would be far too loose to use as a search term.
  return group([`"${full}"`]);
}

function topicGroup(kind: LocalKind): string {
  return PLACE_KINDS.has(kind) ? TOPIC_PLACE : TOPIC_AREA;
}

function actionGroup(kind: LocalKind): string {
  if (kind === "township") return ACTION_TOWNSHIP;
  if (!PLACE_KINDS.has(kind)) return ACTION_AREA;
  const extra: Partial<Record<LocalKind, string>> = {
    town: '"town council"',
    village: '"village board"',
    borough: '"borough council"',
  };
  const add = extra[kind];
  return group(add ? [...ACTION_CITY_TERMS, add] : ACTION_CITY_TERMS);
}

/** Build the v2 Google News query for a local-gov jurisdiction.
 * Shape: <name group> <topic group> <action group> "<State>" — four fully
 * parenthesised / quoted parts, no bare top-level OR, no bare abbreviation. */
export function buildLocalQuery(j: LocalJurisdiction): string {
  const kind = classifyLocalName(j.name);
  const parts = [nameGroup(j, kind), topicGroup(kind), actionGroup(kind)];
  const state = STATE_NAMES[j.stateAbbr?.trim().toUpperCase() ?? ""];
  // An unknown abbreviation is omitted rather than interpolated bare: a bare
  // two-letter token is exactly how defect 2 happened.
  if (state) parts.push(`"${state}"`);
  return parts.join(" ");
}

/** True when the query contains a bare `OR` at parenthesis depth 0 outside a
 * quoted phrase — the v1 defect this whole module exists to prevent. */
export function hasTopLevelBareOr(query: string): boolean {
  let depth = 0;
  let inQuote = false;
  let token = "";
  const flush = (): boolean => {
    const t = token;
    token = "";
    return t === "OR";
  };
  for (const ch of query) {
    if (ch === '"') {
      inQuote = !inQuote;
      if (flush()) return true;
      continue;
    }
    if (inQuote) continue;
    if (ch === "(") {
      depth++;
      if (flush()) return true;
      continue;
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      token = "";
      continue;
    }
    if (/\s/.test(ch)) {
      if (depth === 0 && flush()) return true;
      token = "";
      continue;
    }
    if (depth === 0) token += ch;
  }
  return depth === 0 && flush();
}

/** Parse a `fetch_config.entity` value ("Acworth city, GA") into a
 * jurisdiction. Returns null when the shape is not `<name>, <ST>`. */
export function localJurisdictionFromEntity(entity: string): LocalJurisdiction | null {
  const m = /^(.+),\s*([A-Za-z]{2})$/.exec(entity.trim());
  if (!m) return null;
  return { name: m[1].trim(), stateAbbr: m[2].toUpperCase(), entity: entity.trim() };
}

function wordBoundaryPattern(term: string): RegExp {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
}

/** 'named' when the item text names the jurisdiction's base name
 * (word-boundary, case-insensitive), otherwise 'unmatched'. Nothing is dropped:
 * this is a flag recorded on crawl_metadata so a diluted feed can be measured
 * and so downstream consumers can prefer named items. */
export function localAttribution(
  item: { title?: string; summary?: string | null },
  j: LocalJurisdiction,
): "named" | "unmatched" {
  const text = `${item.title ?? ""} ${item.summary ?? ""}`;
  for (const name of attributionNames(j)) {
    if (wordBoundaryPattern(name).test(text)) return "named";
  }
  return "unmatched";
}

/** Mirror of public.gsearch_seed_url(text) — the eight replacements that
 * migration 0010 defined and every gsearch feed_url in source_registry was
 * built with. Kept byte-identical so TS-built and SQL-built URLs agree. */
export function gsearchSeedUrl(q: string): string {
  return q
    .replace(/%/g, "%25")
    .replace(/&/g, "%26")
    .replace(/ /g, "%20")
    .replace(/"/g, "%22")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\//g, "%2F");
}

/** The RSS feed URL stored in source_registry.feed_url for a query. */
export function googleNewsFeedUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${gsearchSeedUrl(query)}&hl=en-US&gl=US&ceid=US:en`;
}

/** The human-facing Google News search URL stored in source_registry.url. */
export function googleNewsSearchUrl(query: string): string {
  return `https://news.google.com/search?q=${gsearchSeedUrl(query)}`;
}

/** The v1 query, reproduced exactly as waves 6a / 8b built it. Used only to
 * compare old against new in the precision check — never to write anything. */
export function buildLocalQueryV1(j: LocalJurisdiction): string {
  return `"${j.name}" ${j.stateAbbr} data center OR rezoning OR zoning OR moratorium`;
}

/** Derive the lane's source_key from the entity string. Verified against
 * production 2026-10-07: 1,000/1,000 rows reproduce exactly, 1,000 distinct. */
export function localSourceKey(entity: string): string {
  const slug = entity
    .replace(/, /g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `gsearch:loc-${slug.slice(0, 52)}`;
}
