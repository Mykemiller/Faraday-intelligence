// puc-substation-extract — pure transforms (no network, no db, no LLM).
// Unit-tested in test/puc-substation-extract.test.mjs. FAR-379 D1-refined.
//
// WHY THIS SHAPE (I1 finding): puc_filings.raw_text is a title-only index
// (median 19 words; never contains "substation" or an in-service date). The
// substation identity lives in puc_dockets.docket_title (esp. Texas CCN
// transmission siting cases), and the ACTUAL date lives only in the underlying
// filing PDF at source_url. So this module does the deterministic, LLM-free
// work — (1) a cheap candidate pre-filter over docket_title (cost control:
// only candidates get an LLM/PDF fetch), and (2) parse endpoints/voltage/county
// out of the CCN title — while date extraction from the PDF is the handler's
// (impure, LLM-assisted, deploy-gated) job.
//
// Date semantics: a CCN/CPCN *application* is forward-looking → 'approved' or
// 'projected', which never grades. Only a final-order/energization notice
// yields 'actual'. The pre-filter tags which it is so the grade gate is honest.

import type { DateType, SubstationMention } from "../grid-buildout-sync/adapters-pure.ts";
export type { DateType, SubstationMention };

// Keywords that make a docket a substation-vintage candidate worth an LLM/PDF
// fetch. CCN/CPCN + transmission-siting language; the negative list drops the
// pure rate/tariff/procedural noise that dominates the corpus.
const CANDIDATE_POS = /\b(CCN|CPCN|certificate of convenience|transmission line|switch|switching station|substation|kv|kV|interconnection|in-service|energiz)\b/i;
const CANDIDATE_NEG = /\b(wholesale transmission rate|rate update|cost recovery factor|code of conduct waiver|interim update|monthly rate)\b/i;

export interface DocketCandidate {
  is_candidate: boolean;
  reason: string;
  substation_names: string[];
  voltage_kv: number | null;
  county_raw: string | null;
  date_type: DateType;     // best guess from title; PDF fetch refines
  is_transmission_siting: boolean;
}

function titleVoltage(t: string): number | null {
  const m = t.match(/(\d{2,4})\s*-?\s*kv\b/i);
  return m ? Number(m[1]) : null;
}
function titleCounty(t: string): string | null {
  // case-insensitive keyword so ALL-CAPS "…IN LIMESTONE COUNTY" resolves too.
  const m = t.match(/\bin\s+([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,3}?)\s+count(?:y|ies)\b/i);
  return m ? titleCase(m[1].trim()) : null;
}

const CCN_STOP = new Set([
  "THE", "FOR", "OF", "AND", "TO", "A", "AN", "NEW", "PROPOSED", "APPLICATION",
  "AMEND", "ITS", "CERTIFICATE", "CONVENIENCE", "NECESSITY", "JOINT", "PETITION",
]);
const STATION_WORD = /\b(SWITCHING STATION|SUBSTATION|SWITCHYARD|SWITCH|SS|STATION|POI|TAP|INTERCHANGE)\b/gi;

/** Strip leading boilerplate/stopwords and trailing station words from an endpoint phrase. */
function cleanEndpoint(s: string): string {
  let out = s.replace(STATION_WORD, " ").replace(/\s+/g, " ").trim();
  // drop leading stopwords ("PROPOSED KOSSE" → "KOSSE", "THE EL CAPITAN" → "EL CAPITAN")
  const parts = out.split(" ");
  while (parts.length && CCN_STOP.has(parts[0].toUpperCase())) parts.shift();
  out = parts.join(" ").trim();
  return out ? titleCase(out) : "";
}

/**
 * Endpoint / station names out of a CCN transmission-line title, e.g.
 * "…FOR THE EL CAPITAN SWITCH-TO-DRY LAKE SWITCH 345-KV TRANSMISSION LINE…"
 * → ["El Capitan", "Dry Lake"]. Titles are ALL-CAPS, so we can't lean on
 * casing — we isolate the "FOR THE … (kV|TRANSMISSION)" span, split on the
 * TO / dash separator, and clean each endpoint.
 */
