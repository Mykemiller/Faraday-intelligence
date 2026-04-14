import { useState, useEffect, useRef } from "react";

// ── Brand tokens ──────────────────────────────────────────────────────────────
const C = {
  forest:  "#1C3424",
  gold:    "#C4922A",
  white:   "#F8F5F0",
  sage:    "#8CA68A",
  black:   "#141210",
  bg:      "#0D110E",
  surface: "rgba(255,255,255,0.03)",
  border:  "rgba(255,255,255,0.07)",
  green:   "#4ADE80",
  amber:   "#F59E0B",
  violet:  "#A78BFA",
  cyan:    "#00D4FF",
  red:     "#F87171",
  text:    "#E8E4DE",
  muted:   "#6B6560",
  dim:     "#3A3530",
};

const mono  = { fontFamily:"'IBM Plex Mono',monospace" };
const serif = { fontFamily:"'IBM Plex Serif',serif" };
const sans  = { fontFamily:"'Bricolage Grotesque',sans-serif" };

// ── LAUNCH STATE — single source of truth ─────────────────────────────────────
const LAUNCH = {
  challenge:    { live:true,  label:"Live Now",        color:C.green,  icon:"⚡" },
  profile:      { live:true,  label:"Live Now",        color:C.green,  icon:"⚡" },
  intelligence: { live:false, label:"Coming Soon",     color:C.gold,   icon:"◎",  eta:"Q3 2026" },
  academy:      { live:false, label:"In Development",  color:C.violet, icon:"⬡",  eta:"Q4 2026" },
  community:    { live:false, label:"On the Horizon",  color:C.sage,   icon:"◇",  eta:"2027" },
};

// ── MW Economy ────────────────────────────────────────────────────────────────
const ALLOTMENT   = { Free:50, Signal:200, Core:600, Premier:1500 };
const TIER_COLOR  = { Free:C.muted, Signal:C.cyan, Core:C.gold, Premier:C.violet };
const TIER_ACCENT = { Free:"rgba(107,101,96,0.15)", Signal:"rgba(0,212,255,0.12)", Core:"rgba(196,146,42,0.12)", Premier:"rgba(167,139,250,0.12)" };

// ── IDF Data ──────────────────────────────────────────────────────────────────
const THEMES = [
  { id:"T-001", name:"The Power Reckoning",   tagline:"The grid wasn't built for this.",               domains:["D2","D3","D5","D10","D18"], tier:"Core"    },
  { id:"T-002", name:"The Rack Revolution",   tagline:"The rack is being rebuilt from the ground up.", domains:["D1","D2","D7","D9","D10","D11"], tier:"Core" },
  { id:"T-003", name:"The Consent Crisis",    tagline:"Communities are the new permitting authority.", domains:["D3","D11","D13","D14","D18"], tier:"Core"   },
  { id:"T-004", name:"The Capital Concentration", tagline:"Fewer hands. More capital. Higher stakes.", domains:["D4","D5","D6","D15"], tier:"Core"            },
  { id:"T-005", name:"The Inference Economy", tagline:"Training built the factories. Inference fills them.", domains:["D1","D5","D6","D9"], tier:"Core"       },
  { id:"T-006", name:"The Sovereign AI Race", tagline:"Compute is the new strategic reserve.",         domains:["D5","D6","D15"], tier:"Premier"              },
  { id:"T-007", name:"The New Energy Stack",  tagline:"The grid is no longer the default.",            domains:["D2","D3","D5","D11"], tier:"Core"             },
];

const DOMAINS = [
  { id:"D1",  name:"Chips & Density",                      type:"Core",    emoji:"⚡" },
  { id:"D2",  name:"Power Architecture",                   type:"Core",    emoji:"⚡" },
  { id:"D3",  name:"Grid & Regulatory",                    type:"Core",    emoji:"⚡" },
  { id:"D4",  name:"M&A & Capital Markets",                type:"Core",    emoji:"⚡" },
  { id:"D5",  name:"Hyperscaler Activity",                 type:"Core",    emoji:"⚡" },
  { id:"D6",  name:"New Entrants",                         type:"Core",    emoji:"⚡" },
  { id:"D7",  name:"Cooling & Water Technology",           type:"Core",    emoji:"⚡" },
  { id:"D8",  name:"People & Signals",                     type:"Core",    emoji:"⚡" },
  { id:"D9",  name:"Orchestration & Control Plane",        type:"Core",    emoji:"⚡" },
  { id:"D10", name:"Construction",                         type:"Passion", emoji:"◎" },
  { id:"D11", name:"Sustainability",                       type:"Passion", emoji:"◎" },
  { id:"D12", name:"Networking & Interconnect",            type:"Passion", emoji:"◎" },
  { id:"D13", name:"Community Relations",                  type:"Passion", emoji:"◎" },
  { id:"D14", name:"Real Estate & Site Selection",         type:"Passion", emoji:"◎" },
  { id:"D15", name:"Sovereign AI & Geopolitics",           type:"Passion", emoji:"◎" },
  { id:"D16", name:"Security & Resilience",                type:"Passion", emoji:"◎" },
  { id:"D17", name:"Workforce & Labor Markets",            type:"Passion", emoji:"◎" },
  { id:"D18", name:"Community Opposition & Regulatory Risk", type:"Passion", emoji:"◎" },
];

const SUBDOMAINS = [
  { id:"D1.1", name:"GPU Architecture & Roadmap",               parent:"D1"  },
  { id:"D1.2", name:"Rack Density & Power Density Progression", parent:"D1"  },
  { id:"D1.3", name:"Competing Silicon & Alternative Accelerators", parent:"D1" },
  { id:"D2.1", name:"800V DC Power Distribution",               parent:"D2"  },
  { id:"D2.2", name:"Behind-the-Meter Generation (BYOP/BYOG)",  parent:"D2"  },
  { id:"D2.3", name:"UPS, Storage & Power Conditioning",        parent:"D2"  },
  { id:"D2.4", name:"DC Power Delivery at the Rack",            parent:"D2"  },
  { id:"D3.1", name:"Interconnection Queue & Grid Access",      parent:"D3"  },
  { id:"D3.2", name:"State Moratorium & Legislative Landscape", parent:"D3"  },
  { id:"D3.3", name:"Utility Rate Cases & PUC Proceedings",     parent:"D3"  },
  { id:"D4.1", name:"PE & Infrastructure Fund Activity",        parent:"D4"  },
  { id:"D4.2", name:"DC REIT Performance & Valuation",          parent:"D4"  },
  { id:"D4.3", name:"Sovereign Wealth & Institutional Capital", parent:"D4"  },
  { id:"D4.4", name:"Integrated Infrastructure Vendor M&A",     parent:"D4"  },
  { id:"D5.1", name:"Big 5 Capex & Campus Announcements",       parent:"D5"  },
  { id:"D5.2", name:"Hyperscaler Custom Silicon",               parent:"D5"  },
  { id:"D6.1", name:"Neocloud Infrastructure",                  parent:"D6"  },
  { id:"D6.2", name:"Sovereign AI Programs & National Compute", parent:"D6"  },
  { id:"D7.1", name:"Direct-to-Chip Liquid Cooling (DLC)",      parent:"D7"  },
  { id:"D7.2", name:"Immersion Cooling",                        parent:"D7"  },
  { id:"D7.3", name:"Water Use & Waterless Cooling Strategies", parent:"D7"  },
  { id:"D8.1", name:"Executive Movement & C-Suite Intelligence",parent:"D8"  },
  { id:"D8.2", name:"Conference Intelligence & Speaking Circuit",parent:"D8"  },
  { id:"D9.1", name:"AI Factory Orchestration & DCIM",          parent:"D9"  },
  { id:"D9.2", name:"GPU Utilization & Compute Scheduling",     parent:"D9"  },
  { id:"D10.1",name:"Long-Lead Equipment & Supply Chain",       parent:"D10" },
  { id:"D10.2",name:"GC/EPC Capacity & Construction Execution", parent:"D10" },
  { id:"D10.3",name:"Modular & Prefabricated Delivery",         parent:"D10" },
  { id:"D11.1",name:"Clean Energy Procurement (PPA/REC/CFE)",   parent:"D11" },
  { id:"D11.2",name:"Carbon Accounting & Scope 1-3 Reporting",  parent:"D11" },
  { id:"D14.1",name:"Site Selection Criteria & Market Scoring", parent:"D14" },
  { id:"D15.1",name:"Chip Export Controls & BIS Regime",        parent:"D15" },
  { id:"D18.1",name:"Project Opposition Register",              parent:"D18" },
  { id:"D18.2",name:"Jurisdiction Posture Intelligence (JPS)",  parent:"D18" },
];

