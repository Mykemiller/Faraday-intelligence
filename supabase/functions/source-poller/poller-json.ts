// poller-json.ts — per-source JSON-API adapters for the source-poller
// (CC-SOURCE-SCALE-500 Wave 2). Deno-free (ext-pure pattern) so tests import
// it directly. Each adapter maps a JSON payload onto the same FeedItem shape
// the RSS/Atom path produces, so the artifact insert path is identical.

import type { FeedItem } from "./poller-pure.ts";

/** Rewrite the stored feed_url into the URL to actually fetch. Sources whose
 * bare endpoint returns the wrong window (NVD starts at CVE #1; NWS returns
 * every historical alert) get recency parameters here. */
export function jsonFetchUrl(sourceKey: string, feedUrl: string, nowMs: number): string {
  if (sourceKey === "feed:nvd") {
    // CVE API 2.0: bare endpoint pages from startIndex 0 (1999 CVEs) — window
    // to the trailing 7 days instead. Extended ISO-8601 per API docs.
    const end = new Date(nowMs).toISOString();
    const start = new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString();
    const sep = feedUrl.includes("?") ? "&" : "?";
    return `${feedUrl}${sep}pubStartDate=${encodeURIComponent(start)}&pubEndDate=${encodeURIComponent(end)}&resultsPerPage=100`;
  }
  if (sourceKey === "feed:nws-alerts") {
    // Bare /alerts is the full historical firehose; take current actual alerts.
    const sep = feedUrl.includes("?") ? "&" : "?";
    return `${feedUrl}${sep}status=actual&message_type=alert&limit=50`;
  }
  return feedUrl;
}

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** CISA Known Exploited Vulnerabilities catalog (file is append-ordered —
 * sort by dateAdded desc before capping). */
function parseKev(doc: Json, max: number): FeedItem[] {
  const vulns = Array.isArray(doc.vulnerabilities) ? (doc.vulnerabilities as Json[]) : [];
  return vulns
    .slice()
    .sort((a, b) => str(b.dateAdded).localeCompare(str(a.dateAdded)))
    .slice(0, max)
    .map((v) => ({
      title: `${str(v.cveID)}: ${str(v.vulnerabilityName)} (${str(v.vendorProject)} ${str(v.product)})`.trim(),
      link: v.cveID ? `https://nvd.nist.gov/vuln/detail/${str(v.cveID)}` : null,
      published: str(v.dateAdded) || null,
      summary: [str(v.shortDescription), str(v.requiredAction)].filter(Boolean).join(" Required action: ").slice(0, 4000),
    }));
}

/** NVD CVE API 2.0. */
function parseNvd(doc: Json, max: number): FeedItem[] {
  const vulns = Array.isArray(doc.vulnerabilities) ? (doc.vulnerabilities as Json[]) : [];
  const items: FeedItem[] = [];
  for (const wrap of vulns.slice(0, max)) {
    const cve = (wrap.cve ?? {}) as Json;
    const id = str(cve.id);
    if (!id) continue;
    const descs = Array.isArray(cve.descriptions) ? (cve.descriptions as Json[]) : [];
    const en = descs.find((d) => str(d.lang) === "en");
    items.push({
      title: id,
      link: `https://nvd.nist.gov/vuln/detail/${id}`,
      published: str(cve.published) || null,
      summary: str(en?.value).slice(0, 4000),
    });
  }
  return items;
}

/** Google Cloud status incidents.json (array, newest first). */
function parseGcpIncidents(doc: unknown, max: number): FeedItem[] {
  const arr = Array.isArray(doc) ? (doc as Json[]) : [];
  return arr.slice(0, max).map((inc) => {
    const update = (inc.most_recent_update ?? {}) as Json;
    return {
      title: str(inc.external_desc).slice(0, 300) || `Incident ${str(inc.id)}`,
      link: inc.uri ? `https://status.cloud.google.com/${str(inc.uri).replace(/^\//, "")}` : null,
      published: str(inc.begin) || str(inc.created) || null,
      summary: [str(inc.status_impact), str(update.text)].filter(Boolean).join(" — ").slice(0, 4000),
    };
  });
}

/** NWS alerts (GeoJSON FeatureCollection). */
function parseNwsAlerts(doc: Json, max: number): FeedItem[] {
  const feats = Array.isArray(doc.features) ? (doc.features as Json[]) : [];
  return feats.slice(0, max).map((f) => {
    const p = (f.properties ?? {}) as Json;
    return {
      title: str(p.headline) || [str(p.event), str(p.areaDesc)].filter(Boolean).join(" — "),
      link: str(f.id) || null,
      published: str(p.sent) || str(p.effective) || null,
      summary: [str(p.severity), str(p.description)].filter(Boolean).join(": ").slice(0, 4000),
    };
  });
}

/** statuspage.io /api/v2/summary.json shape (generic across tenants). */
function parseStatuspageSummary(doc: Json, max: number): FeedItem[] {
  const page = (doc.page ?? {}) as Json;
  const incidents = Array.isArray(doc.incidents) ? (doc.incidents as Json[]) : [];
  return incidents.slice(0, max).map((inc) => {
    const updates = Array.isArray(inc.incident_updates) ? (inc.incident_updates as Json[]) : [];
    return {
      title: str(inc.name),
      link: str(inc.shortlink) || str(page.url) || null,
      published: str(inc.created_at) || null,
      summary: [str(inc.status), str(updates[0]?.body)].filter(Boolean).join(": ").slice(0, 4000),
    };
  });
}

/** JSON Feed spec (jsonfeed.org) — the generic fallback. */
function parseJsonFeedSpec(doc: Json, max: number): FeedItem[] {
  const items = Array.isArray(doc.items) ? (doc.items as Json[]) : [];
  return items.slice(0, max).map((it) => ({
    title: str(it.title),
    link: str(it.url) || str(it.external_url) || null,
    published: str(it.date_published) || null,
    summary: (str(it.content_text) || str(it.summary) || str(it.content_html).replace(/<[^>]+>/g, " ")).slice(0, 4000),
  }));
}

const ADAPTERS: Record<string, (doc: never, max: number) => FeedItem[]> = {
  "feed:cisa-kev-catalog": parseKev,
  "feed:nvd": parseNvd,
  "feed:google-cloud-status": parseGcpIncidents,
  "feed:nws-alerts": parseNwsAlerts,
};

/** Parse a JSON body for a source. Returns null when no adapter applies —
 * the caller keeps reporting "json (adapter pending)" for that source. */
export function parseJsonSource(sourceKey: string, body: string, max = 50): FeedItem[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  const named = ADAPTERS[sourceKey];
  if (named) return named(doc as never, max);
  if (doc && typeof doc === "object") {
    const o = doc as Json;
    // Shape-detected fallbacks: JSON Feed spec, then statuspage summary.
    if (typeof o.version === "string" && String(o.version).includes("jsonfeed.org") && Array.isArray(o.items)) {
      return parseJsonFeedSpec(o, max);
    }
    if (o.page && Array.isArray(o.incidents)) return parseStatuspageSummary(o, max);
  }
  return null;
}
