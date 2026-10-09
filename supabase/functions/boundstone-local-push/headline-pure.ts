// headline-pure.ts — FDY-91. Recover the publisher's own headline, and the
// publisher's name, from a Google News RSS artifact's raw_content.
//
// Deno-free (ext-pure pattern) so tests import it directly.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NEEDED AT ALL: THERE IS NO HEADLINE COLUMN
// ---------------------------------------------------------------------------
// public.artifacts has no `title`. Measured live on ycadmmngkdhvpcsrcuaq
// 2026-10-07, every one of the 54,211 local-watch artifacts carries exactly
// three crawl_metadata keys — feed_url, fetched_at, mode — and nothing else.
// The headline exists only inside raw_content, in the shape Google News RSS
// produces:
//
//   line 1  <headline> - <publisher>
//   line 2  (blank)
//   line 3  <headline> &nbsp;&nbsp; <publisher>
//
// ---------------------------------------------------------------------------
// ⚠️ THE " - <publisher>" SUFFIX IS GOOGLE'S, NOT THE PUBLISHER'S
// ---------------------------------------------------------------------------
// Guardrail 7 says press items are verbatim: the headline as published. The RSS
// <title> is NOT that — Google appends " - " and the outlet name to every one.
// Storing it would put a string in Boundstone's press_items that no publisher
// ever printed, attributed to that publisher. Stripping it is what makes the
// stored headline verbatim; leaving it would be the edit.
//
// So the suffix is removed, and it is removed by MEASUREMENT rather than by a
// guessy regex: line 3 states the publisher name explicitly after
// `&nbsp;&nbsp;`, and line 1 is required to end in exactly " - " + that name.
// Checked over all 6,157 rows in the relevant window on 2026-10-07:
//
//   rows                                   6,157
//   rows with no publisher on line 3           0
//   line 1 ends in " - " + publisher       6,157  (100%)
//   mismatches                                 0
//
// RE-VERIFIED 2026-10-08, read-only, and it still holds exactly — but only when
// the publisher is taken the way the code below takes it: everything after the
// LAST literal '&nbsp;&nbsp;'. A first attempt at re-measuring used the regex
// '&nbsp;&nbsp;([^&]*)$' instead and reported 56 rows with no publisher and 56
// mismatches. Those 56 are not a shape problem; they are outlet names that
// themselves contain an HTML entity, which '[^&]*' cannot cross. The lesson is
// worth keeping: a measurement that does not use the implementation's own rule
// measures a different rule, and here it would have condemned 56 good rows.
//
// Because the agreement is total, a row that does NOT agree is a shape this
// code has never seen, and extract() returns null rather than guessing which
// part of the string is the headline. Nothing is forwarded from a row whose
// headline cannot be established.

export interface ExtractedHeadline {
  /** The publisher's own headline, with Google's " - <outlet>" suffix removed. */
  headline: string;
  /** The outlet name as Google states it on line 3. Not a domain. */
  publisher: string;
}

/** The separator Google puts between the headline and the outlet on line 3. */
const NBSP_SEP = "&nbsp;&nbsp;";

/**
 * Recover the headline and publisher, or null when raw_content is not the shape
 * described above.
 *
 * NULL IS A REAL ANSWER AND THE CALLER MUST HANDLE IT. It means "this row's
 * headline cannot be established", and the only correct response is to skip the
 * row and ledger the reason — never to fall back to line 1 unstripped, which
 * would publish Google's constructed string as the publisher's words.
 */
export function extractHeadline(rawContent: unknown): ExtractedHeadline | null {
  if (typeof rawContent !== "string") return null;
  const raw = rawContent;

  // The publisher is whatever follows the LAST &nbsp;&nbsp; in the document.
  // Last, not first: a headline may itself contain the entity, and the
  // description line is always the final one in these artifacts.
  const i = raw.lastIndexOf(NBSP_SEP);
  if (i === -1) return null;

  return headlineFromParts(raw.split("\n", 1)[0] ?? "", raw.slice(i + NBSP_SEP.length));
}

/**
 * The same decision, taken from the two strings directly.
 *
 * ⚠️ WHY THIS IS SEPARATE AND EXPORTED. public.boundstone_push_due(int)
 * deliberately does NOT return raw_content — the edge function must not be
 * handed an article body, because a body it holds is a body it could forward
 * (guardrail 7). The SQL therefore performs the same two splits and returns
 * `rss_line1` and `rss_publisher`, and this is the entry point for that path.
 * The alternative — reassembling a fake raw_content in order to re-split it —
 * would be two implementations of one rule pretending to be one.
 *
 * extractHeadline() above delegates here, so the rule exists exactly once.
 */
export function headlineFromParts(
  line1Raw: unknown,
  publisherRaw: unknown,
): ExtractedHeadline | null {
  const line1 = typeof line1Raw === "string" ? line1Raw.trim() : "";
  if (line1 === "") return null;
  const publisher = typeof publisherRaw === "string" ? publisherRaw.trim() : "";
  if (publisher === "") return null;

  // line 1 must end in " - " + publisher. If it does not, this is a shape we
  // have never measured and we decline rather than cut the string somewhere
  // plausible.
  const suffix = ` - ${publisher}`;
  if (!line1.endsWith(suffix)) return null;

  const headline = line1.slice(0, line1.length - suffix.length).trim();
  // A headline that is empty once the suffix is gone carries no claim at all.
  if (headline === "") return null;

  return { headline, publisher };
}

/**
 * The opaque token in a Google News RSS article URL — the same identifier
 * FDY-90's public.gnews_token() reads, reimplemented here only for tests and
 * for logging. It is NEVER sent to Boundstone: guardrail 6 and decision D2 both
 * say an aggregator URL is never stored there.
 */
export function gnewsToken(sourceUrl: unknown): string | null {
  if (typeof sourceUrl !== "string") return null;
  const after = sourceUrl.split("/rss/articles/")[1];
  if (!after) return null;
  const token = after.split("?")[0];
  return token === "" ? null : token;
}

/** True for any URL on a Google host. Such a URL may never reach Boundstone. */
export function isAggregatorUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  return /^https?:\/\/([^/]*\.)?(news\.)?google\./i.test(url.trim());
}

/** The host of an absolute http(s) URL, lower-cased, or "" when there is none. */
export function hostOf(url: unknown): string {
  if (typeof url !== "string") return "";
  const m = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  if (!m) return "";
  return m[1].split("@").pop()!.split(":")[0].toLowerCase();
}