// ── Reputation tiers ──────────────────────────────────────────────────────────
const REP_TIERS = [
  { label:"Observer",          min:0,     color:C.muted  },
  { label:"Analyst",           min:500,   color:C.sage   },
  { label:"Signal",            min:1500,  color:C.cyan   },
  { label:"Senior Analyst",    min:3500,  color:C.gold   },
  { label:"Intelligence Lead", min:7500,  color:C.violet },
  { label:"Faraday Fellow",    min:15000, color:"#FF6B6B" },
];

function getRepTier(score) {
  for (let i = REP_TIERS.length - 1; i >= 0; i--) {
    if (score >= REP_TIERS[i].min) return REP_TIERS[i];
  }
  return REP_TIERS[0];
}

function getRepProgress(score) {
  for (let i = REP_TIERS.length - 1; i >= 0; i--) {
    if (score >= REP_TIERS[i].min) {
      const next = REP_TIERS[i + 1];
      if (!next) return 100;
      return Math.round(((score - REP_TIERS[i].min) / (next.min - REP_TIERS[i].min)) * 100);
    }
  }
  return 0;
}

// ── MW spend costs (future) ───────────────────────────────────────────────────
const SPEND_COSTS = {
  "Deep Dive Q&A":         { cost:8,  label:"per session"   },
  "Theme Brief (full)":    { cost:15, label:"per brief"     },
  "Company Intelligence":  { cost:12, label:"per company"   },
  "Cross-Domain Synthesis":{ cost:20, label:"per synthesis" },
  "Custom Theme Watch":    { cost:30, label:"per month"     },
};

// ── Earn rates ────────────────────────────────────────────────────────────────
const EARN_RATES = {
  "Daily Challenge — complete":  { earn:5,   label:"per puzzle"   },
  "Daily Challenge — streak 7d": { earn:25,  label:"bonus"        },
  "Academy — module complete":   { earn:15,  label:"per module"   },
  "Academy — certification":     { earn:100, label:"per cert"     },
  "Prediction accepted":         { earn:20,  label:"on acceptance" },
  "Prediction correct":          { earn:50,  label:"bonus"        },
};

// ── Mock ledger ───────────────────────────────────────────────────────────────
const LEDGER = [
  { date:"Apr 12", type:"earn",  label:"Daily Challenge — complete",  amount:5,  balance:487 },
  { date:"Apr 11", type:"earn",  label:"Daily Challenge — complete",  amount:5,  balance:482 },
  { date:"Apr 10", type:"earn",  label:"Daily Challenge — streak 7d", amount:25, balance:477 },
  { date:"Apr 10", type:"earn",  label:"Daily Challenge — complete",  amount:5,  balance:452 },
  { date:"Apr 09", type:"earn",  label:"Prediction accepted",         amount:20, balance:447 },
  { date:"Apr 08", type:"earn",  label:"Daily Challenge — complete",  amount:5,  balance:427 },
  { date:"Apr 07", type:"earn",  label:"Academy — module complete",   amount:15, balance:422 },
  { date:"Apr 07", type:"earn",  label:"Daily Challenge — complete",  amount:5,  balance:407 },
];

// ── Badges ────────────────────────────────────────────────────────────────────
const BADGES = [
  { id:"B-C-01", family:"Challenge", name:"First Signal",    desc:"Completed your first puzzle",    icon:"⚡", earned:true,  rare:false },
  { id:"B-C-02", family:"Challenge", name:"Seven Days",      desc:"7-day challenge streak",          icon:"🔥", earned:true,  rare:false },
  { id:"B-C-03", family:"Challenge", name:"Rackl Master",    desc:"Perfect score on 10 Rackl puzzles", icon:"◈", earned:true, rare:false },
  { id:"B-C-04", family:"Challenge", name:"Dark Fiber",      desc:"Solved 5 Dark Fiber puzzles",    icon:"◉", earned:false, rare:false },
  { id:"B-L-01", family:"Learning",  name:"First Module",    desc:"Completed first Academy module", icon:"⬡", earned:false, rare:false },
  { id:"B-I-01", family:"Intelligence", name:"Prognosticator", desc:"First accepted prediction",    icon:"◎", earned:true,  rare:false },
  { id:"B-I-02", family:"Intelligence", name:"Called It",    desc:"First confirmed prediction",     icon:"✦", earned:false, rare:true  },
  { id:"B-M-05", family:"Community", name:"Founding Member", desc:"Joined in the first 90 days",   icon:"★", earned:true,  rare:true  },
];

// ── Contributions ─────────────────────────────────────────────────────────────
const CONTRIBUTIONS = [
  { id:"C-001", type:"Prediction", title:"FERC large-load tariff framework enacted by Q3 2026", status:"Pending Review", submitted:"Apr 09", mw:null  },
  { id:"C-002", type:"Thesis",     title:"ZutaCore as bellwether for immersion cooling M&A wave", status:"Accepted",     submitted:"Mar 28", mw:40    },
  { id:"C-003", type:"Prediction", title:"Second state enacts statewide data center moratorium before Dec 2026", status:"Pending Review", submitted:"Apr 12", mw:null },
];

// ── Teams (Daily Challenge seasonal competition) ──────────────────────────────
const TEAMS_LEADERBOARD = [
  { id:"T-HYPER",   rank:1, name:"The Hyperscalers",       members:14, mw:2847 },
  { id:"T-DFIBER",  rank:2, name:"Dark Fiber Collective",  members:11, mw:2512 },
  { id:"T-LOUDOUN", rank:3, name:"Loudoun Locals",         members:9,  mw:2188 },
  { id:"T-LIQUID",  rank:4, name:"Liquid Cooled",          members:8,  mw:1964 },
  { id:"T-EDGE",    rank:5, name:"Grid Edge",              members:7,  mw:1740 },
];

// Mock: which team (if any) the current subscriber is on. Null = not on a team.
const INITIAL_MY_TEAM = {
  id:      "T-HYPER",
  code:    "HYPER-2026",
  name:    "The Hyperscalers",
  role:    "Member",   // or "Captain"
  joined:  "Mar 22",
  myMW:    185,        // this subscriber's MW contribution to the team this season
};

function currentSeason() {
  const now = new Date();
  const y = now.getFullYear();
  const seasons = [
    { name:"Spring", start:new Date(y, 2, 21), end:new Date(y, 5, 20) },
    { name:"Summer", start:new Date(y, 5, 21), end:new Date(y, 8, 22) },
    { name:"Fall",   start:new Date(y, 8, 23), end:new Date(y, 11, 20) },
    { name:"Winter", start:new Date(y, 11, 21), end:new Date(y + 1, 2, 20) },
  ];
  for (const s of seasons) {
    if (now >= s.start && now <= s.end) return { ...s, year:y };
  }
  return { name:"Winter", start:new Date(y - 1, 11, 21), end:new Date(y, 2, 20), year:y };
}

function slugifyTeam(str) {
  return str.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12);
}

// ── Tiny components ───────────────────────────────────────────────────────────
function SL({ children, color }) {
  return <span style={{ fontSize:"12px", letterSpacing:"0.14em", color:color||C.muted, textTransform:"uppercase", ...mono }}>{children}</span>;
}

function Pill({ children, color, bg }) {
  return (
    <span style={{ fontSize:"11px", letterSpacing:"0.1em", color:color||C.muted, background:bg||"rgba(255,255,255,0.05)",
      border:`1px solid ${color||C.muted}44`, padding:"2px 8px", borderRadius:"3px", ...mono, textTransform:"uppercase" }}>
      {children}
    </span>
  );
}

function Divider() {
  return <div style={{ height:"1px", background:C.border, margin:"20px 0" }} />;
}

// ── MWRing ────────────────────────────────────────────────────────────────────
function MWRing({ balance, allotment, size=72, tier }) {
  const pct = Math.min(balance / allotment, 1);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const tc = TIER_COLOR[tier] || C.gold;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={tc} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition:"stroke-dasharray 0.6s cubic-bezier(0.34,1.56,0.64,1)" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", gap:"1px" }}>
        <span style={{ fontSize:"15px", fontWeight:700, color:tc, lineHeight:1, ...mono }}>{balance}</span>
        <span style={{ fontSize:"10px", color:C.muted, letterSpacing:"0.08em", ...mono }}>MW</span>
      </div>
    </div>
  );
}

// ── RepBar ────────────────────────────────────────────────────────────────────
function RepBar({ score }) {
  const tier = getRepTier(score);
  const pct  = getRepProgress(score);
  const next = REP_TIERS.find(t => t.min > score);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:"13px", color:tier.color, fontWeight:600, ...mono }}>{tier.label}</span>
        <span style={{ fontSize:"12px", color:C.muted, ...mono }}>{score.toLocaleString()} rep</span>
      </div>
      <div style={{ height:"3px", background:"rgba(255,255,255,0.06)", borderRadius:"2px" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:tier.color,
          borderRadius:"2px", transition:"width 0.8s ease" }}/>
      </div>
      {next && <span style={{ fontSize:"11px", color:C.muted, ...mono }}>{(next.min - score).toLocaleString()} to {next.label}</span>}
    </div>
  );
}

