#!/usr/bin/env -S npx tsx
/**
 * Gutenberg — Faraday Academy publishing pipeline (FAR-156)
 * ----------------------------------------------------------
 * Reads a Notion course page, extracts its section/module structure, maps it to
 * a LearnWorlds course payload (sections -> units -> drip schedule), and (only
 * when explicitly told to) publishes it via the LearnWorlds Admin API.
 *
 * DEFAULT MODE IS DRY-RUN: it prints the payload it WOULD send and exits without
 * touching LearnWorlds. Pass --publish to actually create/update the course.
 *
 * Idempotent: the course's external key (the FA-###-## code parsed from the page
 * title, falling back to the Notion page id) is used to look up an existing
 * LearnWorlds course. If found, Gutenberg UPDATES it; if not, it CREATES it.
 * Re-running the same page therefore updates rather than duplicates.
 *
 * Usage:
 *   npx tsx scripts/gutenberg.ts <notion-page-id> [--publish] [--drip-days N]
 *                                                  [--school <slug>] [--json]
 *
 * Env (see scripts/.env.example):
 *   NOTION_API_KEY   (required)         Notion integration token (read access)
 *   NOTION_VERSION   (optional)         Notion API version, default 2022-06-28
 *   LW_SCHOOL_ID     (required-publish) LearnWorlds school slug
 *   LW_API_KEY       (required-publish) LearnWorlds admin API bearer token
 *   LW_CLIENT_ID     (optional)         LearnWorlds Lw-Client header, if required
 *   LW_API_BASE      (optional)         Override API base URL
 *   GUTENBERG_DRIP_INTERVAL_DAYS (optional) default 7
 *
 * Exit codes: 0 ok · 1 usage/validation error · 2 extraction error · 3 API error
 */

/* eslint-disable no-console */

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface CliOptions {
  pageId: string;
  publish: boolean;
  dripDays: number;
  school?: string;
  json: boolean;
}

interface LearnWorldsUnit {
  title: string;
  /** LearnWorlds unit type. We emit textual units; video/quiz are future work. */
  type: "ondemand" | "page";
  order: number;
  content: string;
}

interface LearnWorldsSection {
  title: string;
  order: number;
  /** Drip rule: release this many days after enrollment (0 = immediately). */
  drip: { type: "days_after_enrollment"; value: number };
  units: LearnWorldsUnit[];
}

interface LearnWorldsCoursePayload {
  /** Stable external identifier used for idempotent upsert. */
  externalId: string;
  title: string;
  slug: string;
  description: string;
  access: "paid" | "free" | "draft";
  /** Source provenance — never published to learners, kept for traceability. */
  meta: {
    sourceNotionPageId: string;
    courseCode: string | null;
    generatedBy: "gutenberg";
    sectionCount: number;
    unitCount: number;
  };
  sections: LearnWorldsSection[];
}

/** A normalized intermediate node extracted from Notion before LW mapping. */
interface ExtractedSection {
  title: string;
  units: { title: string; content: string }[];
}

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

class GutenbergError extends Error {
  readonly code: 1 | 2 | 3;
  constructor(message: string, code: 1 | 2 | 3 = 2) {
    super(message);
    this.name = "GutenbergError";
    this.code = code;
  }
}

// ----------------------------------------------------------------------------
// CLI parsing
// ----------------------------------------------------------------------------

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let pageId = "";
  let publish = false;
  let json = false;
  let school = process.env.LW_SCHOOL_ID || undefined;
  let dripDays = Number(process.env.GUTENBERG_DRIP_INTERVAL_DAYS ?? 7);

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--publish") publish = true;
    else if (a === "--json") json = true;
    else if (a === "--drip-days") dripDays = Number(args[++i]);
    else if (a === "--school") school = args[++i];
    else if (a.startsWith("--")) throw new GutenbergError(`Unknown flag: ${a}`, 1);
    else if (!pageId) pageId = a;
    else throw new GutenbergError(`Unexpected argument: ${a}`, 1);
  }

  if (!pageId) {
    throw new GutenbergError(
      "Missing Notion page id.\n" +
        "Usage: gutenberg.ts <notion-page-id> [--publish] [--drip-days N] [--school <slug>] [--json]",
      1,
    );
  }
  if (!Number.isFinite(dripDays) || dripDays < 0) {
    throw new GutenbergError(`--drip-days must be a non-negative number (got ${dripDays})`, 1);
  }
  return { pageId, publish, dripDays, school, json };
}

