// /api/lexicon — Vercel serverless function
// GET /api/lexicon?term=BUSBAR
// Returns: { term, definition, domain, source }
//
// Looks up a Lexicon term in Airtable (table tblibfOpAa5wh0dA5).
// Used by Daily Challenge Lexicon Definition Drop hint (4th hint tier, 2 tokens).
//
// Required env vars on Vercel:
//   AIRTABLE_API_KEY      Airtable Personal Access Token with data.records:read scope
//   AIRTABLE_BASE_ID      appxfti7VuoHYUeu6 (Faraday base)

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "appxfti7VuoHYUeu6";
const AIRTABLE_TABLE_ID = "tblibfOpAa5wh0dA5"; // Lexicon
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

export default async function handler(req, res) {
  // CORS — allow same-origin Faraday calls
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const term = (req.query.term || "").toString().trim().toUpperCase();
  if (!term) return res.status(400).json({ error: "Missing required query param: term" });

  if (!AIRTABLE_API_KEY) {
    return res.status(500).json({ error: "Server not configured: AIRTABLE_API_KEY missing" });
  }

  try {
    // Filter by Term field (exact match, case-insensitive via UPPER)
    const formula = encodeURIComponent(`UPPER({Term}) = "${term.replace(/"/g, '\\"')}"`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?filterByFormula=${formula}&maxRecords=1`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Airtable lookup failed", status: response.status });
    }

    const data = await response.json();
    const record = data.records && data.records[0];

    if (!record) {
      return res.status(200).json({
        term,
        definition: null,
        found: false,
        message: "Term not yet in Lexicon. Faraday is adding new terms daily."
      });
    }

    return res.status(200).json({
      term: record.fields.Term,
      definition: record.fields.Definition || "No definition available.",
      domain: record.fields.Domain || null,
      source: "Faraday Lexicon",
      found: true
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal error", detail: err.message });
  }
}
