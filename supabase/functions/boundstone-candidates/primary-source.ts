// primary-source.ts — CC-BOUNDSTONE-INGEST-1.1 §6.4 (FAR-418).
// Gate 2: locate the ORIGINATING AUTHORITY's own document for a candidate.
// Deno-free (ext-pure pattern) so tests import it directly.
//
// §6.7: the retrieval plan is resolved from `authority_level` into REGISTRY
// KEYS. No host, portal or jurisdiction is named in this file. `puc:${state}`
// is a key template, not a vendor list — which is the whole point: adding the
// 25 missing commissions in §7.2 extends Gate 2's reach with no code change.
//
// FAILURE IS NOT A DROP. A candidate with no primary source still surfaces,
// labelled "NOT LOCATED". That label is the actionable signal: it is why 452 of
// 452 published records carry no working source link, and hiding it would
// reproduce exactly the silence this CC exists to end.

export type AuthorityLevel =
  | "LOCAL"
  | "STATE"
  | "STATE_AGENCY"
  | "GRID_OPERATOR"
  | "UTILITY"
  | "FEDERAL";

export interface RetrievalStep {
  /** Registry source_key (or key template) to resolve, or 'article' for the
   * in-article link scan. */
  via: string;
  why: string;
}

/**
 * §6.4's table, as data. The in-article scan is ALWAYS first: a report on a
 * commission order very often links the order, and a link the publisher already
 * verified beats a search every time.
 *
 * `marketKey` is the ISO/RTO registry key when the classifier could name one;
 * without it the GRID_OPERATOR path falls through to the overseeing commission,
 * which is the CC's stated second hop.
 */
