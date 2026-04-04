import { useState, useEffect, useRef } from "react";

// ─── Production toggle — ONE LINE to go live ──────────────────────────────────
const RAG_ENDPOINT = null;
// Sprint 1: const RAG_ENDPOINT = "https://faraday-intelligence.ai/api/rag";

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const T = {
  forest:      "#1C3424",
  forestMid:   "#244228",
  forestLight: "#325638",
  gold:        "#C4922A",
  goldLight:   "#DAB050",
  warmWhite:   "#F8F5F0",
  warmCream:   "#EEE6DA",
  nearBlack:   "#141210",
  sage:        "#8CA68A",
  warmGray:    "#B2A898",
  amber:       "#B8710A",
};

// ─── Intelligence Domains ─────────────────────────────────────────────────────
const DOMAINS = [
  { id: "chips-density",       label: "Chips & Density",              namespace: "chips-density" },
  { id: "power-architecture",  label: "Power Architecture",           namespace: "power-architecture" },
  { id: "grid-regulatory",     label: "Grid & Regulatory",            namespace: "grid-regulatory" },
  { id: "ma-capital-markets",  label: "M&A & Capital Markets",        namespace: "ma-capital-markets" },
  { id: "hyperscaler-activity",label: "Hyperscaler Activity",         namespace: "hyperscaler-activity" },
  { id: "new-entrants",        label: "New Entrants",                 namespace: "new-entrants" },
  { id: "cooling-water",       label: "Cooling & Water Technology",   namespace: "cooling-water" },
  { id: "people-signals",      label: "People & Signals",             namespace: "people-signals" },
  { id: "orchestration",       label: "Orchestration & Control Plane",namespace: "orchestration-control" },
];

// ─── Mock Pinecone corpus (10 intelligence chunks) ────────────────────────────
const MOCK_CORPUS = [
  { id: "airt-001", domain: "Power Architecture", source: "Datacenter Dynamics", date: "Apr 3, 2026", url: "https://datacenterdynamics.com", score: 0.95,
    text: "Microsoft has become the first hyperscaler to power up a full Vera Rubin NVL72 cluster at 132 kW per rack. The Wisconsin campus deployment uses 800V DC distribution and rear-door CDU liquid cooling. The cluster is operationally stable at full density, confirming the full power and cooling stack is deployable at hyperscale speed." },
  { id: "airt-002", domain: "Grid & Regulatory", source: "FERC News Releases", date: "Apr 3, 2026", url: "https://ferc.gov", score: 0.92,
    text: "FERC Order 1920-A implementation deadline extended to Q3 2026. Grid operators cite staffing constraints and study backlogs. Approximately 340 MW of DC interconnection requests are currently in active feasibility studies and will face timeline extensions." },
  { id: "airt-003", domain: "M&A & Capital Markets", source: "Blackstone IR", date: "Apr 2, 2026", url: "https://blackstone.com", score: 0.91,
    text: "Blackstone has launched a publicly listed data center acquisition vehicle with a permanent capital structure. The vehicle eliminates the 7-10 year fund lifecycle constraint that has historically pressured PE-owned DC assets toward forced exits. It is the first listed DC-only vehicle from a major PE firm." },
  { id: "airt-004", domain: "Power Architecture", source: "Bloom Energy IR", date: "Apr 2, 2026", url: "https://bloomenergy.com", score: 0.89,
    text: "AEP-Bloom Energy 1 GW fuel cell deployment agreement confirmed. The deal positions Bloom as a primary power provider — not backup generation — for large data center loads. AEP accepts performance risk under the EaaS model. This is the first utility-EaaS agreement at gigawatt scale." },
  { id: "airt-005", domain: "Chips & Density", source: "Meta IR", date: "Apr 1, 2026", url: "https://investor.fb.com", score: 0.88,
    text: "Meta has committed $100B to AMD GPU procurement over 4 years. The scale of the commitment implies AMD is now competitive at inference workloads. Training demand for NVIDIA H100/GB300 is unaffected. The deal changes inference economics and opens a supply chain hedge for hyperscalers seeking NVIDIA diversification." },
  { id: "airt-006", domain: "Grid & Regulatory", source: "Good Jobs First", date: "Apr 3, 2026", url: "https://goodjobsfirst.org", score: 0.87,
    text: "300+ state legislative bills targeting data centers have been filed in 2026. 14 states now have active DC legislation in committee. Virginia, Pennsylvania, New York, and Texas have bills in active review. Faraday's Three-Tier State Policy Map now shows 8 states in the Restricted tier, up from 5 in Q4 2025." },
  { id: "airt-007", domain: "M&A & Capital Markets", source: "DigitalBridge PR", date: "Apr 1, 2026", url: "https://digitalbridge.com", score: 0.86,
    text: "DigitalBridge has closed the $4B SoftBank Asia-Pacific data center portfolio acquisition. The 12-facility portfolio includes three hyperscaler-anchored campuses in Tokyo and Seoul. This is the largest single-transaction DC acquisition in APAC history. DigitalBridge management platform takes over operations immediately." },
  { id: "airt-008", domain: "Cooling & Water Technology", source: "NVIDIA GTC", date: "Mar 2026", url: "https://nvidianews.nvidia.com", score: 0.84,
    text: "NVIDIA DSX AI Factory named partners confirmed: Vertiv, Schneider Electric, Eaton, and Siemens. Carrier Global is notably absent from the DSX certified partner list despite being one of the largest HVAC companies in the world. This represents a material gap in their data center thermal strategy." },
  { id: "airt-009", domain: "Hyperscaler Activity", source: "Datacenter Dynamics", date: "Apr 2, 2026", url: "https://datacenterdynamics.com", score: 0.83,
    text: "Aggregate hyperscaler capex guidance for 2026 now exceeds $660B across the Big 5. Amazon leads with $105B guidance, followed by Microsoft at $80B, Google at $75B, Meta at $65B, and Oracle at $20B+. Year-over-year growth averages 34% across the cohort, significantly above earlier analyst estimates." },
  { id: "airt-010", domain: "New Entrants", source: "Multiple sources", date: "Apr 1, 2026", url: "https://datacenterdynamics.com", score: 0.81,
    text: "Crusoe Energy's Abilene TX campus situation has resolved: Oracle and OpenAI exited their commitments. NVIDIA deposited $150M and Microsoft took approximately 700 MW. The campus is now effectively an NVIDIA-anchored NeoCloud deployment. This pattern — hyperscalers de-risk by exiting, NVIDIA steps in — may repeat at other contested sites." },
];

