// attribution-pure.ts — FDY-91. Decide which US state, and which named
// jurisdiction, a local-gov-watch headline is about.
//
// Deno-free (ext-pure pattern) so tests import it directly. FDY-92 imports
// `attributeHeadline` and `buildGazetteer` from here.
//
// ===========================================================================
// ⚠️ THE FEED IS NOT EVIDENCE. THIS IS THE WHOLE POINT OF THE MODULE.
// ===========================================================================
// Faraday runs 1,000 Google-News searches named `gsearch:loc-<place>-<st>`, one
// per small US jurisdiction. It is extremely tempting to take the state from the
// feed's own name — it is right there in the source_key, it is never null, and
// it needs no code. It is also WRONG, often, and measurably so. Read live from
// production 2026-10-07:
//
//   feed gsearch:loc-cherokee-county-ia  →  "Walker County committee weighs
//                                            rules for data center growth"
//                                            (Walker County is GA/AL/TX; the
//                                            publisher is the Rome News-Tribune,
//                                            Rome, Georgia)
//   feed gsearch:loc-…-or (Oregon)       →  "City of Anniston adopts resolution
//                                            that establishes temporary
//                                            moratorium…"   (Anniston, Alabama)
//   feed gsearch:loc-…-or (Oregon)       →  "Augusta Township voters overturn
//                                            Data Center rezoning"  (Michigan)
//   feed gsearch:loc-…-or (Oregon)       →  "Shawnee County commissioners
//                                            approve temporary moratorium…"
//                                            (Shawnee County is Kansas)
//   feed gsearch:loc-…-ar (Arkansas)     →  "Dubuque County supervisors explore
//                                            data center ban…"      (Iowa)
//
// Google News returns whatever it considers related to the query, not only
// items about the queried place. A press item filed under the wrong state lands
// on the wrong state's public page on boundstone.org. So the feed's state is
// used for NOTHING here — not as a signal, not as a tiebreak, not as a
// fallback. It is not even a parameter of this function.
//
// ===========================================================================
// WHAT IS USED INSTEAD, IN ORDER, AND WHAT HAPPENS WHEN NONE OF IT WORKS
// ===========================================================================
// S1  An unambiguous full state NAME in the headline.
// S2  A jurisdiction phrase in the headline that exists in exactly ONE state
//     nationally ("Bullitt County" → KY; "Carlton County" → MN).
// S3  An unambiguous upper-case USPS abbreviation that AGREES with a
//     jurisdiction phrase present in the headline ("WA … Grant County" → WA).
// otherwise  state = null, reason = 'no_honest_state', and the row is NOT
//     forwarded. press_items.state_abbr is NOT NULL and the /news page filters
//     on it, so a guessed state is a wrong fact on a public page. Declining is
//     the correct outcome, not a gap.
//
// ⚠️ RE-MEASURED 2026-10-08 against production, read-only, after this branch
// was rebased onto main. An earlier draft of this header quoted S1 1,186 /
// S2 395 / total 1,581 and omitted S3 entirely. Those numbers do not
// reproduce. The re-measurement runs all three rules over all 6,157 rows via
// scripts/boundstone-local-push-dryrun.sql, which is committed, and that SQL is
// pinned to this module by test/boundstone-local-push.test.mjs over 41 real
// headlines. Production wins. The corrected figures:
//
//   relevant window (artifacts)                              6,157
//   ... whose headline could be established                  6,157  (100%)
//   S1 resolves — an unambiguous full state name             1,125   (39 states)
//   S2 resolves — a jurisdiction unique to one state           377   (33 states)
//   S3 resolves — a USPS code agreeing with a jurisdiction        5   ( 3 states)
//   TOTAL ATTRIBUTABLE                                       1,507   (43 states)
//   declined: no_honest_state                                3,930
//   declined: ambiguous_jurisdiction                           691
//   declined: ambiguous_state_named                             29
//   TOTAL DECLINED                                           4,650
//
// Of the 1,507, 398 also carry a verbatim jurisdiction_name across 113 distinct
// jurisdictions; the rest go forward state-only, which is what the brief asks.
//
// 4,650 refusals is 76% of the window. That is the right trade, not a
// shortfall: taking the FEED's state as a fallback would "resolve" most of them,
// and the five headlines quoted above are exactly what that produces. A smaller
// true number beats a larger false one, because the false ones land on a state
// page on boundstone.org.
//
// ===========================================================================
// ⚠️ THE TRAP S1 HAS TO AVOID: "Michigan City Council to consider data center
// moratorium" (WSBT, live 2026-09-02)
// ===========================================================================
// A naive full-name scan sees "Michigan" and files this under MI. It is Michigan
// City, INDIANA. The guard is not a hand-written exception list: S1 drops a
// state-name match when the state name followed by the next word is itself a
// known place in the gazetteer ("michigan city" is a place in IN and ND), so the
// compound name wins over the bare state word. The same guard covers Kansas
// City, Oklahoma City, Iowa City, Nevada City, Texas City and anything like
// them without naming any of them.
//
// Having dropped "Michigan", nothing else in that headline resolves — "Michigan
// City" appears without a City-of/County/Township marker — so the row is
// declined. That is the right answer: the headline alone does not prove Indiana.
//
// ===========================================================================
// WHAT THIS MODULE NEVER DOES
// ===========================================================================
// * It never reads the feed, the source_url, or the Google News token.
// * It never scores, ranks or assigns a confidence to an attribution. A state is
//   either established or it is null; "probably Ohio" is not representable here
//   and must not become representable.
// * It never invents a jurisdiction_name. When the state is known but the named
//   jurisdiction is ambiguous, jurisdiction_name is null and the item is
//   forwarded state-only — which is exactly what the brief asks for.

