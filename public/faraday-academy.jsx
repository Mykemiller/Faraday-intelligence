import { useState, useEffect, useRef } from "react";

// ── Brand tokens ──────────────────────────────────────────────────────────────
const F = "#1C3424";       // Forest
const G = "#C4922A";       // Gold
const GL = "#D4A84B";      // Gold light
const W = "#F8F5F0";       // Warm White
const NK = "#0E1410";      // Near-black
const NKM = "#141C16";     // Near-black mid

const serif = "'IBM Plex Serif', Georgia, serif";
const mono  = "'IBM Plex Mono', 'Courier New', monospace";
const body  = "'Bricolage Grotesque', 'Helvetica Neue', sans-serif";

// ── Course data ───────────────────────────────────────────────────────────────
const DOMAINS = [
  {
    id: 1, icon: "🧠", code: "D1", short: "Chips & Density",
    full: "Chips & Density",
    tagline: "From GPU generations to rack density — the upstream cause of everything.",
    color: "#7B9FE0",
    courses: [
      { code:"FA-101-01", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"The GPU Revolution: Why Chips Drive Everything",
        desc:"A first-principles introduction to why GPU generations are the upstream cause of every major trend in AI data centers. No technical background required.",
        outcomes:["Understand what a GPU is and why it differs from a CPU","Trace how rack density changes drive downstream infrastructure decisions","Read a GPU roadmap headline with context"],
        modules:["From CPU to GPU: The Shift That Changed Everything","What Is Rack Density and Why Should You Care?","The NVIDIA Ecosystem: A Map","Reading a GPU Roadmap"],
        assessment:"10-question multiple choice quiz. Pass score: 70%." },
      { code:"FA-201-01", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study + Discussion",
        title:"GPU Generations and the Infrastructure Cascade",
        desc:"How each GPU generation (Hopper → Blackwell → Vera Rubin → Feynman) creates cascading infrastructure consequences — from cooling to power to facility design.",
        outcomes:["Map GPU generation releases to infrastructure investment cycles","Understand rack density progression and its implications","Analyze the NVL72 and NVL144 configurations"],
        modules:["Hopper to Blackwell: What Changed and Why","Vera Rubin NVL72/NVL144: Five Configurations, One Era","The Feynman Horizon: Planning for 2028","Case Study: How One GPU Announcement Moved Cooling Markets"],
        assessment:"Case study analysis + 15-question quiz." },
      { code:"FA-301-01", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"Advanced Chip Intelligence: Reading the NVIDIA Ecosystem",
        desc:"Practitioner-level analysis of the NVIDIA partner ecosystem, OCP standards evolution, and ASIC competitive landscape.",
        outcomes:["Analyze NVIDIA DSX AI Factory partner announcements","Evaluate ASIC alternatives for infrastructure implications","Construct a GPU roadmap briefing"],
        modules:["The NVIDIA Moat: DSX AI Factory Deep Dive","OCP Standards: Open Rack Wide and the Power Distribution Evolution","ASIC Alternatives: Threat or Complement?","Research Lab: Build a Chip Intelligence Brief"],
        assessment:"Practitioner brief submission + peer review." },
      { code:"FA-401-01", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"Chip Intelligence Mastery: Market Forecasting and Investment Implications",
        desc:"Expert-level synthesis of chip market dynamics, investment implications, and forward-looking scenario modeling.",
        outcomes:["Construct multi-year GPU demand scenarios","Evaluate capital allocation implications of each GPU generation","Produce investment-grade chip intelligence"],
        modules:["GPU Demand Modeling: Inputs, Assumptions, Scenarios","The Jevons Paradox in Practice: Efficiency and Demand","NVentures and the NVIDIA Investment Ecosystem","Certification Prep: Chip Intelligence Practitioner Exam"],
        assessment:"Proctored certification exam. Pass score: 80%." },
    ],
  },
  {
    id: 2, icon: "⚡", code: "D2", short: "Power Architecture",
    full: "Power Architecture",
    tagline: "The 800V DC transition is the most consequential shift in data center history.",
    color: "#F4A742",
    courses: [
      { code:"FA-101-02", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"Power 101: How AI Data Centers Get Their Energy",
        desc:"A plain-language introduction to how AI data centers source, convert, and consume power. Built for investors and business professionals with no electrical engineering background.",
        outcomes:["Understand the difference between AC and DC power in data centers","Explain BYOP and BYOG","Read a utility contract headline with context"],
        modules:["The Power Chain: From Grid to Rack","AC vs. DC: Why It Matters Now","BYOP/BYOG: What Hyperscalers Are Doing and Why","The 800V DC Transition: A Primer"],
        assessment:"10-question quiz. Pass score: 70%." },
      { code:"FA-201-02", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study",
        title:"The 800V DC Revolution: Architecture and Investment Implications",
        desc:"The shift from 415V AC to 800V DC is the most consequential infrastructure transition in data center history. This course explains the physics, economics, and retrofit market.",
        outcomes:["Explain the 415V AC to 800V DC transition in operator and investor terms","Evaluate the retrofit market opportunity","Analyze EaaS provider positioning"],
        modules:["Why 800V DC? The Physics Without the Engineering Degree","The Retrofit Market: Size, Players, Timeline","EaaS Providers: Bloom Energy, Brookfield, and the New Power Ecosystem","Case Study: The Oracle-AEP-Bloom Energy Deal"],
        assessment:"Case study analysis + quiz." },
      { code:"FA-301-02", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"Power Intelligence: Sourcing, Contracts, and Behind-the-Meter Strategies",
        desc:"Advanced analysis of power sourcing strategies, behind-the-meter generation, utility contract structures, and the BYOP/BYOG landscape.",
        outcomes:["Analyze utility contract structures for data center operators","Evaluate BTM generation economics","Construct a power architecture intelligence brief"],
        modules:["Behind-the-Meter Generation: Economics and Operator Implications","Utility Contract Structures: Rate Cases, PPAs, and Interconnection Agreements","NFPA Code Gaps: The AC-to-DC Constraint","Research Lab: Power Intelligence Brief"],
        assessment:"Practitioner brief submission." },
      { code:"FA-401-02", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"Power Architecture Mastery: Investment Thesis and Scenario Modeling",
        desc:"Expert-level power market analysis. Construct investment theses around the power transition, model scenarios for utility constraint timelines, and evaluate EaaS as an asset class.",
        outcomes:["Build a power-constrained site acquisition model","Evaluate EaaS as asset class","Model utility constraint timeline scenarios by market"],
        modules:["Power as the Scarce Asset: Investment Framework","EaaS as Asset Class: Bloom, Brookfield, and the New Infrastructure Stack","Scenario Modeling: Power Constraint Timelines by Market","Certification Exam"],
        assessment:"Proctored certification exam. Pass score: 80%." },
    ],
  },
  {
    id: 3, icon: "🔌", code: "D3", short: "Grid & Regulatory",
    full: "Grid & Regulatory",
    tagline: "The grid is now the binding constraint on AI infrastructure growth.",
    color: "#6EC98F",
    courses: [
      { code:"FA-101-03", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"The Grid Crisis: Why Location Is the New Moat",
        desc:"Why the power grid is now the binding constraint on AI infrastructure growth, and what that means for investors and operators.",
        outcomes:["Understand ISO/RTO structures","Explain interconnection queues","Read a state moratorium headline with context"],
        modules:["The Grid Basics: ISOs, RTOs, and Why They Matter","Interconnection Queues: The Invisible Bottleneck","State Moratoriums: The 300-Bill Wave","Entitled, Powered Land: The Scarcest Asset"],
        assessment:"10-question quiz." },
      { code:"FA-201-03", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study",
        title:"Navigating State Policy: Moratoriums, Incentives, and the Three-Tier Map",
        desc:"A deep dive into the state policy landscape — the Restricted / Tightening / Open framework, tax incentives, and the community resistance dynamic.",
        outcomes:["Apply the Three-Tier State Policy Map to site selection decisions","Model moratorium risk by state","Evaluate tax incentive stacking strategies"],
        modules:["The Three-Tier State Policy Map Framework","Moratorium Anatomy: How Bills Become Law","Tax Incentives: The Other Side of the Ledger","Community Resistance: The Fourth Variable"],
        assessment:"Case study analysis." },
      { code:"FA-301-03", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"Regulatory Intelligence: Reading the Grid for Investment Signals",
        desc:"Practitioner-level grid and regulatory intelligence. Read FERC orders, ISO queue data, and state legislative calendars to generate investment-grade signals.",
        outcomes:["Parse FERC rulemakings for infrastructure implications","Analyze ISO queue data for capacity signals","Construct a regulatory intelligence brief"],
        modules:["FERC Intelligence: Orders, Rulemakings, and Large Load Policy","ISO Queue Analysis: PJM, MISO, ERCOT, CAISO, NYISO","State Legislative Calendar: Monitoring 50 States","Research Lab: Regulatory Intelligence Brief"],
        assessment:"Practitioner brief submission." },
      { code:"FA-401-03", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"Grid Mastery: Transmission, Policy, and Long-Horizon Scenario Modeling",
        desc:"Expert-level grid analysis. Construct long-horizon scenarios for transmission constraint resolution and build investment theses around grid-advantaged markets.",
        outcomes:["Build transmission constraint models by ISO region","Construct grid-advantaged market investment theses","Model state policy trajectories over 3-year horizon"],
        modules:["Transmission Constraint Modeling","Multi-State Policy Scenario Analysis","BYOG Impact on Grid Operators","Certification Exam"],
        assessment:"Proctored certification exam." },
    ],
  },
  {
    id: 4, icon: "💰", code: "D4", short: "M&A & Capital Markets",
    full: "M&A & Capital Markets",
    tagline: "How private equity, hyperscalers, and infrastructure investors deploy capital.",
    color: "#E8C547",
    courses: [
      { code:"FA-101-04", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"Deal Flow 101: How Capital Moves in the Data Center Economy",
        desc:"A first-principles guide to how private equity, hyperscalers, and infrastructure investors are deploying capital into AI data centers.",
        outcomes:["Understand the capital stack in DC investments","Read a deal announcement with context","Identify which investors are active in the space"],
        modules:["The Capital Stack: Equity, Debt, and Hybrid Structures","Private Equity in Data Centers: Who and Why","Hyperscaler Capex: The Biggest Spending Cycle in History","How to Read a Deal Announcement"],
        assessment:"10-question quiz." },
      { code:"FA-201-04", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study",
        title:"PE Playbook: How Blackstone, DigitalBridge, and Ares Are Winning",
        desc:"Deep dive into the major private equity platforms and their data center strategies — financing structures, portfolio construction, and deal mechanics.",
        outcomes:["Map the major PE platforms and their DC strategies","Understand sale-leaseback and JV structures","Analyze REIT mechanics in the DC context"],
        modules:["The Major PE Platforms: Blackstone, DigitalBridge, Blue Owl, Ares","Financing Structures: Sale-Leaseback, JV, and Prefunded Development","REIT Mechanics for DC Investors","Case Study: The DigitalBridge-SoftBank $4B Deal"],
        assessment:"Case study analysis + quiz." },
      { code:"FA-301-04", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"Capital Markets Intelligence: Reading Deal Flow for Alpha",
        desc:"Practitioner-level capital markets intelligence. Read CB Insights data, SEC filings, and credit signals to identify investment-grade deal flow patterns.",
        outcomes:["Use CB Insights for deal flow analysis","Read REIT filings for operator intelligence","Construct a capital markets intelligence brief"],
        modules:["CB Insights and Deal Flow Analysis","SEC/EDGAR: Reading DC REIT Filings","Moody's/S&P: Credit Signals for DC Operators","Research Lab: Capital Markets Intelligence Brief"],
        assessment:"Practitioner brief submission." },
      { code:"FA-401-04", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"M&A Mastery: Deal Structuring, Valuation, and Investment Thesis Construction",
        desc:"Expert-level M&A analysis. Apply DC-specific valuation frameworks, analyze deal structures, and construct investment theses for institutional audiences.",
        outcomes:["Apply DC valuation frameworks ($/MW, EBITDA multiples)","Analyze JV vs. full acquisition deal structures","Construct investment-grade theses for institutional audiences"],
        modules:["DC Valuation Frameworks","Deal Structure Analysis: JV vs. Full Acquisition","Investment Thesis Construction for Institutional Audiences","Certification Exam"],
        assessment:"Proctored certification exam." },
    ],
  },
  {
    id: 5, icon: "🏢", code: "D5", short: "Hyperscaler Activity",
    full: "Hyperscaler Activity",
    tagline: "The biggest capex cycle in history — how to read it before it moves the market.",
    color: "#8BB8F0",
    courses: [
      { code:"FA-101-05", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"The Big 5: AWS, Google, Microsoft, Meta, Oracle",
        desc:"A first-principles guide to the hyperscaler landscape — who they are, what they're building, and why their capex decisions move infrastructure markets.",
        outcomes:["Identify the Big 5 hyperscalers and their distinct strategies","Read a capex league table with context","Understand Project Stargate's market implications"],
        modules:["Who Are the Hyperscalers?","Capex League Table: How to Read It","Project Stargate: What It Means","Campus-Scale Development: The New Unit of Analysis"],
        assessment:"10-question quiz." },
      { code:"FA-201-05", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study",
        title:"Hyperscaler Intelligence: Demand Signals and Campus Announcements",
        desc:"How to read earnings calls, campus announcements, and utility partnerships as forward-looking intelligence signals.",
        outcomes:["Extract capex signals from earnings call language","Decode campus announcement site selection logic","Analyze utility partnership structures"],
        modules:["Reading Earnings Calls for Capex Signals","Campus Announcements: Site Selection Logic","Utility Partnership Structures","Case Study: The Microsoft-Duke Energy NC Deal"],
        assessment:"Case study analysis + quiz." },
      { code:"FA-301-05", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"Hyperscaler Intelligence: Competitive Positioning and Demand Forecasting",
        desc:"Advanced analysis of hyperscaler competitive dynamics, demand forecasting models, and the Sovereign AI wave.",
        outcomes:["Model competitive dynamics among the Big 5","Evaluate Goldman, McKinsey, and Mizuho demand forecasts","Construct a hyperscaler intelligence brief"],
        modules:["Competitive Dynamics Among the Big 5","Demand Forecasting: Goldman, McKinsey, and Mizuho Models","Stargate and the Sovereign AI Wave","Research Lab: Hyperscaler Intelligence Brief"],
        assessment:"Practitioner brief submission." },
      { code:"FA-401-05", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"Hyperscaler Mastery: Long-Horizon Capex Modeling and Scenario Analysis",
        desc:"Expert-level hyperscaler analysis. Build 3-year capex models, run demand scenario analysis, and model the hyperscaler-utility relationship evolution.",
        outcomes:["Build a 3-year hyperscaler capex model","Run bear/base/bull demand scenarios","Model hyperscaler-utility relationship evolution"],
        modules:["3-Year Capex Model Construction","Demand Scenario Analysis: Bear / Base / Bull","Hyperscaler-Utility Relationship Evolution","Certification Exam"],
        assessment:"Proctored certification exam." },
    ],
  },
  {
    id: 6, icon: "🚀", code: "D6", short: "New Entrants",
    full: "New Entrants",
    tagline: "Neoclouds, edge operators, and the startups reshaping the infrastructure stack.",
    color: "#C47BE8",
    courses: [
      { code:"FA-101-06", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"The Neocloud Era: CoreWeave, Crusoe, and the New Operators",
        desc:"A first-principles introduction to the neocloud category — who they are, why they exist, and how to spot a new entrant worth watching.",
        outcomes:["Define the neocloud category and its market logic","Map the NVIDIA NeoCloud Partner Ecosystem","Identify early signals of a new entrant worth tracking"],
        modules:["What Is a Neocloud?","The NVIDIA NeoCloud Partner Ecosystem","Edge Operators: The Last Mile","How to Spot a New Entrant Worth Watching"],
        assessment:"10-question quiz." },
      { code:"FA-201-06", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study",
        title:"Neocloud Economics: Business Models and Competitive Dynamics",
        desc:"Deep dive into neocloud unit economics, CoreWeave's orchestration moat, and the edge inference economy.",
        outcomes:["Model GPU-as-a-Service unit economics","Evaluate CoreWeave's orchestration moat","Analyze edge inference economics"],
        modules:["GPU-as-a-Service: Unit Economics","CoreWeave's Orchestration Moat","Crusoe and the Abilene Story","The Edge Inference Economy"],
        assessment:"Case study analysis." },
      { code:"FA-301-06", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"New Entrant Intelligence: Identifying Signals Before They Become Headlines",
        desc:"Practitioner-level new entrant intelligence. Apply the GitHub-to-funding signal framework and construct new entrant intelligence briefs.",
        outcomes:["Apply the GitHub → trade press → funding signal chain","Analyze funding rounds for infrastructure implications","Construct a new entrant intelligence brief"],
        modules:["Startup Watch: PR Newswire, Crunchbase, and GitHub Signals","Funding Round Analysis","NVIDIA Partnership as Market Signal","Research Lab: New Entrant Brief"],
        assessment:"Practitioner brief submission." },
      { code:"FA-401-06", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"New Entrant Mastery: Competitive Landscape Modeling and M&A Targets",
        desc:"Expert-level new entrant analysis. Map competitive landscapes, identify M&A targets, and analyze the CoreWeave IPO as a case study.",
        outcomes:["Build a competitive landscape map for the neocloud sector","Identify M&A target characteristics","Analyze the CoreWeave IPO and its market implications"],
        modules:["Landscape Mapping Methodology","M&A Target Identification Framework","Neocloud IPO Analysis: CoreWeave Case Study","Certification Exam"],
        assessment:"Proctored certification exam." },
    ],
  },
  {
    id: 7, icon: "💧", code: "D7", short: "Cooling & Water",
    full: "Cooling & Water Technology",
    tagline: "Thermal management and integrated power delivery — the most underreported constraint.",
    color: "#5BC4D4",
    courses: [
      { code:"FA-101-07", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"The Cooling Revolution: Why Heat Is the Problem That Changes Everything",
        desc:"A plain-language introduction to the cooling challenge — why it matters more than ever, and how the industry is responding.",
        outcomes:["Understand why cooling is now a primary infrastructure constraint","Map the air → water → liquid cooling transition","Identify water scarcity as an infrastructure risk factor"],
        modules:["Why Cooling Matters More Than Ever","Air vs. Water vs. Liquid: The Transition Map","Direct-to-Chip Liquid Cooling: What It Is","Water Scarcity as Infrastructure Risk"],
        assessment:"10-question quiz." },
      { code:"FA-201-07", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study",
        title:"Cooling Technologies: DLC, Immersion, and CDU Market Dynamics",
        desc:"Deep dive into the cooling technology landscape — decision matrices, vendor positioning, and the waterless cooling regulatory driver.",
        outcomes:["Apply DLC vs. immersion vs. air decision matrix","Map the CDU vendor landscape","Evaluate waterless cooling economics"],
        modules:["DLC vs. Immersion vs. Air: Decision Matrix","CDU Market: Vertiv, Schneider, JetCool, Iceotope","Waterless Cooling: The Regulatory Driver","Case Study: A 100MW Facility Cooling Decision"],
        assessment:"Case study analysis + quiz." },
      { code:"FA-301-07", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"Cooling Intelligence: Technology Selection and Market Intelligence",
        desc:"Practitioner-level cooling technology and market intelligence. Apply selection frameworks and generate investment-grade cooling briefs.",
        outcomes:["Apply cooling technology selection framework","Analyze Tier 1 vs. Tier 2 vendor landscape","Construct a cooling intelligence brief"],
        modules:["Cooling Technology Selection Framework","Vendor Landscape Analysis: Tier 1 vs. Tier 2","Water Policy as Investment Signal","Research Lab: Cooling Intelligence Brief"],
        assessment:"Practitioner brief submission." },
      { code:"FA-401-07", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"Cooling Mastery: Thermal Management Strategy and Investment Thesis",
        desc:"Expert-level thermal management analysis. Model CDU market sizing, construct investment theses around the cooling transition, and analyze water policy scenarios.",
        outcomes:["Model CDU market size and growth trajectory","Construct a thermal management investment thesis","Analyze water policy scenarios by region"],
        modules:["Thermal Management as Competitive Moat","CDU Market Sizing and Forecast","Water Policy Scenario Analysis","Certification Exam"],
        assessment:"Proctored certification exam." },
    ],
  },
  {
    id: 8, icon: "👥", code: "D8", short: "People & Signals",
    full: "People & Signals",
    tagline: "Executive moves and conference intelligence — the signals that precede the headlines.",
    color: "#E87B9F",
    courses: [
      { code:"FA-101-08", level:101, tier:"Free", duration:"~45 min", fmt:"Video + Reading + Quiz",
        title:"Executive Intelligence: Why People Moves Are Market Signals",
        desc:"A first-principles introduction to executive intelligence — why people moves signal market direction and how to track them.",
        outcomes:["Understand why executive moves are leading indicators","Use LinkedIn as a basic intelligence tool","Read a conference agenda as a market signal"],
        modules:["Why Executive Moves Matter","LinkedIn as Intelligence Tool","Conference Signals: How to Read a DCD Connect Agenda","The 11 Executives Worth Following"],
        assessment:"10-question quiz." },
      { code:"FA-201-08", level:201, tier:"Signal", duration:"~90 min", fmt:"Video + Case Study",
        title:"LinkedIn Intelligence: From Posts to Signals",
        desc:"How to build a LinkedIn intelligence pipeline that converts executive posts into actionable market signals.",
        outcomes:["Build a LinkedIn intelligence pipeline","Apply signal vs. noise filter to executive posts","Use hashtag intelligence for DC market tracking"],
        modules:["Building a LinkedIn Intelligence Pipeline","Signal vs. Noise: Filtering Executive Posts","Hashtag Intelligence: #datacenter, #aiinfrastructure","Case Study: A Single LinkedIn Post That Moved a Market"],
        assessment:"Case study analysis." },
      { code:"FA-301-08", level:301, tier:"Core", duration:"~3 hrs", fmt:"Seminar + Research Lab",
        title:"People Intelligence: Conference Strategy and Executive Network Mapping",
        desc:"Advanced people intelligence — conference strategy, executive network mapping, and the Nomad Futurist community as intelligence source.",
        outcomes:["Build a conference intelligence strategy","Map executive networks for signal triangulation","Construct a people intelligence brief"],
        modules:["Conference Intelligence: DCD, iMasons, OCP","Executive Network Mapping","The Nomad Futurist Community as Intelligence Source","Research Lab: People Intelligence Brief"],
        assessment:"Practitioner brief submission." },
      { code:"FA-401-08", level:401, tier:"Premier", duration:"~5 hrs", fmt:"Research Seminar + Certification Exam",
        title:"People Intelligence Mastery: Network Analysis and Soft Signal Interpretation",
        desc:"Expert-level people intelligence. Apply network analysis methodology, build persistent executive watch lists, and interpret soft signals at scale.",
        outcomes:["Apply network analysis methodology to DC market","Build and maintain a persistent executive watch list","Interpret soft signals at institutional scale"],
        modules:["Network Analysis Methodology","Soft Signal Interpretation at Scale","Building a Persistent Executive Watch List","Certification Exam"],
        assessment:"Proctored certification exam." },
    ],
  },
];

