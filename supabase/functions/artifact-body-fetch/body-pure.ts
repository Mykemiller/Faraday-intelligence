// body-pure.ts — pure logic for artifact-body-fetch (CC-ARTIFACT-BODY-FETCH-1.0,
// Phases 1–2). Deno-free (ext-pure pattern) so node tests import it directly.
//
// Everything here is deterministic text handling: HTML → text, EDGAR
// submission unwrapping, boilerplate stripping, the size guard, and the
// chunker (a verbatim copy of enrich-pure.chunkText so re-embedded bodies are
// chunked exactly like the rest of the corpus).

export const EXTRACTOR_VERSION = "body-extract_v1.0";

/** Size guard (Phase 2 rule 3). A 10-K can exceed 1 MB of text. */
export const BODY_CHAR_CAP = 500_000;

/** Below this many extracted characters a fetch is recorded as 'empty'. */
export const MIN_BODY_CHARS = 200;

// ---------------------------------------------------------------- entities

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ",
  thinsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", bull: "•", middot: "·", sect: "§", para: "¶", copy: "©",
  reg: "®", trade: "™", deg: "°", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾",
  cent: "¢", pound: "£", euro: "€", yen: "¥", times: "×", divide: "÷", shy: "",
  zwnj: "", zwj: "", laquo: "«", raquo: "»", dagger: "†", Dagger: "‡",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      if (code === 160 || (code >= 8192 && code <= 8203)) return " ";
      try { return String.fromCodePoint(code); } catch { return " "; }
    }
    const v = NAMED_ENTITIES[e] ?? NAMED_ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// ---------------------------------------------------------------- HTML → text

const BLOCK_TAGS =
  "p|div|br|tr|li|ul|ol|h[1-6]|table|thead|tbody|section|article|blockquote|pre|hr|dt|dd|dl|center|title";

/** Remove a paired element and everything inside it (case-insensitive, non-greedy). */
function dropElement(html: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  return html.replace(re, " ");
}