/** One gazetteer row. `level` is collapsed to the three kinds that can match. */
export interface GazetteerRow {
  /** public.jurisdictions.name, verbatim — this is what gets forwarded. */
  name: string;
  /** Two-letter USPS abbreviation, upper case. */
  state_abbr: string;
  /** 'county' | 'cousub' | 'place' */
  kind: GazetteerKind;
}

export type GazetteerKind = "county" | "cousub" | "place";

/** The phrase forms this module recognises in a headline. */
export type PhraseKind = "county" | "township" | "cityof";

export interface Gazetteer {
  /** normalised name → rows carrying it. */
  byName: Map<string, GazetteerRow[]>;
  /** lower-cased full state name → abbreviation. */
  stateNames: Map<string, string>;
  /** every valid abbreviation, upper case. */
  abbrs: Set<string>;
}

export interface Attribution {
  /** Upper-case USPS abbreviation, or null when none could be established. */
  state_abbr: string | null;
  /** public.jurisdictions.name, verbatim, or null when ambiguous/absent. */
  jurisdiction_name: string | null;
  /** Which rule settled the state: 's1_state_name' | 's2_unique_jurisdiction' |
   *  's3_abbr_agrees' | null */
  state_rule: string | null;
  /** Why the state is null. Only set when state_abbr is null. */
  reason: string | null;
  /** The jurisdiction phrases found, for the ledger and for tests. */
  phrases: { text: string; kind: PhraseKind }[];
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------
// public.jurisdictions.name carries its type word, and the casing differs by
// level: counties are "Walker County" / "Rapides Parish" (capital), county
// subdivisions and places are lower-cased ("Center township", "Michigan City
// city", "Rome borough"). Verified live 2026-10-07. So normalisation lower-cases
// first and strips ONE trailing type word — once, not repeatedly: "Rome City
// town" must become "rome city", not "rome".
const TYPE_SUFFIX =
  /\s+(county|parish|city and borough|borough|city|town|village|township|municipality|plantation|gore|district|reservation)$/;

/** The dedupe/lookup surface for a jurisdiction name. */
export function normalizeJurisdiction(name: unknown): string {
  if (typeof name !== "string") return "";
  let s = name.toLowerCase().trim();
  // Collapse the typographic apostrophe and any internal whitespace run, so
  // "St.  Croix" and "O’Brien" match their headline spellings.
  s = s.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
  return s.replace(TYPE_SUFFIX, "").trim();
}

/** Fold a headline to the same surface: lower case, straight apostrophes,
 *  single spaces, and space-padded so a `like`-style whole-word test is safe. */
export function foldHeadline(headline: unknown): string {
  if (typeof headline !== "string") return " ";
  const s = headline
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${s} `;
}

/**
 * Build the lookup structures once per run from rows read out of
 * public.jurisdictions. 39,507 rows live (2026-10-07), of which 38,887 are at
 * the three matchable levels.
 */
export function buildGazetteer(
  rows: Iterable<{ name: unknown; state_abbr: unknown; level: unknown }>,
  stateRows: Iterable<{ name: unknown; state_abbr: unknown }>,
): Gazetteer {
  const byName = new Map<string, GazetteerRow[]>();
  for (const r of rows) {
    const lvl = String(r.level ?? "").toLowerCase();
    const kind: GazetteerKind | null = lvl === "county"
      ? "county"
      : lvl === "cousub"
      ? "cousub"
      : lvl === "place"
      ? "place"
      : null;
    if (!kind) continue;
    // ⚠️ state_abbr is CHARACTER(2) in production, so it arrives space-padded on
    // some drivers. btrim before anything else or every comparison fails.
    const st = String(r.state_abbr ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(st)) continue;
    const name = String(r.name ?? "").trim();
    if (name === "") continue;
    const norm = normalizeJurisdiction(name);
    // The length floor FDY-75's match_press_record also applies, for the same
    // reason: a name that normalises to a fragment would match everything.
    if (norm.length < 4) continue;
    const list = byName.get(norm);
    if (list) list.push({ name, state_abbr: st, kind });
    else byName.set(norm, [{ name, state_abbr: st, kind }]);
  }

  const stateNames = new Map<string, string>();
  const abbrs = new Set<string>();
  for (const r of stateRows) {
    const st = String(r.state_abbr ?? "").trim().toUpperCase();
    const nm = String(r.name ?? "").trim().toLowerCase();
    if (!/^[A-Z]{2}$/.test(st) || nm === "") continue;
    stateNames.set(nm, st);
    abbrs.add(st);
  }
  return { byName, stateNames, abbrs };
}

// ---------------------------------------------------------------------------
// Phrase extraction
// ---------------------------------------------------------------------------
// One to three capitalised words before County/Parish/Township, or after
// "City|Town|Village|Borough of". Three is the ceiling because the longest real
// multi-word names in the corpus are three ("St. Croix County", "Prince
// William County", "Lac qui Parle County" — the last is why the continuation
// allows a lower-case connective below).
const WORD = String.raw`[A-Z][A-Za-z'’.\-]*`;
const CONT = String.raw`(?:[ \-](?:qui|la|le|des|du|of|the|[A-Z][A-Za-z'’.\-]*))`;
const NAME = `${WORD}${CONT}{0,2}`;

const RE_COUNTY = new RegExp(`(${NAME})[ \\t]+(?:County|Parish)\\b`, "g");
const RE_TOWNSHIP = new RegExp(`(${NAME})[ \\t]+Township\\b`, "g");
const RE_CITYOF = new RegExp(`(?:City|Town|Village|Borough)[ \\t]+of[ \\t]+(${NAME})`, "g");

/** The jurisdiction phrases a headline contains, de-duplicated. */
export function extractPhrases(headline: string): { text: string; kind: PhraseKind }[] {
  const out: { text: string; kind: PhraseKind }[] = [];
  const seen = new Set<string>();
  const push = (raw: string, kind: PhraseKind) => {
    const text = normalizeJurisdiction(raw);
    if (text.length < 4) return;
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text, kind });
  };
  for (const [re, kind] of [
    [RE_COUNTY, "county"],
    [RE_TOWNSHIP, "township"],
    [RE_CITYOF, "cityof"],
  ] as [RegExp, PhraseKind][]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(headline)) !== null) push(m[1], kind);
  }
  return out;
}

