// gate0.ts — CC-BOUNDSTONE-INGEST-1.1 §6.2 (FAR-418).
// Cheap, high-recall lexical prefilter. No model call, no network.
// Deno-free (ext-pure pattern) so tests import it directly.
//
// §6.7 CONSTRAINT, LOAD-BEARING: not one proper noun appears below. No state,
// market operator, commission, utility or vendor name; no docket-number format.
// A vocabulary tuned to whichever jurisdiction is loudest this month produces a
// record that looks national and is not. test/far418-no-jurisdiction-tuning.test.mjs
// greps this file (and the classifier prompt) against all 50 state names and
// every US organized-market name, and fails on any hit.

/** A document must assert that something was STOPPED, SLOWED or CONDITIONED. */
export const RESTRICTION_VERBS = [
  "moratorium",
  "moratoria",
  "pause",
  "halt",
  "suspend",
  "suspension",
  "freeze",
  "ban",
  "prohibit",
  "deny",
  "denial",
  "rejected",
  "restrict",
  "restriction",
  "cap",
  "limit",
  "defer",
  "deferral",
  "audit",
  "review pending",
  "stay",
  "conditioned",
];

/** …and it must be about data center development or its grid access. */
export const DEVELOPMENT_OBJECTS = [
  "data center",
  "data centre",
  "hyperscale",
  "colocation",
  "colo",
  "large load",
  "high-density load",
  "ai campus",
  "interconnection request",
  "interconnection queue",
  "load interconnection",
  "load addition",
];

/**
 * Every written form of a term. English inflection is irregular enough that a
 * single `(s|es|ed|ing)?` suffix silently misses real instrument language:
 * "deferred" doubles its consonant, "paused" drops nothing but takes a bare
 * "d", "pausing" drops the "e". Each miss is a restriction the record never
 * sees, so the forms are enumerated rather than approximated.
 */
export function inflections(term: string): string[] {
  const t = term.trim().toLowerCase();
  const forms = new Set([t, `${t}s`, `${t}es`, `${t}ed`, `${t}ing`]);
  const last = t.slice(-1);
  if (last === "e") {
    // pause → paused, pausing
    forms.add(`${t}d`);
    forms.add(`${t.slice(0, -1)}ing`);
  } else if (/[bdfglmnprt]/.test(last) && /[aeiou]/.test(t.slice(-2, -1))) {
    // defer → deferred, deferring · ban → banned, banning
    forms.add(`${t}${last}ed`);
    forms.add(`${t}${last}ing`);
  }
  if (last === "y") forms.add(`${t.slice(0, -1)}ied`); // deny → denied
  return [...forms];
}

/** Word-boundary matcher. Substring matching would fire "cap" inside "capacity"
 * and "ban" inside "urban" — both common in exactly this corpus. */
function boundedPatterns(terms: string[]): RegExp[] {
  return terms.map((t) => {
    const alts = inflections(t)
      .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length) // longest first, so "deferred" wins over "defer"
      .join("|");
    return new RegExp(`(^|[^a-z0-9])(?:${alts})([^a-z0-9]|$)`, "i");
  });
}

const VERB_PATTERNS = boundedPatterns(RESTRICTION_VERBS);
const OBJECT_PATTERNS = boundedPatterns(DEVELOPMENT_OBJECTS);

export interface Gate0Result {
  pass: boolean;
  verbs: string[];
  objects: string[];
}

/**
 * Both families must fire in the SAME document. Either alone is worthless here:
 * "moratorium" alone catches every housing and drilling story in the corpus,
 * and "data center" alone catches the entire growth-announcement firehose that
 * §6.6 requires we never surface.
 */
export function gate0(text: string): Gate0Result {
  const t = text ?? "";
  const verbs: string[] = [];
  const objects: string[] = [];
  for (let i = 0; i < VERB_PATTERNS.length; i++) {
    if (VERB_PATTERNS[i].test(t)) verbs.push(RESTRICTION_VERBS[i]);
  }
  // Short-circuit: no verb, no point scanning for objects.
  if (verbs.length === 0) return { pass: false, verbs, objects };
  for (let i = 0; i < OBJECT_PATTERNS.length; i++) {
    if (OBJECT_PATTERNS[i].test(t)) objects.push(DEVELOPMENT_OBJECTS[i]);
  }
  return { pass: objects.length > 0, verbs, objects };
}