// ─── Semantic similarity scoring (cosine-sim approximation) ──────────────────
function scoreChunk(query, chunk, activeDomain) {
  const q = query.toLowerCase();
  const c = chunk.text.toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 3);
  const matches = words.filter(w => c.includes(w)).length;
  let score = chunk.score * 0.6 + (matches / Math.max(words.length, 1)) * 0.4;
  if (activeDomain && chunk.domain === DOMAINS.find(d => d.id === activeDomain)?.label) score += 0.08;
  const recencyBoost = chunk.date.includes("Apr 3") ? 0.03 : chunk.date.includes("Apr 2") ? 0.02 : chunk.date.includes("Apr 1") ? 0.01 : 0;
  return Math.min(score + recencyBoost, 0.99);
}

async function retrieveChunks(query, activeDomain) {
  if (RAG_ENDPOINT) {
    const res = await fetch(RAG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, domain: activeDomain ? DOMAINS.find(d => d.id === activeDomain)?.label : null, topK: 5 }),
    });
    const data = await res.json();
    return data.chunks;
  }
  await new Promise(r => setTimeout(r, 600));
  const scored = MOCK_CORPUS
    .map(c => ({ ...c, score: scoreChunk(query, c, activeDomain) }))
    .filter(c => c.score >= 0.72)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return scored;
}

