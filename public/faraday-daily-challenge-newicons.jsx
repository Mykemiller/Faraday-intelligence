import { useState, useEffect, useRef, useCallback } from "react";

// ── Brand tokens ──────────────────────────────────────────────────────────────
const C = {
  forest:  "#1C3424",
  forestMid: "#244228",
  gold:    "#C4922A",
  goldLight: "#DAB050",
  cream:   "#EEE6DA",
  white:   "#F8F5F0",
  sage:    "#8CA68A",
  black:   "#141210",
  bg:      "#EEE6DA",       // ← UPDATED: crème background
  surface: "rgba(28,52,36,0.06)",
  border:  "rgba(28,52,36,0.12)",
  green:   "#4ADE80",
  amber:   "#F59E0B",
  red:     "#F87171",
  text:    "#141210",       // ← UPDATED: near-black on crème
  muted:   "#5A5348",
  dim:     "#C8BFB2",
};
const mono  = { fontFamily:"'IBM Plex Mono',monospace" };
const serif = { fontFamily:"'IBM Plex Serif',serif" };
const sans  = { fontFamily:"'Bricolage Grotesque',sans-serif" };

// ── Neon game colors (one per game) ──────────────────────────────────────────
const GAME_COLORS = {
  "Rackl":        { primary:"#00FFC8", secondary:"#00A896", glow:"rgba(0,255,200,0.3)"  },
  "Signal Drop":  { primary:"#FF2D78", secondary:"#FF6FA8", glow:"rgba(255,45,120,0.3)" },
  "The Stack":    { primary:"#FFE600", secondary:"#FFA500", glow:"rgba(255,230,0,0.3)"  },
  "Circuit":      { primary:"#00CFFF", secondary:"#0080FF", glow:"rgba(0,207,255,0.3)"  },
  "The Brief":    { primary:"#B8FF00", secondary:"#7ACC00", glow:"rgba(184,255,0,0.3)"  },
  "Dark Fiber":   { primary:"#BF5FFF", secondary:"#8B2FE0", glow:"rgba(191,95,255,0.3)" },
  "Frequency":    { primary:"#FF6B00", secondary:"#FF3D00", glow:"rgba(255,107,0,0.3)"  },
};

// ── Scoring constants ────────────────────────────────────────────────────────
const BASE_SCORE = 100;
const STREAK_MULTIPLIERS = [
  { days:1,  mult:1.0,  badge:null              },
  { days:7,  mult:1.25, badge:"⚡ Week Warrior"  },
  { days:14, mult:1.5,  badge:"🏆 Fortnight"    },
  { days:30, mult:2.0,  badge:"🌐 Signal Constant" },
];
const SPEED_BONUS_THRESHOLD = 0.5;
const PERFECT_BONUS = 15;
const MW_PER_PUZZLE = 5;
const MW_STREAK_BONUS = 25;

function getStreakMultiplier(streak) {
  for (let i = STREAK_MULTIPLIERS.length - 1; i >= 0; i--) {
    if (streak >= STREAK_MULTIPLIERS[i].days) return STREAK_MULTIPLIERS[i];
  }
  return STREAK_MULTIPLIERS[0];
}

function calcScore({ basePoints, maxPoints, timeElapsed, timeLimit, perfect, streak }) {
  const accuracy = maxPoints > 0 ? (basePoints / maxPoints) : 1;
  let score = Math.round(accuracy * BASE_SCORE);
  if (perfect) score += PERFECT_BONUS;
  if (timeLimit && timeElapsed < timeLimit * SPEED_BONUS_THRESHOLD) score += 10;
  const { mult } = getStreakMultiplier(streak);
  return Math.min(Math.round(score * mult), 150);
}

// ══════════════════════════════════════════════════════════════════════════════
// NEON SVG ICONS — Forest green bg, per-game neon fills, bold shapes
// ══════════════════════════════════════════════════════════════════════════════
const SZ = 80, R = 16;

function IconBase({ gameType, size = SZ, children }) {
  const c = GAME_COLORS[gameType];
  const id = gameType.replace(/[^a-z0-9]/gi, "");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${SZ} ${SZ}`}
      xmlns="http://www.w3.org/2000/svg" style={{ display:"block", flexShrink:0 }}>
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#234530"/>
          <stop offset="100%" stopColor="#1C3424"/>
        </linearGradient>
        <filter id={`glow${id}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <pattern id={`grid${id}`} x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.4"/>
        </pattern>
      </defs>
      <rect width={SZ} height={SZ} rx={R} ry={R} fill={`url(#bg${id})`}/>
      <rect width={SZ} height={SZ} rx={R} ry={R} fill={`url(#grid${id})`}/>
      <ellipse cx={SZ/2} cy={SZ*0.45} rx={30} ry={24} fill={c.glow} style={{filter:"blur(12px)"}}/>
      <g filter={`url(#glow${id})`}>{children}</g>
      <rect width={SZ} height={SZ} rx={R} ry={R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="1"/>
    </svg>
  );
}

function IconRackl({ size }) {
  const c = GAME_COLORS["Rackl"];
  const slots = [c.primary,"#1C3424",c.secondary,"#1C3424",c.primary,c.secondary,"#1C3424",c.primary];
  return (
    <IconBase gameType="Rackl" size={size}>
      <rect x="18" y="14" width="44" height="52" rx="3" fill="rgba(0,0,0,0.4)" stroke={c.primary} strokeWidth="1.2"/>
      {[0,1,2,3].map(row => [0,1].map(col => (
        <rect key={`${row}${col}`} x={21+col*21} y={17+row*12} width="18" height="9" rx="2"
          fill={slots[row*2+col]} opacity={slots[row*2+col]==="#1C3424"?0.25:0.9}/>
      )))}
      <rect x="18" y="63" width="44" height="3" rx="1.5" fill={c.primary} opacity="0.7"/>
    </IconBase>
  );
}

function IconSignalDrop({ size }) {
  const c = GAME_COLORS["Signal Drop"];
  const word = ["B","U","S","B","A","R"];
  return (
    <IconBase gameType="Signal Drop" size={size}>
      {[0,1,2,3].map(row => [0,1,2,3,4,5].map(col => (
        <rect key={`${row}${col}`} x={8+col*11} y={12+row*11} width="9" height="9" rx="1.5"
          fill={row===2?c.primary:"rgba(255,255,255,0.05)"}
          stroke={row===2?c.primary:"rgba(255,255,255,0.12)"} strokeWidth="0.8"
          opacity={row===2?1:(row<2?0.6:0.3)}/>
      )))}
      {word.map((l,i)=>(
        <text key={i} x={12.5+i*11} y={30} fontSize="5" fontWeight="800"
          fontFamily="IBM Plex Mono,monospace" fill="#141210" textAnchor="middle">{l}</text>
      ))}
      <path d="M8,66 Q16,58 24,66 Q32,74 40,66 Q48,58 56,66 Q64,74 72,66"
        fill="none" stroke={c.primary} strokeWidth="2" strokeLinecap="round" opacity="0.9"/>
    </IconBase>
  );
}

