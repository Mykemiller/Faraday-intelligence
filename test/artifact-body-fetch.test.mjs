// Tests for artifact-body-fetch pure logic (CC-ARTIFACT-BODY-FETCH-1.0).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_CHAR_CAP,
  chunkSource,
  chunkText,
  decodeEntities,
  dropNoiseLines,
  extractSecDocument,
  htmlToText,
  isBlockResponse,
  isExhibitDocument,
  isSecHost,
  qualifiesForRechunk,
  robotsAllows,
  stripFilingTail,
  truncateAtParagraph,
  unwrapEdgarSubmission,
} from "../supabase/functions/artifact-body-fetch/body-pure.ts";
import { chunkText as enrichChunkText } from "../supabase/functions/enrich-artifacts/enrich-pure.ts";

test("decodeEntities handles named, decimal, hex and nbsp", () => {
  assert.equal(decodeEntities("AT&amp;T &#8212; &#x2019;s&nbsp;x &unknown;"), "AT&T — ’s x &unknown;");
});

test("htmlToText drops script/style/ix:header and keeps block structure", () => {
  const html = `<html><head><title>T</title><style>.a{}</style></head><body>
    <ix:header><ix:hidden>dei:Secret 123</ix:hidden></ix:header>
    <div style="display:none">hidden fact</div>
    <p>First&nbsp;para.</p><script>var x=1</script><p>Second <b>para</b>.</p>
    <table><tr><td>Revenue</td><td>100</td></tr></table></body></html>`;
  const t = htmlToText(html);
  assert.ok(!/Secret|hidden fact|var x|\.a\{/.test(t), t);
  assert.match(t, /First para\.\n+Second para\./);
  assert.match(t, /Revenue 100/);
});

test("htmlToText preferMain picks <main> when it carries the content", () => {
  const body = "Substantive text. ".repeat(60);
  const html = `<nav>Home | About | Contact</nav><main><p>${body}</p></main><footer>© gov</footer>`;
  const t = htmlToText(html, { preferMain: true, dropChrome: true });
  assert.ok(!/Home \| About/.test(t));
  assert.ok(t.startsWith("Substantive text."));
});

test("unwrapEdgarSubmission keeps only the first <DOCUMENT> and reads the header type", () => {
  const raw = `<SEC-DOCUMENT>0000712515-02-002877.txt
CONFORMED SUBMISSION TYPE:	10-K
<DOCUMENT>
<TYPE>10-K
<TEXT>
Annual report body.
</TEXT>
</DOCUMENT>
<DOCUMENT>
<TYPE>EX-21
<TEXT>Subsidiaries list</TEXT>
</DOCUMENT>
</SEC-DOCUMENT>`;
  const u = unwrapEdgarSubmission(raw);
  assert.equal(u.conformedType, "10-K");
  assert.equal(u.documentType, "10-K");
  assert.equal(u.droppedDocuments, 1);
  assert.match(u.text, /Annual report body/);
  assert.ok(!/Subsidiaries/.test(u.text));
});

test("isExhibitDocument uses <TYPE> when known, else the file name", () => {
  assert.equal(isExhibitDocument("https://x/ex99-1.htm", null), true);
  assert.equal(isExhibitDocument("https://x/ex_853035.htm", null), true);
  assert.equal(isExhibitDocument("https://x/f26836exv10w64.htm", null), true);
  assert.equal(isExhibitDocument("https://x/form10_k.htm", null), false);
  assert.equal(isExhibitDocument("https://x/d10k.txt", "10-K"), false);
  assert.equal(isExhibitDocument("https://x/d10k.txt", "EX-99.1"), true);
});

test("stripFilingTail cuts a trailing SIGNATURES section but never a top-of-doc mention", () => {
  const top = "SIGNATURES\n" + "Body text. ".repeat(500) + "\nSIGNATURES\nBy: /s/ Jane Doe";
  const r = stripFilingTail(top);
  assert.equal(r.cut, "SIGNATURES");
  assert.ok(r.text.startsWith("SIGNATURES\nBody text."));
  assert.ok(!/Jane Doe/.test(r.text));
});

test("extractSecDocument does not tail-cut an exhibit (exhibit IS the body)", () => {
  const html = "<html><body><p>" + "Press release text. ".repeat(300) + "</p><p>SIGNATURES</p><p>Contact: IR</p></body></html>";
  const e = extractSecDocument(html, "https://www.sec.gov/Archives/edgar/data/1/2/ex99-1.htm");
  assert.equal(e.isExhibit, true);
  assert.equal(e.tailCut, null);
  assert.match(e.text, /Contact: IR/);
  const p = extractSecDocument(html, "https://www.sec.gov/Archives/edgar/data/1/2/form8-k.htm");
  assert.equal(p.isExhibit, false);
  assert.equal(p.tailCut, "SIGNATURES");
});

test("dropNoiseLines removes page numbers and TOC links but keeps words like 'civil'", () => {
  const t = dropNoiseLines("Intro\n12\nTable of Contents\nPage 3 of 40\niv\ncivil\n<PAGE>\nEnd");
  assert.equal(t, "Intro\ncivil\nEnd");
});

test("truncateAtParagraph respects the cap and breaks on a paragraph", () => {
  const para = "x".repeat(900) + "\n\n";
  const text = para.repeat(1000); // ~902k chars
  const r = truncateAtParagraph(text, BODY_CHAR_CAP);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= BODY_CHAR_CAP);
  assert.ok(r.text.endsWith("x"));
  assert.deepEqual(truncateAtParagraph("short"), { text: "short", truncated: false });
});