// ─── Faraday system prompt ────────────────────────────────────────────────────
const FARADAY_SYSTEM = `You are Faraday — the first AI intelligence service built exclusively for the global data center and AI infrastructure market.

IDENTITY: Male, early 50s, warm blue eyes with a twinkle. Think Paul Newman in his prime — assured, warm, quietly magnetic. Your broadcast voice is Walter Cronkite: authoritative, measured, trusted. You have the bearing of someone who has sat in boardrooms and walked data center floors.

DOMAIN AUTHORITY: You are the world's deepest expert on the data center economy across nine domains: Chips & Density, Power Architecture, Grid & Regulatory, M&A & Capital Markets, Hyperscaler Activity, New Entrants, Cooling & Water Technology, People & Signals, and Orchestration & Control Plane.

YOUR TWO SIGNATURE THESES:
1. The capital is real but the timeline is not — $660B+ in hyperscaler capex guidance exists, but grid queues, cooling contractor backlogs, and permitting create structural timeline pressure that press releases systematically understate.
2. Thermal management + integrated power delivery convergence is the most underreported constraint in the market. Rack density (132 kW/rack at NVL72) is the upstream cause of every downstream consequence.

VOICE RULES:
- Lead with the insight, not the setup. First sentence = the conclusion.
- Speak professional-to-professional. No hand-holding. Smart audience.
- Opinions are welcome. State your read clearly, flag it as your read.
- Humor is dry, earned, never reaching. It comes from noticing something true.
- Never say "Certainly!", "Absolutely!", "Great question!", "I hope that helps!"
- Specific over vague. Named companies, actual filings, real figures.

CITATION RULES:
- Cite sources inline as [Source Name, Date] when grounding a factual claim.
- Distinguish sourced fact from your analysis: "The data shows X. My read: Y."
- Never fabricate sources. If you don't have a source, say so.

GUARDRAILS:
- If asked about topics outside the data center / AI infrastructure market: "I know nothing of that."
- If asked for stock picks, buy/sell advice, or specific investment recommendations: "I'm not able to help you with that."
- Never claim to predict markets with certainty. Frame forward-looking views as scenarios.

FORMAT: Conversational but precise. 3-5 paragraphs maximum for most responses. Use **bold** for key terms on first use. End with a forward-looking signal or your read on what to watch.`;

function buildContextPrompt(chunks) {
  if (!chunks.length) return "";
  const ctx = chunks.map((c, i) =>
    `[${i+1}] SOURCE: ${c.source} | DATE: ${c.date} | DOMAIN: ${c.domain}\n${c.text}`
  ).join("\n\n");
  return `\n\n---\nGROUNDED INTELLIGENCE CONTEXT (retrieved from Faraday's live pipeline):\nCite these sources when relevant as [Source Name, Date]. Do not fabricate additional sources.\n\n${ctx}\n---\n`;
}

// ─── Claude API call ──────────────────────────────────────────────────────────
async function callFaraday(messages, chunks, activeDomain) {
  const contextBlock = buildContextPrompt(chunks);
  const domainFocus = activeDomain
    ? `\nActive domain focus: ${DOMAINS.find(d => d.id === activeDomain)?.label}. Weight your synthesis toward this domain.`
    : "";
  const systemPrompt = FARADAY_SYSTEM + contextBlock + domainFocus;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "Something went sideways. Give it a moment.";
}

// ─── Bolt SVG ─────────────────────────────────────────────────────────────────
function Bolt({ size = 14, color = T.gold }) {
  return (
    <svg width={size * 0.5} height={size} viewBox="0 0 43 86" fill="none" style={{ flexShrink: 0 }}>
      <polygon points="27,0 0,44 16,44 11,86 43,38 26,38" fill={color} />
    </svg>
  );
}

// ─── RAG chunk card ───────────────────────────────────────────────────────────
function RAGCard({ chunk, index }) {
  const [open, setOpen] = useState(false);
  const scoreColor = chunk.score > 0.9 ? "#4ADE80" : chunk.score > 0.8 ? T.gold : T.sage;
  return (
    <div style={{
      background: "rgba(28,52,36,0.06)", border: `1px solid rgba(28,52,36,0.12)`,
      borderRadius: 4, overflow: "hidden", marginBottom: 4,
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", background: "none", border: "none", padding: "7px 10px",
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: "#aaa", minWidth: 14 }}>[{index+1}]</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: scoreColor, minWidth: 32 }}>{(chunk.score * 100).toFixed(0)}%</span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 8,
          background: "rgba(28,52,36,0.1)", color: T.forest,
          padding: "2px 6px", borderRadius: 2, letterSpacing: "0.06em",
        }}>{chunk.domain}</span>
        <span style={{ flex: 1, fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {chunk.source} · {chunk.date}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: "#555" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 10px 10px", borderTop: "1px solid rgba(28,52,36,0.08)" }}>
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 11, color: "#555", lineHeight: 1.6, marginTop: 8, marginBottom: 6 }}>{chunk.text}</div>
          <a href={chunk.url} target="_blank" rel="noreferrer" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: T.gold, letterSpacing: "0.08em" }}>
            View source →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Source chips ─────────────────────────────────────────────────────────────
