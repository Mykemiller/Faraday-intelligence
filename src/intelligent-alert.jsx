import { useState, useEffect, useRef } from "react";

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

// ─── Mock alert data ───────────────────────────────────────────────────────────
const ALERTS = {
  S: {
    tier: "S",
    tierName: "Snapshot",
    date: "Friday, April 4, 2026",
    edition: "Vol. 1, No. 1",
    readTime: "< 2 min",
    items: [
      {
        domain: "Power & Grid",
        headline: "FERC Order 1920-A implementation deadline extended to Q3 2026.",
        context: "Grid operators cite staffing constraints and study backlogs. Affects ~340 MW of DC interconnection requests currently in feasibility phase.",
        source: "FERC News Releases",
        date: "Apr 3, 2026",
      },
      {
        domain: "Chips & Density",
        headline: "Microsoft powers up first Vera Rubin NVL72 cluster — 132 kW/rack confirmed.",
        context: "First hyperscaler to operationalize the new standard. Wisconsin campus. Rear-door CDU cooling. Signals facility retrofit wave accelerating.",
        source: "Datacenter Dynamics",
        date: "Apr 3, 2026",
      },
      {
        domain: "Capital & M&A",
        headline: "Blackstone launches listed DC acquisition vehicle — permanent capital structure.",
        context: "First publicly traded DC-focused vehicle from a PE firm. Eliminates fund lifecycle constraints. Retail access to infrastructure returns.",
        source: "Wall Street Journal",
        date: "Apr 2, 2026",
      },
    ],
  },
  M: {
    tier: "M",
    tierName: "Full Brief",
    date: "Friday, April 4, 2026",
    edition: "Vol. 1, No. 1",
    readTime: "4 min",
    sections: [
      {
        domain: "Power & Grid",
        icon: "⚡",
        items: [
          {
            headline: "FERC Order 1920-A deadline slips — grid queue implications.",
            body: "Implementation delayed to Q3 2026 citing utility staffing shortfalls and study backlogs across PJM and MISO. The 18-month delay extends queue clearing timelines for roughly 340 MW of large-load interconnection requests currently in active feasibility studies.",
            stat: { value: "340 MW", label: "DC requests affected" },
            source: "FERC News Releases", date: "Apr 3, 2026",
          },
          {
            headline: "AEP-Bloom Energy 1 GW fuel cell deployment — primary power, not backup.",
            body: "The agreement reshapes how utilities think about their role in the data center economy. AEP is no longer just a grid supplier — it is becoming an infrastructure partner. EaaS is now primary power at scale, not a backup hedge.",
            stat: { value: "1 GW", label: "EaaS deployment" },
            source: "Bloom Energy IR", date: "Apr 2, 2026",
          },
        ],
      },
      {
        domain: "Chips & Density",
        icon: "🔲",
        items: [
          {
            headline: "Vera Rubin NVL72 at 132 kW/rack — the retrofit math just changed.",
            body: "Microsoft's Wisconsin deployment confirms rack power density at 132 kW. For comparison: most DC floors built pre-2022 are spec'd for 8–15 kW. The gap is not bridgeable with incremental upgrades. It requires structural power and cooling rearchitecture.",
            stat: { value: "132 kW", label: "per rack, NVL72" },
            source: "Datacenter Dynamics", date: "Apr 3, 2026",
          },
        ],
      },
      {
        domain: "Capital & M&A",
        icon: "💰",
        items: [
          {
            headline: "Blackstone's listed DC vehicle changes the capital structure of the sector.",
            body: "Permanent capital + listed liquidity + DC-only mandate is a new combination. It eliminates the 7–10 year fund lifecycle pressure that has historically constrained how PE manages DC assets. Expect longer hold periods and more vertical integration.",
            stat: { value: "$180B+", label: "PE pipeline in DC" },
            source: "Blackstone IR", date: "Apr 2, 2026",
          },
          {
            headline: "DigitalBridge closes $4B SoftBank Asia-Pacific DC portfolio.",
            body: "Largest single-transaction DC acquisition in APAC history. DigitalBridge takes over management of 12 facilities across Japan, Korea, and Australia. Confirms thesis: specialist operators outbid generalist PE in contested DC auctions.",
            stat: { value: "$4B", label: "APAC acquisition" },
            source: "DigitalBridge PR", date: "Apr 1, 2026",
          },
        ],
      },
      {
        domain: "Regulatory & Policy",
        icon: "📋",
        items: [
          {
            headline: "300+ state bills targeting data centers — 14 states now with active legislation.",
            body: "The moratorium wave is accelerating. Virginia, Pennsylvania, New York, and Texas all have bills in active committee. Faraday's Three-Tier State Policy Map now shows 8 states in the Restricted tier, up from 5 in Q4 2025.",
            stat: { value: "14 states", label: "active DC legislation" },
            source: "Good Jobs First", date: "Apr 3, 2026",
          },
        ],
      },
    ],
    faradayTake: {
      headline: "The power constraint is structural, not cyclical.",
      body: "Every signal this week points to the same conclusion: the bottleneck in AI infrastructure is not GPUs, capital, or land. It is power delivery at the right density, in the right locations, with the right regulatory clearance. The firms that internalize this — and build or buy accordingly — have a durable moat. The ones treating it as a temporary supply chain issue will be surprised in 18 months.",
    },
  },
  L: {
    tier: "L",
    tierName: "Deep Brief",
    date: "Friday, April 4, 2026",
    edition: "Vol. 1, No. 1",
    readTime: "10 min",
    toc: [
      { id: "power", label: "Power & Grid" },
      { id: "chips", label: "Chips & Density" },
      { id: "capital", label: "Capital & M&A" },
      { id: "regulatory", label: "Regulatory & Policy" },
      { id: "radar", label: "On the Radar" },
      { id: "take", label: "Faraday's Take" },
    ],
    sections: [
      {
        id: "power",
        domain: "Power & Grid",
        icon: "⚡",
        items: [
          {
            headline: "FERC Order 1920-A implementation delayed — queue implications cascade.",
            body: "The 18-month extension is not just a procedural slip. It means the most capital-intensive phase of the interconnection process — impact studies — will not clear until at least late 2027 for projects currently in queue. For DC developers with live grid applications, this is a site selection signal: markets where queue study has already cleared are worth a premium.",
            stat: { value: "340 MW", label: "affected requests" },
            source: "FERC News Releases", date: "Apr 3, 2026",
          },
          {
            headline: "AEP-Bloom 1 GW agreement reframes utility economics.",
            body: "AEP is accepting revenue risk to retain the customer relationship. That's a structural shift. Utilities historically charged large loads for infrastructure and took no performance risk. The EaaS model inverts this — Bloom owns and operates generation equipment, AEP takes a capacity payment. This model will spread to other utilities under hyperscaler pressure.",
            stat: { value: "$5B", label: "Brookfield Bloom deal" },
            source: "Bloom Energy IR", date: "Apr 2, 2026",
          },
          {
            headline: "BTM generation economics: the math that's moving the market.",
            body: "Behind-the-meter generation now achieves parity with utility grid power in 11 states when transmission charges and interconnection timeline costs are included. The tipping point has arrived for campuses above 200 MW in constrained markets. Expect the next wave of campus announcements to include BYOG language as a standard feature, not a differentiator.",
            stat: { value: "11 states", label: "BTM parity achieved" },
            source: "Faraday Analysis", date: "Apr 4, 2026",
          },
        ],
      },
      {
        id: "chips",
        domain: "Chips & Density",
        icon: "🔲",
        items: [
          {
            headline: "Vera Rubin NVL72 deployment confirmed — what it means for every existing DC.",
            body: "The NVL72's 132 kW/rack spec is not aspirational. It is operational. Microsoft's Wisconsin deployment proves the full stack — 800V DC, rear-door CDU, structural floor reinforcement — is deployable at hyperscaler speed. The implication for existing facilities: any lease or acquisition of pre-2022 DC space now requires a density retrofit assessment as a standard underwriting step.",
            stat: { value: "132 kW/rack", label: "NVL72 confirmed" },
            source: "Datacenter Dynamics", date: "Apr 3, 2026",
          },
          {
            headline: "AMD's $100B Meta commitment — the NVIDIA dependency story just got complicated.",
            body: "This is not a token diversification play. $100B over 4 years at Meta's scale implies AMD is competitive at inference workloads. It does not displace NVIDIA for training — H100/GB300 demand is unaffected. But it changes the inference economics story and opens a supply chain hedge for buyers who have been entirely NVIDIA-dependent.",
            stat: { value: "$100B", label: "AMD-Meta commitment" },
            source: "Meta IR", date: "Apr 1, 2026",
          },
        ],
      },
      {
        id: "capital",
        domain: "Capital & M&A",
        icon: "💰",
        items: [
          {
            headline: "Blackstone's listed vehicle: permanent capital changes the ownership model.",
            body: "The traditional PE model imposes a structural constraint on DC ownership: assets must be monetized within the fund lifecycle. Listed permanent capital eliminates this. Blackstone can now hold assets through the full GPU generation cycle (3–4 years) without forced exit pressure. For operators, this means a different negotiating dynamic — a landlord that doesn't need to sell.",
            stat: { value: "Permanent", label: "capital structure" },
            source: "Blackstone IR", date: "Apr 2, 2026",
          },
          {
            headline: "DigitalBridge-SoftBank closes — APAC specialist operators now dominant.",
            body: "The 12-facility portfolio includes three hyperscaler-anchored campuses in Tokyo and Seoul. DigitalBridge's management platform — not ownership per se — is the strategic asset. Managing a SoftBank portfolio with DigitalBridge operational infrastructure is a template for capital-light expansion. Expect similar structures in India and Southeast Asia by Q4 2026.",
            stat: { value: "$4B", label: "APAC acquisition" },
            source: "DigitalBridge PR", date: "Apr 1, 2026",
          },
        ],
      },
      {
        id: "regulatory",
        domain: "Regulatory & Policy",
        icon: "📋",
        items: [
          {
            headline: "The moratorium map is accelerating — Faraday's Three-Tier update.",
            body: "8 states now in the Restricted tier (Virginia counties, NYC, Portland OR, selected Maryland markets). 6 states in Tightening. The Open tier is shrinking. This is not a political story — it is a site selection story. Markets with active opposition are pricing it into land costs and timeline risk. Faraday's site selection framework now includes a moratorium risk score as a mandatory factor.",
            stat: { value: "8 states", label: "now Restricted" },
            source: "Good Jobs First + Faraday", date: "Apr 3, 2026",
          },
        ],
      },
      {
        id: "radar",
        domain: "On the Radar",
        icon: "🔭",
        items: [
          {
            headline: "Carrier Global — absent from NVIDIA DSX partner list.",
            body: "Vertiv, Schneider Electric, Eaton, and Siemens are DSX-certified. Carrier — one of the largest HVAC companies in the world — is not. This is a material gap in their data center strategy. Faraday's read: either a DSX partnership announcement comes in Q2 2026, or Carrier's ZutaCore investment becomes the vector for re-entry.",
            source: "NVIDIA GTC", date: "Mar 2026",
          },
          {
            headline: "Crusoe's Abilene TX campus — watch the NVIDIA relationship.",
            body: "Oracle and OpenAI have both exited the Abilene commitment. NVIDIA deposited $150M and Microsoft took ~700 MW. This campus is now effectively an NVIDIA-anchored NeoCloud deployment. The pattern — hyperscalers de-risk by exiting, NVIDIA steps in — may repeat at other contested sites.",
            source: "Multiple sources", date: "Mar-Apr 2026",
          },
        ],
      },
    ],
    faradayTake: {
      headline: "The capital is real. The timeline is not.",
      body: "Every week, another headline confirms $50B in DC commitments. Every week, the actual constraint picture looks harder: grid queues that won't clear until 2028, cooling contractors booked 18 months out, liquid-capable retrofits priced at $15–25M per MW, and moratorium risks in the top-10 markets. The capital is absolutely real. But the timelines in the press releases are aspirational. My read: the firms that are quietly solving the power and permitting problem — through BTM, through rural siting, through utility partnership rather than opposition — will have a 24-month lead that late entrants cannot close. Watch the site selection announcements that don't make headlines.",
    },
  },
};