// ----------------------------------------------------------------------------
// Notion fetch layer
// ----------------------------------------------------------------------------

const NOTION_BASE = "https://api.notion.com/v1";

function notionHeaders(): Record<string, string> {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new GutenbergError("NOTION_API_KEY is not set", 1);
  return {
    Authorization: `Bearer ${key}`,
    "Notion-Version": process.env.NOTION_VERSION || "2022-06-28",
    "Content-Type": "application/json",
  };
}

async function notionGet(path: string): Promise<any> {
  const res = await fetch(`${NOTION_BASE}${path}`, { headers: notionHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GutenbergError(`Notion API ${res.status} on ${path}: ${body.slice(0, 300)}`, 3);
  }
  return res.json();
}

/** Fetch a page's metadata (for the title) plus all of its child blocks. */
async function fetchNotionPage(pageId: string): Promise<{ title: string; blocks: any[] }> {
  const page = await notionGet(`/pages/${pageId}`);
  const title = extractTitle(page);

  const blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const chunk = await notionGet(`/blocks/${pageId}/children${qs}`);
    blocks.push(...(chunk.results ?? []));
    cursor = chunk.has_more ? chunk.next_cursor : undefined;
  } while (cursor);

  return { title, blocks };
}

function extractTitle(page: any): string {
  const props = page?.properties ?? {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === "title" && Array.isArray(p.title)) {
      return plainText(p.title).trim();
    }
  }
  return "";
}

/** Flatten a Notion rich_text array to plain text. */
function plainText(rich: any[]): string {
  if (!Array.isArray(rich)) return "";
  return rich.map((r) => r?.plain_text ?? "").join("");
}

/** Pull human-readable text out of any supported block for unit content. */
function blockText(block: any): string {
  const t = block?.type;
  const data = block?.[t];
  if (!data) return "";
  if (Array.isArray(data.rich_text)) return plainText(data.rich_text);
  // Table rows arrive as their own child blocks; cells live under table_row.
  if (t === "table_row" && Array.isArray(data.cells)) {
    return data.cells.map((cell: any[]) => plainText(cell)).join(" | ");
  }
  return "";
}

// ----------------------------------------------------------------------------
// Extraction: Notion blocks -> ExtractedSection[]
// ----------------------------------------------------------------------------

const SECTION_HEADINGS = new Set(["heading_1", "heading_2"]);
const UNIT_HEADINGS = new Set(["heading_3"]);

/**
 * Walk the block list and build a section/unit tree.
 *
 * Rules (kept deliberately generic so this works on any Notion course page, not
 * just the current FA-### templates):
 *   - A heading_1 or heading_2 opens a new SECTION.
 *   - A heading_3 opens a new UNIT inside the current section.
 *   - Any other content block appends text to the current unit (or to an
 *     implicit "Overview" unit if the section has no heading_3 yet).
 *   - Content that appears before the first section heading becomes a synthetic
 *     "Introduction" section so nothing is silently dropped.
 */
function extractSections(blocks: any[]): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  let current: ExtractedSection | null = null;
  let currentUnit: { title: string; content: string } | null = null;

  const ensureSection = (title: string): ExtractedSection => {
    const s: ExtractedSection = { title, units: [] };
    sections.push(s);
    current = s;
    currentUnit = null;
    return s;
  };

  const ensureUnit = (title: string): { title: string; content: string } => {
    if (!current) ensureSection("Introduction");
    const u = { title, content: "" };
    current!.units.push(u);
    currentUnit = u;
    return u;
  };

  for (const block of blocks) {
    const type = block?.type;
    if (SECTION_HEADINGS.has(type)) {
      const title = blockText(block).trim() || "Untitled section";
      ensureSection(title);
      continue;
    }
    if (UNIT_HEADINGS.has(type)) {
      const title = blockText(block).trim() || "Untitled unit";
      ensureUnit(title);
      continue;
    }
    // Body content.
    const text = blockText(block).trim();
    if (!text) continue;
    if (!current) ensureSection("Introduction");
    if (!currentUnit) ensureUnit(current!.title);
    currentUnit!.content += (currentUnit!.content ? "\n\n" : "") + text;
  }

  // Drop empty sections (heading with no extractable content under it).
  return sections.filter((s) => s.units.some((u) => u.content.trim().length > 0));
}