function IconTheStack({ size }) {
  const c = GAME_COLORS["The Stack"];
  const blocks = [
    {y:55,w:54,label:"H100",fill:c.secondary,op:1.0},
    {y:43,w:42,label:"B200",fill:c.primary,op:0.95},
    {y:31,w:32,label:"VR",fill:c.primary,op:0.8},
    {y:19,w:22,label:"FN",fill:c.secondary,op:0.65},
  ];
  return (
    <IconBase gameType="The Stack" size={size}>
      {blocks.map((b,i)=>(
        <g key={i}>
          <rect x={(SZ-b.w)/2} y={b.y} width={b.w} height="9" rx="2"
            fill={b.fill} opacity={b.op}/>
          <text x={SZ/2} y={b.y+6.5} fontSize="5" fontWeight="700"
            fontFamily="IBM Plex Mono,monospace" fill="#141210" textAnchor="middle" opacity={b.op}>{b.label}</text>
        </g>
      ))}
      <path d="M40,14 L40,8 M37,11 L40,7 L43,11"
        fill="none" stroke={c.primary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </IconBase>
  );
}

function IconCircuit({ size }) {
  const c = GAME_COLORS["Circuit"];
  return (
    <IconBase gameType="Circuit" size={size}>
      <circle cx="40" cy="16" r="6" fill={c.primary} opacity="0.9"/>
      <text x="40" y="19" fontSize="6" fontWeight="800" fontFamily="IBM Plex Mono,monospace"
        fill="#141210" textAnchor="middle">?</text>
      <path d="M40,22 L40,32" stroke={c.primary} strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M40,32 L22,42" stroke={c.primary} strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
      <path d="M40,32 L58,42" stroke={c.primary} strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
      <rect x="10" y="42" width="24" height="12" rx="3" fill="rgba(0,207,255,0.2)" stroke={c.primary} strokeWidth="1.2"/>
      <text x="22" y="51" fontSize="5.5" fontWeight="800" fontFamily="IBM Plex Mono,monospace"
        fill={c.primary} textAnchor="middle">TRUE</text>
      <rect x="46" y="42" width="24" height="12" rx="3" fill="rgba(255,45,120,0.15)" stroke="#FF2D78" strokeWidth="1.2"/>
      <text x="58" y="51" fontSize="5.5" fontWeight="800" fontFamily="IBM Plex Mono,monospace"
        fill="#FF6FA8" textAnchor="middle">FALSE</text>
      <path d="M28,66 A12,12 0 0 1 52,66" fill="none" stroke={c.secondary} strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
      <text x="40" y="72" fontSize="6" fontWeight="700" fontFamily="IBM Plex Mono,monospace"
        fill={c.primary} textAnchor="middle">60s</text>
    </IconBase>
  );
}

function IconTheBrief({ size }) {
  const c = GAME_COLORS["The Brief"];
  return (
    <IconBase gameType="The Brief" size={size}>
      <rect x="16" y="12" width="48" height="57" rx="4" fill="rgba(0,0,0,0.35)" stroke={c.primary} strokeWidth="1.2"/>
      <path d="M50,12 L64,26 L50,26 Z" fill={c.secondary} opacity="0.45"/>
      <path d="M50,12 L64,12 L64,26" fill="none" stroke={c.primary} strokeWidth="0.8"/>
      {[21,30,39,48,57].map((y,i)=>(
        <rect key={i} x="20" y={y} width={i===2?36:(i===4?22:30)} height="3" rx="1.5"
          fill={i===2?c.primary:"rgba(255,255,255,0.18)"} opacity={i===2?0.9:0.5}/>
      ))}
      <rect x="16" y="50" width="48" height="6" rx="0" fill={c.primary} opacity="0.07"/>
      <line x1="16" y1="53" x2="64" y2="53" stroke={c.primary} strokeWidth="0.8" opacity="0.5"/>
      {[0,1,2,3].map(i=>(
        <circle key={i} cx={24+i*11} cy="63" r={i===1?4:2.5}
          fill={i===1?c.primary:"rgba(255,255,255,0.12)"}
          stroke={i===1?"none":"rgba(255,255,255,0.18)"} strokeWidth="0.8"/>
      ))}
    </IconBase>
  );
}

function IconDarkFiber({ size }) {
  const c = GAME_COLORS["Dark Fiber"];
  const terms = [16,28,40,52];
  const defs  = [22,38,52];
  return (
    <IconBase gameType="Dark Fiber" size={size}>
      {terms.map((y,i)=>(
        <g key={i}>
          <rect x="8" y={y-4} width="24" height="8" rx="2"
            fill={i===1?c.primary:"rgba(191,95,255,0.18)"}
            stroke={c.primary} strokeWidth="0.8" opacity={i===1?1:0.55}/>
          <text x="20" y={y+3} fontSize="4.5" fontWeight="700" fontFamily="IBM Plex Mono,monospace"
            fill={i===1?"#141210":c.primary} textAnchor="middle" opacity={i===1?1:0.65}>
            {["BUS","CDU","PUE","WUE"][i]}
          </text>
        </g>
      ))}
      {defs.map((y,i)=>(
        <rect key={i} x="48" y={y-5} width="24" height="10" rx="2"
          fill={i===2?"rgba(191,95,255,0.3)":"rgba(191,95,255,0.1)"}
          stroke={c.secondary} strokeWidth="0.8" opacity="0.65"/>
      ))}
      {[[0,0],[1,2],[2,1],[3,2]].map(([ti,di],i)=>{
        const x1=32,y1=terms[ti],x2=48,y2=defs[di],mid=(x1+x2)/2,active=ti===1;
        return (
          <path key={i} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
            fill="none" stroke={active?c.primary:c.secondary}
            strokeWidth={active?1.8:0.8} opacity={active?0.9:0.25}
            strokeDasharray={active?"none":"3,2"}/>
        );
      })}
      {terms.map((y,i)=>(
        <circle key={i} cx="32" cy={y} r="2" fill={i===1?c.primary:c.secondary} opacity={i===1?1:0.45}/>
      ))}
      {defs.map((y,i)=>(
        <circle key={i} cx="48" cy={y} r="2" fill={c.secondary} opacity="0.5"/>
      ))}
    </IconBase>
  );
}

function IconFrequency({ size }) {
  const c = GAME_COLORS["Frequency"];
  const wave = () => {
    const pts=[];
    for(let x=10;x<=70;x+=2){const t=(x-10)/60;const y=44+Math.sin(t*Math.PI*4)*(12*(1-t*0.3));pts.push(`${x},${y.toFixed(1)}`);}
    return "M"+pts.join(" L");
  };
  return (
    <IconBase gameType="Frequency" size={size}>
      {[30,38,46,54].map(y=>(
        <line key={y} x1="10" y1={y} x2="70" y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="0.8"/>
      ))}
      <path d={`${wave()} L70,62 L10,62 Z`} fill={c.primary} opacity="0.07"/>
      <path d={wave()} fill="none" stroke={c.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="48" y1="20" x2="48" y2="62" stroke={c.secondary} strokeWidth="1.2" opacity="0.6" strokeDasharray="2,2"/>
      {[0,1,2,3].map(i=>(
        <g key={i}>
          <circle cx={18+i*15} cy="72" r={i===2?3.5:2.5}
            fill={i===2?c.primary:"rgba(255,107,0,0.18)"}
            stroke={c.primary} strokeWidth={i===2?0:0.8} opacity={i===2?1:0.55}/>
        </g>
      ))}
    </IconBase>
  );
}

const GAME_ICONS = {
  "Rackl":       IconRackl,
  "Signal Drop": IconSignalDrop,
  "The Stack":   IconTheStack,
  "Circuit":     IconCircuit,
  "The Brief":   IconTheBrief,
  "Dark Fiber":  IconDarkFiber,
  "Frequency":   IconFrequency,
};

// ── Mock puzzle data ──────────────────────────────────────────────────────────
const PUZZLE_DATA = {
  Rackl: {
    name: "The Power Stack",
    domain: "Power Architecture",
    groups: [
      { label:"800V DC Transition",   color:"#1C3424", textColor:"#EEE6DA", items:["Bus bar", "DC-DC converter", "Power shelf", "OCP ORW"] },
      { label:"Grid Access",          color:"#C4922A", textColor:"#141210", items:["Interconnect queue", "FERC Order", "Large-load study", "ISO/RTO"] },
      { label:"BTM Generation",       color:"#2A5A3A", textColor:"#EEE6DA", items:["SMR offtake", "Gas peaker", "Solar+storage", "BYOG contract"] },
      { label:"Cooling Architecture", color:"#5A4010", textColor:"#EEE6DA", items:["CDU", "Cold plate", "WUE", "Rear-door HX"] },
    ],
  },
  "Signal Drop": {
    name: "BUSBAR",
    domain: "Power Architecture",
    word: "BUSBAR",
    clue: "A rigid conductor distributing electrical power within a switchgear panel or power distribution unit",
    hint1: "Found in every data center switchroom",
    hint2: "Copper or aluminum, never flexible",
  },
  "The Stack": {
    name: "Rank GPU Generations: Hopper → Blackwell → Vera Rubin → Feynman",
    domain: "Chips & Density",
    items: ["H100 (Hopper)", "B200 (Blackwell)", "GB300 (Vera Rubin NVL72)", "Feynman (2028)"],
    correctOrder: [0, 1, 2, 3],
    metric: "TDP per chip (watts) — lowest to highest",
    values: ["700W", "1000W", "1200W", "~1500W est."],
  },
  Circuit: {
    name: "Power Architecture True/False Sprint #1",
    domain: "Power Architecture",
    timeLimit: 60,
    questions: [
      { q:"The 800V DC transition eliminates the need for per-rack UPS units.", a:true,  explanation:"800V DC-native racks eliminate per-rack AC/DC conversion and UPS stages, moving protection upstream." },
      { q:"NFPA 70 currently has complete code coverage for 800V DC data center distribution.", a:false, explanation:"NFPA 70 has significant gaps for 800V DC. The code framework is still catching up to the transition." },
      { q:"Behind-the-meter generation bypasses the ISO/RTO interconnection queue.", a:true,  explanation:"BTM generation connects directly to the facility, not to the grid — avoiding queue requirements entirely." },
      { q:"PJM's interconnection queue average wait time is currently under 2 years.", a:false, explanation:"PJM average queue wait exceeds 5 years as of 2026, driven by unprecedented large-load applications." },
      { q:"A CDU (Coolant Distribution Unit) is required for direct-to-chip liquid cooling.", a:true,  explanation:"The CDU is the central heat exchanger that manages facility-side coolant distribution to server-side cold plates." },
      { q:"WUE measures watts used per watt of IT load.", a:false, explanation:"WUE (Water Usage Effectiveness) measures liters of water per kWh of IT load — it's a water metric, not power." },
    ],
  },
  "The Brief": {
    name: "The 800V DC Transition",
    domain: "Power Architecture",
    readTime: 90,
    brief: `The AI data center industry is undergoing its most significant power architecture change in a generation: the shift from 415V AC to 800V DC distribution at the rack level.\n\nLegacy data centers distribute power as alternating current (AC) at 415V (or 480V in the US), which requires multiple conversion stages — transformer to switchgear to UPS to PDU — before reaching the server. Each conversion wastes energy and adds failure points.\n\n800V DC distribution eliminates three of those conversions. Power enters the facility as AC, converts once to 800V DC, and distributes directly to rack-level power shelves. GPU-native DC-DC converters inside the rack handle the final step. The result: higher efficiency, lower cooling burden on the power chain, and smaller copper footprint.\n\nEaton, Vertiv, and Schneider Electric are all acquiring capabilities in this space. OCP's Open Rack Wide (ORW) specification formalizes the 800V DC rack interface. NVIDIA's NVLink architecture is designed around DC-native power delivery.\n\nThe constraint: NFPA 70 (the National Electrical Code) does not yet have complete guidance for 800V DC in occupied buildings. Until the code catches up, facilities must navigate a patchwork of Authority Having Jurisdiction (AHJ) interpretations. Greenfield campuses are building to 800V DC today. Retrofits are operationally complex and expensive.`,
    questions: [
      { q:"What is the primary efficiency advantage of 800V DC distribution?", options:["Higher voltage means less heat","Fewer AC/DC conversion stages in the power chain","Copper wire is cheaper at 800V","UPS systems are not required"], correct:1, explanation:"800V DC eliminates multiple conversion stages, each of which wastes energy. Fewer conversions = higher round-trip efficiency." },
      { q:"What is the current primary constraint on 800V DC adoption in existing facilities?", options:["Cost of copper busbars","NFPA 70 code gap for 800V DC in occupied buildings","GPU incompatibility","Utility resistance to DC loads"], correct:1, explanation:"NFPA 70 lacks complete code guidance for 800V DC, forcing facilities to work with local AHJ interpretations." },
      { q:"Which of the following companies is NOT mentioned as acquiring capabilities in 800V DC infrastructure?", options:["Eaton","Vertiv","Schneider Electric","Siemens"], correct:3, explanation:"The brief mentions Eaton, Vertiv, and Schneider Electric. Siemens was not cited in this specific brief." },
    ],
  },
  "Dark Fiber": {
    name: "Power Architecture Terms #1",
    domain: "Power Architecture",
    pairs: [
      { term:"BUSBAR",      def:"A rigid conductor — copper or aluminum — that distributes electrical power within switchgear, bus ducts, or PDUs at high current with minimal loss" },
      { term:"CDU",         def:"Coolant Distribution Unit — the rack-side heat exchanger that circulates chilled facility water to server-side cold plates in a direct liquid cooling loop" },
      { term:"PUE",         def:"Power Usage Effectiveness — total facility power divided by IT load power; a score of 1.0 is perfect; real-world AI facilities target 1.2–1.4" },
      { term:"SWITCHGEAR",  def:"The assembly of circuit breakers, disconnects, and protective devices that controls and protects the electrical distribution system in a facility" },
      { term:"WUE",         def:"Water Usage Effectiveness — liters of water consumed per kWh of IT load; the cooling equivalent of PUE; world-class target is below 0.5L/kWh" },
      { term:"INTERCONNECT",def:"The physical and contractual connection between a generation asset or large load and the ISO/RTO transmission grid; acquiring a queue position takes years" },
    ],
  },
  Frequency: {
    name: "Power Architecture Quiz #1",
    domain: "Power Architecture",
    questions: [
      { q:"What does the acronym 'BYOG' stand for in data center power strategy?", options:["Build Your Own Grid","Bring Your Own Generation","Bypass Your Operator Grid","Backup Your Own Generator"], correct:1, explanation:"BYOG (Bring Your Own Generation) refers to operators developing or contracting dedicated generation assets — nuclear, gas, solar — rather than relying solely on grid power." },
      { q:"Which ISO/RTO has the largest interconnection queue backlog in North America as of 2026?", options:["ERCOT","CAISO","PJM","MISO"], correct:2, explanation:"PJM (covering the Mid-Atlantic and Midwest) has the largest backlog, with average queue wait times exceeding 5 years driven by AI data center demand in Northern Virginia and Ohio." },
      { q:"At what voltage does the emerging DC power distribution standard for high-density AI racks operate?", options:["48V DC","240V DC","415V DC","800V DC"], correct:3, explanation:"800V DC is the emerging standard for high-density rack distribution, supported by OCP's Open Rack Wide (ORW) spec and NVIDIA's NVLink power architecture." },
      { q:"What does 'entitlement' mean in data center site selection?", options:["Tax incentive approval","Utility interconnection agreement","Zoning and permitting approval for the intended use","Grid capacity allocation"], correct:2, explanation:"Entitlement refers to the regulatory and zoning approvals that permit the intended development. Entitled land with a grid queue position is categorically more valuable than unentitled land." },
    ],
  },
};

// ── Shared components ─────────────────────────────────────────────────────────
function SL({ children, color }) {
  return <span style={{ fontSize:"10px", letterSpacing:"0.14em", color:color||C.muted, textTransform:"uppercase", ...mono }}>{children}</span>;
}

function Btn({ children, onClick, disabled, variant="primary", small }) {
  const styles = {
    primary: { background:`rgba(196,146,42,0.1)`, border:`1px solid rgba(196,146,42,0.4)`, color:C.gold },
    ghost:   { background:`rgba(28,52,36,0.05)`, border:`1px solid ${C.border}`, color:C.muted },
    success: { background:`rgba(74,222,128,0.1)`, border:`1px solid rgba(74,222,128,0.3)`, color:C.green },
    danger:  { background:`rgba(248,113,113,0.1)`, border:`1px solid rgba(248,113,113,0.3)`, color:C.red },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], borderRadius:"6px",
      padding: small?"6px 14px":"10px 20px",
      fontSize: small?"10px":"11px",
      cursor: disabled?"not-allowed":"pointer",
      opacity: disabled?0.5:1,
      letterSpacing:"0.08em", transition:"all 0.15s", ...mono,
    }}>{children}</button>
  );
}