const TIER_META = {
  "Free":    { label:"Free", color:"#4ADE80", bg:"rgba(74,222,128,0.1)" },
  "Signal":  { label:"Signal ~$5", color:G, bg:`rgba(196,146,42,0.12)` },
  "Core":    { label:"Core ~$75–99", color:"#7B9FE0", bg:"rgba(123,159,224,0.12)" },
  "Premier": { label:"Premier ~$250–299", color:"#C47BE8", bg:"rgba(196,123,232,0.12)" },
};

const LEVEL_LABELS = { 101:"Foundations", 201:"Applications", 301:"Practitioner", 401:"Mastery" };

// ── Global styles ─────────────────────────────────────────────────────────────
function GlobalStyle() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Bricolage+Grotesque:wght@300;400;500;600&display=swap";
    document.head.appendChild(link);
    const s = document.createElement("style");
    s.textContent = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      ::-webkit-scrollbar { width: 5px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(196,146,42,0.3); border-radius: 3px; }
      @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
      .fa-fade { animation: fadeUp 0.45s cubic-bezier(0.23,1,0.32,1) forwards; }
      .fa-fade-1 { animation: fadeUp 0.45s 0.05s cubic-bezier(0.23,1,0.32,1) both; }
      .fa-fade-2 { animation: fadeUp 0.45s 0.12s cubic-bezier(0.23,1,0.32,1) both; }
      .fa-fade-3 { animation: fadeUp 0.45s 0.2s cubic-bezier(0.23,1,0.32,1) both; }
      .fa-fade-4 { animation: fadeUp 0.45s 0.28s cubic-bezier(0.23,1,0.32,1) both; }
      .nav-item { transition: color 0.15s, background 0.15s; cursor: pointer; }
      .nav-item:hover { color: ${GL} !important; }
      .domain-card { transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s; cursor: pointer; }
      .domain-card:hover { transform: translateY(-3px); }
      .course-row { transition: background 0.15s, border-color 0.15s; cursor: pointer; }
      .course-row:hover { background: rgba(196,146,42,0.05) !important; }
      .back-btn { transition: color 0.15s, border-color 0.15s; cursor: pointer; }
      .back-btn:hover { color: ${GL} !important; border-color: ${GL} !important; }
    `;
    document.head.appendChild(s);
  }, []);
  return null;
}

// ── Shared: Header ────────────────────────────────────────────────────────────
function Header({ onHome }) {
  return (
    <header style={{
      background: F, borderBottom: `1px solid rgba(196,146,42,0.25)`,
      padding: "0 32px", height: 64,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      position: "sticky", top: 0, zIndex: 100,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, cursor:"pointer" }} onClick={onHome}>
        <div style={{
          width:36, height:36, borderRadius:8,
          border:`1.5px solid ${G}`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontFamily: serif, fontSize:17, fontWeight:700, color:G,
        }}>F</div>
        <div>
          <div style={{ fontFamily:serif, fontSize:15, fontWeight:700, color:W, letterSpacing:"-0.01em" }}>Faraday Academy</div>
          <div style={{ fontFamily:mono, fontSize:9, color:G, letterSpacing:"0.15em" }}>INTELLIGENCE EDUCATION</div>
        </div>
      </div>
      <nav style={{ display:"flex", gap:24, alignItems:"center" }}>
        {["Catalog","Certifications","Pricing"].map(n => (
          <span key={n} className="nav-item" onClick={onHome}
            style={{ fontFamily:mono, fontSize:11, color:"rgba(248,245,240,0.5)", letterSpacing:"0.08em" }}>
            {n}
          </span>
        ))}
        <button onClick={onHome} style={{
          fontFamily:mono, fontSize:10, color:F, background:G, border:"none",
          borderRadius:6, padding:"7px 16px", cursor:"pointer", letterSpacing:"0.08em", fontWeight:600,
        }}>ENROLL FREE</button>
      </nav>
    </header>
  );
}

// ── Tier badge ────────────────────────────────────────────────────────────────
function TierBadge({ tier }) {
  const m = TIER_META[tier] || TIER_META["Free"];
  return (
    <span style={{
      fontFamily:mono, fontSize:9, color:m.color, background:m.bg,
      border:`1px solid ${m.color}55`, borderRadius:4,
      padding:"2px 8px", letterSpacing:"0.08em", whiteSpace:"nowrap",
    }}>{m.label}</span>
  );
}

// ── Level pill ────────────────────────────────────────────────────────────────
function LevelPill({ level }) {
  const colors = { 101:"#4ADE80", 201:G, 301:"#7B9FE0", 401:"#C47BE8" };
  const c = colors[level];
  return (
    <span style={{
      fontFamily:mono, fontSize:9, color:c,
      background:`${c}18`, border:`1px solid ${c}44`,
      borderRadius:4, padding:"2px 8px", letterSpacing:"0.06em",
    }}>{level} — {LEVEL_LABELS[level]}</span>
  );
}

// ── Home: Hero ────────────────────────────────────────────────────────────────
function Hero({ onBrowse }) {
  return (
    <section style={{
      background: `linear-gradient(180deg, ${F} 0%, ${NKM} 100%)`,
      padding: "80px 32px 64px",
      position: "relative", overflow: "hidden",
    }}>
      {/* Background texture */}
      <div style={{
        position:"absolute", inset:0, opacity:0.04,
        backgroundImage:`repeating-linear-gradient(0deg,transparent,transparent 39px,${G} 39px,${G} 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,${G} 39px,${G} 40px)`,
      }}/>
      <div style={{ maxWidth:880, margin:"0 auto", position:"relative" }}>
        <div className="fa-fade" style={{ fontFamily:mono, fontSize:10, color:G, letterSpacing:"0.2em", marginBottom:16 }}>
          FARADAY ACADEMY · EST. 2026
        </div>
        <h1 className="fa-fade-1" style={{
          fontFamily:serif, fontSize:"clamp(32px,5vw,56px)", fontWeight:700,
          color:W, lineHeight:1.15, letterSpacing:"-0.025em", marginBottom:20,
        }}>
          The intelligence layer<br/>
          <span style={{ color:G }}>powering the AI infrastructure economy.</span>
        </h1>
        <p className="fa-fade-2" style={{
          fontFamily:body, fontSize:17, color:"rgba(248,245,240,0.7)",
          lineHeight:1.75, maxWidth:600, marginBottom:36,
        }}>
          Structured, domain-specific education for investors, operators, and ecosystem professionals.
          Nine Intelligence Domains. 101 to 401. Built to certify the ability to read a live, changing market.
        </p>
        <div className="fa-fade-3" style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
          <button onClick={onBrowse} style={{
            fontFamily:mono, fontSize:11, fontWeight:600, color:F, background:G,
            border:"none", borderRadius:8, padding:"13px 28px", cursor:"pointer",
            letterSpacing:"0.08em",
          }}>BROWSE CATALOG →</button>
          <button style={{
            fontFamily:mono, fontSize:11, color:G, background:"transparent",
            border:`1px solid ${G}66`, borderRadius:8, padding:"13px 28px", cursor:"pointer",
            letterSpacing:"0.08em",
          }}>VIEW CERTIFICATIONS</button>
        </div>
        <div className="fa-fade-4" style={{ display:"flex", gap:32, marginTop:48, flexWrap:"wrap" }}>
          {[["9","Intelligence Domains"],["36","Courses"],["4","Certification Levels"],["Free","Start Today"]].map(([v,l]) => (
            <div key={l}>
              <div style={{ fontFamily:serif, fontSize:28, fontWeight:700, color:G }}>{v}</div>
              <div style={{ fontFamily:mono, fontSize:10, color:"rgba(248,245,240,0.4)", letterSpacing:"0.1em", marginTop:2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Home: Domain grid ─────────────────────────────────────────────────────────
function DomainGrid({ onSelectDomain }) {
  return (
    <section style={{ padding:"64px 32px", maxWidth:1100, margin:"0 auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:36 }}>
        <div>
          <div style={{ fontFamily:mono, fontSize:9, color:G, letterSpacing:"0.2em", marginBottom:8 }}>INTELLIGENCE DOMAINS</div>
          <h2 style={{ fontFamily:serif, fontSize:28, fontWeight:700, color:W, letterSpacing:"-0.02em" }}>
            Nine domains. One platform.
          </h2>
        </div>
        <div style={{ fontFamily:mono, fontSize:10, color:"rgba(248,245,240,0.3)" }}>
          4 courses per domain · 101 → 401
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:16 }}>
        {DOMAINS.map((d, idx) => (
          <div key={d.id} className="domain-card fa-fade"
            style={{ animationDelay:`${idx*0.06}s`, animationFillMode:"both" }}
            onClick={() => onSelectDomain(d)}>
            <div style={{
              background: NKM, border: `1px solid rgba(255,255,255,0.07)`,
              borderRadius:12, padding:"20px 22px",
              borderTop: `3px solid ${d.color}`,
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <span style={{ fontSize:28 }}>{d.icon}</span>
                <span style={{ fontFamily:mono, fontSize:9, color:d.color, letterSpacing:"0.1em",
                  background:`${d.color}18`, border:`1px solid ${d.color}33`, borderRadius:4, padding:"2px 8px" }}>
                  {d.code}
                </span>
              </div>
              <div style={{ fontFamily:serif, fontSize:15, fontWeight:700, color:W, marginBottom:6, lineHeight:1.3 }}>
                {d.full}
              </div>
              <div style={{ fontFamily:body, fontSize:12, color:"rgba(248,245,240,0.45)", lineHeight:1.6, marginBottom:16 }}>
                {d.tagline}
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {[101,201,301,401].map(lvl => (
                  <span key={lvl} style={{ fontFamily:mono, fontSize:9, color:"rgba(248,245,240,0.3)",
                    background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
                    borderRadius:4, padding:"2px 7px" }}>
                    {lvl}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
        {/* Domain 9 teaser */}
        <div style={{
          background: NKM, border: `1px solid rgba(255,255,255,0.05)`,
          borderRadius:12, padding:"20px 22px", opacity:0.45,
          borderTop: `3px solid rgba(255,255,255,0.1)`,
        }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
            <span style={{ fontSize:28 }}>🤖</span>
            <span style={{ fontFamily:mono, fontSize:9, color:"rgba(248,245,240,0.3)", letterSpacing:"0.1em",
              background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:4, padding:"2px 8px" }}>
              D9
            </span>
          </div>
          <div style={{ fontFamily:serif, fontSize:15, fontWeight:700, color:"rgba(248,245,240,0.5)", marginBottom:6 }}>
            Orchestration & Control Plane
          </div>
          <div style={{ fontFamily:mono, fontSize:10, color:"rgba(248,245,240,0.25)", letterSpacing:"0.08em" }}>
            COMING SOON
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Home: Cert strip ──────────────────────────────────────────────────────────
function CertStrip() {
  return (
    <section style={{
      background: F, borderTop:`1px solid rgba(196,146,42,0.2)`,
      borderBottom:`1px solid rgba(196,146,42,0.2)`,
      padding:"48px 32px",
    }}>
      <div style={{ maxWidth:900, margin:"0 auto", display:"flex", gap:40, alignItems:"center", flexWrap:"wrap" }}>
        <div style={{ flex:"1 1 300px" }}>
          <div style={{ fontFamily:mono, fontSize:9, color:G, letterSpacing:"0.2em", marginBottom:10 }}>PRACTITIONER CERTIFICATION</div>
          <h3 style={{ fontFamily:serif, fontSize:22, fontWeight:700, color:W, lineHeight:1.3, marginBottom:10 }}>
            The only certification that tests live market intelligence.
          </h3>
          <p style={{ fontFamily:body, fontSize:13, color:"rgba(248,245,240,0.55)", lineHeight:1.7 }}>
            DCD, Uptime Institute, and AWS certify historical knowledge. Faraday certifies the ability to read a live, changing market. No analog exists anywhere in the sector.
          </p>
        </div>
        <div style={{ flex:"1 1 400px", display:"flex", flexDirection:"column", gap:10 }}>
          {[
            ["Domain Practitioner","1 domain · 301 level · 1 brief"],
            ["Intelligence Analyst","3 domains · 3 briefs · 90 days"],
            ["Intelligence Fellow","All 9 domains · 12-month cycle"],
          ].map(([t,s]) => (
            <div key={t} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"12px 16px", background:"rgba(0,0,0,0.3)", borderRadius:8,
              border:"1px solid rgba(196,146,42,0.15)" }}>
              <span style={{ fontFamily:body, fontSize:13, color:W, fontWeight:500 }}>{t}</span>
              <span style={{ fontFamily:mono, fontSize:10, color:G }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Home page ─────────────────────────────────────────────────────────────────
function HomePage({ onSelectDomain, onBrowse }) {
  return (
    <div style={{ background:NK, minHeight:"100vh" }}>
      <Hero onBrowse={onBrowse} />
      <DomainGrid onSelectDomain={onSelectDomain} />
      <CertStrip />
    </div>
  );
}

// ── Course detail modal ───────────────────────────────────────────────────────
function CourseModal({ course, domainColor, onClose }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:300,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20,
    }} onClick={onClose}>
      <div style={{
        background:"#141C16", border:`1px solid rgba(196,146,42,0.25)`,
        borderTop:`3px solid ${domainColor}`,
        borderRadius:14, padding:"28px 32px",
        width:"100%", maxWidth:620, maxHeight:"85vh", overflowY:"auto",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <LevelPill level={course.level} />
            <TierBadge tier={course.tier} />
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"rgba(248,245,240,0.3)",
            fontSize:18, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ fontFamily:mono, fontSize:9, color:"rgba(248,245,240,0.35)", letterSpacing:"0.1em", marginBottom:6 }}>
          {course.code} · {course.duration} · {course.fmt}
        </div>
        <h3 style={{ fontFamily:serif, fontSize:20, fontWeight:700, color:W, lineHeight:1.3, marginBottom:12 }}>
          {course.title}
        </h3>
        <p style={{ fontFamily:body, fontSize:13, color:"rgba(248,245,240,0.6)", lineHeight:1.75, marginBottom:22 }}>
          {course.desc}
        </p>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:mono, fontSize:9, color:G, letterSpacing:"0.15em", marginBottom:10 }}>LEARNING OUTCOMES</div>
          {course.outcomes.map((o,i) => (
            <div key={i} style={{ display:"flex", gap:10, marginBottom:7 }}>
              <span style={{ color:domainColor, fontFamily:mono, fontSize:11, marginTop:1 }}>→</span>
              <span style={{ fontFamily:body, fontSize:12, color:"rgba(248,245,240,0.7)", lineHeight:1.6 }}>{o}</span>
            </div>
          ))}
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:mono, fontSize:9, color:G, letterSpacing:"0.15em", marginBottom:10 }}>MODULES</div>
          {course.modules.map((m,i) => (
            <div key={i} style={{ display:"flex", gap:10, padding:"7px 10px",
              background:"rgba(255,255,255,0.02)", borderRadius:6, marginBottom:4 }}>
              <span style={{ fontFamily:mono, fontSize:10, color:domainColor, minWidth:18 }}>{i+1}.</span>
              <span style={{ fontFamily:body, fontSize:12, color:"rgba(248,245,240,0.7)" }}>{m}</span>
            </div>
          ))}
        </div>
        <div style={{ padding:"12px 14px", background:`${domainColor}12`,
          border:`1px solid ${domainColor}33`, borderRadius:8, marginBottom:20 }}>
          <div style={{ fontFamily:mono, fontSize:9, color:domainColor, letterSpacing:"0.12em", marginBottom:4 }}>ASSESSMENT</div>
          <div style={{ fontFamily:body, fontSize:12, color:"rgba(248,245,240,0.65)" }}>{course.assessment}</div>
        </div>
        <button style={{
          width:"100%", fontFamily:mono, fontSize:11, color:NK, background:G,
          border:"none", borderRadius:8, padding:"13px", cursor:"pointer", letterSpacing:"0.08em", fontWeight:600,
        }}>
          {course.tier === "Free" ? "START FOR FREE →" : `ENROLL — ${TIER_META[course.tier]?.label}`}
        </button>
      </div>
    </div>
  );
}

// ── Domain catalog page ───────────────────────────────────────────────────────
function DomainPage({ domain, onBack }) {
  const [selected, setSelected] = useState(null);

  return (
    <div style={{ background:NK, minHeight:"100vh" }}>
      {/* Domain hero */}
      <section style={{
        background:`linear-gradient(135deg, ${F} 0%, ${NKM} 60%)`,
        borderBottom:`1px solid ${domain.color}44`,
        padding:"40px 32px 36px",
        position:"relative", overflow:"hidden",
      }}>
        <div style={{
          position:"absolute", right:-80, top:-80,
          width:400, height:400, borderRadius:"50%",
          background:`radial-gradient(circle, ${domain.color}18 0%, transparent 70%)`,
          pointerEvents:"none",
        }}/>
        <div style={{ maxWidth:860, margin:"0 auto", position:"relative" }}>
          <button className="back-btn" onClick={onBack} style={{
            background:"none", border:`1px solid rgba(196,146,42,0.25)`,
            borderRadius:6, padding:"6px 14px",
            fontFamily:mono, fontSize:10, color:"rgba(248,245,240,0.4)",
            letterSpacing:"0.08em", marginBottom:24, display:"flex", alignItems:"center", gap:6,
          }}>← ALL DOMAINS</button>

          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:10 }}>
            <span style={{ fontSize:36 }}>{domain.icon}</span>
            <span style={{ fontFamily:mono, fontSize:10, color:domain.color, letterSpacing:"0.15em",
              background:`${domain.color}18`, border:`1px solid ${domain.color}33`,
              borderRadius:5, padding:"3px 10px" }}>{domain.code}</span>
          </div>
          <h1 style={{ fontFamily:serif, fontSize:"clamp(24px,4vw,38px)", fontWeight:700, color:W, letterSpacing:"-0.02em", marginBottom:8 }}>
            {domain.full}
          </h1>
          <p style={{ fontFamily:body, fontSize:14, color:"rgba(248,245,240,0.55)", lineHeight:1.7, maxWidth:540 }}>
            {domain.tagline}
          </p>
          <div style={{ display:"flex", gap:20, marginTop:20, flexWrap:"wrap" }}>
            {[["4","Courses"],["101–401","Levels"],["Free","Entry Point"]].map(([v,l]) => (
              <div key={l}>
                <div style={{ fontFamily:serif, fontSize:22, fontWeight:700, color:domain.color }}>{v}</div>
                <div style={{ fontFamily:mono, fontSize:9, color:"rgba(248,245,240,0.3)", letterSpacing:"0.1em" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Courses */}
      <section style={{ padding:"36px 32px", maxWidth:860, margin:"0 auto" }}>
        <div style={{ fontFamily:mono, fontSize:9, color:"rgba(248,245,240,0.3)", letterSpacing:"0.15em", marginBottom:20 }}>
          4 COURSES · CLICK TO EXPAND
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {domain.courses.map((c, idx) => (
            <div key={c.code} className="course-row fa-fade"
              style={{ animationDelay:`${idx * 0.07}s`, animationFillMode:"both" }}
              onClick={() => setSelected(c)}>
              <div style={{
                background: NKM, border:`1px solid rgba(255,255,255,0.06)`,
                borderLeft:`3px solid ${domain.color}`,
                borderRadius:"0 10px 10px 0", padding:"18px 20px",
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" }}>
                      <LevelPill level={c.level} />
                      <TierBadge tier={c.tier} />
                      <span style={{ fontFamily:mono, fontSize:9, color:"rgba(248,245,240,0.25)", padding:"2px 0" }}>
                        {c.duration}
                      </span>
                    </div>
                    <div style={{ fontFamily:serif, fontSize:16, fontWeight:700, color:W, lineHeight:1.3, marginBottom:4 }}>
                      {c.title}
                    </div>
                    <div style={{ fontFamily:body, fontSize:12, color:"rgba(248,245,240,0.45)", lineHeight:1.6 }}>
                      {c.desc.length > 120 ? c.desc.slice(0,120)+"…" : c.desc}
                    </div>
                  </div>
                  <div style={{ fontFamily:mono, fontSize:10, color:domain.color, opacity:0.6, flexShrink:0 }}>
                    VIEW →
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Level legend */}
        <div style={{ marginTop:40, padding:"20px 22px", background:NKM,
          border:`1px solid rgba(255,255,255,0.06)`, borderRadius:10 }}>
          <div style={{ fontFamily:mono, fontSize:9, color:"rgba(248,245,240,0.3)", letterSpacing:"0.15em", marginBottom:14 }}>
            COURSE LEVEL GUIDE
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10 }}>
            {Object.entries(LEVEL_LABELS).map(([lvl,lbl]) => (
              <div key={lvl} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <LevelPill level={Number(lvl)} />
                <span style={{ fontFamily:body, fontSize:11, color:"rgba(248,245,240,0.35)", lineHeight:1.5 }}>
                  {lvl === "101" ? "No prior knowledge required" :
                   lvl === "201" ? "Familiar with basics" :
                   lvl === "301" ? "Working professional" :
                   "Expert · Certification prep"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {selected && (
        <CourseModal course={selected} domainColor={domain.color} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Catalog overview page ─────────────────────────────────────────────────────
function CatalogPage({ onSelectDomain, onBack }) {
  return (
    <div style={{ background:NK, minHeight:"100vh" }}>
      <section style={{
        background:`linear-gradient(180deg, ${F} 0%, ${NKM} 100%)`,
        borderBottom:`1px solid rgba(196,146,42,0.2)`,
        padding:"40px 32px 36px",
      }}>
        <div style={{ maxWidth:860, margin:"0 auto" }}>
          <button className="back-btn" onClick={onBack} style={{
            background:"none", border:`1px solid rgba(196,146,42,0.25)`,
            borderRadius:6, padding:"6px 14px",
            fontFamily:mono, fontSize:10, color:"rgba(248,245,240,0.4)",
            letterSpacing:"0.08em", marginBottom:24,
          }}>← ACADEMY HOME</button>
          <div style={{ fontFamily:mono, fontSize:9, color:G, letterSpacing:"0.2em", marginBottom:10 }}>FARADAY COURSE CATALOG</div>
          <h1 style={{ fontFamily:serif, fontSize:"clamp(24px,4vw,38px)", fontWeight:700, color:W, letterSpacing:"-0.02em", marginBottom:8 }}>
            101 → 401 across nine Intelligence Domains.
          </h1>
          <p style={{ fontFamily:body, fontSize:14, color:"rgba(248,245,240,0.5)", lineHeight:1.7 }}>
            36 courses. Free entry at every domain. Certification-eligible from 301. Select a domain below.
          </p>
        </div>
      </section>

      {/* Level key */}
      <div style={{ padding:"20px 32px 0", maxWidth:860, margin:"0 auto" }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {Object.entries(LEVEL_LABELS).map(([lvl,lbl]) => (
            <div key={lvl} style={{ display:"flex", gap:6, alignItems:"center" }}>
              <LevelPill level={Number(lvl)} />
              <span style={{ fontFamily:body, fontSize:11, color:"rgba(248,245,240,0.3)" }}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>

      <section style={{ padding:"24px 32px 48px", maxWidth:860, margin:"0 auto" }}>
        {DOMAINS.map((d, di) => (
          <div key={d.id} className="fa-fade" style={{ animationDelay:`${di*0.05}s`, animationFillMode:"both", marginBottom:12 }}>
            <div className="domain-card" onClick={() => onSelectDomain(d)} style={{
              background:NKM, border:`1px solid rgba(255,255,255,0.06)`,
              borderLeft:`4px solid ${d.color}`,
              borderRadius:"0 12px 12px 0", padding:"16px 20px",
              display:"flex", alignItems:"center", gap:16,
            }}>
              <span style={{ fontSize:26, flexShrink:0 }}>{d.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:serif, fontSize:15, fontWeight:700, color:W, marginBottom:3 }}>{d.full}</div>
                <div style={{ fontFamily:body, fontSize:12, color:"rgba(248,245,240,0.4)" }}>{d.tagline}</div>
              </div>
              <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                {[101,201,301,401].map(lvl => (
                  <span key={lvl} style={{ fontFamily:mono, fontSize:9,
                    color:d.color, background:`${d.color}18`, border:`1px solid ${d.color}33`,
                    borderRadius:4, padding:"2px 6px" }}>{lvl}</span>
                ))}
              </div>
              <span style={{ fontFamily:mono, fontSize:10, color:d.color, opacity:0.5, flexShrink:0 }}>→</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Root app ──────────────────────────────────────────────────────────────────
export default function FaradayAcademy() {
  // view: "home" | "catalog" | { domain }
  const [view, setView] = useState("home");

  return (
    <div style={{ background:NK, fontFamily:body }}>
      <GlobalStyle />
      <Header onHome={() => setView("home")} />

      {view === "home" && (
        <HomePage
          onSelectDomain={d => setView({ domain: d })}
          onBrowse={() => setView("catalog")}
        />
      )}
      {view === "catalog" && (
        <CatalogPage
          onSelectDomain={d => setView({ domain: d })}
          onBack={() => setView("home")}
        />
      )}
      {view?.domain && (
        <DomainPage
          domain={view.domain}
          onBack={() => setView("catalog")}
        />
      )}
    </div>
  );
}
