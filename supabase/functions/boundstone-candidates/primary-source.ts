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

/**
 * Pull candidate authority links out of an article's HTML.
 *
 * `isQuotable` is injected — the allowlist lives in the Boundstone database
 * (boundstone.allowed_source_domains), and this module must not carry a second,
 * drifting copy of it. Anchor text is returned so the caller can prefer links
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