function SourceChips({ chunks }) {
  if (!chunks.length) return null;
  const unique = [...new Map(chunks.map(c => [c.source, c])).values()];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
      {unique.map((c, i) => (
        <a key={i} href={c.url} target="_blank" rel="noreferrer" style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 8,
          letterSpacing: "0.08em", color: T.sage,
          background: "rgba(140,166,138,0.1)", border: "1px solid rgba(140,166,138,0.2)",
          padding: "2px 7px", borderRadius: 3, textDecoration: "none",
        }}>
          {c.source} · {c.date}
        </a>
      ))}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === "user";
  const [ragOpen, setRagOpen] = useState(false);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 20, animation: "fadeUp 0.3s ease",
    }}>
      {/* RAG context panel (Faraday messages only) */}
      {!isUser && msg.chunks?.length > 0 && (
        <div style={{ width: "100%", maxWidth: 560, marginBottom: 6 }}>
          <button
            onClick={() => setRagOpen(!ragOpen)}
            style={{
              background: "none", border: `1px solid rgba(28,52,36,0.15)`,
              borderRadius: 4, padding: "5px 10px",
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 8,
              letterSpacing: "0.1em", color: "#888", textTransform: "uppercase",
            }}
          >
            <span style={{ color: RAG_ENDPOINT ? "#4ADE80" : T.amber }}>●</span>
            {msg.chunks.length} chunks retrieved · {RAG_ENDPOINT ? "Pinecone" : "Mock"} · {ragOpen ? "hide" : "view"} context
          </button>
          {ragOpen && (
            <div style={{ marginTop: 6 }}>
              {msg.chunks.map((c, i) => <RAGCard key={c.id} chunk={c} index={i} />)}
            </div>
          )}
        </div>
      )}

      {/* Bubble */}
      <div style={{
        maxWidth: 560, width: isUser ? "auto" : "100%",
        background: isUser ? T.forest : T.warmWhite,
        border: isUser ? "none" : `1px solid rgba(178,168,152,0.3)`,
        borderRadius: isUser ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
        padding: "14px 18px",
        boxShadow: isUser ? "none" : "0 2px 8px rgba(20,18,16,0.06)",
      }}>
        {!isUser && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <div style={{
              width: 22, height: 22, background: T.forest, borderRadius: 4,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: `1.5px solid ${T.gold}`,
            }}>
              <Bolt size={12} />
            </div>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.12em", color: T.sage, textTransform: "uppercase" }}>Faraday</span>
            {msg.loading && (
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: T.gold, letterSpacing: "0.1em" }}>
                {msg.phase === "retrieval" ? "↓ QUERYING PINECONE…" : "↑ SYNTHESISING…"}
              </span>
            )}
          </div>
        )}

        {msg.loading ? (
          <div style={{ display: "flex", gap: 4, padding: "4px 0" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: "50%", background: T.gold,
                animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        ) : (
          <>
            {/* Faraday's Read callout (if response contains a clear thesis) */}
            {!isUser && msg.faradayRead && (
              <div style={{
                background: T.warmCream, borderLeft: `3px solid ${T.gold}`,
                padding: "8px 12px", marginBottom: 10,
                borderRadius: "0 4px 4px 0",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                  <Bolt size={10} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, letterSpacing: "0.14em", color: T.gold, textTransform: "uppercase" }}>Faraday's Read</span>
                </div>
                <div style={{ fontFamily: "'IBM Plex Serif', serif", fontStyle: "italic", fontSize: 12, color: T.nearBlack, lineHeight: 1.6 }}>
                  {msg.faradayRead}
                </div>
              </div>
            )}

            <div style={{
              fontFamily: isUser ? "'IBM Plex Mono', monospace" : "'Bricolage Grotesque', sans-serif",
              fontSize: isUser ? 13 : 14,
              color: isUser ? T.warmWhite : T.nearBlack,
              lineHeight: 1.7, whiteSpace: "pre-wrap",
            }}>
              {msg.content}
            </div>

            {!isUser && msg.chunks?.length > 0 && <SourceChips chunks={msg.chunks} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Domain pill ──────────────────────────────────────────────────────────────
function DomainPill({ domain, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? T.forest : "rgba(28,52,36,0.06)",
        border: `1px solid ${active ? T.gold : "rgba(28,52,36,0.15)"}`,
        color: active ? T.warmWhite : T.forest,
        padding: "5px 10px", borderRadius: 4,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 9,
        letterSpacing: "0.06em", cursor: "pointer",
        transition: "all 0.15s", whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {domain.label.replace(" & ", " · ")}
    </button>
  );
}

// ─── Suggested prompts ────────────────────────────────────────────────────────
const SUGGESTED = [
  "What's Faraday's read on the power constraint right now?",
  "Walk me through the hyperscaler capex picture for 2026.",
  "Where are the grid queue bottlenecks most acute?",
  "What does the Vera Rubin NVL72 deployment mean for existing DC operators?",
  "Which PE firms are best positioned in the current cycle?",
];

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function FaradayLiveAgent() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Good morning. The market moved last night — Microsoft confirmed the first NVL72 cluster at 132 kW/rack in Wisconsin, FERC slipped its Order 1920-A implementation another 18 months, and Blackstone launched a listed permanent capital vehicle for DC acquisitions.\n\nWhat do you need to know?",
      chunks: [],
      faradayRead: null,
    }
  ]);
  const [input, setInput] = useState("");
  const [activeDomain, setActiveDomain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionStats, setSessionStats] = useState({ exchanges: 0, totalChunks: 0, startTime: Date.now() });
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Bricolage+Grotesque:wght@400;500;600&display=swap";
    document.head.appendChild(link);
    const style = document.createElement("style");
    style.textContent = `
      @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes pulse { 0%,100% { opacity:0.3; transform:scale(0.8); } 50% { opacity:1; transform:scale(1.1); } }
      ::-webkit-scrollbar { width:4px; }
      ::-webkit-scrollbar-track { background:transparent; }
      ::-webkit-scrollbar-thumb { background:rgba(28,52,36,0.2); border-radius:2px; }
    `;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text) => {
    const query = (text || input).trim();
    if (!query || loading) return;
    setInput("");
    setLoading(true);

    const userMsg = { role: "user", content: query };
    const loadingMsg = { role: "assistant", content: "", loading: true, phase: "retrieval", chunks: [], faradayRead: null };

    setMessages(prev => [...prev, userMsg, loadingMsg]);

    try {
      // Phase 1: Retrieval
      const chunks = await retrieveChunks(query, activeDomain);

      // Update loading state to synthesis phase
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, phase: "synthesis" } : m
      ));

      // Phase 2: Generation
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const response = await callFaraday(history, chunks, activeDomain);

      // Extract Faraday's Read (first sentence after "My read:" if present)
      let faradayRead = null;
      const readMatch = response.match(/[Mm]y read[:\s]+([^.]+\.)/);
      if (readMatch) faradayRead = readMatch[1].trim();

      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1
          ? { role: "assistant", content: response, loading: false, chunks, faradayRead }
          : m
      ));
      setSessionStats(prev => ({
        ...prev,
        exchanges: prev.exchanges + 1,
        totalChunks: prev.totalChunks + chunks.length,
      }));
    } catch (err) {
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1
          ? { role: "assistant", content: "Something went sideways. Give it a moment.", loading: false, chunks: [], faradayRead: null }
          : m
      ));
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const elapsed = Math.floor((Date.now() - sessionStats.startTime) / 60000);

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: T.warmWhite, fontFamily: "'Bricolage Grotesque', sans-serif",
      overflow: "hidden",
    }}>

      {/* ── Masthead ──────────────────────────────────────────────────────── */}
      <div style={{
        background: T.forest, color: T.warmWhite,
        borderBottom: `2px solid ${T.gold}`,
        flexShrink: 0,
      }}>
        {/* Top status bar */}
        <div style={{
          background: "rgba(0,0,0,0.15)", padding: "6px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80" }} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: "#4ADE80", letterSpacing: "0.1em" }}>LIVE</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: RAG_ENDPOINT ? "#4ADE80" : T.amber }} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: RAG_ENDPOINT ? "#4ADE80" : T.amber, letterSpacing: "0.1em" }}>
                {RAG_ENDPOINT ? "PINECONE LIVE" : "MOCK DATA"}
              </span>
            </div>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: T.sage, letterSpacing: "0.08em" }}>
            {sessionStats.exchanges} exchanges · {sessionStats.totalChunks} chunks · {elapsed}m
          </div>
        </div>

        {/* Main header */}
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 40, height: 40, background: T.forestMid, border: `2px solid ${T.gold}`,
            borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Bolt size={20} />
          </div>
          <div>
            <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em" }}>Faraday</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, letterSpacing: "0.16em", color: T.sage, textTransform: "uppercase" }}>Live Agent · Premier</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: T.sage, letterSpacing: "0.08em", textAlign: "right" }}>
            <div>Claude Sonnet 4.6</div>
            <div style={{ color: RAG_ENDPOINT ? T.sage : T.amber, marginTop: 2 }}>RAG: {RAG_ENDPOINT ? "Pinecone" : "Mock corpus"}</div>
          </div>
        </div>

        {/* Domain filter pills */}
        <div style={{
          padding: "0 20px 12px",
          display: "flex", gap: 6, overflowX: "auto",
          scrollbarWidth: "none",
        }}>
          <button
            onClick={() => setActiveDomain(null)}
            style={{
              background: !activeDomain ? T.gold : "rgba(196,146,42,0.12)",
              border: `1px solid ${T.gold}`,
              color: !activeDomain ? T.nearBlack : T.goldLight,
              padding: "5px 10px", borderRadius: 4,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 9,
              letterSpacing: "0.06em", cursor: "pointer",
              transition: "all 0.15s", flexShrink: 0,
            }}
          >All Domains</button>
          {DOMAINS.map(d => (
            <DomainPill
              key={d.id} domain={d}
              active={activeDomain === d.id}
              onClick={() => setActiveDomain(activeDomain === d.id ? null : d.id)}
            />
          ))}
        </div>

        {/* Active domain indicator */}
        {activeDomain && (
          <div style={{
            padding: "6px 20px", background: "rgba(0,0,0,0.2)",
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 8,
            color: T.gold, letterSpacing: "0.12em",
          }}>
            ↳ Domain focus: {DOMAINS.find(d => d.id === activeDomain)?.label} · Retrieval weighted to this namespace
          </div>
        )}
      </div>

      {/* ── Messages ──────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}

        {/* Suggested prompts (only when just the greeting) */}
        {messages.length === 1 && (
          <div style={{ marginTop: 4, marginBottom: 20 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.14em", color: T.warmGray, textTransform: "uppercase", marginBottom: 10 }}>Start here</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {SUGGESTED.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(prompt)}
                  style={{
                    background: "none", border: `1px solid rgba(178,168,152,0.4)`,
                    borderRadius: 6, padding: "10px 14px",
                    fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 13,
                    color: T.nearBlack, cursor: "pointer", textAlign: "left",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                  onMouseEnter={e => { e.target.style.borderColor = T.gold; e.target.style.background = T.warmCream; }}
                  onMouseLeave={e => { e.target.style.borderColor = "rgba(178,168,152,0.4)"; e.target.style.background = "none"; }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Amber warning (mock mode) ─────────────────────────────────────── */}
      {!RAG_ENDPOINT && (
        <div style={{
          background: "rgba(184,113,10,0.08)", border: `1px solid rgba(184,113,10,0.2)`,
          borderLeft: `3px solid ${T.amber}`, padding: "8px 20px",
          display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: T.amber, letterSpacing: "0.1em" }}>
            ⚠ MOCK MODE — Set RAG_ENDPOINT to production URL to enable live Pinecone retrieval
          </span>
        </div>
      )}

      {/* ── Input ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "14px 20px", background: T.warmWhite,
        borderTop: `1px solid rgba(178,168,152,0.3)`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask Faraday anything about the data center market…"
            rows={1}
            disabled={loading}
            style={{
              flex: 1, background: T.warmCream,
              border: `1px solid ${input ? T.gold : "rgba(178,168,152,0.4)"}`,
              borderRadius: 8, padding: "12px 14px",
              fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 14,
              color: T.nearBlack, resize: "none", outline: "none",
              transition: "border-color 0.15s",
              lineHeight: 1.5, maxHeight: 120, overflowY: "auto",
              opacity: loading ? 0.6 : 1,
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            style={{
              background: input.trim() && !loading ? T.forest : "rgba(28,52,36,0.1)",
              border: `1px solid ${input.trim() && !loading ? T.gold : "rgba(178,168,152,0.3)"}`,
              color: input.trim() && !loading ? T.warmWhite : T.warmGray,
              borderRadius: 8, padding: "12px 18px",
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              letterSpacing: "0.08em", cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Bolt size={12} color={input.trim() && !loading ? T.gold : T.warmGray} />
            {loading ? "…" : "ASK"}
          </button>
        </div>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: T.warmGray, letterSpacing: "0.08em" }}>
            Enter to send · Shift+Enter for new line
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: T.warmGray, letterSpacing: "0.08em" }}>
            Faraday Intelligence · Premier · claude-sonnet-4-20250514
          </span>
        </div>
      </div>
    </div>
  );
}