/** Remove elements styled display:none — Inline XBRL hides its fact header this way. */
function dropHiddenDivs(html: string): string {
  // Only simple, non-nested hidden blocks; ix:header is removed separately below.
  return html.replace(/<div\b[^>]*style\s*=\s*"[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\/div\s*>/gi, " ");
}

export interface HtmlOptions {
  /** Prefer <main>/<article> when it carries most of the text (general web pages). */
  preferMain?: boolean;
  /** Drop <nav>/<header>/<footer>/<aside>/<form> chrome (general web pages). */
  dropChrome?: boolean;
}

export function htmlToText(html: string, opts: HtmlOptions = {}): string {
  let h = html;
  h = h.replace(/<!--[\s\S]*?-->/g, " ");
  for (const t of ["script", "style", "noscript", "head", "svg", "template", "iframe"]) h = dropElement(h, t);
  // Inline XBRL: the hidden fact header and any ix:hidden block are pure machine data.
  h = dropElement(h, "ix:header");
  h = dropElement(h, "ix:hidden");
  h = dropHiddenDivs(h);
  if (opts.dropChrome) for (const t of ["nav", "header", "footer", "aside", "form"]) h = dropElement(h, t);
  if (opts.preferMain) {
    const m = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i.exec(h);
    if (m) {
      const inner = htmlToText(m[2]);
      const whole = htmlToText(h);
      if (inner.length >= 500 && inner.length >= whole.length * 0.3) return inner;
    }
  }
  h = h.replace(/<(td|th)\b[^>]*>/gi, " \t ");
  h = h.replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  // Inline tags vanish without a space: SEC HTML splits words across <font>/<span> runs.
  h = h.replace(/<[^>]+>/g, "");
  return normalizeWhitespace(decodeEntities(h));
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[  -​\t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------- EDGAR

export interface EdgarUnwrap {
  /** Text of the primary <DOCUMENT> (or the whole input when not a submission wrapper). */
  text: string;
  /** CONFORMED SUBMISSION TYPE from the SEC header, when present. */
  conformedType: string | null;
  /** <TYPE> of the document kept (e.g. 10-K, EX-99.1), when present. */
  documentType: string | null;
  /** How many further <DOCUMENT> blocks (exhibits, XBRL, graphics) were dropped. */
  droppedDocuments: number;
  isHtml: boolean;
}

/** Full-submission .txt files wrap several documents: keep only the first. */
export function unwrapEdgarSubmission(raw: string): EdgarUnwrap {
  const conformed = /CONFORMED SUBMISSION TYPE:\s*([^\r\n]+)/i.exec(raw)?.[1]?.trim() ?? null;
  const docs = raw.match(/<DOCUMENT>[\s\S]*?<\/DOCUMENT>/gi);
  if (!docs || docs.length === 0) {
    return { text: raw, conformedType: conformed, documentType: null, droppedDocuments: 0, isHtml: looksLikeHtml(raw) };
  }
  const first = docs[0];
  const docType = /<TYPE>\s*([^\r\n<]+)/i.exec(first)?.[1]?.trim() ?? null;
  const textBlock = /<TEXT>([\s\S]*?)<\/TEXT>/i.exec(first)?.[1] ?? first;
  return {
    text: textBlock,
    conformedType: conformed,
    documentType: docType,
    droppedDocuments: docs.length - 1,
    isHtml: looksLikeHtml(textBlock),
  };
}

export function looksLikeHtml(s: string): boolean {
  const head = s.slice(0, 5000);
  return /<(html|body|div|p|table|font|br)\b/i.test(head);
}

/** Lines that carry no content: page numbers, TOC back-links, SGML page markers. */
const NOISE_LINE = /^(?:<\/?PAGE>|page \d+( of \d+)?|-?\s*\d{1,3}\s*-?|table of contents|\(?back to (?:top|contents)\)?|(?=[ivx]+$)x{0,3}(?:ix|iv|v?i{0,3}))$/i;

export function dropNoiseLines(text: string): string {
  return text
    .split("\n")
    .filter((l) => !NOISE_LINE.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * For a PRIMARY filing document (10-K, 8-K body), cut the trailing signature
 * page / exhibit index. Only headings in the final 25% of the text count, so a
 * table-of-contents mention near the top can never truncate the filing.
 * Exhibit documents are deliberately NOT tail-cut (Myke 2026-09-27: for rows
 * whose stored URL is an exhibit, the exhibit IS the body).
 */
export function stripFilingTail(text: string): { text: string; cut: string | null } {
  const floor = Math.floor(text.length * 0.75);
  const re = /\n(SIGNATURES?|EXHIBIT INDEX|INDEX TO EXHIBITS|EXHIBITS INDEX)\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= floor) return { text: text.slice(0, m.index).trim(), cut: m[1].toUpperCase() };
  }
  return { text, cut: null };
}

/** Is this stored EDGAR document an exhibit rather than the primary filing? */
export function isExhibitDocument(url: string, documentType: string | null): boolean {
  if (documentType) return /^EX-/i.test(documentType);
  const file = (url.split("/").pop() ?? "").toLowerCase();
  return /(^|[_\-.])ex[-_]?\d|exv?\d|exhibit/.test(file);
}

export interface SecExtract {
  text: string;
  conformedType: string | null;
  documentType: string | null;
  isExhibit: boolean;
  droppedDocuments: number;
  tailCut: string | null;
}

export function extractSecDocument(raw: string, url: string): SecExtract {
  const u = unwrapEdgarSubmission(raw);
  let text = u.isHtml ? htmlToText(u.text) : normalizeWhitespace(decodeEntities(u.text.replace(/<\/?[A-Z-]+>/g, "\n")));
  // Stray XBRL / SGML residue that survives in legacy submissions.
  text = text.replace(/<XBRL>[\s\S]*?<\/XBRL>/gi, " ");
  text = dropNoiseLines(text);
  const isExhibit = isExhibitDocument(url, u.documentType);
  let tailCut: string | null = null;
  if (!isExhibit) {
    const t = stripFilingTail(text);
    text = t.text;
    tailCut = t.cut;
  }
  return {
    text,
    conformedType: u.conformedType,
    documentType: u.documentType,
    isExhibit,
    droppedDocuments: u.droppedDocuments,
    tailCut,
  };
}

// ---------------------------------------------------------------- size guard

export function truncateAtParagraph(text: string, cap = BODY_CHAR_CAP): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  const window = text.slice(0, cap);
  const para = window.lastIndexOf("\n\n");
  if (para >= cap * 0.8) return { text: window.slice(0, para).trim(), truncated: true };
  const line = window.lastIndexOf("\n");
  if (line >= cap * 0.8) return { text: window.slice(0, line).trim(), truncated: true };
  const sentence = window.lastIndexOf(". ");
  if (sentence >= cap * 0.8) return { text: window.slice(0, sentence + 1).trim(), truncated: true };
  return { text: window.trim(), truncated: true };
}

// ---------------------------------------------------------------- HTTP classification

export type FetchOutcome = "ok" | "failed" | "blocked" | "empty";

/** SEC's refusal page names the reason; any 403/429 from sec.gov is treated as a block. */
export function isBlockResponse(status: number, body: string, host: string): boolean {
  if (status === 429) return true;
  if (status === 403) {
    if (/sec\.gov$/i.test(host)) return true;
    return /Request Rate|Undeclared Automated|Access Denied|blocked|captcha|cloudflare/i.test(body.slice(0, 4000));
  }
  return false;
}

export function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase(); } catch { return ""; }
}

export function isSecHost(url: string): boolean {
  return /(^|\.)sec\.gov$/i.test(hostOf(url));
}

// ---------------------------------------------------------------- chunking (verbatim enrich-pure.chunkText)

const CHUNK_CHARS = 512 * 4;
const OVERLAP_CHARS = 64 * 4;

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_CHARS, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start = end - OVERLAP_CHARS;
  }
  return chunks.filter((c) => c.length > 50);
}

/** Phase rule 2e: re-chunk only when the body is materially deeper than the capture. */
export function qualifiesForRechunk(bodyChars: number | null, rawLen: number): boolean {
  if (bodyChars == null) return false;
  return bodyChars >= 2 * rawLen && bodyChars >= rawLen + 500;
}

/** The ingest capture (title/company/date) leads the chunked text so chunk 0 keeps it. */
export function chunkSource(rawContent: string | null, body: string): string {
  const head = (rawContent ?? "").trim();
  if (!head || body.startsWith(head.slice(0, 80))) return body;
  return `${head}\n\n${body}`;
}

// ---------------------------------------------------------------- robots.txt

/**
 * Minimal robots.txt evaluation: groups for our agent token (else `*`),
 * longest-match Allow/Disallow. Unparseable or absent robots ⇒ allowed.
 */
export function robotsAllows(robotsTxt: string | null, path: string, agentToken = "faraday"): boolean {
  if (!robotsTxt) return true;
  type Group = { agents: string[]; rules: Array<{ allow: boolean; path: string }> };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (key === "disallow" && val === "") continue; // empty Disallow = allow all
      cur.rules.push({ allow: key === "allow", path: val });
    } else {
      lastWasAgent = false;
    }
  }
  const token = agentToken.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (robotsPathMatches(r.path, path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) {
        best = { allow: r.allow, len: r.path.length };
      }
    }
  }
  return best ? best.allow : true;
}

function robotsPathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}