// ─── Bolt SVG ─────────────────────────────────────────────────────────────────
function Bolt({ size = 16, color = T.gold }) {
  const r = size / 110;
  return (
    <svg width={size * 0.39} height={size * 0.78} viewBox="0 0 43 86" fill="none">
      <polygon points="27,0 0,44 16,44 11,86 43,38 26,38" fill={color} />
    </svg>
  );
}

// ─── Double rule ──────────────────────────────────────────────────────────────
function DoubleRule({ width = 60 }) {
  return (
    <div style={{ width, display: "flex", flexDirection: "column", gap: 2, margin: "18px 0 20px" }}>
      <div style={{ height: 2, background: T.forestLight }} />
      <div style={{ height: 2, background: T.gold }} />
    </div>
  );
}

// ─── Source chip ──────────────────────────────────────────────────────────────
function SourceChip({ source, date }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontFamily: "'IBM Plex Mono', monospace", fontSize: 9,
      letterSpacing: "0.1em", color: T.sage,
      background: "rgba(140,166,138,0.08)", border: `1px solid rgba(140,166,138,0.2)`,
      padding: "3px 8px", borderRadius: 3,
    }}>
      {source} · {date}
    </span>
  );
}

// ─── Stat callout ─────────────────────────────────────────────────────────────
function StatCallout({ value, label }) {
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column",
      background: T.warmCream, borderLeft: `3px solid ${T.gold}`,
      padding: "8px 14px", margin: "10px 0 4px",
    }}>
      <span style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 22, color: T.forest, lineHeight: 1 }}>{value}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.14em", color: T.sage, textTransform: "uppercase", marginTop: 3 }}>{label}</span>
    </div>
  );
}