// ── InterestChip ──────────────────────────────────────────────────────────────
function InterestChip({ label, active, onClick, color, locked }) {
  return (
    <button onClick={locked ? null : onClick} style={{
      background: active ? `${color||C.gold}18` : "rgba(255,255,255,0.03)",
      border: `1px solid ${active ? (color||C.gold) : C.border}`,
      color: locked ? C.dim : (active ? (color||C.gold) : C.muted),
      borderRadius:"4px", padding:"5px 10px", fontSize:"12px",
      cursor: locked ? "not-allowed" : "pointer", ...mono,
      letterSpacing:"0.06em", transition:"all 0.15s",
      opacity: locked ? 0.45 : 1,
    }}>
      {label}{locked ? " 🔒" : ""}
    </button>
  );
}

// ── ThemeCard ─────────────────────────────────────────────────────────────────
function ThemeCard({ theme, active, onClick, subscriberTier }) {
  const locked = theme.tier === "Premier" && subscriberTier !== "Premier";
  return (
    <div onClick={locked ? null : onClick} style={{
      background: active ? "rgba(196,146,42,0.06)" : C.surface,
      border: `1px solid ${active ? C.gold : C.border}`,
      borderRadius:"8px", padding:"14px 16px", cursor: locked ? "not-allowed" : "pointer",
      transition:"all 0.15s", opacity: locked ? 0.5 : 1,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"6px" }}>
        <span style={{ fontSize:"14px", fontWeight:600, color: active ? C.gold : C.text, ...sans }}>{theme.name}</span>
        <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
          {locked && <span style={{ fontSize:"11px", color:C.muted, ...mono }}>PREMIER</span>}
          {active && <span style={{ fontSize:"11px", color:C.gold, ...mono }}>✓ FOLLOWING</span>}
        </div>
      </div>
      <p style={{ fontSize:"12px", color:C.muted, margin:0, lineHeight:1.5, ...mono, fontStyle:"italic" }}>{theme.tagline}</p>
      <div style={{ display:"flex", gap:"4px", marginTop:"8px", flexWrap:"wrap" }}>
        {theme.domains.map(d => (
          <span key={d} style={{ fontSize:"10px", color:C.muted, background:"rgba(255,255,255,0.04)",
            border:`1px solid ${C.border}`, padding:"2px 5px", borderRadius:"2px", ...mono }}>{d}</span>
        ))}
      </div>
    </div>
  );
}