/** Which gazetteer kinds a phrase form may match. A "X Township" headline must
 *  not match a PLACE called X, and vice versa — that is how "Center Township"
 *  stops matching every city called Center. */
function kindsFor(kind: PhraseKind): GazetteerKind[] {
  if (kind === "county") return ["county"];
  if (kind === "township") return ["cousub"];
  return ["place", "cousub"];
}

function hitsFor(g: Gazetteer, phrases: { text: string; kind: PhraseKind }[]): GazetteerRow[] {
  const out: GazetteerRow[] = [];
  for (const p of phrases) {
    const rows = g.byName.get(p.text);
    if (!rows) continue;
    const allowed = kindsFor(p.kind);
    for (const r of rows) if (allowed.includes(r.kind)) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// S3's guard: an ALL-CAPS headline makes every word upper case, so an
// upper-case two-letter token carries no signal at all. Measured shape in the
// corpus: "STATE OF THE COUNTY: Data centers, agribusiness center top
// discussion at chamber event". Without this guard "OF" is not a state but
// plenty of real codes are, and the rule would fire on noise.
// ---------------------------------------------------------------------------
function isShouty(headline: string): boolean {
  const letters = headline.replace(/[^A-Za-z]/g, "");
  if (letters.length < 12) return true; // too short to judge; refuse the rule
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.6;
}

/**
 * Attribute one headline.
 *
 * `headline` must already be the publisher's own headline — run it through
 * headline-pure.ts first. Nothing else is passed in, deliberately: see the
 * header for why the feed is not a parameter.
 */
export function attributeHeadline(headline: string, g: Gazetteer): Attribution {
  const phrases = extractPhrases(headline);
  const folded = foldHeadline(headline);
  const base: Attribution = {
    state_abbr: null,
    jurisdiction_name: null,
    state_rule: null,
    reason: "no_honest_state",
    phrases,
  };

  // ── S1 — a full state name, unless it is the head of a compound place ─────
  const named = new Set<string>();
  for (const [nm, st] of g.stateNames) {
    const at = folded.indexOf(` ${nm} `);
    if (at === -1) continue;
    // ⚠️ THE "Michigan City" GUARD. Look at the word that follows the state
    // name: if "<state> <next>" is itself a place in the gazetteer, the compound
    // name is what the headline means and the bare state word is a false
    // positive. No hand-written exception list — the registry decides.
    const after = folded.slice(at + nm.length + 2);
    const next = after.split(" ", 1)[0]?.replace(/[^a-z']/g, "") ?? "";
    if (next !== "" && g.byName.has(`${nm} ${next}`)) continue;
    named.add(st);
  }
  if (named.size === 1) {
    const st = [...named][0];
    return { ...base, state_abbr: st, state_rule: "s1_state_name", reason: null,
             jurisdiction_name: nameWithin(g, phrases, st) };
  }

  const hits = hitsFor(g, phrases);

  // ── S2 — a jurisdiction phrase unique to one state nationally ────────────
  const hitStates = new Set(hits.map((h) => h.state_abbr));
  if (hitStates.size === 1) {
    const st = [...hitStates][0];
    return { ...base, state_abbr: st, state_rule: "s2_unique_jurisdiction", reason: null,
             jurisdiction_name: nameWithin(g, phrases, st) };
  }

  // ── S3 — an abbreviation that AGREES with a phrase in the headline ───────
  // Two independent signals pointing at the same state. Neither alone is
  // trusted: "Grant County" is in 14 states and a bare "WA" could be anything,
  // but "WA" plus a Grant County that exists in WA is the state.
  if (!isShouty(headline) && hitStates.size > 1) {
    const codes = new Set<string>();
    for (const m of headline.matchAll(/\b([A-Z]{2})\b/g)) {
      if (g.abbrs.has(m[1]) && hitStates.has(m[1])) codes.add(m[1]);
    }
    if (codes.size === 1) {
      const st = [...codes][0];
      return { ...base, state_abbr: st, state_rule: "s3_abbr_agrees", reason: null,
               jurisdiction_name: nameWithin(g, phrases, st) };
    }
  }

  // Nothing established it. Say so, and say which of the two shapes it was.
  return {
    ...base,
    reason: named.size > 1
      ? "ambiguous_state_named"
      : hitStates.size > 1
      ? "ambiguous_jurisdiction"
      : "no_honest_state",
  };
}

/**
 * The verbatim jurisdictions.name, when exactly one distinct name matches inside
 * the resolved state. Ambiguity yields null and the item goes forward
 * state-only — never a guess, and never a concatenation of candidates.
 */
function nameWithin(
  g: Gazetteer,
  phrases: { text: string; kind: PhraseKind }[],
  state: string,
): string | null {
  const names = new Set<string>();
  for (const p of phrases) {
    const rows = g.byName.get(p.text);
    if (!rows) continue;
    const allowed = kindsFor(p.kind);
    for (const r of rows) {
      if (r.state_abbr === state && allowed.includes(r.kind)) names.add(r.name);
    }
  }
  return names.size === 1 ? [...names][0] : null;
}