// ----------------------------------------------------------------------------
// Mapping: ExtractedSection[] -> LearnWorldsCoursePayload
// ----------------------------------------------------------------------------

const COURSE_CODE_RE = /\bFA-(?:\d{3}|X)-[A-Z0-9]+\b/i;

function parseCourseCode(title: string): string | null {
  const m = title.match(COURSE_CODE_RE);
  return m ? m[0].toUpperCase() : null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildPayload(
  page: { title: string; blocks: any[] },
  extracted: ExtractedSection[],
  opts: CliOptions,
): LearnWorldsCoursePayload {
  if (extracted.length === 0) {
    throw new GutenbergError(
      `No sections could be extracted from page "${page.title || opts.pageId}". ` +
        "Expected at least one heading (## / #) with content beneath it.",
      2,
    );
  }

  const code = parseCourseCode(page.title);
  const externalId = code ?? `notion:${opts.pageId}`;
  const title = page.title || "Untitled Faraday Academy Course";

  // First section's first unit doubles as the course description seed.
  const description =
    extracted[0].units.find((u) => u.content.trim())?.content.slice(0, 480).trim() ?? "";

  let unitCount = 0;
  const sections: LearnWorldsSection[] = extracted.map((s, i) => {
    const units: LearnWorldsUnit[] = s.units
      .filter((u) => u.content.trim().length > 0)
      .map((u, j) => {
        unitCount++;
        return { title: u.title, type: "page" as const, order: j + 1, content: u.content };
      });
    return {
      title: s.title,
      order: i + 1,
      drip: { type: "days_after_enrollment" as const, value: i * opts.dripDays },
      units,
    };
  });

  return {
    externalId,
    title,
    // Prefix the code only when the title doesn't already carry it (avoid dupes).
    slug: slugify(code && !title.toUpperCase().includes(code) ? `${code} ${title}` : title),
    description,
    access: "draft", // never auto-publish to "paid"/"free"; human flips access in LW
    meta: {
      sourceNotionPageId: opts.pageId,
      courseCode: code,
      generatedBy: "gutenberg",
      sectionCount: sections.length,
      unitCount,
    },
    sections,
  };
}

// ----------------------------------------------------------------------------
// LearnWorlds API layer (only exercised with --publish)
// ----------------------------------------------------------------------------

function lwBase(school?: string): string {
  if (process.env.LW_API_BASE) return process.env.LW_API_BASE.replace(/\/+$/, "");
  const slug = school || process.env.LW_SCHOOL_ID;
  if (!slug) throw new GutenbergError("LW_SCHOOL_ID (or --school) is required to publish", 1);
  return `https://${slug}.learnworlds.com/admin/api/v2`;
}

function lwHeaders(): Record<string, string> {
  const key = process.env.LW_API_KEY;
  if (!key) throw new GutenbergError("LW_API_KEY is required to publish", 1);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (process.env.LW_CLIENT_ID) headers["Lw-Client"] = process.env.LW_CLIENT_ID;
  return headers;
}

async function lwRequest(method: string, base: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: lwHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GutenbergError(`LearnWorlds ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, 3);
  }
  return res.status === 204 ? {} : res.json();
}

/** Look up an existing course by our external id (idempotency key). */
async function findExistingCourse(base: string, externalId: string): Promise<string | null> {
  const q = encodeURIComponent(externalId);
  const data = await lwRequest("GET", base, `/courses?filter[external_id]=${q}`);
  const list = data?.data ?? data?.courses ?? [];
  if (Array.isArray(list) && list.length > 0) return list[0].id ?? list[0].course_id ?? null;
  return null;
}

/**
 * Publish (create or update) the course + its sections/units. This is the only
 * code path that mutates LearnWorlds, and it runs only under --publish.
 */
async function publishToLearnWorlds(payload: LearnWorldsCoursePayload, opts: CliOptions): Promise<void> {
  const base = lwBase(opts.school);
  const existingId = await findExistingCourse(base, payload.externalId);

  const courseBody = {
    title: payload.title,
    slug: payload.slug,
    description: payload.description,
    access: payload.access,
    external_id: payload.externalId,
  };

  let courseId: string;
  if (existingId) {
    await lwRequest("PUT", base, `/courses/${existingId}`, courseBody);
    courseId = existingId;
    console.log(`↻ Updated existing LearnWorlds course ${courseId} (${payload.externalId})`);
  } else {
    const created = await lwRequest("POST", base, `/courses`, courseBody);
    courseId = created?.id ?? created?.data?.id;
    console.log(`＋ Created LearnWorlds course ${courseId} (${payload.externalId})`);
  }

  // Sections + units. (LearnWorlds keys child content under the course id.)
  for (const section of payload.sections) {
    const sec = await lwRequest("POST", base, `/courses/${courseId}/sections`, {
      title: section.title,
      order: section.order,
      drip_type: section.drip.type,
      drip_value: section.drip.value,
    });
    const sectionId = sec?.id ?? sec?.data?.id;
    for (const unit of section.units) {
      await lwRequest("POST", base, `/courses/${courseId}/sections/${sectionId}/units`, {
        title: unit.title,
        type: unit.type,
        order: unit.order,
        content: unit.content,
      });
    }
  }
  console.log(
    `✓ Published ${payload.sections.length} sections / ${payload.meta.unitCount} units to course ${courseId}.`,
  );
}

// ----------------------------------------------------------------------------
// Dry-run reporting
// ----------------------------------------------------------------------------

function printDryRun(payload: LearnWorldsCoursePayload, opts: CliOptions): void {
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log("──────────────────────────────────────────────────────────────");
  console.log("  GUTENBERG DRY-RUN — no LearnWorlds calls made (pass --publish)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Course        : ${payload.title}`);
  console.log(`  External id   : ${payload.externalId}`);
  console.log(`  Course code   : ${payload.meta.courseCode ?? "(none — using page id)"}`);
  console.log(`  Slug          : ${payload.slug}`);
  console.log(`  Access        : ${payload.access}`);
  console.log(`  Source page   : ${payload.meta.sourceNotionPageId}`);
  console.log(`  Sections/units: ${payload.meta.sectionCount} / ${payload.meta.unitCount}`);
  console.log(`  Drip interval : ${opts.dripDays} day(s) between sections`);
  console.log(`  Description   : ${payload.description.slice(0, 120)}${payload.description.length > 120 ? "…" : ""}`);
  console.log("  ----------------------------------------------------------");
  for (const s of payload.sections) {
    console.log(`  § ${s.order}. ${s.title}   [release T+${s.drip.value}d]`);
    for (const u of s.units) {
      const preview = u.content.replace(/\s+/g, " ").slice(0, 64);
      console.log(`      • ${u.title}  (${u.content.length} chars) — ${preview}…`);
    }
  }
  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Re-run with --publish (and LW_API_KEY / LW_SCHOOL_ID set) to");
  console.log("  create/update this course in LearnWorlds. Upsert is keyed on");
  console.log("  the external id above, so publishing twice updates in place.");
  console.log("──────────────────────────────────────────────────────────────");
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const page = await fetchNotionPage(opts.pageId);
  const extracted = extractSections(page.blocks);
  const payload = buildPayload(page, extracted, opts);

  if (!opts.publish) {
    printDryRun(payload, opts);
    return;
  }

  // Guard: publishing needs credentials. Fail loudly rather than half-publish.
  if (!process.env.LW_API_KEY || !(opts.school || process.env.LW_SCHOOL_ID)) {
    throw new GutenbergError(
      "--publish requires LW_API_KEY and LW_SCHOOL_ID (or --school). " +
        "Provision them (see scripts/.env.example) or drop --publish for a dry-run.",
      1,
    );
  }
  await publishToLearnWorlds(payload, opts);
}

// Only run when invoked directly (so the pure functions can be imported/tested).
const invokedDirectly = !!process.argv[1] && /gutenberg\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    if (err instanceof GutenbergError) {
      console.error(`✗ ${err.message}`);
      process.exit(err.code);
    }
    console.error("✗ Unexpected error:", err);
    process.exit(3);
  });
}

export { extractSections, buildPayload, parseCourseCode, slugify, printDryRun };
export type { LearnWorldsCoursePayload, ExtractedSection };