test("isBlockResponse: any 403/429 from sec.gov is a block; 403 elsewhere only with block text", () => {
  assert.equal(isBlockResponse(403, "", "www.sec.gov"), true);
  assert.equal(isBlockResponse(429, "", "example.gov"), true);
  assert.equal(isBlockResponse(403, "Forbidden", "example.gov"), false);
  assert.equal(isBlockResponse(403, "Access Denied", "example.gov"), true);
  assert.equal(isBlockResponse(404, "", "www.sec.gov"), false);
  assert.equal(isSecHost("https://www.sec.gov/Archives/x"), true);
  assert.equal(isSecHost("https://notsec.gov/x"), false);
});

test("chunkText is byte-identical to enrich-pure.chunkText", () => {
  const text = ("Lorem ipsum dolor sit amet. ".repeat(400)) + "tail";
  assert.deepEqual(chunkText(text), enrichChunkText(text));
  assert.deepEqual(chunkText("tiny"), enrichChunkText("tiny"));
});

test("qualifiesForRechunk: >=2x raw AND >=raw+500", () => {
  assert.equal(qualifiesForRechunk(700, 150), true);
  assert.equal(qualifiesForRechunk(600, 150), false); // 2x but not +500
  assert.equal(qualifiesForRechunk(1200, 700), false); // +500 but not 2x
  assert.equal(qualifiesForRechunk(null, 10), false);
});

test("chunkSource leads with the ingest capture unless the body already starts with it", () => {
  assert.equal(chunkSource("10-K ACME filed 2020", "Body"), "10-K ACME filed 2020\n\nBody");
  assert.equal(chunkSource("", "Body"), "Body");
  assert.equal(chunkSource("Body", "Body text"), "Body text");
});

test("robotsAllows: agent group wins, longest match, empty disallow", () => {
  const robots = "User-agent: *\nDisallow: /private/\nAllow: /private/public\n\nUser-agent: BadBot\nDisallow: /\n";
  assert.equal(robotsAllows(robots, "/docs/a.pdf"), true);
  assert.equal(robotsAllows(robots, "/private/x"), false);
  assert.equal(robotsAllows(robots, "/private/public/x"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow:\n", "/x"), true);
  assert.equal(robotsAllows("User-agent: faraday\nDisallow: /\nUser-agent: *\nDisallow:", "/x"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/a.pdf"), false);
  assert.equal(robotsAllows(null, "/x"), true);
});