// ─── Faraday's Take ───────────────────────────────────────────────────────────
function FaradayTake({ headline, body }) {
  return (
    <div style={{
      background: T.warmCream,
      borderLeft: "none",
      padding: "24px 28px",
      position: "relative",
      marginTop: 8,
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        background: `linear-gradient(to bottom, ${T.forest} 60%, ${T.gold} 40%)`,
      }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Bolt size={14} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.18em", color: T.gold, textTransform: "uppercase" }}>Faraday's Take</span>
      </div>
      <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 600, fontSize: 15, color: T.nearBlack, marginBottom: 10, lineHeight: 1.3 }}>{headline}</div>
      <div style={{ fontFamily: "'IBM Plex Serif', serif", fontStyle: "italic", fontSize: 14, color: "#444", lineHeight: 1.75 }}>{body}</div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ icon, domain, id }) {
  return (
    <div id={id} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "14px 0 12px",
      borderTop: `1px solid rgba(28,52,36,0.1)`,
      marginTop: 8,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: T.forest, fontWeight: 500 }}>{domain}</span>
    </div>
  );
}

// ─── Intelligence item ────────────────────────────────────────────────────────
function IntelItem({ item, showBody = false }) {
  return (
    <div style={{ paddingBottom: 18, marginBottom: 18, borderBottom: `1px solid rgba(178,168,152,0.25)` }}>
      <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 600, fontSize: 15, color: T.nearBlack, lineHeight: 1.35, marginBottom: 6 }}>
        {item.headline}
      </div>
      {item.context && (
        <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 13, color: "#555", lineHeight: 1.65, marginBottom: 8 }}>{item.context}</div>
      )}
      {showBody && item.body && (
        <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 13, color: "#555", lineHeight: 1.7, marginBottom: 10 }}>{item.body}</div>
      )}
      {item.stat && <StatCallout value={item.stat.value} label={item.stat.label} />}
      <div style={{ marginTop: 8 }}>
        <SourceChip source={item.source} date={item.date} />
      </div>
    </div>
  );
}