function ProgressBar({ value, max, color }) {
  return (
    <div style={{ height:"3px", background:"rgba(28,52,36,0.1)", borderRadius:"2px", overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${(value/max)*100}%`, background:color||C.gold,
        borderRadius:"2px", transition:"width 0.3s ease" }}/>
    </div>
  );
}

// ── Score display ─────────────────────────────────────────────────────────────
function ScoreCard({ score, puzzleType, domain, streak, mwEarned, onShare, onNext, isNew7Day }) {
  const emoji = score >= 130?"🔥":score>=100?"⚡":score>=75?"✦":"◎";
  return (
    <div style={{ textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:"20px" }}>
      <div style={{ fontSize:"48px" }}>{emoji}</div>
      <div>
        <div style={{ fontSize:"48px", fontWeight:800, color:C.gold, letterSpacing:"-0.04em", ...sans }}>{score}</div>
        <div style={{ fontSize:"11px", color:C.muted, marginTop:"4px", ...mono }}>points · {puzzleType}</div>
      </div>
      <div style={{ background:`rgba(196,146,42,0.06)`, border:`1px solid rgba(196,146,42,0.2)`,
        borderRadius:"8px", padding:"12px 20px", display:"flex", gap:"24px" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:"16px", fontWeight:700, color:C.gold, ...sans }}>{streak}</div>
          <div style={{ fontSize:"9px", color:C.muted, ...mono }}>day streak</div>
        </div>
        <div style={{ width:"1px", background:C.border }}/>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:"16px", fontWeight:700, color:C.green, ...sans }}>+{mwEarned}</div>
          <div style={{ fontSize:"9px", color:C.muted, ...mono }}>MW earned</div>
        </div>
      </div>
      {isNew7Day && (
        <div style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.3)",
          borderRadius:"6px", padding:"10px 16px", fontSize:"11px", color:C.amber, ...mono }}>
          ⚡ Week Warrior — 7-day streak! +{MW_STREAK_BONUS} bonus MW
        </div>
      )}
      <div style={{ display:"flex", gap:"10px" }}>
        <Btn onClick={onShare} variant="ghost" small>↑ Share Result</Btn>
        <Btn onClick={onNext}>Play Another →</Btn>
      </div>
      <div style={{ fontSize:"9px", color:C.dim, ...mono }}>
        Score includes {getStreakMultiplier(streak).mult}× streak multiplier
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: RACKL
// ══════════════════════════════════════════════════════════════════════════════
function GameRackl({ puzzle, streak, onComplete }) {
  const allItems = puzzle.groups.flatMap((g,gi)=>g.items.map((item,i)=>({item,groupIdx:gi,id:`${gi}-${i}`})));
  const [tiles,setTiles]=useState(()=>[...allItems].sort(()=>Math.random()-0.5));
  const [selected,setSelected]=useState([]);
  const [solved,setSolved]=useState([]);
  const [mistakes,setMistakes]=useState(0);
  const [feedback,setFeedback]=useState(null);
  const [done,setDone]=useState(false);
  const [scoreVal,setScoreVal]=useState(null);
  const startTime=useRef(Date.now());

  function toggle(id){if(solved.includes(id))return;setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):prev.length<4?[...prev,id]:prev);}
  function submit(){
    if(selected.length!==4)return;
    const groups=selected.map(id=>tiles.find(t=>t.id===id).groupIdx);
    if(groups.every(g=>g===groups[0])){
      const newSolved=[...solved,...selected];
      setSolved(newSolved);setSelected([]);
      setFeedback({type:"correct",label:puzzle.groups[groups[0]].label});
      setTimeout(()=>setFeedback(null),1500);
      if(newSolved.length===16){const elapsed=(Date.now()-startTime.current)/1000;const s=calcScore({basePoints:16,maxPoints:16,timeElapsed:elapsed,timeLimit:180,perfect:mistakes===0,streak});setScoreVal(s);setDone(true);}
    } else {
      setMistakes(m=>m+1);setFeedback({type:"wrong"});setSelected([]);
      setTimeout(()=>setFeedback(null),800);
    }
  }

  if(done)return<ScoreCard score={scoreVal} puzzleType="Rackl" domain={puzzle.domain}
    streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)} isNew7Day={streak===7}/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {puzzle.groups.filter((_,gi)=>solved.some(id=>tiles.find(t=>t.id===id)?.groupIdx===gi)).map((g,gi)=>(
        <div key={gi} style={{background:g.color,borderRadius:"8px",padding:"12px 16px",display:"flex",alignItems:"center",gap:"12px"}}>
          <span style={{fontSize:"11px",fontWeight:700,color:g.textColor,letterSpacing:"0.06em",...mono}}>{g.label}</span>
          <span style={{fontSize:"10px",color:g.textColor,opacity:0.7,...mono}}>{g.items.join(" · ")}</span>
        </div>
      ))}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px"}}>
        {tiles.filter(t=>!solved.includes(t.id)).map(t=>{
          const isSel=selected.includes(t.id);
          return(
            <button key={t.id} onClick={()=>toggle(t.id)} style={{
              background:isSel?"rgba(196,146,42,0.15)":C.white,
              border:`2px solid ${isSel?C.gold:"rgba(28,52,36,0.15)"}`,
              borderRadius:"8px",padding:"14px 8px",cursor:"pointer",transition:"all 0.12s",
              transform:isSel?"translateY(-2px)":"none",
              boxShadow:isSel?`0 4px 12px rgba(196,146,42,0.2)`:"none",
            }}>
              <span style={{fontSize:"11px",fontWeight:600,color:isSel?C.gold:C.black,lineHeight:1.3,textAlign:"center",display:"block",...sans}}>{t.item}</span>
            </button>
          );
        })}
      </div>
      {feedback&&(
        <div style={{textAlign:"center",fontSize:"11px",...mono,
          color:feedback.type==="correct"?C.green:C.red,
          background:feedback.type==="correct"?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)",
          border:`1px solid ${feedback.type==="correct"?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.3)"}`,
          borderRadius:"6px",padding:"8px"}}>
          {feedback.type==="correct"?`✓ ${feedback.label}`:"✗ Not quite — try again"}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",gap:"6px"}}>
          {[...Array(4)].map((_,i)=>(
            <div key={i} style={{width:"10px",height:"10px",borderRadius:"50%",background:i<mistakes?C.red:C.dim}}/>
          ))}
          <span style={{fontSize:"9px",color:C.muted,marginLeft:"6px",...mono}}>{mistakes} mistakes</span>
        </div>
        <Btn onClick={submit} disabled={selected.length!==4}>Submit {selected.length}/4</Btn>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: SIGNAL DROP
// ══════════════════════════════════════════════════════════════════════════════
function GameSignalDrop({ puzzle, streak, onComplete }) {
  const word=puzzle.word.toUpperCase();
  const [guesses,setGuesses]=useState([]);
  const [current,setCurrent]=useState("");
  const [won,setWon]=useState(false);
  const [lost,setLost]=useState(false);
  const [scoreVal,setScoreVal]=useState(null);
  const [hint,setHint]=useState(0);
  const [lexiconDef,setLexiconDef]=useState(null);
  const [lexiconLoading,setLexiconLoading]=useState(false);
  const maxGuesses=6;
  const startTime=useRef(Date.now());

  // Lexicon Definition Drop — 4th hint tier (2 tokens)
  // Fetches the Lexicon entry for the puzzle answer from /api/lexicon
  async function fetchLexiconDefinition(){
    if(lexiconDef||lexiconLoading)return;
    setLexiconLoading(true);
    try{
      const res=await fetch(`/api/lexicon?term=${encodeURIComponent(word)}`);
      const data=await res.json();
      setLexiconDef(data.definition||"Definition not found in Lexicon.");
    }catch(e){
      setLexiconDef("Lexicon lookup failed. Try again shortly.");
    }finally{
      setLexiconLoading(false);
    }
  }

  function addLetter(l){if(current.length<word.length&&!won&&!lost)setCurrent(c=>c+l);}
  function removeLetter(){setCurrent(c=>c.slice(0,-1));}
  function submitGuess(){
    if(current.length!==word.length)return;
    const newGuesses=[...guesses,current];setGuesses(newGuesses);setCurrent("");
    if(current===word){setWon(true);const elapsed=(Date.now()-startTime.current)/1000;const s=calcScore({basePoints:Math.max(0,maxGuesses-newGuesses.length+1),maxPoints:maxGuesses,timeElapsed:elapsed,timeLimit:300,perfect:newGuesses.length===1,streak});setScoreVal(s);}
    else if(newGuesses.length>=maxGuesses){setLost(true);setScoreVal(10);}
  }

  function getTileState(ri,ci){const guess=guesses[ri];if(!guess)return"empty";const l=guess[ci];if(l===word[ci])return"correct";if(word.includes(l))return"present";return"absent";}

  const tileColors={correct:C.forest,present:"#5A4010",absent:"rgba(28,52,36,0.15)",empty:"rgba(28,52,36,0.05)"};
  const tileText={correct:C.green,present:C.amber,absent:C.muted,empty:C.dim};

  if(won||lost)return<ScoreCard score={scoreVal} puzzleType="Signal Drop" domain={puzzle.domain}
    streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)} isNew7Day={streak===7}/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px",alignItems:"center"}}>
      <div style={{fontSize:"10px",color:C.muted,textAlign:"center",lineHeight:1.6,...mono,maxWidth:"360px"}}>
        {puzzle.clue}
        {hint>0&&<div style={{color:C.amber,marginTop:"4px"}}>Hint: {puzzle.hint1}</div>}
        {hint>1&&<div style={{color:C.amber}}>Hint 2: {puzzle.hint2}</div>}
        {lexiconDef&&<div style={{color:C.green,marginTop:"8px",padding:"8px",background:"rgba(28,52,36,0.04)",borderLeft:`2px solid ${C.green}`,textAlign:"left",lineHeight:1.5}}>
          <div style={{fontSize:"9px",textTransform:"uppercase",letterSpacing:"0.1em",color:C.muted,marginBottom:"4px"}}>📖 Lexicon Definition</div>
          {lexiconDef}
        </div>}
        {lexiconLoading&&<div style={{color:C.muted,marginTop:"6px",fontSize:"10px"}}>Loading Lexicon…</div>}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
        {[...Array(maxGuesses)].map((_,ri)=>{
          const guess=guesses[ri]||(ri===guesses.length?current:"");
          return(
            <div key={ri} style={{display:"flex",gap:"4px"}}>
              {[...Array(word.length)].map((_,ci)=>{
                const state=ri<guesses.length?getTileState(ri,ci):(guess[ci]?"current":"empty");
                return(
                  <div key={ci} style={{width:"44px",height:"44px",borderRadius:"4px",
                    background:state==="current"?"rgba(28,52,36,0.08)":tileColors[state]||tileColors.empty,
                    border:`2px solid ${state==="current"?C.border:(state==="empty"?C.dim:"transparent")}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:"16px",fontWeight:700,color:state==="current"?C.text:(tileText[state]||C.muted),
                    transition:"all 0.2s",...mono}}>
                    {guess[ci]||""}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"5px",alignItems:"center"}}>
        {[["Q","W","E","R","T","Y","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["ENTER","Z","X","C","V","B","N","M","⌫"]].map((row,ri)=>(
          <div key={ri} style={{display:"flex",gap:"4px"}}>
            {row.map(key=>{
              const isCorrect=guesses.some((g,gi)=>g.split("").some((l,ci)=>l===key&&word[ci]===key));
              const isPresent=!isCorrect&&guesses.some(g=>g.includes(key)&&word.includes(key));
              const used=guesses.some(g=>g.includes(key));
              return(
                <button key={key} onClick={()=>{if(key==="ENTER")submitGuess();else if(key==="⌫")removeLetter();else addLetter(key);}} style={{
                  background:isCorrect?C.forest:isPresent?"#5A4010":used?"rgba(28,52,36,0.15)":"rgba(28,52,36,0.08)",
                  border:"none",borderRadius:"4px",width:key.length>1?"52px":"32px",height:"40px",
                  color:isCorrect?C.green:isPresent?C.amber:C.text,
                  fontSize:"11px",cursor:"pointer",fontWeight:600,...mono}}>{key}</button>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
        {hint<2&&<Btn onClick={()=>setHint(h=>h+1)} variant="ghost" small>💡 Hint ({2-hint} left)</Btn>}
        {!lexiconDef&&<Btn onClick={fetchLexiconDefinition} variant="ghost" small>📖 Lexicon Drop (2 tokens)</Btn>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: THE STACK
// ══════════════════════════════════════════════════════════════════════════════
function GameStack({ puzzle, streak, onComplete }) {
  const [order,setOrder]=useState(()=>[...puzzle.items.map((_,i)=>i)].sort(()=>Math.random()-0.5));
  const [dragging,setDragging]=useState(null);
  const [submitted,setSubmitted]=useState(false);
  const [scoreVal,setScoreVal]=useState(null);
  const startTime=useRef(Date.now());

  function dragStart(idx){setDragging(idx);}
  function dragOver(e,idx){e.preventDefault();if(dragging===null||dragging===idx)return;const n=[...order];const item=n.splice(dragging,1)[0];n.splice(idx,0,item);setOrder(n);setDragging(idx);}
  function dragEnd(){setDragging(null);}
  function submit(){
    const correct=order.filter((item,idx)=>puzzle.correctOrder.indexOf(item)===idx).length;
    const s=calcScore({basePoints:correct,maxPoints:order.length,timeElapsed:(Date.now()-startTime.current)/1000,timeLimit:120,perfect:correct===order.length,streak});
    setScoreVal(s);setSubmitted(true);
  }

  if(submitted)return(
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {order.map((itemIdx,rankIdx)=>{
        const correctRank=puzzle.correctOrder.indexOf(itemIdx);const isCorrect=correctRank===rankIdx;
        return(
          <div key={itemIdx} style={{background:isCorrect?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.06)",border:`1px solid ${isCorrect?"rgba(74,222,128,0.3)":"rgba(248,113,113,0.2)"}`,borderRadius:"8px",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",gap:"12px",alignItems:"center"}}>
              <span style={{fontSize:"10px",color:isCorrect?C.green:C.red,...mono}}>#{rankIdx+1}</span>
              <span style={{fontSize:"12px",color:C.text}}>{puzzle.items[itemIdx]}</span>
            </div>
            <div style={{textAlign:"right"}}>
              <span style={{fontSize:"10px",color:C.muted,...mono}}>{puzzle.values?.[correctRank]||""}</span>
              {!isCorrect&&<div style={{fontSize:"9px",color:C.red,...mono}}>Correct: #{correctRank+1}</div>}
            </div>
          </div>
        );
      })}
      <div style={{fontSize:"10px",color:C.muted,...mono,textAlign:"center"}}>Ranking by: {puzzle.metric}</div>
      <ScoreCard score={scoreVal} puzzleType="The Stack" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)} isNew7Day={streak===7}/>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <div style={{fontSize:"10px",color:C.muted,textAlign:"center",...mono}}>{puzzle.metric} — drag to reorder</div>
      {order.map((itemIdx,rankIdx)=>(
        <div key={itemIdx} draggable onDragStart={()=>dragStart(rankIdx)} onDragOver={(e)=>dragOver(e,rankIdx)} onDragEnd={dragEnd}
          style={{background:dragging===rankIdx?"rgba(196,146,42,0.08)":C.white,border:`1px solid ${dragging===rankIdx?C.gold:C.border}`,borderRadius:"8px",padding:"14px 16px",display:"flex",alignItems:"center",gap:"14px",cursor:"grab",transition:"all 0.1s",transform:dragging===rankIdx?"scale(1.02)":"none"}}>
          <span style={{fontSize:"16px",color:C.dim,userSelect:"none"}}>⠿</span>
          <span style={{fontSize:"14px",color:C.text,flex:1,...sans}}>{puzzle.items[itemIdx]}</span>
          <span style={{fontSize:"10px",color:C.muted,...mono}}>#{rankIdx+1}</span>
        </div>
      ))}
      <div style={{marginTop:"8px"}}><Btn onClick={submit}>Lock In Ranking →</Btn></div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: CIRCUIT
// ══════════════════════════════════════════════════════════════════════════════
function GameCircuit({ puzzle, streak, onComplete }) {
  const [qIdx,setQIdx]=useState(0);
  const [answers,setAnswers]=useState([]);
  const [timeLeft,setTimeLeft]=useState(puzzle.timeLimit);
  const [done,setDone]=useState(false);
  const [scoreVal,setScoreVal]=useState(null);
  const [lastFeedback,setLastFeedback]=useState(null);
  const startTime=useRef(Date.now());

  useEffect(()=>{
    if(done)return;
    const t=setInterval(()=>setTimeLeft(prev=>{if(prev<=1){clearInterval(t);finish(answers);return 0;}return prev-1;}),1000);
    return()=>clearInterval(t);
  },[done,answers]);

  function answer(val){
    const q=puzzle.questions[qIdx];const ok=(val===q.a);
    const newAnswers=[...answers,{q:q.q,given:val,correct:q.a,ok,explanation:q.explanation}];
    setLastFeedback(ok);
    setTimeout(()=>{setLastFeedback(null);if(qIdx+1>=puzzle.questions.length)finish(newAnswers);else{setQIdx(i=>i+1);setAnswers(newAnswers);}},600);
  }

  function finish(finalAnswers){
    setDone(true);const correct=finalAnswers.filter(a=>a.ok).length;
    const s=calcScore({basePoints:correct,maxPoints:puzzle.questions.length,timeElapsed:(Date.now()-startTime.current)/1000,timeLimit:puzzle.timeLimit,perfect:correct===puzzle.questions.length,streak});
    setScoreVal(s);
  }

  if(done&&scoreVal!==null)return(
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      {answers.map((a,i)=>(
        <div key={i} style={{background:a.ok?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)",border:`1px solid ${a.ok?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}`,borderRadius:"8px",padding:"12px 14px"}}>
          <div style={{fontSize:"11px",color:C.text,marginBottom:"4px"}}>{a.q}</div>
          <div style={{fontSize:"9px",color:a.ok?C.green:C.red,...mono}}>{a.ok?"✓ Correct":`✗ You said ${a.given?"TRUE":"FALSE"} · Answer: ${a.correct?"TRUE":"FALSE"}`}</div>
          <div style={{fontSize:"9px",color:C.muted,marginTop:"4px",lineHeight:1.5,...mono}}>{a.explanation}</div>
        </div>
      ))}
      <ScoreCard score={scoreVal} puzzleType="Circuit" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)} isNew7Day={streak===7}/>
    </div>
  );

  const q=puzzle.questions[qIdx];const timePct=(timeLeft/puzzle.timeLimit)*100;const timeColor=timePct>50?C.green:timePct>25?C.amber:C.red;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <SL>{qIdx+1} / {puzzle.questions.length}</SL>
        <span style={{fontSize:"16px",fontWeight:700,color:timeColor,...mono}}>{timeLeft}s</span>
      </div>
      <ProgressBar value={timeLeft} max={puzzle.timeLimit} color={timeColor}/>
      <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"24px",minHeight:"100px",display:"flex",alignItems:"center",justifyContent:"center",transition:"background 0.2s",backgroundColor:lastFeedback===true?"rgba(74,222,128,0.05)":lastFeedback===false?"rgba(248,113,113,0.05)":C.white}}>
        <p style={{fontSize:"15px",color:C.text,textAlign:"center",margin:0,lineHeight:1.6,...sans}}>{q.q}</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
        <button onClick={()=>answer(true)} style={{background:"rgba(74,222,128,0.07)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:"8px",padding:"18px",color:C.green,fontSize:"14px",fontWeight:700,cursor:"pointer",...sans}}>TRUE ✓</button>
        <button onClick={()=>answer(false)} style={{background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.3)",borderRadius:"8px",padding:"18px",color:C.red,fontSize:"14px",fontWeight:700,cursor:"pointer",...sans}}>FALSE ✗</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: THE BRIEF
// ══════════════════════════════════════════════════════════════════════════════
function GameBrief({ puzzle, streak, onComplete }) {
  const [phase,setPhase]=useState("read");
  const [qIdx,setQIdx]=useState(0);
  const [answers,setAnswers]=useState([]);
  const [selected,setSelected]=useState(null);
  const [scoreVal,setScoreVal]=useState(null);
  const [timeLeft,setTimeLeft]=useState(puzzle.readTime);
  const startTime=useRef(Date.now());

  useEffect(()=>{if(phase!=="read")return;const t=setInterval(()=>setTimeLeft(prev=>{if(prev<=0){clearInterval(t);return 0;}return prev-1;}),1000);return()=>clearInterval(t);},[phase]);

  function nextQuestion(){
    const q=puzzle.questions[qIdx];const newAnswers=[...answers,{given:selected,correct:q.correct,ok:selected===q.correct,explanation:q.explanation}];
    setAnswers(newAnswers);setSelected(null);
    if(qIdx+1>=puzzle.questions.length){const correct=newAnswers.filter(a=>a.ok).length;const s=calcScore({basePoints:correct,maxPoints:puzzle.questions.length,timeElapsed:(Date.now()-startTime.current)/1000,timeLimit:300,perfect:correct===puzzle.questions.length,streak});setScoreVal(s);setPhase("done");}
    else setQIdx(i=>i+1);
  }

  if(phase==="done")return(
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      {puzzle.questions.map((q,i)=>(
        <div key={i} style={{background:answers[i]?.ok?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)",border:`1px solid ${answers[i]?.ok?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}`,borderRadius:"8px",padding:"12px 14px"}}>
          <div style={{fontSize:"11px",color:C.text,marginBottom:"6px"}}>{q.q}</div>
          <div style={{fontSize:"10px",color:answers[i]?.ok?C.green:C.red,...mono}}>{answers[i]?.ok?"✓ Correct":`✗ Correct: "${q.options[q.correct]}"`}</div>
          <div style={{fontSize:"9px",color:C.muted,marginTop:"4px",lineHeight:1.5,...mono}}>{q.explanation}</div>
        </div>
      ))}
      <ScoreCard score={scoreVal} puzzleType="The Brief" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)} isNew7Day={streak===7}/>
    </div>
  );

  if(phase==="read")return(
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between"}}><SL>Read the brief</SL><span style={{fontSize:"10px",color:C.muted,...mono}}>{timeLeft}s suggested read time</span></div>
      <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"20px",maxHeight:"320px",overflowY:"auto"}}>
        {puzzle.brief.split("\n\n").map((p,i)=>(
          <p key={i} style={{fontSize:"12px",color:C.text,lineHeight:1.7,marginBottom:"12px",marginTop:0,...sans}}>{p}</p>
        ))}
      </div>
      <Btn onClick={()=>setPhase("quiz")}>Ready — Take the Quiz →</Btn>
    </div>
  );

  const q=puzzle.questions[qIdx];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      <SL>Question {qIdx+1} of {puzzle.questions.length}</SL>
      <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"16px"}}>
        <p style={{fontSize:"13px",color:C.text,margin:0,lineHeight:1.6,...sans}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {q.options.map((opt,i)=>(
          <button key={i} onClick={()=>setSelected(i)} style={{background:selected===i?"rgba(196,146,42,0.08)":C.white,border:`1px solid ${selected===i?C.gold:C.border}`,borderRadius:"6px",padding:"12px 16px",textAlign:"left",cursor:"pointer",fontSize:"12px",color:selected===i?C.gold:C.text,transition:"all 0.12s",...sans}}>
            <span style={{color:C.muted,marginRight:"10px",...mono}}>{String.fromCharCode(65+i)}.</span>{opt}
          </button>
        ))}
      </div>
      <Btn onClick={nextQuestion} disabled={selected===null}>{qIdx+1<puzzle.questions.length?"Next Question →":"Submit Answers →"}</Btn>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: DARK FIBER
// ══════════════════════════════════════════════════════════════════════════════
function GameDarkFiber({ puzzle, streak, onComplete }) {
  const [selectedTerm,setSelectedTerm]=useState(null);
  const [selectedDef,setSelectedDef]=useState(null);
  const [matched,setMatched]=useState([]);
  const [wrong,setWrong]=useState(false);
  const [scoreVal,setScoreVal]=useState(null);
  const [done,setDone]=useState(false);
  const [mistakes,setMistakes]=useState(0);
  const [shuffledDefs]=useState(()=>[...puzzle.pairs].sort(()=>Math.random()-0.5).map(p=>p.term));
  const startTime=useRef(Date.now());

  useEffect(()=>{
    if(!selectedTerm||!selectedDef)return;
    if(selectedTerm===selectedDef){
      const newMatched=[...matched,selectedTerm];setMatched(newMatched);setSelectedTerm(null);setSelectedDef(null);
      if(newMatched.length===puzzle.pairs.length){const s=calcScore({basePoints:puzzle.pairs.length,maxPoints:puzzle.pairs.length,timeElapsed:(Date.now()-startTime.current)/1000,timeLimit:180,perfect:mistakes===0,streak});setScoreVal(s);setDone(true);}
    } else {
      setWrong(true);setMistakes(m=>m+1);
      setTimeout(()=>{setWrong(false);setSelectedTerm(null);setSelectedDef(null);},800);
    }
  },[selectedTerm,selectedDef]);

  if(done)return<ScoreCard score={scoreVal} puzzleType="Dark Fiber" domain={puzzle.domain}
    streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)} isNew7Day={streak===7}/>;

  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
      <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
        <SL color={C.gold}>Terms</SL>
        {puzzle.pairs.map(p=>{
          const isMatched=matched.includes(p.term);const isSel=selectedTerm===p.term;
          return(
            <button key={p.term} onClick={()=>!isMatched&&setSelectedTerm(p.term)} style={{background:isMatched?"rgba(74,222,128,0.07)":isSel?"rgba(196,146,42,0.1)":C.white,border:`1px solid ${isMatched?"rgba(74,222,128,0.3)":isSel?C.gold:C.border}`,borderRadius:"6px",padding:"10px 12px",textAlign:"left",cursor:isMatched?"default":"pointer",color:isMatched?C.green:isSel?C.gold:C.text,fontSize:"11px",fontWeight:600,...mono,transition:"all 0.12s"}}>{p.term}</button>
          );
        })}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
        <SL color={C.sage}>Definitions</SL>
        {shuffledDefs.map(term=>{
          const pair=puzzle.pairs.find(p=>p.term===term);const isMatched=matched.includes(term);const isSel=selectedDef===term;
          return(
            <button key={term} onClick={()=>!isMatched&&setSelectedDef(term)} style={{background:isMatched?"rgba(74,222,128,0.07)":isSel?"rgba(140,166,138,0.1)":C.white,border:`1px solid ${isMatched?"rgba(74,222,128,0.3)":isSel?C.sage:(wrong&&isSel?"rgba(248,113,113,0.4)":C.border)}`,borderRadius:"6px",padding:"10px 12px",textAlign:"left",cursor:isMatched?"default":"pointer",color:isMatched?C.green:isSel?C.sage:C.muted,fontSize:"10px",lineHeight:1.5,...mono,transition:"all 0.12s"}}>{pair.def.length>80?pair.def.slice(0,80)+"…":pair.def}</button>
          );
        })}
      </div>
      {wrong&&<div style={{gridColumn:"1/-1",textAlign:"center",fontSize:"10px",color:C.red,background:"rgba(248,113,113,0.06)",border:"1px solid rgba(248,113,113,0.2)",borderRadius:"4px",padding:"6px",...mono}}>✗ Incorrect match — try again ({mistakes} mistakes)</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: FREQUENCY
// ══════════════════════════════════════════════════════════════════════════════
function GameFrequency({ puzzle, streak, onComplete }) {
  const [qIdx,setQIdx]=useState(0);
  const [answers,setAnswers]=useState([]);
  const [selected,setSelected]=useState(null);
  const [revealed,setRevealed]=useState(false);
  const [scoreVal,setScoreVal]=useState(null);
  const [done,setDone]=useState(false);
  const startTime=useRef(Date.now());

  function pick(idx){if(revealed)return;setSelected(idx);setRevealed(true);}
  function next(){
    const q=puzzle.questions[qIdx];const newAnswers=[...answers,{given:selected,correct:q.correct,ok:selected===q.correct,explanation:q.explanation}];
    setAnswers(newAnswers);setSelected(null);setRevealed(false);
    if(qIdx+1>=puzzle.questions.length){const correct=newAnswers.filter(a=>a.ok).length;const s=calcScore({basePoints:correct,maxPoints:puzzle.questions.length,timeElapsed:(Date.now()-startTime.current)/1000,timeLimit:240,perfect:correct===puzzle.questions.length,streak});setScoreVal(s);setDone(true);}
    else setQIdx(i=>i+1);
  }

  if(done)return(
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      {puzzle.questions.map((q,i)=>(
        <div key={i} style={{background:answers[i]?.ok?"rgba(74,222,128,0.05)":"rgba(248,113,113,0.05)",border:`1px solid ${answers[i]?.ok?"rgba(74,222,128,0.2)":"rgba(248,113,113,0.2)"}`,borderRadius:"8px",padding:"12px"}}>
          <div style={{fontSize:"11px",color:C.text,marginBottom:"4px"}}>{q.q}</div>
          <div style={{fontSize:"10px",color:answers[i]?.ok?C.green:C.red,...mono}}>{answers[i]?.ok?"✓ Correct":`✗ Answer: "${q.options[q.correct]}"`}</div>
          <div style={{fontSize:"9px",color:C.muted,marginTop:"4px",lineHeight:1.5,...mono}}>{q.explanation}</div>
        </div>
      ))}
      <ScoreCard score={scoreVal} puzzleType="Frequency" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)} isNew7Day={streak===7}/>
    </div>
  );

  const q=puzzle.questions[qIdx];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <SL>{qIdx+1} / {puzzle.questions.length}</SL>
        <ProgressBar value={qIdx+1} max={puzzle.questions.length} color={C.sage}/>
      </div>
      <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"20px"}}>
        <p style={{fontSize:"14px",color:C.text,margin:0,lineHeight:1.6,...sans}}>{q.q}</p>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {q.options.map((opt,i)=>{
          const isCorrect=revealed&&i===q.correct;const isWrong=revealed&&i===selected&&i!==q.correct;
          return(
            <button key={i} onClick={()=>pick(i)} style={{background:isCorrect?"rgba(74,222,128,0.07)":isWrong?"rgba(248,113,113,0.07)":(selected===i&&!revealed)?"rgba(196,146,42,0.07)":C.white,border:`1px solid ${isCorrect?"rgba(74,222,128,0.4)":isWrong?"rgba(248,113,113,0.4)":(selected===i&&!revealed)?C.gold:C.border}`,borderRadius:"6px",padding:"12px 16px",textAlign:"left",cursor:revealed?"default":"pointer",fontSize:"12px",color:isCorrect?C.green:isWrong?C.red:(selected===i&&!revealed)?C.gold:C.text,transition:"all 0.15s",...sans}}>
              <span style={{color:C.muted,marginRight:"10px",...mono}}>{String.fromCharCode(65+i)}.</span>{opt}
            </button>
          );
        })}
      </div>
      {revealed&&(
        <div>
          <div style={{fontSize:"10px",color:C.muted,lineHeight:1.6,...mono,background:C.white,borderRadius:"6px",padding:"10px",marginBottom:"10px"}}>{q.explanation}</div>
          <Btn onClick={next}>{qIdx+1<puzzle.questions.length?"Next Question →":"See Results →"}</Btn>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SOCIAL GATE
// ══════════════════════════════════════════════════════════════════════════════
function SocialGate({ trigger, onRegister, onDismiss }) {
  const [email,setEmail]=useState("");const [sent,setSent]=useState(false);const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const headlines={leaderboard:{h:"You just scored. See where you rank.",sub:"Drop your email to join the leaderboard and track your streak."},streak:{h:"7-day streak — you're on a run.",sub:"Register to keep your streak alive across sessions."},team:{h:"You've been challenged.",sub:"Add your email to accept and track your score against theirs."},default:{h:"Want to track your streak?",sub:"One email. No password. We send a magic link."}};
  const copy=headlines[trigger]||headlines.default;

  async function submit(){if(!email||!email.includes("@")){setError("Enter a valid email address");return;}setLoading(true);setError("");await new Promise(r=>setTimeout(r,1200));setSent(true);setLoading(false);if(onRegister)onRegister(email);}

  if(sent)return(
    <div style={{textAlign:"center",padding:"24px"}}>
      <div style={{fontSize:"32px",marginBottom:"12px"}}>✦</div>
      <div style={{fontSize:"15px",fontWeight:700,color:C.gold,marginBottom:"8px",...sans}}>Check your inbox</div>
      <div style={{fontSize:"11px",color:C.muted,lineHeight:1.6,...mono}}>We sent a magic link to <span style={{color:C.text}}>{email}</span>.<br/>Click it to activate your leaderboard profile and streak tracking.</div>
      <div style={{marginTop:"16px"}}><Btn onClick={onDismiss} variant="ghost" small>Continue playing →</Btn></div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      <div>
        <div style={{fontSize:"16px",fontWeight:700,color:C.text,marginBottom:"6px",...sans}}>{copy.h}</div>
        <div style={{fontSize:"11px",color:C.muted,lineHeight:1.5,...mono}}>{copy.sub}</div>
      </div>
      <div style={{display:"flex",gap:"8px"}}>
        <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="your@email.com"
          style={{flex:1,background:C.white,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"10px 14px",color:C.text,fontSize:"12px",...mono}}/>
        <Btn onClick={submit} disabled={loading||!email}>{loading?"…":"→"}</Btn>
      </div>
      {error&&<div style={{fontSize:"10px",color:C.red,...mono}}>{error}</div>}
      <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
        <div style={{flex:1,height:"1px",background:C.border}}/>
        <span style={{fontSize:"9px",color:C.dim,...mono}}>OR</span>
        <div style={{flex:1,height:"1px",background:C.border}}/>
      </div>
      <Btn onClick={onDismiss} variant="ghost" small>Skip — play without tracking</Btn>
      <div style={{fontSize:"9px",color:C.dim,lineHeight:1.5,...mono}}>No password. No newsletter. One magic link per session. Your email is only used for game notifications and streak persistence.</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME TILE — Updated with neon SVG icons
// ══════════════════════════════════════════════════════════════════════════════
const GAME_CONFIGS = [
  { type:"Rackl",       desc:"Group the tiles — four connected sets",      time:"~3 min" },
  { type:"Signal Drop", desc:"Guess the industry term — Wordle style",      time:"~2 min" },
  { type:"The Stack",   desc:"Drag to rank in the correct order",           time:"~2 min" },
  { type:"Circuit",     desc:"True/False sprint — beat the clock",          time:"~2 min" },
  { type:"The Brief",   desc:"Read the intelligence brief, then answer",    time:"~4 min" },
  { type:"Dark Fiber",  desc:"Match terms to their definitions",            time:"~3 min" },
  { type:"Frequency",   desc:"Multiple choice knowledge quiz",              time:"~3 min" },
];

function GameTile({ config, plays, onPlay }) {
  const [hov,setHov]=useState(false);
  const IconComponent=GAME_ICONS[config.type];
  const c=GAME_COLORS[config.type];
  return (
    <button onClick={onPlay}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{
        background:C.white,
        border:`1px solid ${hov?c.primary:C.border}`,
        borderRadius:"14px", padding:"18px",
        cursor:"pointer", textAlign:"left",
        transition:"all 0.18s cubic-bezier(0.34,1.56,0.64,1)",
        display:"flex", flexDirection:"column", gap:"12px",
        boxShadow:hov?`0 8px 28px ${c.glow}, 0 2px 8px rgba(28,52,36,0.06)`:"0 1px 4px rgba(28,52,36,0.04)",
        transform:hov?"translateY(-3px)":"none",
      }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <IconComponent size={64}/>
        <span style={{fontSize:"9px",color:C.muted,...mono,marginTop:"4px"}}>{config.time}</span>
      </div>
      <div>
        <div style={{fontSize:"13px",fontWeight:700,color:C.text,marginBottom:"4px",...sans}}>{config.type}</div>
        <div style={{fontSize:"10px",color:C.muted,lineHeight:1.4,...mono}}>{config.desc}</div>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:"9px",background:`${c.primary}15`,border:`1px solid ${c.primary}33`,
          color:c.primary,borderRadius:"3px",padding:"2px 7px",...mono,letterSpacing:"0.04em"}}>
          Power Architecture
        </span>
        <span style={{fontSize:"9px",color:C.dim,...mono}}>{plays.toLocaleString()} plays</span>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN — Daily Challenge App (crème bg)
// ══════════════════════════════════════════════════════════════════════════════
export default function DailyChallenge() {
  const [screen,setScreen]=useState("lobby");
  const [activeGame,setActiveGame]=useState(null);
  const [email,setEmail]=useState(null);
  const [streak,setStreak]=useState(3);
  const [mwBalance,setMwBalance]=useState(487);
  const [gamesPlayed,setGamesPlayed]=useState(0);
  const [gateReason,setGateReason]=useState(null);
  const [playCounts]=useState({"Rackl":1240,"Signal Drop":892,"The Stack":743,"Circuit":1105,"The Brief":580,"Dark Fiber":671,"Frequency":834});

  useEffect(()=>{
    const link=document.createElement("link");link.rel="stylesheet";
    link.href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;700&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
    const style=document.createElement("style");
    style.textContent=`
      * { box-sizing:border-box; }
      body { background:#EEE6DA; }
      @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
      .ca { animation:fadeUp 0.3s ease forwards; }
      button { font-family:inherit; }
      input { font-family:inherit; }
      input:focus { border-color:rgba(196,146,42,0.5)!important; outline:none; box-shadow:0 0 0 2px rgba(196,146,42,0.06); }
      ::-webkit-scrollbar { width:4px; }
      ::-webkit-scrollbar-thumb { background:rgba(28,52,36,0.15); border-radius:2px; }
    `;
    document.head.appendChild(style);
  },[]);

  function startGame(gt){setActiveGame(gt);setScreen("game");}
  function onGameComplete(score){
    setGamesPlayed(g=>g+1);setMwBalance(b=>b+MW_PER_PUZZLE+(streak===6?MW_STREAK_BONUS:0));setStreak(s=>s+1);
    if(!email&&gamesPlayed===0){setGateReason("leaderboard");setScreen("gate");}
    else setScreen("lobby");
  }
  function onRegister(emailAddr){setEmail(emailAddr);setTimeout(()=>setScreen("lobby"),2000);}
  function onGateDismiss(){setScreen("lobby");}

  const GAME_COMPONENTS={"Rackl":GameRackl,"Signal Drop":GameSignalDrop,"The Stack":GameStack,"Circuit":GameCircuit,"The Brief":GameBrief,"Dark Fiber":GameDarkFiber,"Frequency":GameFrequency};

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, ...mono }}>

      {/* ── HEADER ── Forest green masthead */}
      <div style={{
        background:C.forest,
        borderBottom:`2px solid ${C.gold}`,
        padding:"12px 24px",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        position:"sticky", top:0, zIndex:50,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ width:"28px", height:"28px", borderRadius:"6px",
            background:C.cream, display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:"13px", fontWeight:800, color:C.forest, ...serif }}>F</div>
          <div>
            <div style={{ fontSize:"13px", fontWeight:700, color:C.white, letterSpacing:"-0.01em", ...sans }}>Faraday</div>
            <div style={{ fontSize:"9px", color:C.sage, letterSpacing:"0.12em" }}>DAILY CHALLENGE</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
            <div style={{ width:"5px", height:"5px", borderRadius:"50%", background:"#4ADE80", animation:"pulse 2s ease infinite" }}/>
            <span style={{ fontSize:"9px", color:"#4ADE80", letterSpacing:"0.1em" }}>LIVE</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"5px",
            background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.25)",
            borderRadius:"4px", padding:"4px 8px" }}>
            <span style={{ fontSize:"9px" }}>🔥</span>
            <span style={{ fontSize:"10px", color:C.amber }}>{streak} day streak</span>
          </div>
          <div style={{ fontSize:"10px", color:C.gold, background:"rgba(196,146,42,0.12)",
            border:`1px solid rgba(196,146,42,0.3)`, borderRadius:"4px", padding:"4px 8px" }}>
            {mwBalance} MW
          </div>
          {!email&&(
            <button onClick={()=>{setGateReason("default");setScreen("gate");}} style={{
              background:"rgba(255,255,255,0.08)", border:`1px solid rgba(255,255,255,0.2)`,
              color:C.cream, borderRadius:"4px", padding:"5px 12px",
              fontSize:"9px", cursor:"pointer", letterSpacing:"0.08em", ...mono}}>Sign In →</button>
          )}
          {screen!=="lobby"&&(
            <button onClick={()=>setScreen("lobby")} style={{
              background:"none", border:`1px solid rgba(255,255,255,0.2)`,
              color:C.sage, borderRadius:"4px", padding:"5px 12px",
              fontSize:"9px", cursor:"pointer", ...mono}}>← Lobby</button>
          )}
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth:"800px", margin:"0 auto", padding:"32px 24px" }}>

        {/* LOBBY */}
        {screen==="lobby"&&(
          <div className="ca">
            <div style={{ marginBottom:"32px" }}>
              <h1 style={{ fontSize:"30px", fontWeight:800, color:C.forest,
                letterSpacing:"-0.03em", margin:"0 0 10px", ...sans }}>
                Test your edge.
              </h1>
              <p style={{ fontSize:"12px", color:C.muted, margin:0, lineHeight:1.7, ...mono }}>
                Seven daily intelligence challenges for people who work in and around<br/>
                the AI data center economy. Free to play. Two minutes.
              </p>
            </div>

            {/* Game tiles — updated with neon icons */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:"14px", marginBottom:"32px" }}>
              {GAME_CONFIGS.map(config=>(
                <GameTile key={config.type} config={config}
                  plays={playCounts[config.type]||0}
                  onPlay={()=>startGame(config.type)}/>
              ))}
            </div>

            {/* Social proof strip */}
            <div style={{ display:"flex", gap:"24px", padding:"16px 20px",
              background:C.white, border:`1px solid ${C.border}`,
              borderRadius:"8px", marginBottom:"24px" }}>
              {[
                {label:"Active streaks today",value:"847",color:C.amber},
                {label:"Total plays today",value:"5,065",color:C.gold},
                {label:"Share rate",value:"23%",color:"#4ADE80"},
              ].map(s=>(
                <div key={s.label}>
                  <div style={{fontSize:"16px",fontWeight:700,color:s.color,...sans}}>{s.value}</div>
                  <div style={{fontSize:"9px",color:C.muted,...mono}}>{s.label}</div>
                </div>
              ))}
              {email&&(
                <div style={{marginLeft:"auto"}}>
                  <div style={{fontSize:"10px",color:"#4ADE80",...mono}}>✓ Registered</div>
                  <div style={{fontSize:"9px",color:C.muted,...mono}}>{email}</div>
                </div>
              )}
            </div>

            {/* Tip of the day — forest green panel */}
            <div style={{ background:C.forest, borderRadius:"10px", padding:"22px 26px",
              borderTop:`3px solid ${C.gold}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"12px" }}>
                <SL color={C.cream}>Faraday Tip of the Day</SL>
                <span style={{ fontSize:"9px", color:C.gold, background:`rgba(196,146,42,0.15)`,
                  border:`1px solid rgba(196,146,42,0.3)`, padding:"2px 8px", borderRadius:"3px",
                  ...mono, letterSpacing:"0.08em" }}>POWER ARCHITECTURE</span>
              </div>
              <p style={{ fontSize:"13px", color:C.cream, lineHeight:1.7, margin:0, ...serif, fontStyle:"italic" }}>
                "The 800V DC transition isn't a technology decision — it's a real estate decision.
                Legacy AC facilities can't retrofit fast enough to host Blackwell-class density.
                The hardware roadmap and the facility obsolescence schedule are the same document."
              </p>
            </div>
          </div>
        )}

        {/* GAME */}
        {screen==="game"&&activeGame&&(()=>{
          const GameComponent=GAME_COMPONENTS[activeGame];
          const puzzle=PUZZLE_DATA[activeGame];
          const config=GAME_CONFIGS.find(c=>c.type===activeGame);
          const IconComponent=GAME_ICONS[activeGame];
          const gc=GAME_COLORS[activeGame];
          if(!GameComponent||!puzzle)return<div style={{color:C.red}}>Puzzle not found</div>;
          return(
            <div className="ca">
              <div style={{ marginBottom:"20px", padding:"16px 20px",
                background:C.white, border:`1px solid ${C.border}`,
                borderLeft:`3px solid ${gc.primary}`, borderRadius:"8px",
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <IconComponent size={40}/>
                  <div>
                    <div style={{ fontSize:"14px", fontWeight:700, color:C.text, ...sans }}>{activeGame}</div>
                    <div style={{ fontSize:"10px", color:C.muted, ...mono }}>{puzzle.name}</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:"8px" }}>
                  <span style={{ fontSize:"9px", color:C.muted, background:C.cream, border:`1px solid ${C.border}`, padding:"3px 8px", borderRadius:"3px", ...mono }}>{puzzle.domain}</span>
                  <span style={{ fontSize:"9px", color:C.muted, ...mono }}>{config.time}</span>
                </div>
              </div>
              <GameComponent puzzle={puzzle} streak={streak} onComplete={onGameComplete}/>
            </div>
          );
        })()}

        {/* SOCIAL GATE */}
        {screen==="gate"&&(
          <div className="ca" style={{ maxWidth:"420px", margin:"0 auto" }}>
            <div style={{ background:C.white, border:`1px solid ${C.border}`,
              borderRadius:"12px", padding:"28px" }}>
              <SocialGate trigger={gateReason} onRegister={onRegister} onDismiss={onGateDismiss}/>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