// ── ProductCard ───────────────────────────────────────────────────────────────
function ProductCard({ productKey, title, desc, earnText }) {
  const p = LAUNCH[productKey];
  return (
    <div style={{
      background: p.live ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.2)",
      border: `1px solid ${p.live ? C.border : C.dim}`,
      borderRadius:"8px", padding:"16px",
      opacity: p.live ? 1 : 0.75,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
        <span style={{ fontSize:"14px", fontWeight:600, color: p.live ? C.text : C.muted, ...sans }}>{title}</span>
        <span style={{ fontSize:"11px", color:p.color, background:`${p.color}18`,
          border:`1px solid ${p.color}44`, padding:"2px 7px", borderRadius:"3px", ...mono,
          letterSpacing:"0.08em" }}>{p.icon} {p.label}{p.eta ? ` · ${p.eta}` : ""}</span>
      </div>
      <p style={{ fontSize:"13px", color:C.muted, margin:"0 0 8px", lineHeight:1.6, ...mono }}>{desc}</p>
      {earnText && (
        <div style={{ fontSize:"12px", color:C.green, background:"rgba(74,222,128,0.06)",
          border:"1px solid rgba(74,222,128,0.15)", borderRadius:"4px",
          padding:"6px 10px", ...mono }}>
          {p.live ? `✦ Earn: ${earnText}` : `◎ Future earn: ${earnText}`}
        </div>
      )}
    </div>
  );
}

// ── Badge grid ────────────────────────────────────────────────────────────────
function BadgeGrid({ badges, featured, onFeatureToggle }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:"8px" }}>
      {badges.map(b => (
        <div key={b.id} onClick={() => b.earned && onFeatureToggle(b.id)} style={{
          background: b.earned ? (b.rare ? "rgba(255,107,107,0.06)" : C.surface) : "rgba(0,0,0,0.2)",
          border: `1px solid ${b.earned ? (b.rare ? "#FF6B6B55" : C.border) : C.dim}`,
          borderRadius:"6px", padding:"12px", cursor: b.earned ? "pointer" : "default",
          opacity: b.earned ? 1 : 0.4, transition:"all 0.15s",
          position:"relative",
        }}>
          {featured.includes(b.id) && (
            <div style={{ position:"absolute", top:6, right:6, width:6, height:6,
              borderRadius:"50%", background:C.gold }} />
          )}
          <div style={{ fontSize:"20px", marginBottom:"6px", filter: b.earned ? "none" : "grayscale(1)" }}>{b.icon}</div>
          <div style={{ fontSize:"12px", fontWeight:600, color: b.earned ? (b.rare ? "#FF6B6B" : C.text) : C.muted,
            marginBottom:"2px", ...sans }}>{b.name}</div>
          <div style={{ fontSize:"11px", color:C.muted, lineHeight:1.4, ...mono }}>{b.desc}</div>
          {b.rare && b.earned && (
            <div style={{ marginTop:"6px" }}>
              <Pill color="#FF6B6B" bg="rgba(255,107,107,0.08)">Rare</Pill>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Contribution row ──────────────────────────────────────────────────────────
function ContribRow({ c }) {
  const statusColor = { "Accepted":C.green, "Pending Review":C.amber, "Declined":C.red }[c.status] || C.muted;
  const typeIcon = { "Prediction":"◎", "Thesis":"⬡", "Announcement":"↑", "Idea":"◇" }[c.type] || "·";
  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:"12px", padding:"12px 0",
      borderBottom:`1px solid ${C.border}` }}>
      <span style={{ fontSize:"16px", color:C.muted, marginTop:"1px", flexShrink:0 }}>{typeIcon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:"13px", color:C.text, marginBottom:"4px", lineHeight:1.4, ...mono }}>{c.title}</div>
        <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
          <Pill color={statusColor} bg={`${statusColor}10`}>{c.status}</Pill>
          <span style={{ fontSize:"11px", color:C.muted, ...mono }}>{c.type} · {c.submitted}</span>
          {c.mw && <span style={{ fontSize:"11px", color:C.green, ...mono }}>+{c.mw} MW</span>}
        </div>
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ visible, message }) {
  return (
    <div style={{ position:"fixed", bottom:"28px", left:"50%",
      transform:`translateX(-50%) translateY(${visible?"0":"12px"})`,
      opacity:visible?1:0, background:"rgba(28,52,36,0.97)",
      border:"1px solid rgba(140,166,138,0.3)", borderRadius:"8px",
      padding:"11px 22px", display:"flex", alignItems:"center", gap:"9px",
      transition:"all 0.2s", zIndex:400, pointerEvents:"none" }}>
      <span style={{ color:C.green, fontSize:"14px" }}>✓</span>
      <span style={{ fontSize:"12px", color:C.sage, ...mono, letterSpacing:"0.07em" }}>{message}</span>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function SubscriberProfileV7() {

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; }
      @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
      .ca  { animation: fadeUp 0.35s ease forwards; }
      button { transition: all 0.15s; }
      input:focus, textarea:focus {
        border-color: rgba(196,146,42,0.4) !important;
        outline: none;
        box-shadow: 0 0 0 2px rgba(196,146,42,0.06);
      }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
    `;
    document.head.appendChild(style);
  }, []);

  // ── Profile stub ──
  const profile = {
    handle:    "JM_DataOps",
    name:      "Jordan Morris",
    email:     "j.morris@datacorp.io",
    org:       "DataCorp Infrastructure",
    role:      "Director of Infrastructure Strategy",
    tier:      "Core",
    joined:    "2025-09-12",
    streak:    12,
  };

  // ── State ──
  const [activeTab,       setActiveTab]       = useState("overview");
  const [interestTab,     setInterestTab]     = useState("themes");
  const [balance,         setBalance]         = useState(487);
  const [repScore]                            = useState(2340);
  const [followedThemes,  setFollowedThemes]  = useState(["T-001","T-002","T-003"]);
  const [followedDomains, setFollowedDomains] = useState(["D1","D3","D7","D18"]);
  const [followedSDs,     setFollowedSDs]     = useState(["D3.2","D7.1","D18.1","D18.2"]);
  const [featuredBadges,  setFeaturedBadges]  = useState(["B-M-05","B-C-01","B-I-01"]);
  const [toast,           setToast]           = useState({ visible:false, msg:"" });
  const [unsaved,         setUnsaved]         = useState(false);
  const [showLedger,      setShowLedger]      = useState(false);
  const [editingProfile,  setEditingProfile]  = useState(false);
  const [profileDraft,    setProfileDraft]    = useState({ name:profile.name, org:profile.org, role:profile.role });

  // Teams
  const [myTeam,          setMyTeam]          = useState(INITIAL_MY_TEAM);
  const [teamMode,        setTeamMode]        = useState("create");   // "create" | "join" — when not on a team
  const [teamDraft,       setTeamDraft]       = useState({ name:"", code:"" });
  const [teamShareBlock,  setTeamShareBlock]  = useState(null);        // { code, link } after create
  const season = currentSeason();

  const allotment    = ALLOTMENT[profile.tier];
  const pct          = Math.round((balance / allotment) * 100);
  const repTier      = getRepTier(repScore);
  const earnedBadges = BADGES.filter(b => b.earned);

  function showToast(msg) {
    setToast({ visible:true, msg });
    setTimeout(() => setToast({ visible:false, msg:"" }), 2800);
  }

  function toggleTheme(id) {
    const tier = THEMES.find(t => t.id === id)?.tier;
    if (tier === "Premier" && profile.tier !== "Premier") return;
    setFollowedThemes(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    setUnsaved(true);
  }

  function toggleDomain(id) {
    setFollowedDomains(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    // if removing a domain, remove its sub-domains too
    if (followedDomains.includes(id)) {
      setFollowedSDs(p => p.filter(sd => !sd.startsWith(id + ".")));
    }
    setUnsaved(true);
  }

  function toggleSD(id) {
    const parent = id.split(".")[0];
    if (!followedDomains.includes(parent)) return; // must follow parent domain
    setFollowedSDs(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    setUnsaved(true);
  }

  function toggleFeaturedBadge(id) {
    setFeaturedBadges(p => {
      if (p.includes(id)) return p.filter(x => x !== id);
      if (p.length >= 6) { showToast("Max 6 featured badges"); return p; }
      return [...p, id];
    });
  }

  function saveInterests() {
    setUnsaved(false);
    showToast("Intelligence focus saved");
  }

  // ── Team actions ──
  function createTeam() {
    const name = teamDraft.name.trim();
    if (!name) { showToast("Team name required"); return; }
    const code = slugifyTeam(name) + "-" + new Date().getFullYear();
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/teams?code=${encodeURIComponent(code)}`;
    setTeamShareBlock({ code, link });
    setMyTeam({ id:`T-${code}`, code, name, role:"Captain", joined:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"}), myMW:0 });
    setTeamDraft({ name:"", code:"" });
    showToast(`Team "${name}" created`);
    // Production: POST /api/teams/create { name, captain, email, code }
  }

  function joinTeam() {
    const code = teamDraft.code.trim().toUpperCase();
    if (!code) { showToast("Team code required"); return; }
    const match = TEAMS_LEADERBOARD.find(t => slugifyTeam(t.name) + "-" + new Date().getFullYear() === code);
    const name = match ? match.name : code;
    setMyTeam({ id:match?.id || `T-${code}`, code, name, role:"Member", joined:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"}), myMW:0 });
    setTeamDraft({ name:"", code:"" });
    setTeamShareBlock(null);
    showToast(`Joined ${name}`);
    // Production: POST /api/teams/join { code, name, email }
  }

  function leaveTeam() {
    setMyTeam(null);
    setTeamShareBlock(null);
    setTeamMode("create");
    showToast("Left team");
    // Production: POST /api/teams/leave
  }

  function copyTeamLink(link) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => showToast("Invite link copied"));
    }
  }

  const TABS = [
    { id:"overview",      label:"Overview"    },
    { id:"focus",         label:"My Focus"    },
    { id:"mw",            label:"MW Economy"  },
    { id:"teams",         label:"Teams"       },
    { id:"reputation",    label:"Reputation"  },
    { id:"contributions", label:"Contributions" },
    { id:"settings",      label:"Settings"    },
  ];

  const tierC  = TIER_COLOR[profile.tier];
  const tierBg = TIER_ACCENT[profile.tier];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, ...mono }}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"0 28px",
        background:"rgba(0,0,0,0.3)", backdropFilter:"blur(8px)",
        position:"sticky", top:0, zIndex:100 }}>

        {/* Top bar */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"14px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
            {/* Avatar */}
            <div style={{ width:"36px", height:"36px", borderRadius:"8px",
              background:`linear-gradient(135deg,${C.forest},${C.gold}44)`,
              border:`1px solid ${C.gold}44`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:"15px", fontWeight:700, color:C.gold, ...serif }}>
              {profile.handle.charAt(0)}
            </div>
            <div>
              <div style={{ fontSize:"15px", fontWeight:600, color:C.text, letterSpacing:"-0.01em", ...sans }}>
                {profile.handle}
              </div>
              <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.1em" }}>
                {profile.role} · {profile.org}
              </div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            {/* Live pulse */}
            <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
              <div style={{ width:"6px", height:"6px", borderRadius:"50%",
                background:C.green, animation:"pulse 2s ease infinite" }}/>
              <span style={{ fontSize:"11px", color:C.green, letterSpacing:"0.1em" }}>LIVE</span>
            </div>
            {/* Tier badge */}
            <div style={{ background:tierBg, border:`1px solid ${tierC}55`,
              borderRadius:"4px", padding:"4px 10px", display:"flex", alignItems:"center", gap:"6px" }}>
              <span style={{ fontSize:"12px", color:tierC, fontWeight:600, letterSpacing:"0.08em" }}>{profile.tier}</span>
            </div>
            {/* MW balance */}
            <div style={{ display:"flex", alignItems:"center", gap:"6px",
              background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`,
              borderRadius:"4px", padding:"4px 10px" }}>
              <span style={{ fontSize:"13px", color:tierC, fontWeight:600 }}>{balance}</span>
              <span style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.08em" }}>MW</span>
            </div>
            {/* Streak */}
            <div style={{ display:"flex", alignItems:"center", gap:"5px",
              background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.25)",
              borderRadius:"4px", padding:"4px 10px" }}>
              <span style={{ fontSize:"12px" }}>🔥</span>
              <span style={{ fontSize:"12px", color:C.amber }}>{profile.streak}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:"0", overflowX:"auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              background:"none", border:"none",
              borderBottom:`2px solid ${activeTab===t.id ? C.gold : "transparent"}`,
              color: activeTab===t.id ? C.gold : C.muted,
              padding:"13px 18px", fontSize:"12px", cursor:"pointer",
              letterSpacing:"0.1em", textTransform:"uppercase", ...mono,
              transition:"color 0.15s", whiteSpace:"nowrap",
              position:"relative",
            }}>
              {t.label}
              {t.id === "focus" && unsaved && (
                <span style={{ position:"absolute", top:10, right:10, width:5, height:5,
                  borderRadius:"50%", background:C.gold }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── BODY ───────────────────────────────────────────────────────── */}
      <div style={{ padding:"28px", maxWidth:"900px", margin:"0 auto" }}>

        {/* ══════════ OVERVIEW ════════════════════════════════════════════ */}
        {activeTab === "overview" && (
          <div className="ca" style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

            {/* Identity + stats row */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:"12px" }}>
              {[
                { label:"MW Balance",    value:`${balance} MW`,         sub:`${pct}% of ${allotment} MW/mo`,  color:tierC  },
                { label:"Reputation",    value:repScore.toLocaleString(), sub:repTier.label,                  color:repTier.color },
                { label:"Badges Earned", value:`${earnedBadges.length}`, sub:`${featuredBadges.length} featured`, color:C.gold },
                { label:"Active Streak", value:`${profile.streak} days`, sub:"Daily Challenge",               color:C.amber },
              ].map(s => (
                <div key={s.label} style={{ background:C.surface, border:`1px solid ${C.border}`,
                  borderRadius:"8px", padding:"16px" }}>
                  <SL>{s.label}</SL>
                  <div style={{ fontSize:"20px", fontWeight:700, color:s.color,
                    margin:"6px 0 3px", letterSpacing:"-0.02em", ...sans }}>{s.value}</div>
                  <div style={{ fontSize:"11px", color:C.muted }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Intelligence Focus summary */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
                <SL>Intelligence Focus</SL>
                <button onClick={() => setActiveTab("focus")} style={{
                  background:"none", border:"none", color:C.gold, fontSize:"11px",
                  cursor:"pointer", letterSpacing:"0.1em", ...mono }}>CONFIGURE →</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {[
                  { label:"Themes following",     count:followedThemes.length,  total:7,  color:C.gold   },
                  { label:"Domains following",    count:followedDomains.length, total:18, color:C.sage   },
                  { label:"Sub-Domains following",count:followedSDs.length,     total:34, color:C.cyan   },
                ].map(r => (
                  <div key={r.label}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
                      <span style={{ fontSize:"12px", color:C.muted }}>{r.label}</span>
                      <span style={{ fontSize:"12px", color:r.color }}>{r.count} / {r.total}</span>
                    </div>
                    <div style={{ height:"3px", background:"rgba(255,255,255,0.05)", borderRadius:"2px" }}>
                      <div style={{ height:"100%", width:`${(r.count/r.total)*100}%`,
                        background:r.color, borderRadius:"2px", transition:"width 0.8s ease" }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Your Team — Daily Challenge seasonal competition */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
                <SL>Your Team · {season.name} {season.year}</SL>
                <button onClick={() => setActiveTab("teams")} style={{
                  background:"none", border:"none", color:C.gold, fontSize:"11px",
                  cursor:"pointer", letterSpacing:"0.1em", ...mono }}>
                  {myTeam ? "MANAGE →" : "JOIN →"}
                </button>
              </div>
              {myTeam ? (() => {
                const lb  = TEAMS_LEADERBOARD.find(t => t.id === myTeam.id);
                const rank = lb?.rank;
                const mw   = lb?.mw ?? 0;
                const mem  = lb?.members ?? 1;
                return (
                  <div style={{ display:"flex", alignItems:"center", gap:"20px", flexWrap:"wrap" }}>
                    <div style={{ flex:"1 1 200px", minWidth:0 }}>
                      <div style={{ fontSize:"16px", fontWeight:600, color:C.text, ...serif, marginBottom:"4px" }}>
                        {myTeam.name}
                      </div>
                      <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.08em" }}>
                        {myTeam.role} · Joined {myTeam.joined}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:"24px" }}>
                      <div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", ...mono }}>Rank</div>
                        <div style={{ fontSize:"20px", fontWeight:700, color:C.gold, ...sans }}>{rank ? `#${rank}` : "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", ...mono }}>Team MW</div>
                        <div style={{ fontSize:"20px", fontWeight:700, color:C.text, ...sans }}>{mw.toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", ...mono }}>Members</div>
                        <div style={{ fontSize:"20px", fontWeight:700, color:C.text, ...sans }}>{mem}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", ...mono }}>Your MW</div>
                        <div style={{ fontSize:"20px", fontWeight:700, color:C.green, ...sans }}>{myTeam.myMW}</div>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:"16px", flexWrap:"wrap" }}>
                  <div style={{ flex:"1 1 260px", minWidth:0 }}>
                    <div style={{ fontSize:"13px", color:C.text, marginBottom:"4px", ...sans }}>
                      You're not on a team yet.
                    </div>
                    <div style={{ fontSize:"12px", color:C.muted, lineHeight:1.6 }}>
                      Form a team with your company, school, or Slack crew — every member's Daily Challenge MW rolls up to the team total.
                    </div>
                  </div>
                  <button onClick={() => setActiveTab("teams")} style={{
                    background:`rgba(196,146,42,0.12)`, border:`1px solid ${C.gold}44`,
                    color:C.gold, borderRadius:"6px", padding:"8px 18px",
                    fontSize:"12px", cursor:"pointer", letterSpacing:"0.08em", ...mono }}>
                    CREATE OR JOIN A TEAM →
                  </button>
                </div>
              )}
            </div>

            {/* Platform products */}
            <div>
              <div style={{ marginBottom:"14px" }}><SL>Platform</SL></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                <ProductCard productKey="challenge"
                  title="Daily Challenge"
                  desc="Seven puzzle types — Rackl, Signal Drop, The Stack, Circuit, The Brief, Dark Fiber, Frequency. New puzzles every day."
                  earnText="5 MW/puzzle · 25 MW streak bonus" />
                <ProductCard productKey="intelligence"
                  title="Faraday Intelligence"
                  desc="Live intelligence feed across all 18 domains. Theme-tagged. Sub-domain filtered. Your focus profile determines your feed from day one."
                  earnText="15 MW/module · 100 MW/certification" />
                <ProductCard productKey="academy"
                  title="Faraday Academy"
                  desc="36 courses across all domains. Certification tracks. Sub-domain competency pathways. Built on the same IDF architecture as the Intelligence feed."
                  earnText="15 MW/module · 100 MW/certification" />
                <ProductCard productKey="community"
                  title="Faraday Community"
                  desc="Subscriber-only forums, contribution pipeline, and the Subscriber Moderator program. Prediction submissions, thesis debates, and the Prognostication leaderboard."
                  earnText="20 MW/accepted contribution" />
              </div>
            </div>

            {/* Featured badges */}
            {earnedBadges.length > 0 && (
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"20px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
                  <SL>Featured Badges</SL>
                  <button onClick={() => setActiveTab("reputation")} style={{
                    background:"none", border:"none", color:C.gold, fontSize:"11px",
                    cursor:"pointer", letterSpacing:"0.1em", ...mono }}>MANAGE →</button>
                </div>
                <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                  {BADGES.filter(b => featuredBadges.includes(b.id)).map(b => (
                    <div key={b.id} style={{ display:"flex", alignItems:"center", gap:"6px",
                      background: b.rare ? "rgba(255,107,107,0.06)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${b.rare ? "#FF6B6B44" : C.border}`,
                      borderRadius:"4px", padding:"6px 10px" }}>
                      <span style={{ fontSize:"16px" }}>{b.icon}</span>
                      <span style={{ fontSize:"12px", color: b.rare ? "#FF6B6B" : C.text }}>{b.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════ MY FOCUS ════════════════════════════════════════════ */}
        {activeTab === "focus" && (
          <div className="ca" style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

            {/* Header + save */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <h2 style={{ margin:"0 0 4px", fontSize:"18px", fontWeight:700, color:C.text, ...sans }}>Intelligence Focus</h2>
                <p style={{ margin:0, fontSize:"12px", color:C.muted, lineHeight:1.6 }}>
                  Your focus profile drives your Intelligence feed from the moment it launches.<br/>
                  Configure all three layers — Themes, Domains, Sub-Domains — independently.
                </p>
              </div>
              {unsaved && (
                <button onClick={saveInterests} style={{
                  background:`rgba(196,146,42,0.12)`, border:`1px solid ${C.gold}44`,
                  color:C.gold, borderRadius:"6px", padding:"8px 18px",
                  fontSize:"12px", cursor:"pointer", letterSpacing:"0.08em", ...mono }}>
                  ↑ SAVE CHANGES
                </button>
              )}
            </div>

            {/* Interest tabs */}
            <div style={{ display:"flex", borderBottom:`1px solid ${C.border}` }}>
              {[
                { id:"themes",    label:`Themes (${followedThemes.length})`,     color:C.gold   },
                { id:"domains",   label:`Domains (${followedDomains.length})`,   color:C.sage   },
                { id:"subdomains",label:`Sub-Domains (${followedSDs.length})`,   color:C.cyan   },
              ].map(t => (
                <button key={t.id} onClick={() => setInterestTab(t.id)} style={{
                  background:"none", border:"none",
                  borderBottom:`2px solid ${interestTab===t.id ? t.color : "transparent"}`,
                  color: interestTab===t.id ? t.color : C.muted,
                  padding:"10px 16px", fontSize:"12px", cursor:"pointer",
                  letterSpacing:"0.1em", textTransform:"uppercase", ...mono }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Themes panel */}
            {interestTab === "themes" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                <p style={{ margin:"0 0 4px", fontSize:"11px", color:C.muted, lineHeight:1.6 }}>
                  Themes are cross-domain narrative threads. Following a Theme sends you alerts across all Domains it spans.<br/>
                  <span style={{ color:C.cyan }}>Core+</span> themes available on your tier.
                  <span style={{ color:C.violet }}> Premier</span> themes require Premier.
                </p>
                {THEMES.map(t => (
                  <ThemeCard key={t.id} theme={t} active={followedThemes.includes(t.id)}
                    onClick={() => toggleTheme(t.id)} subscriberTier={profile.tier} />
                ))}
              </div>
            )}

            {/* Domains panel */}
            {interestTab === "domains" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
                <p style={{ margin:0, fontSize:"11px", color:C.muted, lineHeight:1.6 }}>
                  Select Domains to receive all content within them. Following a Domain also unlocks its Sub-Domains below.
                </p>
                <div>
                  <div style={{ marginBottom:"10px" }}><SL color={C.gold}>Core Domains — D1–D9</SL></div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                    {DOMAINS.filter(d => d.type === "Core").map(d => (
                      <InterestChip key={d.id} label={`${d.id} ${d.name}`}
                        active={followedDomains.includes(d.id)}
                        onClick={() => toggleDomain(d.id)} color={C.sage} />
                    ))}
                  </div>
                </div>
                <Divider />
                <div>
                  <div style={{ marginBottom:"10px" }}><SL color={C.cyan}>Passion Domains — D10–D18</SL></div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                    {DOMAINS.filter(d => d.type === "Passion").map(d => (
                      <InterestChip key={d.id} label={`${d.id} ${d.name}`}
                        active={followedDomains.includes(d.id)}
                        onClick={() => toggleDomain(d.id)} color={C.cyan} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Domains panel */}
            {interestTab === "subdomains" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
                <p style={{ margin:0, fontSize:"11px", color:C.muted, lineHeight:1.6 }}>
                  Sub-Domains let you filter within a Domain you already follow. You must follow a Domain to enable its Sub-Domains.<br/>
                  Locked chips require the parent Domain to be followed first.
                </p>
                {DOMAINS.filter(d => SUBDOMAINS.some(sd => sd.parent === d.id)).map(domain => {
                  const sds = SUBDOMAINS.filter(sd => sd.parent === domain.id);
                  const parentFollowed = followedDomains.includes(domain.id);
                  return (
                    <div key={domain.id}>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px" }}>
                        <span style={{ fontSize:"12px", color: parentFollowed ? C.text : C.dim,
                          fontWeight:600, ...sans }}>{domain.id} — {domain.name}</span>
                        {!parentFollowed && <Pill color={C.dim}>Follow domain first</Pill>}
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                        {sds.map(sd => (
                          <InterestChip key={sd.id} label={`${sd.id} ${sd.name}`}
                            active={followedSDs.includes(sd.id)}
                            onClick={() => toggleSD(sd.id)}
                            locked={!parentFollowed}
                            color={C.cyan} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════ MW ECONOMY ══════════════════════════════════════════ */}
        {activeTab === "mw" && (
          <div className="ca" style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

            {/* Balance card */}
            <div style={{ background:C.surface, border:`1px solid ${tierC}33`,
              borderRadius:"10px", padding:"24px",
              display:"flex", alignItems:"center", gap:"24px" }}>
              <MWRing balance={balance} allotment={allotment} size={88} tier={profile.tier} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:"24px", fontWeight:700, color:tierC,
                  letterSpacing:"-0.02em", marginBottom:"4px", ...sans }}>
                  {balance} MW
                </div>
                <div style={{ fontSize:"12px", color:C.muted, marginBottom:"10px" }}>
                  {allotment - balance} MW remaining this cycle · resets on sign-up anniversary
                </div>
                <div style={{ display:"flex", gap:"8px" }}>
                  <Pill color={tierC} bg={tierBg}>{profile.tier} · {allotment} MW/mo</Pill>
                  <Pill color={C.muted}>Lifetime: {(12340).toLocaleString()} MW</Pill>
                </div>
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px" }}>

              {/* Earn rates */}
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"18px" }}>
                <div style={{ marginBottom:"12px" }}><SL color={C.green}>How to Earn MW</SL></div>
                {Object.entries(EARN_RATES).map(([k,v]) => (
                  <div key={k} style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center", padding:"7px 0",
                    borderBottom:`1px solid ${C.border}` }}>
                    <div>
                      <div style={{ fontSize:"12px", color:C.text, marginBottom:"2px" }}>{k}</div>
                      <div style={{ fontSize:"11px", color:C.muted }}>{v.label}</div>
                    </div>
                    <span style={{ fontSize:"13px", color:C.green, fontWeight:600 }}>+{v.earn}</span>
                  </div>
                ))}
              </div>

              {/* Spend costs — locked/teased */}
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"18px",
                opacity:0.7 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
                  <SL color={C.amber}>Intelligence Spend</SL>
                  <Pill color={C.gold} bg="rgba(196,146,42,0.08)">Coming Q3 2026</Pill>
                </div>
                {Object.entries(SPEND_COSTS).map(([k,v]) => (
                  <div key={k} style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center", padding:"7px 0",
                    borderBottom:`1px solid ${C.border}` }}>
                    <div>
                      <div style={{ fontSize:"12px", color:C.muted, marginBottom:"2px" }}>{k}</div>
                      <div style={{ fontSize:"11px", color:C.dim }}>{v.label}</div>
                    </div>
                    <span style={{ fontSize:"13px", color:C.dim }}>−{v.cost}</span>
                  </div>
                ))}
                <div style={{ marginTop:"10px", fontSize:"11px", color:C.muted, lineHeight:1.5 }}>
                  MW you earn now will be spendable when Intelligence launches. Your balance carries forward.
                </div>
              </div>
            </div>

            {/* Ledger */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"18px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
                <SL>Recent Activity</SL>
                <button onClick={() => setShowLedger(p => !p)} style={{
                  background:"none", border:"none", color:C.muted, fontSize:"11px",
                  cursor:"pointer", letterSpacing:"0.1em", ...mono }}>
                  {showLedger ? "COLLAPSE ▲" : "EXPAND ▼"}
                </button>
              </div>
              {(showLedger ? LEDGER : LEDGER.slice(0, 4)).map((row, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize:"12px", color:C.text }}>{row.label}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>{row.date}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:"13px", color: row.type==="earn" ? C.green : C.red, fontWeight:600 }}>
                      {row.type==="earn" ? "+" : "−"}{row.amount} MW
                    </div>
                    <div style={{ fontSize:"11px", color:C.muted }}>{row.balance} MW</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════ TEAMS ═══════════════════════════════════════════════ */}
        {activeTab === "teams" && (
          <div className="ca" style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

            {/* Header + season banner */}
            <div>
              <h2 style={{ margin:"0 0 4px", fontSize:"18px", fontWeight:700, color:C.text, ...sans }}>
                Teams
              </h2>
              <p style={{ margin:0, fontSize:"12px", color:C.muted, lineHeight:1.6 }}>
                Play the Daily Challenge together. Every member's MW rolls up to the team total.
                Four seasons per year — standings reset each season.
              </p>
            </div>

            <div style={{ background:`linear-gradient(135deg, ${C.forest} 0%, #244228 100%)`,
              border:`1px solid ${C.gold}55`, borderRadius:"10px",
              padding:"16px 20px", display:"flex", justifyContent:"space-between",
              alignItems:"center", flexWrap:"wrap", gap:"12px" }}>
              <div>
                <div style={{ fontSize:"11px", color:C.gold, letterSpacing:"0.14em",
                  textTransform:"uppercase", ...mono, marginBottom:"4px" }}>Current Season</div>
                <div style={{ fontSize:"18px", fontWeight:700, color:C.white, ...serif }}>
                  {season.name} {season.year}
                </div>
              </div>
              <div style={{ fontSize:"12px", color:"rgba(248,245,240,0.7)", ...mono }}>
                {season.start.toLocaleDateString("en-US",{month:"long",day:"numeric"})} — {season.end.toLocaleDateString("en-US",{month:"long",day:"numeric"})}, {season.end.getFullYear()}
              </div>
            </div>

            {/* My team OR create/join */}
            {myTeam ? (
              (() => {
                const lb  = TEAMS_LEADERBOARD.find(t => t.id === myTeam.id);
                const rank = lb?.rank;
                const mw   = lb?.mw ?? 0;
                const mem  = lb?.members ?? 1;
                return (
                  <div style={{ background:C.surface, border:`1px solid ${C.gold}33`,
                    borderRadius:"10px", padding:"24px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between",
                      alignItems:"flex-start", marginBottom:"16px", flexWrap:"wrap", gap:"10px" }}>
                      <div>
                        <SL color={C.gold}>My Team</SL>
                        <div style={{ fontSize:"22px", fontWeight:700, color:C.text, ...serif,
                          marginTop:"6px", marginBottom:"4px" }}>{myTeam.name}</div>
                        <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                          <Pill color={C.gold} bg="rgba(196,146,42,0.08)">{myTeam.role}</Pill>
                          <Pill color={C.muted}>Code: {myTeam.code}</Pill>
                          <Pill color={C.muted}>Joined {myTeam.joined}</Pill>
                        </div>
                      </div>
                      <button onClick={leaveTeam} style={{
                        background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.25)",
                        color:C.red, borderRadius:"4px", padding:"6px 12px", fontSize:"11px",
                        cursor:"pointer", letterSpacing:"0.1em", ...mono }}>
                        LEAVE TEAM
                      </button>
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:"12px" }}>
                      {[
                        { label:"Rank",     value: rank ? `#${rank}` : "—", color:C.gold },
                        { label:"Team MW",  value: mw.toLocaleString(),      color:C.text },
                        { label:"Members",  value: mem,                      color:C.text },
                        { label:"Your MW",  value: myTeam.myMW,              color:C.green },
                      ].map(s => (
                        <div key={s.label} style={{ background:"rgba(255,255,255,0.03)",
                          border:`1px solid ${C.border}`, borderRadius:"6px", padding:"12px" }}>
                          <div style={{ fontSize:"10px", color:C.muted, letterSpacing:"0.12em",
                            textTransform:"uppercase", ...mono, marginBottom:"4px" }}>{s.label}</div>
                          <div style={{ fontSize:"18px", fontWeight:700, color:s.color, ...sans }}>
                            {s.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    {myTeam.role === "Captain" && teamShareBlock && (
                      <div style={{ marginTop:"16px", padding:"12px",
                        background:"rgba(196,146,42,0.06)", border:`1px solid ${C.gold}22`,
                        borderRadius:"6px" }}>
                        <div style={{ fontSize:"11px", color:C.gold, letterSpacing:"0.1em",
                          textTransform:"uppercase", ...mono, marginBottom:"6px" }}>
                          Invite link
                        </div>
                        <div style={{ fontSize:"12px", color:C.text, ...mono,
                          wordBreak:"break-all", marginBottom:"8px" }}>{teamShareBlock.link}</div>
                        <button onClick={() => copyTeamLink(teamShareBlock.link)} style={{
                          background:C.gold, color:C.forest, border:"none",
                          borderRadius:"4px", padding:"6px 14px", fontSize:"11px",
                          cursor:"pointer", letterSpacing:"0.1em", fontWeight:600, ...mono }}>
                          COPY LINK
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div style={{ background:C.surface, border:`1px solid ${C.border}`,
                borderRadius:"10px", padding:"24px" }}>
                {/* Mode switch */}
                <div style={{ display:"flex", gap:"0", borderBottom:`1px solid ${C.border}`,
                  marginBottom:"18px" }}>
                  {[
                    { id:"create", label:"Create a team" },
                    { id:"join",   label:"Join a team"   },
                  ].map(m => (
                    <button key={m.id} onClick={() => setTeamMode(m.id)} style={{
                      background:"none", border:"none",
                      borderBottom:`2px solid ${teamMode===m.id ? C.gold : "transparent"}`,
                      color: teamMode===m.id ? C.gold : C.muted,
                      padding:"10px 16px", fontSize:"12px", cursor:"pointer",
                      letterSpacing:"0.1em", textTransform:"uppercase", ...mono }}>
                      {m.label}
                    </button>
                  ))}
                </div>

                {teamMode === "create" ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                    <p style={{ margin:0, fontSize:"12px", color:C.muted, lineHeight:1.6 }}>
                      Any affiliation — company, school, Slack crew, family. Invite anyone by link, no approvals required.
                    </p>
                    <div>
                      <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.1em",
                        textTransform:"uppercase", ...mono, marginBottom:"6px" }}>Team Name</div>
                      <input value={teamDraft.name}
                        onChange={e => setTeamDraft(p => ({...p, name:e.target.value}))}
                        placeholder="e.g. The Hyperscalers" maxLength={40}
                        style={{ width:"100%", background:"rgba(255,255,255,0.04)",
                          border:`1px solid ${C.border}`, borderRadius:"4px",
                          padding:"8px 12px", color:C.text, fontSize:"13px", ...mono }} />
                    </div>
                    <div style={{ fontSize:"11px", color:C.muted, lineHeight:1.5 }}>
                      Captain: <span style={{ color:C.text }}>{profile.name}</span> ({profile.email})
                    </div>
                    <button onClick={createTeam} style={{
                      alignSelf:"flex-start", background:C.gold, color:C.forest, border:"none",
                      borderRadius:"6px", padding:"9px 20px", fontSize:"12px",
                      cursor:"pointer", letterSpacing:"0.08em", fontWeight:600, ...mono }}>
                      CREATE TEAM
                    </button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                    <p style={{ margin:0, fontSize:"12px", color:C.muted, lineHeight:1.6 }}>
                      Got an invite link? Paste the team code below.
                    </p>
                    <div>
                      <div style={{ fontSize:"11px", color:C.muted, letterSpacing:"0.1em",
                        textTransform:"uppercase", ...mono, marginBottom:"6px" }}>Team Code</div>
                      <input value={teamDraft.code}
                        onChange={e => setTeamDraft(p => ({...p, code:e.target.value.toUpperCase()}))}
                        placeholder="e.g. HYPER-2026" maxLength={20}
                        style={{ width:"100%", background:"rgba(255,255,255,0.04)",
                          border:`1px solid ${C.border}`, borderRadius:"4px",
                          padding:"8px 12px", color:C.text, fontSize:"13px", ...mono }} />
                    </div>
                    <div style={{ fontSize:"11px", color:C.muted, lineHeight:1.5 }}>
                      Joining as: <span style={{ color:C.text }}>{profile.name}</span> ({profile.email})
                    </div>
                    <button onClick={joinTeam} style={{
                      alignSelf:"flex-start", background:`rgba(196,146,42,0.12)`,
                      border:`1px solid ${C.gold}44`, color:C.gold,
                      borderRadius:"6px", padding:"9px 20px", fontSize:"12px",
                      cursor:"pointer", letterSpacing:"0.08em", ...mono }}>
                      JOIN TEAM
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Leaderboard */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`,
              borderRadius:"8px", padding:"20px" }}>
              <div style={{ marginBottom:"4px" }}><SL>Season Leaderboard</SL></div>
              <div style={{ fontSize:"11px", color:C.muted, marginBottom:"14px" }}>
                Top teams by cumulative MW this season · updated after every Daily Challenge cycle
              </div>
              <div>
                {TEAMS_LEADERBOARD.map((t, i) => {
                  const mine = myTeam?.id === t.id;
                  return (
                    <div key={t.id} style={{ display:"grid",
                      gridTemplateColumns:"50px 1fr 80px 100px", gap:"12px",
                      padding:"11px 10px",
                      borderBottom: i < TEAMS_LEADERBOARD.length-1 ? `1px solid ${C.border}` : "none",
                      background: mine ? "rgba(196,146,42,0.06)" : "transparent",
                      borderRadius: mine ? "6px" : "0",
                      alignItems:"center" }}>
                      <div style={{ fontSize:"14px", color:C.gold, fontWeight:500, ...mono }}>
                        {t.rank}
                      </div>
                      <div style={{ fontSize:"14px", fontWeight:600,
                        color: mine ? C.gold : C.text, ...serif }}>
                        {t.name}
                        {mine && <span style={{ marginLeft:"8px", fontSize:"10px",
                          color:C.gold, letterSpacing:"0.1em", ...mono }}>YOU</span>}
                      </div>
                      <div style={{ fontSize:"12px", color:C.muted, textAlign:"right", ...mono }}>
                        {t.members} members
                      </div>
                      <div style={{ fontSize:"14px", color:C.text, textAlign:"right",
                        fontWeight:500, ...mono }}>
                        {t.mw.toLocaleString()} MW
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* How Teams work */}
            <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${C.border}`,
              borderRadius:"8px", padding:"20px" }}>
              <div style={{ marginBottom:"12px" }}><SL>How Teams Work</SL></div>
              <ul style={{ listStyle:"none", padding:0, margin:0 }}>
                {[
                  "Create or join a team with a shareable link — any affiliation welcome.",
                  "Every team member's daily MW rolls up to the team total.",
                  "Four seasons per year: Spring, Summer, Fall, Winter. Standings reset each season.",
                  "All 7 Daily Challenge games count: Rackl, Wattl, Circuit, Signal Drop, The Stack, Dark Fiber, Frequency.",
                  "Top teams at season close earn a spot on the Faraday Wall of Fame.",
                ].map((line, i) => (
                  <li key={i} style={{ position:"relative", padding:"6px 0 6px 22px",
                    fontSize:"13px", color:C.muted, lineHeight:1.5, ...mono }}>
                    <span style={{ position:"absolute", left:0, color:C.gold }}>⚡</span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ══════════ REPUTATION ══════════════════════════════════════════ */}
        {activeTab === "reputation" && (
          <div className="ca" style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

            {/* Rep score card */}
            <div style={{ background:C.surface, border:`1px solid ${repTier.color}33`,
              borderRadius:"10px", padding:"24px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"16px" }}>
                <div>
                  <div style={{ fontSize:"28px", fontWeight:700, color:repTier.color,
                    letterSpacing:"-0.02em", ...sans }}>{repScore.toLocaleString()}</div>
                  <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>Reputation Score — permanent, never resets</div>
                </div>
                <Pill color={repTier.color} bg={`${repTier.color}12`}>{repTier.label}</Pill>
              </div>
              <RepBar score={repScore} />
            </div>

            {/* Rep tiers ladder */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"18px" }}>
              <div style={{ marginBottom:"12px" }}><SL>Reputation Ladder</SL></div>
              {REP_TIERS.map((t, i) => {
                const active = repTier.label === t.label;
                const achieved = repScore >= t.min;
                return (
                  <div key={t.label} style={{ display:"flex", alignItems:"center", gap:"12px",
                    padding:"8px 0", borderBottom: i < REP_TIERS.length-1 ? `1px solid ${C.border}` : "none",
                    opacity: achieved ? 1 : 0.4 }}>
                    <div style={{ width:"8px", height:"8px", borderRadius:"50%",
                      background: achieved ? t.color : C.dim, flexShrink:0 }}/>
                    <span style={{ fontSize:"13px", color: active ? t.color : (achieved ? C.text : C.muted),
                      fontWeight: active ? 600 : 400, flex:1 }}>{t.label}</span>
                    <span style={{ fontSize:"11px", color:C.muted }}>{t.min.toLocaleString()}+</span>
                    {active && <Pill color={t.color} bg={`${t.color}10`}>Current</Pill>}
                  </div>
                );
              })}
            </div>

            {/* Badges */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"18px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
                <SL>Badges — {earnedBadges.length}/{BADGES.length} earned</SL>
                <span style={{ fontSize:"11px", color:C.muted }}>Click earned badges to feature (max 6)</span>
              </div>
              <BadgeGrid badges={BADGES} featured={featuredBadges} onFeatureToggle={toggleFeaturedBadge} />
            </div>
          </div>
        )}

        {/* ══════════ CONTRIBUTIONS ═══════════════════════════════════════ */}
        {activeTab === "contributions" && (
          <div className="ca" style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

            <div style={{ background:"rgba(196,146,42,0.05)", border:`1px solid ${C.gold}22`,
              borderRadius:"8px", padding:"16px" }}>
              <div style={{ fontSize:"13px", color:C.gold, fontWeight:600, marginBottom:"6px", ...sans }}>
                ◎ Contribution Pipeline
              </div>
              <p style={{ margin:0, fontSize:"12px", color:C.muted, lineHeight:1.6 }}>
                Submit predictions, theses, announcements, and ideas. All contributions are reviewed before
                acceptance. Accepted work earns MW and reputation. Corpus-level promotions require Myke's editorial sign-off.
              </p>
            </div>

            {/* My contributions */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"18px" }}>
              <div style={{ marginBottom:"4px" }}><SL>My Submissions</SL></div>
              {CONTRIBUTIONS.map(c => <ContribRow key={c.id} c={c} />)}
            </div>

            {/* Submit new */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"18px",
              opacity: LAUNCH.intelligence.live ? 1 : 0.6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px" }}>
                <SL>New Contribution</SL>
                {!LAUNCH.intelligence.live && (
                  <Pill color={C.gold} bg="rgba(196,146,42,0.08)">Activates with Intelligence · Q3 2026</Pill>
                )}
              </div>

              {/* Type selector */}
              <div style={{ display:"flex", gap:"6px", marginBottom:"12px", flexWrap:"wrap" }}>
                {["Prediction","Thesis","Announcement","Idea"].map(type => {
                  const icon = { Prediction:"◎", Thesis:"⬡", Announcement:"↑", Idea:"◇" }[type];
                  const earn = { Prediction:"+20 MW on accept", Thesis:"+40 MW on accept", Announcement:"+20 MW", Idea:"+10 MW" }[type];
                  return (
                    <div key={type} style={{
                      background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`,
                      borderRadius:"6px", padding:"8px 12px", cursor:"not-allowed", opacity:0.6 }}>
                      <div style={{ fontSize:"13px", color:C.muted }}>{icon} {type}</div>
                      <div style={{ fontSize:"11px", color:C.dim, marginTop:"2px" }}>{earn}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize:"11px", color:C.dim, lineHeight:1.5 }}>
                Contribution submission activates when Faraday Intelligence launches. Your submissions above
                were accepted through early access. Keep earning MW — they're ready to spend when the full
                pipeline opens.
              </div>
            </div>
          </div>
        )}

        {/* ══════════ SETTINGS ════════════════════════════════════════════ */}
        {activeTab === "settings" && (
          <div className="ca" style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

            {/* Profile */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
                <SL>Profile</SL>
                <button onClick={() => setEditingProfile(p => !p)} style={{
                  background: editingProfile ? "rgba(196,146,42,0.1)" : "rgba(255,255,255,0.04)",
                  border:`1px solid ${editingProfile ? C.gold : C.border}`,
                  color: editingProfile ? C.gold : C.muted,
                  borderRadius:"4px", padding:"5px 12px", fontSize:"11px",
                  cursor:"pointer", letterSpacing:"0.1em", ...mono }}>
                  {editingProfile ? "CANCEL" : "EDIT"}
                </button>
              </div>
              {[
                { label:"Handle",       value:profile.handle,   editable:false },
                { label:"Name",         value:profileDraft.name,  key:"name",   editable:true  },
                { label:"Email",        value:profile.email,    editable:false },
                { label:"Organization", value:profileDraft.org,   key:"org",    editable:true  },
                { label:"Role",         value:profileDraft.role,  key:"role",   editable:true  },
                { label:"Tier",         value:profile.tier,     editable:false },
                { label:"Member since", value:profile.joined,   editable:false },
              ].map(f => (
                <div key={f.label} style={{ display:"flex", alignItems:"center", gap:"16px",
                  padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:"11px", color:C.muted, width:"100px", flexShrink:0,
                    letterSpacing:"0.1em", textTransform:"uppercase" }}>{f.label}</span>
                  {editingProfile && f.editable ? (
                    <input value={f.value} onChange={e => setProfileDraft(p => ({...p, [f.key]:e.target.value}))}
                      style={{ flex:1, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
                        borderRadius:"4px", padding:"6px 10px", color:C.text, fontSize:"13px", ...mono }} />
                  ) : (
                    <span style={{ fontSize:"13px", color: f.editable ? C.text : C.muted }}>{f.value}</span>
                  )}
                </div>
              ))}
              {editingProfile && (
                <button onClick={() => { setEditingProfile(false); showToast("Profile updated"); }}
                  style={{ marginTop:"12px", background:`rgba(196,146,42,0.1)`,
                    border:`1px solid ${C.gold}44`, color:C.gold, borderRadius:"6px",
                    padding:"9px 20px", fontSize:"12px", cursor:"pointer",
                    letterSpacing:"0.08em", ...mono }}>
                  ↑ SAVE PROFILE
                </button>
              )}
            </div>

            {/* Alert preferences */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ marginBottom:"14px" }}><SL>Alert Preferences</SL></div>
              {[
                { label:"Faraday Intelligent Alert", desc:"Daily dispatch · top signals across all domains", active:true },
                { label:"Theme Alerts",              desc:"When new signals match your followed Themes · Core+", active:true  },
                { label:"Sub-Domain Alerts",         desc:"Granular alerts within your followed Sub-Domains · Core+", active:false },
                { label:"Prediction Resolutions",    desc:"When your submitted predictions are resolved", active:true  },
                { label:"MW Balance Warnings",       desc:"Alert when balance drops below 20%", active:true  },
              ].map(a => (
                <div key={a.label} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize:"13px", color:C.text, marginBottom:"2px" }}>{a.label}</div>
                    <div style={{ fontSize:"11px", color:C.muted }}>{a.desc}</div>
                  </div>
                  <div style={{ width:"32px", height:"18px", borderRadius:"9px",
                    background: a.active ? `${C.gold}33` : "rgba(255,255,255,0.06)",
                    border: `1px solid ${a.active ? C.gold : C.border}`,
                    position:"relative", cursor:"pointer", flexShrink:0 }}>
                    <div style={{ position:"absolute", top:"2px",
                      left: a.active ? "14px" : "2px",
                      width:"12px", height:"12px", borderRadius:"50%",
                      background: a.active ? C.gold : C.dim,
                      transition:"left 0.2s ease" }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Subscription */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"8px", padding:"20px" }}>
              <div style={{ marginBottom:"14px" }}><SL>Subscription</SL></div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                background:tierBg, border:`1px solid ${tierC}33`, borderRadius:"6px", padding:"14px 16px",
                marginBottom:"12px" }}>
                <div>
                  <div style={{ fontSize:"16px", fontWeight:600, color:tierC, ...sans }}>{profile.tier}</div>
                  <div style={{ fontSize:"11px", color:C.muted, marginTop:"2px" }}>
                    {allotment} MW / month · Theme following · Sub-Domain filtering
                  </div>
                </div>
                <span style={{ fontSize:"18px", color:tierC }}>✦</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
                <button style={{
                  background:"rgba(167,139,250,0.08)", border:"1px solid rgba(167,139,250,0.25)",
                  color:C.violet, borderRadius:"6px", padding:"10px", fontSize:"12px",
                  cursor:"pointer", letterSpacing:"0.08em", ...mono }}>
                  ↑ UPGRADE TO PREMIER
                </button>
                <button style={{
                  background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`,
                  color:C.muted, borderRadius:"6px", padding:"10px", fontSize:"12px",
                  cursor:"pointer", letterSpacing:"0.08em", ...mono }}>
                  MANAGE BILLING
                </button>
              </div>
            </div>

          </div>
        )}
      </div>

      <Toast visible={toast.visible} message={toast.msg} />
    </div>
  );
}