// ─── Masthead ─────────────────────────────────────────────────────────────────
function Masthead({ alert, onTierChange, currentTier }) {
  return (
    <div style={{ background: T.forest, color: T.warmWhite, paddingBottom: 0 }}>
      {/* Top bar */}
      <div style={{
        borderBottom: `1px solid rgba(255,255,255,0.08)`,
        padding: "10px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.14em", color: T.sage }}>
          FARADAY INTELLIGENCE · {alert.edition}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.1em", color: T.sage }}>
          {alert.date}
        </div>
      </div>

      {/* Main masthead */}
      <div style={{ padding: "20px 28px 0", display: "flex", alignItems: "center", gap: 14 }}>
        {/* F mark */}
        <div style={{
          width: 44, height: 44, background: T.forestMid,
          border: `2px solid ${T.gold}`, borderRadius: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 24, color: T.warmWhite,
          flexShrink: 0,
        }}>F</div>
        <div>
          <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 20, letterSpacing: "-0.01em" }}>Faraday 2.0</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.18em", color: T.sage, textTransform: "uppercase" }}>Intelligent Alert</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80" }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#4ADE80", letterSpacing: "0.1em" }}>LIVE</span>
        </div>
      </div>

      {/* Gold double rule */}
      <div style={{ margin: "14px 28px 0" }}>
        <div style={{ height: 2, background: T.forestLight }} />
        <div style={{ height: 2, background: T.gold, marginTop: 2 }} />
      </div>

      {/* Tier tabs */}
      <div style={{ display: "flex", padding: "0 28px", gap: 0, marginTop: 0 }}>
        {[
          { key: "S", label: "S — Snapshot", sub: "< 2 min" },
          { key: "M", label: "M — Full Brief", sub: "4 min" },
          { key: "L", label: "L — Deep Brief", sub: "10 min" },
        ].map(({ key, label, sub }) => (
          <button
            key={key}
            onClick={() => onTierChange(key)}
            style={{
              background: "none", border: "none",
              borderBottom: currentTier === key ? `3px solid ${T.gold}` : "3px solid transparent",
              color: currentTier === key ? T.warmWhite : T.sage,
              padding: "14px 18px 12px",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
              cursor: "pointer", transition: "color 0.15s",
              display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3,
            }}
          >
            <span>{label}</span>
            <span style={{ fontSize: 8, color: currentTier === key ? T.gold : "rgba(140,166,138,0.6)", letterSpacing: "0.08em" }}>{sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── TOC (L tier) ─────────────────────────────────────────────────────────────
function TOC({ items }) {
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div style={{
      background: T.warmCream, border: `1px solid rgba(28,52,36,0.12)`,
      padding: "16px 20px", marginBottom: 24,
    }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.18em", color: T.sage, textTransform: "uppercase", marginBottom: 12 }}>In This Brief</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => scroll(item.id)}
            style={{
              background: "none", border: "none", padding: 0,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
              color: T.forest, cursor: "pointer", letterSpacing: "0.08em",
              textDecoration: "underline", textDecorationColor: T.gold,
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Snapshot view (S) ────────────────────────────────────────────────────────
function SnapshotView({ alert }) {
  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Bolt size={13} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.18em", color: T.gold, textTransform: "uppercase" }}>3 signals · this morning</span>
      </div>
      <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 18, color: T.nearBlack, marginBottom: 4 }}>
        The market moved while you slept.
      </div>
      <DoubleRule width={50} />
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {alert.items.map((item, i) => (
          <IntelItem key={i} item={item} />
        ))}
      </div>
      <div style={{
        marginTop: 8, padding: "14px 18px",
        background: T.forest, color: T.warmWhite,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 13, fontStyle: "italic", color: T.sage }}>Want the full picture?</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.1em", color: T.gold, marginTop: 4 }}>Upgrade to M — Full Brief ↑</div>
        </div>
        <div style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 13, color: T.warmWhite, fontStyle: "italic" }}>— Faraday</div>
      </div>
    </div>
  );
}

// ─── Full view (M) ────────────────────────────────────────────────────────────
function FullView({ alert }) {
  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Bolt size={13} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.18em", color: T.gold, textTransform: "uppercase" }}>
          {alert.sections.reduce((n, s) => n + s.items.length, 0)} signals across {alert.sections.length} domains
        </span>
      </div>
      <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 19, color: T.nearBlack, lineHeight: 1.25 }}>
        Power is the constraint.<br />Everything else is downstream.
      </div>
      <DoubleRule width={50} />
      {alert.sections.map((section) => (
        <div key={section.domain}>
          <SectionHeader icon={section.icon} domain={section.domain} />
          {section.items.map((item, i) => <IntelItem key={i} item={item} showBody />)}
        </div>
      ))}
      <div style={{ marginTop: 16 }}>
        <SectionHeader icon="⚡" domain="Faraday's Take" />
        <FaradayTake {...alert.faradayTake} />
      </div>
      <div style={{ marginTop: 28, paddingTop: 20, borderTop: `1px solid rgba(178,168,152,0.3)`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.1em", color: T.sage }}>FARADAY INTELLIGENCE · {alert.date}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Bolt size={10} />
          <span style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 11, fontStyle: "italic", color: T.sage }}>Faraday. Your unfair advantage.</span>
        </div>
      </div>
    </div>
  );
}