export function retrievalPlan(
  level: AuthorityLevel | null,
  stateAbbr: string | null,
  marketKey: string | null,
): RetrievalStep[] {
  const st = stateAbbr ? stateAbbr.toLowerCase() : null;
  const steps: RetrievalStep[] = [
    { via: "article", why: "explicit authority link inside the reporting" },
  ];
  switch (level) {
    case "LOCAL":
      // Municipal agenda/minutes portals are registered per jurisdiction under
      // the agenda: prefix; the FIPS resolution happens in the caller, which
      // holds the crosswalk.
      steps.push({ via: "agenda:*", why: "municipal agenda/minutes portal for the resolved FIPS" });
      break;
    case "STATE":
      if (st) {
        steps.push({ via: `gov:${st}`, why: "governor newsroom / executive-order index" });
        steps.push({ via: `legis:${st}`, why: "legislature bill page" });
      }
      break;
    case "STATE_AGENCY":
      if (st) steps.push({ via: `puc:${st}`, why: "commission docket search, by docket number where captured" });
      break;
    case "GRID_OPERATOR":
      if (marketKey) steps.push({ via: `${marketKey}-notices`, why: "market notices index" });
      if (st) steps.push({ via: `puc:${st}`, why: "overseeing commission docket" });
      break;
    case "UTILITY":
      // Deliberately NOT the utility's own newsroom. A utility press release is
      // discovery; the docket is the record (§7.4, §12).
      if (st) steps.push({ via: `puc:${st}`, why: "regulating commission docket — never the utility's press release" });
      break;
    case "FEDERAL":
      steps.push({ via: "feed:federal-register", why: "federal instrument of record" });
      break;
    default:
      break;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// QUOTABILITY — the Boundstone rule, mirrored exactly.
// ---------------------------------------------------------------------------
//
// ⚠️ PROMPT SAID X, PRODUCTION IS Y. The earlier draft of this function read
// `boundstone.allowed_source_domains`. THAT TABLE DOES NOT EXIST in the
// Boundstone project (fwnerwrtlgnchuprvfgl); checked read-only against
// information_schema.tables on 2026-10-06. There is no allowlist to read, and
// no RPC exposes `boundstone.blocked_source_domains` either (every public
// `bs_*` function was enumerated; none returns it). So the rule is carried
// here, as code, mirrored character-for-character from the live SQL and pinned
// by tests — which is the only honest option when the table is not reachable
// from a service-role client that is allowed to call functions and nothing
// else.
//
// The rule as Boundstone states it: a quotable source is a GOVERNMENT HOST and
// not a blocked commercial monitor. There is no third category.

/**
 * Mirror of `boundstone.url_host(text)`:
 *
 *   select lower(split_part(split_part(
 *     regexp_replace(coalesce(u,''), '^https?://', ''), '/', 1), ':', 1))
 *
 * ⚠️ MIRRORED WARTS AND ALL, DELIBERATELY. Postgres `regexp_replace` without
 * the 'i' flag is CASE SENSITIVE, so `HTTPS://energy.gov/x` does not get its
 * scheme stripped and the "host" comes out as `https` — not a government host.
 * `ftp://energy.gov/x` resolves to `ftp` for the same reason. Those are not
 * behaviours worth having, but they are the behaviours the database has, and a
 * link Faraday calls quotable MUST be a link Boundstone calls quotable. Fixing
 * it here would make the two disagree silently, which is strictly worse than
 * both being odd in the same way. Verified against the live function on
 * 2026-10-06; the fixtures in test/far418-government-host.test.mjs are its
 * actual output, not predictions.
 */
export function urlHost(u: string | null | undefined): string {
  const s = String(u ?? "");
  // Case-sensitive, first-match-only — exactly what regexp_replace does here.
  const noScheme = s.replace(/^https?:\/\//, "");
  return noScheme.split("/")[0].split(":")[0].toLowerCase();
}

/**
 * Mirror of `boundstone.is_government_host(text)`:
 *
 *   select case when coalesce(u,'') = '' then false
 *     else boundstone.url_host(u) ~ '(^|\.)(gov|mil)$'
 *       or boundstone.url_host(u) ~ '\.[a-z]{2}\.us$'
 *       or boundstone.url_host(u) ~ '(^|\.)us$' end
 *
 * .gov / .mil, plus US state and local `.us`. [REC-6] / guardrail 6: every
 * source link Boundstone publishes is on one of these.
 */
export function isGovernmentHost(u: string | null | undefined): boolean {
  const s = String(u ?? "");
  if (s === "") return false;
  const h = urlHost(u);
  return /(^|\.)(gov|mil)$/.test(h) || /\.[a-z]{2}\.us$/.test(h) || /(^|\.)us$/.test(h);
}

/**
 * Snapshot of `boundstone.blocked_source_domains`, read from the live table on
 * 2026-10-06 (5 rows / 4 vendors — Data365 holds two domains).
 *
 * ⚠️ THE CC SAYS "four commercial monitors"; the table holds FIVE ROWS. Both
 * statements are true — LegiScan, FiscalNote, PolicyNote and Data365 are four
 * vendors and `data365.co` + `data365.com` are two of their domains. The list
 * below is the DOMAIN list, because a domain is what a URL is matched against.
 *
 * These are discovery-only sources: compiled commercial output is not
 * redistributable, so a link to one may never become a record's citation.
 * `docs/far-418/boundstone-blocked-source-domains.snapshot.json` carries the
 * same rows with their reasons and the read timestamp, and
 * test/far418-boundstone-rpc-only.test.mjs fails if the two drift apart.
 */
export const BLOCKED_SOURCE_DOMAINS: readonly string[] = [
  "data365.co",
  "data365.com",
  "fiscalnote.com",
  "legiscan.com",
  "policynote.com",
];

export interface Provenance {
  isQuotable: (u: string) => boolean;
  kindOf: (u: string) => string | null;
}

/** Suffix match: `legiscan.com` blocks `www.legiscan.com`, never `xlegiscan.com`. */
function suffixHit(host: string, domains: readonly string[]): string | null {
  for (const d of domains) if (host === d || host.endsWith(`.${d}`)) return d;
  return null;
}

/**
 * The quotability rule. BLOCKLIST FIRST AND ALWAYS WINS — a commercial monitor
 * that happens to sit behind a government-looking host is still not quotable —
 * then `isGovernmentHost`. There is no allowlist branch any more because there
 * is no allowlist table (see the note at the top of this section).
 */
export function makeProvenance(
  blocked: readonly string[] = BLOCKED_SOURCE_DOMAINS,
): Provenance {
  return {
    isQuotable(u: string): boolean {
      const host = urlHost(u);
      if (!host) return false;
      if (suffixHit(host, blocked)) return false;
      return isGovernmentHost(u);
    },
    kindOf(u: string): string | null {
      const host = urlHost(u);
      if (!host) return null;
      if (suffixHit(host, blocked)) return null;
      return isGovernmentHost(u) ? "GOV_TLD" : null;
    },
  };
}

/**
 * Pull candidate authority links out of an article's HTML.
 *
 * `isQuotable` is injected so the caller decides the rule. In this function it
 * is always `makeProvenance().isQuotable` (below): blocklist first, then
 * `isGovernmentHost`. Anchor text is returned so the caller can prefer links
 * that announce themselves as the instrument.
 */
export function extractAuthorityLinks(
  html: string,
  baseUrl: string,
  isQuotable: (url: string) => boolean,
  max = 12,
): Array<{ url: string; text: string }> {
  const out: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const href = m[1].match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    if (!isQuotable(abs)) continue;
    seen.add(abs);
    out.push({ url: abs, text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) });
  }
  return out;
}

/** Words that mark a link as the instrument itself rather than a homepage.
 * Generic instrument vocabulary — no jurisdiction, no vendor (§6.7). */
const INSTRUMENT_HINTS = [
  "order", "docket", "filing", "ordinance", "resolution", "executive order",
  "protocol", "tariff", "revision", "decision", "ruling", "notice", "pdf",
  "full text", "read the", "official",
];

/**
 * Rank extracted links so the best guess is fetched first. A PDF or a link
 * whose text says "order"/"docket" is far more likely to be the instrument than
 * a bare link to the authority's homepage.
 */
export function rankAuthorityLinks(
  links: Array<{ url: string; text: string }>,
  instrumentNo: string | null,
): Array<{ url: string; text: string; score: number }> {
  const no = (instrumentNo ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return links
    .map((l) => {
      const hay = `${l.text} ${l.url}`.toLowerCase();
      let score = 0;
      // The strongest possible signal: the link carries the docket number the
      // classifier transcribed out of the document.
      if (no && hay.replace(/\s+/g, "").includes(no)) score += 5;
      for (const h of INSTRUMENT_HINTS) if (hay.includes(h)) score += 1;
      if (/\.pdf($|[?#])/i.test(l.url)) score += 2;
      // A bare origin is almost never the instrument.
      try {
        const u = new URL(l.url);
        if (u.pathname === "/" || u.pathname === "") score -= 3;
      } catch { /* keep score */ }
      return { ...l, score };
    })
    .sort((a, b) => b.score - a.score);
}