export function extractCcnEndpoints(titleRaw: string): string[] {
  const t = titleRaw.replace(/&#9;/g, " ").replace(/\s+/g, " ").trim();
  const out = new Set<string>();

  // Only a transmission-LINE siting title yields endpoints. This is the key
  // guard: without it, "…COMPANY TO AMEND…" splits on the stray "TO" and
  // produces garbage. Anchor on the "FOR THE <endpoints> … TRANSMISSION LINE"
  // grammar that CCN line-siting titles share.
  if (/TRANSMISSION LINE/i.test(t)) {
    // greedy prefix anchors the LAST "FOR THE" (titles can have an earlier
    // "for the Application of…"); the endpoint clause is the one before the kV.
    const m = t.match(/.*\bFOR THE\s+(.*?)\s+\d{2,4}\s*-?\s*KV\b/i)
           || t.match(/.*\bFOR THE\s+(.*?)\s+TRANSMISSION LINE/i);
    let span = (m ? m[1] : "")
      .replace(/\b(SINGLE-CIRCUIT|DOUBLE-CIRCUIT|CONVERSION|REBUILD|PROJECT)\b.*$/i, "")
      .trim();
    const parts = span.split(/\s+TO\s+|-TO-|\s+-\s+|\s+–\s+/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      for (const p of parts) { const c = cleanEndpoint(p); if (c) out.add(c); }
    } else if (parts.length === 1 && /SWITCH|SUBSTATION|STATION/i.test(t)) {
      const c = cleanEndpoint(parts[0]); if (c) out.add(c);
    }
  }
  // standalone "<Name> SWITCHING STATION / SUBSTATION" (no line)
  if (out.size === 0) {
    for (const m of t.matchAll(/\bFOR THE\s+([A-Z][A-Z0-9.'-]*(?:\s+[A-Z0-9.'-]+){0,3})\s+(?:SWITCHING STATION|SUBSTATION)\b/g)) {
      const c = cleanEndpoint(m[1]); if (c) out.add(c);
    }
  }
  return [...out].filter((s) => s.length > 2 && !CCN_STOP.has(s.toUpperCase()));
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

/** Classify the title's date semantics — applications never grade. */
export function classifyPucDateType(title: string, docketType: string | null): DateType {
  if (/\b(energiz|placed in service|in-service date|commercial operation|final order|completed)\b/i.test(title)) return "actual";
  if (/\b(CCN|CPCN|certificate of convenience|application|petition|amend)\b/i.test(title)) return "approved";
  return "projected";
}

/**
 * The cheap pre-filter (D1): decide whether a docket is a substation-vintage
 * candidate and pull whatever the title already gives us. Only candidates are
 * handed to the (paid) LLM/PDF-fetch stage in the handler.
 */
export function screenDocket(
  docket: { docket_title?: string | null; docket_type?: string | null },
): DocketCandidate {
  const title = (docket.docket_title ?? "").replace(/&#9;/g, " ").trim();
  const negative = CANDIDATE_NEG.test(title);
  const positive = CANDIDATE_POS.test(title);
  const names = extractCcnEndpoints(title);
  // A real substation-vintage candidate is a transmission-LINE siting case (or
  // a named switching station), not a rate / service-area / generation-facility
  // filing. Requiring extracted endpoints is what makes the pre-filter cheap
  // and precise — only these get an LLM/PDF fetch.
  const isSiting = /\bTRANSMISSION LINE\b/i.test(title) || /\b(SWITCHING STATION|SUBSTATION)\b/i.test(title);
  const is_candidate = positive && !negative && isSiting && names.length > 0;
  return {
    is_candidate,
    reason: negative ? "excluded:rate/procedural" : positive ? (names.length ? "candidate:endpoints" : "candidate:keyword") : "no-match",
    substation_names: names,
    voltage_kv: titleVoltage(title),
    county_raw: titleCounty(title),
    date_type: classifyPucDateType(title, docket.docket_type ?? null),
    is_transmission_siting: isSiting,
  };
}

/**
 * Project a screened docket into substation mentions (pre-PDF). Dates stay null
 * until the handler's PDF/LLM stage fills them; date_type carries the title's
 * best guess so the resolver parks these as no-grade/unresolved, not graded.
 */
export function docketToMentions(
  cand: DocketCandidate,
  countyFips: string | null,
  stateAbbr: string | null,
): SubstationMention[] {
  return cand.substation_names.map((n) => ({
    extracted_name_frag: n,
    extracted_voltage_kv: cand.voltage_kv,
    state_abbr_hint: stateAbbr,
    county_fips_hint: countyFips,
    extracted_inservice_date: null,        // filled by PDF/LLM stage when actual
    extracted_date_type: cand.date_type,
    extraction_confidence: cand.date_type === "actual" ? 0.85 : 0.30,
  }));
}