// ─── Deep view (L) ────────────────────────────────────────────────────────────
function DeepView({ alert }) {
  return (
    <div style={{ padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Bolt size={13} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.18em", color: T.gold, textTransform: "uppercase" }}>
          Full-depth intelligence · {alert.readTime}
        </span>
      </div>
      <div style={{ fontFamily: "'IBM Plex Serif', serif", fontWeight: 700, fontSize: 20, color: T.nearBlack, lineHeight: 1.2 }}>
        The capital is real.<br />The timeline is not.
      </div>
      <DoubleRule width={50} />
      <TOC items={alert.toc} />

      {alert.sections.map((section) => (
        <div key={section.id}>
          <SectionHeader icon={section.icon} domain={section.domain} id={section.id} />
          {section.items.map((item, i) => <IntelItem key={i} item={item} showBody />)}
        </div>
      ))}

      <div id="take" style={{ marginTop: 20 }}>
        <SectionHeader icon="⚡" domain="Faraday's Take" />
        <FaradayTake {...alert.faradayTake} />
      </div>

      {/* Challenge CTA */}
      <div style={{
        marginTop: 24, background: T.forest, color: T.warmWhite,
        padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.16em", color: T.gold, textTransform: "uppercase", marginBottom: 6 }}>
            ⚡ Daily Challenge · Take Today's
          </div>
          <div style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 15, fontWeight: 600 }}>Think you read the market?</div>
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 12, color: T.sage, marginTop: 4 }}>Four categories. Sixteen signals. One ranking.</div>
        </div>
        <button style={{
          background: T.gold, color: T.nearBlack,
          border: "none", padding: "10px 20px",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
          letterSpacing: "0.1em", textTransform: "uppercase",
          cursor: "pointer", whiteSpace: "nowrap",
        }}>Play now →</button>
      </div>

      <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid rgba(178,168,152,0.3)`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: "0.1em", color: T.sage }}>FARADAY INTELLIGENCE · {alert.date}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Bolt size={10} />
          <span style={{ fontFamily: "'IBM Plex Serif', serif", fontSize: 11, fontStyle: "italic", color: T.sage }}>Faraday. Your unfair advantage.</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function FaradayIntelligentAlert() {
  const [tier, setTier] = useState("M");
  const alert = ALERTS[tier];

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Bricolage+Grotesque:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#E8E4DE",
      display: "flex", justifyContent: "center",
      padding: "32px 16px",
      fontFamily: "'Bricolage Grotesque', sans-serif",
    }}>
      <div style={{
        width: "100%", maxWidth: 640,
        background: T.warmWhite,
        boxShadow: "0 8px 48px rgba(20,18,16,0.18), 0 0 0 1px rgba(28,52,36,0.08)",
      }}>
        <Masthead alert={alert} onTierChange={setTier} currentTier={tier} />

        <div style={{ minHeight: 400 }}>
          {tier === "S" && <SnapshotView alert={alert} />}
          {tier === "M" && <FullView alert={alert} />}
          {tier === "L" && <DeepView alert={alert} />}
        </div>
      </div>
    </div>
  );
}
