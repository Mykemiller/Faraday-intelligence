# CC-SOURCE-SCALE-500 — Wave 1 News-Feed Candidate Catalog (≥10 per IDF Domain)

**Date:** 2026-07-17 · **Status:** CANDIDATES — nothing here is countable yet.
**Trigger:** Myke 2026-07-17 — "bring the news feed count for each domain to a minimum of 10 sources."
**Method:** four parallel research passes over all 23 IDF Domains (D13+D18 combined). ~336 candidates total, 13–17 per domain — enough headroom that every domain lands ≥10 after vetting attrition.

## Verification caveat (applies to every row)

Direct feed fetching is egress-blocked from the dev container (proxy 403 on news hosts — the known allowlist pattern). **"Verified? Yes" = corroborated via search/documentation this session; "No"/"No\*"/"Pattern"/"TBV" = publication confirmed but feed path inferred.** No feed URL is fabricated-as-verified. Every row requires a one-shot HTTP verification from Vercel (or the future `source-poller` probe mode) before it enters `source_registry` as anything but `license_status='unreviewed', countable=false`.

## Vetting pipeline (candidate → countable)

1. **Feed verification sweep** (Vercel/edge, 0 LLM cost): HTTP GET each feed URL; resolve TBVs (WordPress `/feed`, Industry Dive `/feeds/news/`, statuspage.io `/history.rss`, BLOX `/search/?f=rss&t=article` patterns).
2. **License read** for rows flagged `restrictive-tos` (CoStar, AM Best, Law360, ACBJ, analyst/broker newsrooms, associations). Publication-fact use of headline feeds is the default posture; anything ambiguous is excluded from the count until cleared (engagement STOP rule).
3. **Seed `source_registry`**: verified rows insert as `status='registered'`, `license_status` per read, `idf_domains` from this catalog; `countable=true` only when the R1 named-source test + license both pass.
4. **Wave-1 activation** via `source-poller` (pending AUTO-199 grant).

## Known structural findings from this sweep

- **CISA retired its RSS feeds (~May 2025)** — use the KEV JSON file + advisories index/API polling instead. **NVD legacy RSS retired** — API 2.0 only.
- **FERC and NERC newsrooms have no confirmed RSS** — GovDelivery email or index-page polling.
- **AWS status has no all-services feed** — per service-region RSS fan-out required.
- **bizjournals (ACBJ) and Gannett** have largely deprecated public RSS — local-market coverage may need scraper/newsletter fallbacks.
- **Data Center Knowledge's** legacy `/rss.xml` appears dead post-replatform — re-discover.
- **Anthropic newsroom** has no public RSS — index polling.
- **Cross-domain feeds** (DCD, Utility Dive, Bisnow, Capacity, SemiAnalysis, The Next Platform, Telecom Ramblings, Construction Dive, Canary Media, HR Dive, Dragos, Vertiv…): one source under R1/A2, serving multiple `idf_domains[]` — counted once.

## Coverage summary

| Domain | Candidates found | Domain | Candidates found |
|---|---:|---|---:|
| D1 Chips & Density | 15 | D13+D18 Community/Opposition | 16 |
| D2 Power Architecture | 16 | D14 Real Estate & Site Sel. | 15 |
| D3 Grid & Regulatory | 15 | D15 Sovereign AI & Geopolitics | 14 |
| D4 M&A & Capital Markets | 14 | D16 Cyber & Physical Security | 15 |
| D5 Hyperscaler Activity | 15 | D17 Workforce & Labor | 15 |
| D6 New Entrants | 15 | D19 Tax & Incentives | 14 |
| D7 Cooling & Water | 14 | D20 Facility IT/OT | 15 |
| D8 People & Signals | 13 | D21 Insurance & Risk | 14 |
| D9 Orchestration | 14 | D22 Media & Analyst | 17 |
| D10 Construction | 14 | D23 Outage & Emergency | 17 |
| D11 Sustainability | 14 | **Total** | **≈336** |
| D12 Networking & Interconnect | 15 | | |

---

# D1 — Chips & Density

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| SemiAnalysis | SemiAnalysis LLC | https://semianalysis.com | https://semianalysis.com/feed/ | No* | 0.3 | Free + paid tiers | paywalled | The reference analyst on GPU/HBM/CoWoS supply chains and AI datacenter buildouts |
| The Next Platform | Stackhouse Publishing | https://www.nextplatform.com | https://www.nextplatform.com/feed/ | No* | 1 | Open | public-rss | Deep technical coverage of accelerators, HPC/AI systems, hyperscale silicon |
| ServeTheHome | STH Media | https://www.servethehome.com | https://www.servethehome.com/feed/ | No* | 2 | Open | public-rss | Hands-on GPU server/accelerator hardware coverage, density and power at rack level |
| Semiconductor Engineering | Sperling Media | https://semiengineering.com | https://semiengineering.com/feed/ | No* | 3 | Open | public-rss | Advanced packaging, chiplets, HBM, foundry process deep dives |
| Chips and Cheese | Chips and Cheese | https://chipsandcheese.com | https://chipsandcheese.com/feed | No* | 0.3 | Free + paid | public-rss | Microarchitecture analysis of GPUs/accelerators |
| HPCwire | Tabor Communications | https://www.hpcwire.com | https://www.hpcwire.com/feed/ | No* | 3 | Open (reg-wall on some) | public-rss | AI/HPC accelerator deployments, supercomputer wins, silicon roadmaps |
| TrendForce News | TrendForce | https://www.trendforce.com/news/ | TBV | No | 5 | Open (research paywalled) | paywalled | HBM/DRAM pricing and foundry utilization — leading indicator for GPU supply |
| EE Times | AspenCore | https://www.eetimes.com | TBV (likely /feed) | No | 2 | Open | public-rss | Semiconductor industry news, packaging, power devices |
| The Register (Systems) | Situation Publishing | https://www.theregister.com/systems/ | TBV (section .atom exists) | No | 3 | Open | public-rss | Irreverent but fast coverage of AI silicon and server vendors |
| NVIDIA Blog | NVIDIA | https://blogs.nvidia.com | https://blogs.nvidia.com/feed/ | No* | 1.5 | Open | public-rss | Primary source for GPU/NVL platform announcements |
| SK hynix Newsroom | SK hynix | https://news.skhynix.com | https://news.skhynix.com/feed/ | No* | 0.2 | Open | public-rss | HBM leader's own announcements (HBM4 cadence) |
| TSMC Press Releases | TSMC | https://pr.tsmc.com | TBV | No | 0.1 | Open | public-rss | Foundry capacity/packaging (CoWoS/SoIC) expansion facts |
| Intel Newsroom | Intel | https://newsroom.intel.com | TBV | No | 0.5 | Open | public-rss | Foundry (18A) + Gaudi accelerator announcements |
| WikiChip Fuse | WikiChip | https://fuse.wikichip.org | https://fuse.wikichip.org/feed/ | No* | 0.05 | Open | public-rss | Authoritative die/packaging teardown analysis (low cadence, high signal) |
| Blocks & Files | Situation Publishing (assoc.) | https://blocksandfiles.com | https://blocksandfiles.com/feed/ | No* | 2 | Open | public-rss | Memory/storage hierarchy incl. HBM/CXL vendor news |

# D2 — Power Architecture

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| POWER Magazine | Access Intelligence | https://www.powermag.com | https://www.powermag.com/feed/ | No* | 2 | Open | public-rss | Generation tech incl. gas turbines, SMRs, data-center load stories |
| Power Engineering | Clarion Events | https://www.power-eng.com | TBV (likely /feed) | No | 1.5 | Open | public-rss | Utility-scale + on-site generation projects |
| T&D World | Endeavor Business Media | https://www.tdworld.com | TBV | No | 2 | Open | public-rss | Transmission/interconnection — the binding constraint for DC power |
| Canary Media | Canary Media (nonprofit) | https://www.canarymedia.com | https://www.canarymedia.com/rss-feed | Yes | 2 | Open | public-rss | Clean energy + data-center power demand beat (also D11) |
| Latitude Media | Latitude Media | https://www.latitudemedia.com | TBV | No | 1 | Open + paid tier | paywalled | Dedicated AI-and-energy vertical; strong BTM/nuclear-deal coverage |
| Microgrid Knowledge | Endeavor Business Media | https://www.microgridknowledge.com | TBV | No | 1 | Open | public-rss | BTM generation, microgrids for data centers |
| World Nuclear News | World Nuclear Association | https://www.world-nuclear-news.org | TBV | No | 2 | Open | public-rss | Fastest global SMR/nuclear project wire |
| ANS Nuclear Newswire | American Nuclear Society | https://www.ans.org/news/ | TBV | No | 1.5 | Open | public-rss | US-centric SMR licensing and deployment news |
| Nuclear Engineering International | Progressive Media | https://www.neimagazine.com | TBV | No | 1 | Open | public-rss | Nuclear vendor/equipment detail |
| NRC News Releases | US NRC | https://www.nrc.gov | TBV (NRC publishes RSS) | No | 0.5 | Open | gov-public-domain | SMR licensing actions — primary regulatory facts |
| Power Electronics News | AspenCore | https://www.powerelectronicsnews.com | TBV (likely /feed) | No | 0.7 | Open | public-rss | 800V DC architecture, SiC/GaN power conversion |
| Vertiv News | Vertiv | https://www.vertiv.com/en-us/about/news-and-insights/ | TBV | No | 0.2 | Open | restrictive-tos | #1 DC power/UPS vendor's product + capacity announcements (also D7) |
| Schneider Electric Blog | Schneider Electric | https://blog.se.com | https://blog.se.com/feed/ | No* | 1 | Open | public-rss | UPS/power architecture + White Paper drops (incl. 800V DC guidance) |
| Eaton Newsroom | Eaton | https://www.eaton.com/us/en-us/company/news-insights.html | TBV | No | 0.3 | Open | public-rss | Major UPS/switchgear vendor announcements |
| Bloom Energy Newsroom | Bloom Energy | https://www.bloomenergy.com/news/ | TBV | No | 0.1 | Open | public-rss | Leading BTM fuel-cell supplier to data centers |
| GE Vernova News | GE Vernova | https://www.gevernova.com/news | TBV | No | 0.3 | Open | public-rss | Gas turbines + BWRX-300 SMR — both DC-critical supply signals |

# D3 — Grid & Regulatory (news feeds; docket/queue data feeds already live)

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| FERC News Releases & Headlines | FERC | https://www.ferc.gov/news-events/news | TBV (no news RSS found; GovDelivery + pollable index) | Partial — no RSS confirmed | 1–3 | Free | gov-public-domain | Orders, NOPRs, enforcement — primary regulatory signal |
| RTO Insider | RTO Insider LLC | https://www.rtoinsider.com/ | TBV (likely /feed/, WordPress) | No | 5–15 | Paywalled articles, public headlines | paywalled | Deepest dedicated coverage of all 7 ISO/RTO stakeholder processes |
| Utility Dive | Industry Dive | https://www.utilitydive.com/ | https://www.utilitydive.com/feeds/news/ | Yes | 5–10 | Free | public-rss | Daily utility/grid news incl. data-center load-growth beat (also D11/D22) |
| NERC Newsroom | NERC | https://www.nerc.com/news/Pages/default.aspx | TBV (no RSS found; pollable index) | Partial | 0.2–0.5 | Free | public-rss (TBV) | Reliability standards, alerts, seasonal assessments |
| POLITICO Energy | POLITICO | https://www.politico.com/energy | TBV (rss.politico.com/energy.xml historical) | No | 5–10 | Headlines free, Pro paywalled | paywalled | Beltway energy policy — FERC nominations, permitting legislation |
| E&E News (Energywire) | POLITICO (E&E) | https://www.eenews.net/ | TBV | No | 10–20 | Paywalled | paywalled | Premier energy-regulatory trade press |
| S&P Global Commodity Insights — Electric Power | S&P Global | https://www.spglobal.com/commodityinsights/en/market-insights/latest-news/electric-power | TBV | No | 5–15 | Headlines free | paywalled | Market/regulatory wire incl. data-center power deals |
| PJM Inside Lines | PJM | https://insidelines.pjm.com/ | TBV (WordPress /feed/) | No | 0.5–1 | Free | public-rss | Largest ISO by DC load; interconnection + capacity-market news |
| ERCOT News | ERCOT | https://www.ercot.com/news | TBV | No | 0.3–1 | Free | public-rss | TX large-load interconnection (SB6 era) press + market notices |
| MISO Media Center | MISO | https://www.misoenergy.org/about/media-center/ | TBV | No | 0.2–0.5 | Free | public-rss | Central-US queue reform, capacity shortfall news |
| CAISO News Releases | CAISO | https://www.caiso.com/about/news | TBV | No | 0.2–0.5 | Free | public-rss | Western grid, FMM/EDAM expansion |
| ISO-NE News | ISO New England | https://www.iso-ne.com/about/news-media/ | TBV | No | 0.2 | Free | public-rss | New England capacity + large-load posture |
| POWER Magazine | Access Intelligence | https://www.powermag.com/ | TBV (/feed/) | No | 3–6 | Free | public-rss | (cross-listed D2) |
| Canary Media | Canary Media Inc. | https://www.canarymedia.com/ | https://www.canarymedia.com/rss-feed | Yes | 3–5 | Free | public-rss | (cross-listed D2/D11) |
| NYISO Newsroom | NYISO | https://www.nyiso.com/newsroom | TBV | No | 0.2 | Free | public-rss | NY large-load + queue news |

# D4 — M&A & Capital Markets

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| SEC EDGAR Latest Filings — 8-K Atom | U.S. SEC | https://www.sec.gov/edgar | https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K&company=&count=40&output=atom | Yes (sec.gov/about/rss-feeds) | 100s (filter to DC universe) | open | gov-public-domain | Primary-source deal events: 8-Ks from DLR, EQIX, IRM, hyperscalers, neoclouds |
| SEC EDGAR Full-Text Search API | U.S. SEC | https://www.sec.gov/edgar/search/ | https://efts.sec.gov/LATEST/search-index?q=%22data%20center%22&forms=8-K | Yes | query-driven | open | gov-public-domain | Keyword-pollable JSON API over all filings incl. 13F |
| GlobeNewswire (category feeds) | Notified | https://www.globenewswire.com | https://www.globenewswire.com/rss/list | Yes | 50+ per category | open | public-rss | REIT earnings, financing closes, fund launches |
| Business Wire industry feeds | Berkshire Hathaway | https://www.businesswire.com | via https://www.businesswire.com/help/feed-options | Yes | 30–100 | open | public-rss | Deal/financing PRs; keyword-configurable RSS |
| DCD — Investment channel | DCD | https://www.datacenterdynamics.com/en/tag/investment/ | https://www.datacenterdynamics.com/en/atom/ | Pattern | 15–25 (filter tag) | open | public-rss | Most complete DC-specific M&A/financing stream (also D22) |
| Infrastructure Investor | PEI Group | https://www.infrastructureinvestor.com | https://www.infrastructureinvestor.com/feed/ | No (WP pattern) | 3–6 | headline free / paywall | paywalled | Infra-fund and digital-infrastructure PE deal coverage |
| Nareit — REIT.com news | Nareit | https://www.reit.com | TBV | No | 1–3 | open | public-rss | DC REIT sector news, indices, capital-markets commentary |
| PE Hub | PEI Group | https://www.pehub.com | https://www.pehub.com/feed/ | No (WP pattern) | 5–10 | headline free / paywall | paywalled | US PE deal flow incl. digital infra (2nd PEI — at cap) |
| IPE Real Assets | IPE International Publishers | https://realassets.ipe.com | TBV | No | 3–5 | free registration | paywalled | Institutional capital allocations to DC/digital infra |
| S&P Global Market Intelligence news | S&P Global | https://www.spglobal.com/market-intelligence/en/news-insights | TBV | No | 5–10 | mixed | restrictive-tos | 451 lineage; DC M&A league tables |
| The Information | The Information | https://www.theinformation.com | https://www.theinformation.com/feed | No | 3–5 | headline feed public | paywalled | Breaks GPU-backed financing / neocloud deals |
| PitchBook News | PitchBook (Morningstar) | https://pitchbook.com/news | TBV | No | 5–8 | open articles | restrictive-tos | VC/PE deal reporting on AI-infrastructure |
| Institutional Real Estate Inc. (IREI) | IREI | https://irei.com | TBV | No | 2–4 | headline free / paywall | paywalled | Infra/real-asset fund closes and DC allocations |
| Commercial Mortgage Alert | Green Street News | https://www.greenstreet.com/news | TBV | No | 2–4 | paywall | restrictive-tos | CMBS/SASB DC securitizations — legal read needed |

# D5 — Hyperscaler Activity

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| AWS News Blog | Amazon | https://aws.amazon.com/blogs/aws/ | https://aws.amazon.com/blogs/aws/feed/ | No* | 2 | Open | public-rss | Region/service launches, capex-signaling announcements |
| AWS What's New | Amazon | https://aws.amazon.com/new/ | https://aws.amazon.com/about-aws/whats-new/recent/feed/ | No* | 10+ | Open | public-rss | Machine-grain feed of every AWS launch incl. new regions/AZs |
| Microsoft Azure Blog | Microsoft | https://azure.microsoft.com/en-us/blog/ | TBV | No | 1.5 | Open | public-rss | Azure infrastructure and region announcements |
| Microsoft Source | Microsoft | https://news.microsoft.com | https://news.microsoft.com/feed/ | No* | 2 | Open | public-rss | Corporate news incl. DC investment country announcements |
| Google Cloud Blog | Google | https://cloud.google.com/blog | TBV | No | 3 | Open | public-rss | GCP region/TPU/infrastructure announcements |
| Meta Newsroom | Meta | https://about.fb.com/news/ | https://about.fb.com/news/feed/ | No* | 1 | Open | public-rss | Meta DC investment announcements |
| Meta Engineering | Meta | https://engineering.fb.com | https://engineering.fb.com/feed/ | No* | 0.3 | Open | public-rss | Cluster/infra engineering disclosures that reveal scale |
| Oracle News | Oracle | https://www.oracle.com/news/ | TBV | No | 1 | Open | public-rss | OCI capex and Stargate-related announcements |
| OpenAI News | OpenAI | https://openai.com/news/ | TBV (rss.xml reported) | No | 0.5 | Open | public-rss | Stargate/compute-deal primary source |
| Anthropic Newsroom | Anthropic | https://www.anthropic.com/news | TBV (no public RSS — index poll) | No | 0.3 | Open | public-rss | Compute partnership announcements |
| SiliconANGLE | SiliconANGLE Media | https://siliconangle.com | https://siliconangle.com/feed/ | No* | 8 | Open | public-rss | Fast cloud/AI-infra news desk incl. earnings capex |
| The Stack | The Stack Technology | https://www.thestack.technology | TBV | No | 1 | Free + paid | paywalled | Sharp enterprise-cloud reporting, hyperscaler infra scoops |
| TechCrunch | Yahoo (TechCrunch) | https://techcrunch.com | https://techcrunch.com/feed/ | No* | 15 | Open | public-rss | AI-lab funding/compute deals; high volume, filterable |
| CNBC Technology | CNBC | https://www.cnbc.com/technology/ | TBV (legacy ID-based RSS) | No | 10 | Open | public-rss | Capex guidance from earnings; fast headlines |
| Capacity Media | Euromoney/Delinian | https://www.capacitymedia.com | TBV | No | 2 | Open (some reg-wall) | paywalled | Carrier/DC-adjacent hyperscaler expansion (also D12/D22) |

# D6 — New Entrants

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| CoreWeave Newsroom | CoreWeave | https://www.coreweave.com/newsroom | TBV (IR press RSS likely) | No | 0.2 | Open | public-rss | Largest neocloud; contract + DC expansion announcements |
| Crusoe Blog | Crusoe | https://www.crusoe.ai/blog | TBV | No | 0.1 | Open | public-rss | Energy-first AI DC developer (Abilene/Stargate builder) |
| Lambda Blog | Lambda | https://lambda.ai/blog | TBV | No | 0.15 | Open | public-rss | GPU cloud; capacity + funding announcements |
| Nebius Newsroom | Nebius Group | https://nebius.com/newsroom | TBV | No | 0.15 | Open | public-rss | Fast-scaling international neocloud (NBIS) |
| Together AI Blog | Together AI | https://www.together.ai/blog | TBV | No | 0.2 | Open | public-rss | GPU cloud + inference platform buildouts |
| Voltage Park Blog | Voltage Park | https://www.voltagepark.com/blog | TBV | No | 0.05 | Open | public-rss | Emerging US GPU cloud |
| TensorWave Blog | TensorWave | https://tensorwave.com/blog | TBV | No | 0.05 | Open | public-rss | AMD-based neocloud — non-NVIDIA buildout signal |
| Fluidstack | Fluidstack | https://www.fluidstack.io | TBV | No | 0.05 | Open | public-rss | Neocloud doing multi-GW colocation deals |
| Applied Digital News | Applied Digital | https://ir.applieddigital.com | TBV (IR press RSS) | No | 0.1 | Open | public-rss | Miner-to-AI-DC converter (Ellendale); lease announcements |
| IREN Newsroom | IREN Ltd | https://iren.com | TBV (IR press RSS) | No | 0.1 | Open | public-rss | Miner-to-AI-cloud pivot; capacity contracts |
| Northern Data Newsroom | Northern Data Group | https://northerndata.de | TBV | No | 0.1 | Open | public-rss | European neocloud (Taiga/Ardent) |
| G42 News | G42 | https://www.g42.ai | TBV | No | 0.1 | Open | public-rss | Gulf AI-infra entrant; sovereign-scale buildouts |
| The Tech Capital | The Tech Capital | https://www.thetechcapital.com | TBV (likely /feed) | No | 3 | Free + paid | paywalled | DC finance/deals press — earliest on new entrants |
| W.Media | W.Media | https://w.media | TBV (likely /feed) | No | 2 | Open | public-rss | APAC DC trade press; regional new-operator coverage (also D22) |
| Data Centre Magazine | BizClik | https://datacentremagazine.com | TBV | No | 2 | Open | public-rss | Broad operator/developer announcements |

# D7 — Cooling & Water Technology

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Cooling Post | Cooling Post Ltd | https://www.coolingpost.com | https://www.coolingpost.com/feed/ (WordPress) | No (RSS exists; WP default path) | 2–3 | Free | public-rss | Independent daily AC/refrigeration/heat-pump news incl. DC cooling |
| DCD — Cooling channel | Data Centre Dynamics | https://www.datacenterdynamics.com | https://www.datacenterdynamics.com/en/rss/ (feed index) | No | 5–10 (cooling subset ~1–2) | Free | public-rss | Leading DC trade press cooling vertical (also D22) |
| Data Center Frontier | Endeavor Business Media | https://www.datacenterfrontier.com | TBV | No | 2–4 | Free | public-rss | Deep liquid-cooling and thermal-density coverage (also D22) |
| Electronics Cooling | ITEM Media | https://www.electronics-cooling.com | https://www.electronics-cooling.com/feed/ | No | 0.3–1 | Free | public-rss | Engineering-grade thermal management, immersion/cold-plate |
| Vertiv — News & Insights | Vertiv | https://www.vertiv.com/en-us/about/news-and-insights/ | TBV | No | 0.3–0.5 | Free | restrictive-tos | Named cooling vendor (also D2) |
| nVent Newsroom | nVent | https://www.nvent.com/en-us/about-us/news | TBV | No | 0.1–0.3 | Free | restrictive-tos | Liquid cooling (nVent/Iceotope) |
| CoolIT Systems News | CoolIT Systems | https://www.coolitsystems.com | TBV | No | 0.1 | Free | restrictive-tos | Named DLC vendor; hyperscale cold-plate deals |
| LiquidStack News | LiquidStack | https://www.liquidstack.com/news | TBV | No | 0.1 | Free | restrictive-tos | Named immersion vendor |
| Submer Blog/News | Submer | https://submer.com/blog/ | https://submer.com/feed/ | No | 0.1–0.2 | Free | restrictive-tos | Named immersion vendor |
| Boyd Newsroom | Boyd Corporation | https://www.boydcorp.com | TBV | No | 0.1 | Free | restrictive-tos | Liquid cooling loops/CDUs |
| ASHRAE News | ASHRAE | https://www.ashrae.org/about/news | TBV | No | 0.1–0.2 | Free | restrictive-tos | TC 9.9 thermal guidelines drive DC cooling standards |
| Smart Water Magazine | SWM | https://smartwatermagazine.com | TBV (Drupal /rss likely) | No | 3–5 | Free | public-rss | Water-utility/tech news incl. DC water-use stories |
| WaterWorld | Endeavor Business Media | https://www.waterworld.com | TBV | No | 2–4 | Free | public-rss | US municipal water sector news |
| Water Online | VertMarkets | https://www.wateronline.com | TBV | No | 1–3 | Free (reg some) | restrictive-tos (flag) | Water treatment/reuse tech news |

# D8 — People & Signals (no LinkedIn/X)

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| PR Newswire (category RSS) | Cision | https://www.prnewswire.com | https://www.prnewswire.com/rss/ (index) | Yes | 100s (filter) | open | public-rss | Largest volume of "X appoints Y" DC/AI-infra people releases |
| Business Wire (keyword/industry RSS) | Berkshire Hathaway | https://www.businesswire.com | via https://www.businesswire.com/help/feed-options | Yes | 30–100 | open | public-rss | Configurable to technology/personnel keywords (also D4) |
| GlobeNewswire | Notified | https://www.globenewswire.com | https://www.globenewswire.com/rss/list | Yes | 50+ | open | public-rss | Mid-cap operator exec announcements (also D4) |
| DCD — People/Workforce tag | DCD | https://www.datacenterdynamics.com/en/tag/people/ | https://www.datacenterdynamics.com/en/atom/ (filter) | Pattern | 2–4 | open | public-rss | Curated DC exec-move reporting |
| Capacity Media — People moves | Euromoney/Delinian | https://www.capacitymedia.com | TBV | No | 1–3 | free registration | paywalled | Dedicated telecoms/DC people-moves franchise |
| Data Center Post | iMiller Public Relations | https://datacenterpost.com | https://datacenterpost.com/feed/ | Yes | 2–4 | open | public-rss | Appointment/partnership PRs across colo/interconnection (also D12) |
| Telecom Ramblings | Ramblings LLC | https://www.telecomramblings.com | https://www.telecomramblings.com/feed/ | Yes | 3–6 | open | public-rss | Industry-people + M&A roundups in fiber/DC (also D12) |
| CRN — Channel people news | The Channel Company | https://www.crn.com | TBV | No | 10–20 | open | public-rss | Exec moves at OEMs/integrators serving DC build-outs |
| HR Dive | Industry Dive | https://www.hrdive.com | https://www.hrdive.com/feeds/news/ | Pattern | 5–8 | open | public-rss | Hiring/labor-market signal layer (also D17) |
| Staffing Industry Analysts — Daily News | SIA (Crain) | https://www.staffingindustry.com | TBV | No | 5–10 | free registration | paywalled | Hiring-demand signals incl. DC construction/tech staffing (also D17) |
| 7x24 Exchange newsroom | 7x24 Exchange Intl | https://www.7x24exchange.org | TBV | No | <1 | open | public-rss | Core DC industry conference org |
| Data Center World / AFCOM | Informa | https://www.datacenterworld.com | TBV | No | <1 | open | restrictive-tos | Flagship conference programming/speaker signals |
| InterGlobix Magazine | InterGlobix | https://interglobixmagazine.com | https://interglobixmagazine.com/feed/ | No (WP pattern) | 1–2 | open | public-rss | Executive interviews/profiles across digital infrastructure |

# D9 — Orchestration Intelligence & Control Plane

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| NVIDIA Technical Blog | NVIDIA | https://developer.nvidia.com/blog | https://developer.nvidia.com/blog/feed | No* | 2 | Open | public-rss | AI-factory orchestration primary source (Base Command, Run:ai, NVL) |
| Kubernetes Blog | CNCF/K8s project | https://kubernetes.io/blog/ | https://kubernetes.io/feed.xml | No* | 0.3 | Open | public-rss | DRA/device-plugin evolution — the substrate of GPU scheduling |
| CNCF Blog | CNCF | https://www.cncf.io/blog/ | https://www.cncf.io/feed/ | No* | 1.5 | Open | public-rss | Ecosystem orchestration project news (Kueue, Volcano) |
| The New Stack | The New Stack | https://thenewstack.io | https://thenewstack.io/feed/ | No* | 5 | Open | public-rss | Cluster orchestration and AI platform engineering trade press |
| Run:ai Blog | NVIDIA (Run:ai) | https://www.run.ai/blog | TBV | No | 0.1 | Open | public-rss | GPU orchestration category leader |
| Anyscale Blog | Anyscale | https://www.anyscale.com/blog | TBV | No | 0.2 | Open | public-rss | Ray — dominant distributed-AI scheduling framework |
| SkyPilot Blog | SkyPilot | https://blog.skypilot.co | TBV | No | 0.1 | Open | public-rss | Multi-cloud GPU scheduling OSS |
| SchedMD News | SchedMD | https://www.schedmd.com | TBV | No | 0.03 | Open | public-rss | Slurm — HPC/AI batch scheduler standard |
| Sunbird DCIM Blog | Sunbird Software | https://www.sunbirddcim.com/blog | TBV | No | 0.15 | Open | public-rss | Pure-play DCIM vendor |
| Nlyte Blog | Nlyte (Carrier) | https://www.nlyte.com/blog/ | TBV | No | 0.1 | Open | public-rss | Enterprise DCIM — BMS/DCIM convergence signal |
| Hyperview Blog | Hyperview | https://www.hyperviewhq.com/blog | TBV | No | 0.1 | Open | public-rss | Cloud-native DCIM challenger |
| Device42 Blog | Device42 (Freshworks) | https://www.device42.com/blog/ | TBV | No | 0.15 | Open | public-rss | Infrastructure discovery/DCIM-adjacent |
| NetBox Labs Blog | NetBox Labs | https://netboxlabs.com/blog/ | TBV | No | 0.15 | Open | public-rss | Source-of-truth infrastructure modeling (DCIM/IPAM OSS) |
| EkkoSense News | EkkoSense | https://www.ekkosense.com | TBV | No | 0.05 | Open | public-rss | AI-driven cooling/capacity optimization software |

# D10 — Construction

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Construction Dive | Industry Dive | https://www.constructiondive.com | https://www.constructiondive.com/feeds/news/ | Yes | 5–8 | Free | public-rss | Best free daily construction news; frequent DC-build coverage (also D17) |
| ENR (Engineering News-Record) | BNP Media | https://www.enr.com | https://www.enr.com/rss (index) | Yes | 5–10 | Headlines free | paywalled | Flagship construction trade; megaproject/DC coverage (also D17) |
| Construction Physics | Brian Potter (Substack) | https://www.construction-physics.com | https://www.construction-physics.com/feed | Yes | 0.2–0.3 | Free/partial paid | public-rss | Analytical essays incl. DC construction economics |
| Building Design+Construction | SGC Horizon | https://www.bdcnetwork.com | TBV | No | 3–5 | Free | public-rss | AEC news with data-center sector vertical |
| AGC of America Newsroom | AGC | https://www.agc.org/news | TBV | No | 0.3–1 | Free | restrictive-tos | Industry stats, labor, policy affecting DC builds (also D17) |
| Turner Construction News | Turner | https://www.turnerconstruction.com/news | TBV | No | 0.1–0.3 | Free | restrictive-tos | Top DC general contractor |
| DPR Construction Newsroom | DPR | https://www.dpr.com/media/news | TBV | No | 0.1–0.2 | Free | restrictive-tos | Major advanced-tech/DC GC |
| Mortenson Newsroom | Mortenson | https://www.mortenson.com | TBV | No | 0.1–0.2 | Free | restrictive-tos | Major DC/mission-critical builder |
| HITT Contracting News | HITT | https://www.hitt.com/news | TBV | No | 0.1 | Free | restrictive-tos | NoVA-centric DC GC |
| Holder Construction News | Holder | https://www.holderconstruction.com | TBV | No | <0.1 | Free | restrictive-tos | Top-3 US data-center GC |
| Modular Building Institute News | MBI | https://www.modular.org | TBV | No | 0.1–0.3 | Free | restrictive-tos | Modular/prefab DC construction |
| For Construction Pros | IRONMARKETS | https://www.forconstructionpros.com | TBV | No | 3–6 | Free | public-rss | Equipment/labor signals |
| Construction Briefing | KHL Group | https://www.constructionbriefing.com | TBV | No | 2–4 | Free | public-rss | Global construction news, hyperscale DC items |
| Dodge Construction Network News | Dodge | https://www.construction.com/news | TBV | No | 0.1–0.2 | Free | restrictive-tos | Construction-starts data releases (leading indicator) |

# D11 — Sustainability

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Canary Media | Canary Media (nonprofit) | https://www.canarymedia.com | https://www.canarymedia.com/rss-feed | Yes | 3–5 | Free | public-rss | Clean-energy transition news; heavy DC-power coverage |
| Latitude Media | Latitude Media | https://www.latitudemedia.com | TBV | No | 1–3 | Free (some reg) | public-rss | Frontier climate-tech + data-center energy beat (also D2) |
| Trellis (ex-GreenBiz) | Trellis Group | https://trellis.net | https://trellis.net/feed/ | No | 3–5 | Free | public-rss | Corporate sustainability/ESG practice news |
| ESG Dive | Industry Dive | https://www.esgdive.com | https://www.esgdive.com/feeds/news/ | Yes | 3–5 | Free | public-rss | ESG disclosure/regulation news |
| Utility Dive | Industry Dive | https://www.utilitydive.com | https://www.utilitydive.com/feeds/news/ | Yes | 5–8 | Free | public-rss | (cross-listed D3/D22; 2nd Industry Dive — at cap) |
| EPA Newsroom | US EPA | https://www.epa.gov/newsroom | Filterable RSS via newsroom browse (XML view) | Yes (mechanism) | 2–5 | Free | gov-public-domain | Enforcement, permitting, air/water rules |
| RMI News & Insights | RMI | https://rmi.org | https://rmi.org/feed/ | No | 0.5–1 | Free | restrictive-tos | Energy-transition research/announcements |
| IEA News | International Energy Agency | https://www.iea.org/news | TBV | No | 0.3–1 | Free | restrictive-tos (IEA terms) | Global energy + DC electricity demand reports |
| PV Magazine USA | pv magazine group | https://www.pv-magazine-usa.com | https://www.pv-magazine-usa.com/feed/ | No | 4–6 | Free | public-rss | Solar/storage project + PPA market news |
| Inside Climate News | ICN (nonprofit) | https://insideclimatenews.org | https://insideclimatenews.org/feed/ | No | 2–4 | Free | public-rss (republishable CC) | Climate accountability journalism incl. DC siting |
| Grist | Grist (nonprofit) | https://grist.org | https://grist.org/feed/ | No | 3–5 | Free | public-rss (republishable) | Climate news; community-impact angles |
| Heatmap News | Heatmap | https://heatmap.news | TBV | No | 3–5 | Paywalled (headline feed) | paywalled | High-quality energy/climate analysis, strong DC beat |
| CleanTechnica | CleanTechnica | https://cleantechnica.com | https://cleantechnica.com/feed/ | No | 8–12 | Free | public-rss | High-volume clean-energy news (noisier; rank lower) |
| Renewable Energy World | Endeavor Business Media | https://www.renewableenergyworld.com | TBV | No | 2–4 | Free | public-rss | Renewables project/REC market coverage |

# D12 — Networking & Interconnect

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Telecom Ramblings | Rob Powell | https://www.telecomramblings.com | https://www.telecomramblings.com/feed/ | Yes | 2–4 | Free | public-rss | The core fiber/interconnect deal-tracking blog |
| Data Center POST | JSA | https://datacenterpost.com | https://datacenterpost.com/feed/ | Yes | 1–2 | Free | public-rss | DC ecosystem + interconnection vendor news |
| Submarine Telecoms Forum | SubTel Forum | https://subtelforum.com | TBV ("News Now" RSS confirmed; likely /feed) | No | 3–5 | Free | public-rss | The subsea-cable industry news source |
| Fierce Network (ex-FierceTelecom) | Questex | https://www.fierce-network.com | TBV | No | 5–8 | Free (reg-wall some) | public-rss | Telecom/fiber/cloud networking daily news |
| Lightwave | Endeavor Business Media | https://www.lightwaveonline.com | TBV | No | 2–4 | Free | public-rss | Optical networking/fiber tech trade press |
| Capacity Media | Euromoney/Delinian | https://www.capacitymedia.com | TBV | No | 3–5 | Partial paywall | paywalled | Wholesale carrier, subsea, interconnect M&A (also D5/D22) |
| Broadband Breakfast | Breakfast Media | https://broadbandbreakfast.com | TBV (Ghost → /rss likely) | No | 2–4 | Free/partial paid | public-rss | US broadband policy/BEAD/fiber-buildout news |
| ISE Magazine | ISE | https://isemag.com | TBV | No | 1–2 | Free | public-rss | OSP fiber engineering trade press |
| TeleGeography Blog | TeleGeography | https://blog.telegeography.com | TBV (HubSpot → /rss.xml likely) | No | 0.3–0.5 | Free | restrictive-tos | Subsea/terrestrial route and capacity analysis |
| Equinix Interconnections Blog | Equinix | https://blog.equinix.com | https://blog.equinix.com/feed/ | No | 0.5–1 | Free | restrictive-tos | Interconnection ecosystem signals |
| Zayo Newsroom | Zayo | https://www.zayo.com/newsroom/ | TBV | No | 0.1–0.3 | Free | restrictive-tos | Long-haul/dark-fiber route builds |
| Lumen Newsroom | Lumen Technologies | https://news.lumen.com | TBV | No | 0.2–0.5 | Free | restrictive-tos | Conduit/fiber network news |
| Ciena Newsroom/Insights | Ciena | https://www.ciena.com/about/newsroom/ | TBV | No | 0.2–0.4 | Free | restrictive-tos | Optical capacity demand signals |
| Corning News Center | Corning | https://www.corning.com/worldwide/en/about-us/news-events.html | TBV | No | 0.2–0.4 | Free | restrictive-tos | Fiber supply/demand indicator |
| Fiber Broadband Association News | FBA | https://fiberbroadband.org | TBV | No | 0.1–0.3 | Free | restrictive-tos | Fiber deployment industry association |

# D13 + D18 — Community Relations / Opposition & Regulatory Risk (combined)

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Route Fifty | GovExec | https://www.route-fifty.com | TBV (RSS offered; likely /rss/all/) | No (RSS exists) | 3–5 | Free | public-rss | State/local gov news incl. DC zoning & tax fights (also D19) |
| Governing | e.Republic | https://www.governing.com | https://www.governing.com/rss | Yes | 2–4 | Free | public-rss | State/local policy analysis (also D19) |
| Planetizen | Planetizen | https://www.planetizen.com | https://www.planetizen.com/frontpage/feed | Yes | 5–8 | Free | public-rss | Land-use/zoning news — opposition early-warning |
| Virginia Mercury | States Newsroom | https://virginiamercury.com | https://virginiamercury.com/feed/ | No | 3–5 | Free | public-rss (CC republishable) | Best statehouse coverage of VA data-center policy |
| Arizona Mirror | States Newsroom | https://azmirror.com | https://azmirror.com/feed/ | No | 2–4 | Free | public-rss (CC republishable) | Phoenix-market DC water/power policy (2nd States Newsroom — at cap) |
| Cardinal News | Cardinal News (nonprofit) | https://cardinalnews.org | https://cardinalnews.org/feed/ | No | 2–3 | Free | public-rss (republishable) | SW/Southside VA — emerging DC siting + opposition |
| InsideNoVa | Rappahannock Media | https://www.insidenova.com | TBV (BLOX CMS → /search/?f=rss&t=article) | No | 5–10 | Free/metered | public-rss | Prince William/NoVA — ground zero for DC opposition |
| Loudoun Times-Mirror | Ogden Newspapers | https://www.loudountimes.com | TBV (BLOX CMS pattern) | No | 3–5 | Paywalled | paywalled | Data Center Alley's paper of record |
| Prince William Times | Piedmont Media | https://www.princewilliamtimes.com | TBV (BLOX CMS pattern) | No | 2–4 | Metered paywall | paywalled | PW Digital Gateway fight coverage |
| Piedmont Environmental Council | PEC | https://www.pecva.org | https://www.pecva.org/feed/ | No | 0.3–0.5 | Free | restrictive-tos (advocacy) | Leading organized DC-opposition group in VA — direct D18 signal |
| Data Center Watch | 10Q (research) | https://www.datacenterwatch.org | TBV (report site; feed unlikely) | No | <0.1 | Free | restrictive-tos (flag) | Tracks blocked/delayed DC projects + opposition nationally |
| Columbus Dispatch (metro) | Gannett | https://www.dispatch.com | TBV (Gannett RSS limited/deprecated) | No | 5–10 | Paywalled | paywalled | Central Ohio DC boom (New Albany/Intel corridor) |
| Atlanta Business Chronicle | ACBJ | https://www.bizjournals.com/atlanta | TBV (ACBJ RSS largely discontinued) | No | 3–5 | Paywalled | restrictive-tos (flag) | Atlanta DC market deals + zoning |
| Phoenix Business Journal | ACBJ | https://www.bizjournals.com/phoenix | TBV (2nd ACBJ — at cap) | No | 3–5 | Paywalled | restrictive-tos (flag) | Phoenix/Mesa DC market + water politics |
| San Antonio Express-News (tech/biz) | Hearst | https://www.expressnews.com | TBV (Hearst RSS varies) | No | 2–4 | Paywalled | paywalled | San Antonio/New Braunfels DC growth market |
| American City & County | Endeavor Business Media | https://www.americancityandcounty.com | TBV | No | 1–2 | Free | public-rss | Municipal administration/procurement perspective |

# D14 — Real Estate & Site Selection

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Bisnow — Data Center (national) | Bisnow | https://www.bisnow.com/data-center | https://www.bisnow.com/rss (DC tag feed TBV) | Yes (main /rss) | 3–8 | free registration | public-rss | Deepest daily CRE-angle DC coverage by market (also D22) |
| CBRE Media Center / Research | CBRE | https://www.cbre.com/about/media-center | TBV | No | 1–3 | open | restrictive-tos | Semiannual DC Trends + market research |
| JLL Newsroom | JLL | https://www.jll.com/en-us/newsroom | TBV | No | 1–3 | open | restrictive-tos | DC Outlook reports, transactions |
| Cushman & Wakefield News | Cushman & Wakefield | https://www.cushmanwakefield.com/en/united-states/news | TBV | No | 1–2 | open | restrictive-tos | Global DC Market Comparison + Americas research |
| CoStar News | CoStar Group | https://www.costar.com/news | TBV (no public RSS known) | No | 10–20 | open articles | restrictive-tos (legal read) | Land assemblage / DC campus deal scoops |
| GlobeSt | ALM | https://www.globest.com | TBV | No | 10–15 | free registration | paywalled | National CRE incl. data-center vertical |
| Commercial Observer | Observer Media | https://commercialobserver.com | https://commercialobserver.com/feed/ | No (WP pattern) | 8–12 | headline free / metered | paywalled | DC leasing/financing, NoVA + national |
| Site Selection Magazine | Conway Inc. | https://siteselection.com | TBV | No | 2–4 | open | public-rss | Site-selection trade of record |
| Area Development | Halcyon | https://www.areadevelopment.com | TBV | No | 2–4 | open | public-rss | Corporate facility siting + incentives context |
| Business Facilities | Group C Media | https://businessfacilities.com | https://businessfacilities.com/feed/ | No (WP pattern) | 3–5 | open | public-rss | Economic-development location announcements |
| Commercial Property Executive | Yardi (CPE) | https://www.commercialsearch.com/news/ | https://www.commercialsearch.com/news/feed/ | No (WP pattern) | 8–12 | open | public-rss | National CRE with recurring DC coverage |
| REBusinessOnline | France Media | https://rebusinessonline.com | https://rebusinessonline.com/feed/ | No (WP pattern) | 10–15 | open | public-rss | Regional deal-level coverage — secondary-market DC land buys |
| The Real Deal | Korangy Publishing | https://therealdeal.com | https://therealdeal.com/feed/ | No (WP pattern) | 15–25 | metered | paywalled | Land/entitlement scoops in TX, VA, NY |
| Equinix Newsroom | Equinix | https://www.equinix.com/newsroom | TBV | No | <1 | open | restrictive-tos | Colo operator anchor — expansions, land purchases |
| Digital Realty — Press Releases | Digital Realty | https://www.digitalrealty.com/about/press-releases | TBV | No | <1 | open | restrictive-tos | Second colo/REIT operator newsroom anchor |

# D15 — Sovereign AI & Geopolitics

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| BIS News & Updates | Commerce/BIS | https://www.bis.gov/news-updates | TBV (RSS referenced; path TBV; domain moved from bis.doc.gov) | Partial | 0.5–2 | Free | gov-public-domain | Export-control actions, Entity List adds — core D15 signal |
| Federal Register — BIS agency feed (anchor) | NARA/GPO | https://www.federalregister.gov/agencies/industry-and-security-bureau | Per-agency .rss + JSON API (documented) | Yes | 0.5–2 | Free | gov-public-domain | Legally operative export-control/CFIUS rule text at publication |
| Commerce Dept. Newsroom | Dept. of Commerce | https://www.commerce.gov/news | TBV | No | 1–3 | Free | gov-public-domain | Secretary-level chip/AI policy announcements |
| Treasury Press Releases (CFIUS) | U.S. Treasury | https://home.treasury.gov/news/press-releases | TBV | No | 2–5 | Free | gov-public-domain | CFIUS actions, outbound-investment rules |
| CSIS | CSIS | https://www.csis.org/ | TBV (no article RSS confirmed) | Partial | 2–5 | Free | public-rss (TBV) | Chip/export-control analysis |
| Brookings — AI topic | Brookings | https://www.brookings.edu/topics/artificial-intelligence/ | TBV (WordPress topic /feed/) | No | 1–2 | Free | public-rss | AI governance + compute policy research |
| CSET Georgetown | CSET | https://cset.georgetown.edu/ | TBV | No | 0.3–1 | Free | public-rss | Compute/export-control data-driven analysis — highest signal-to-noise |
| RAND | RAND Corp. | https://www.rand.org/topics/artificial-intelligence.html | TBV (topic RSS published) | No | 0.5–1 | Free | public-rss | National-security AI/compute reports |
| CNAS | CNAS | https://www.cnas.org/ | TBV | No | 0.5 | Free | public-rss | Technology & national security program |
| Carnegie Endowment — Technology | Carnegie | https://carnegieendowment.org/programs/technology | TBV | No | 0.5 | Free | public-rss | Sovereign AI, global compute governance |
| Stanford HAI News | Stanford HAI | https://hai.stanford.edu/news | TBV | No | 0.5 | Free | public-rss | National AI policy + compute index research |
| OECD.AI Policy Observatory | OECD | https://oecd.ai/ | TBV | No | 0.3 | Free | public-rss (TBV) | Cross-national AI/compute program tracker |
| Export Compliance Daily | Warren Communications | https://exportcompliancedaily.com/ | TBV | No | 3–8 | Paywalled | restrictive-tos (legal read) | Daily export-control trade wire |
| White House Briefing Room | White House | https://www.whitehouse.gov/briefing-room/ | TBV (WordPress /feed/ historically) | No | 3–8 | Free | gov-public-domain | AI EOs, chip-diplomacy announcements |

# D16 — Cyber & Physical Security and Resilience

**Vetting finding: CISA retired RSS ~May 2025; NVD retired legacy RSS — both are API/index-poll now.**

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| CISA Cybersecurity Advisories | CISA | https://www.cisa.gov/news-events/cybersecurity-advisories | all.xml retired May 2025 — poll advisories index/GovDelivery | Partial (retirement flagged) | 2–6 | Free | gov-public-domain | Authoritative US advisories incl. ICS/OT for DC building systems |
| CISA KEV Catalog | CISA | https://www.cisa.gov/known-exploited-vulnerabilities-catalog | https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | Partial (well-documented) | 0.5–2 | Free | gov-public-domain | Exploited-in-wild vuln signal |
| NVD | NIST | https://nvd.nist.gov/ | https://services.nvd.nist.gov/rest/json/cves/2.0 (API 2.0) | Yes | 100+ | Free (rate-limited) | gov-public-domain | Canonical CVE feed |
| Google Threat Intelligence (Mandiant) | Google Cloud | https://cloud.google.com/blog/topics/threat-intelligence | TBV (RSS referenced) | Partial | 0.3–1 | Free | public-rss | Frontline APT/ransomware reporting incl. infrastructure targeting |
| Cisco Talos blog | Cisco | https://blog.talosintelligence.com/ | TBV (/rss/, Ghost standard) | No | 0.5–1 | Free | public-rss | High-volume threat research |
| Unit 42 | Palo Alto Networks | https://unit42.paloaltonetworks.com/ | TBV (/feed/) | No | 0.3–1 | Free | public-rss | Cloud + edge threat research |
| CrowdStrike blog | CrowdStrike | https://www.crowdstrike.com/blog/ | TBV (/blog/feed/) | No | 0.3–1 | Free | public-rss | Adversary tracking, eCrime intel |
| Dragos blog | Dragos | https://www.dragos.com/blog/ | TBV | No | 0.2–0.5 | Free | public-rss | THE OT/ICS threat feed — substation/BMS/cooling-relevant (also D20) |
| Claroty Team82 | Claroty | https://claroty.com/team82 | TBV | No | 0.1–0.3 | Free | public-rss | ICS/building-automation vuln research (also D20) |
| SecurityWeek | Wired Business Media | https://www.securityweek.com/ | TBV (feedburner historical) | No | 10–15 | Free | public-rss | Broad security news wire incl. ICS |
| BleepingComputer | BleepingComputer | https://www.bleepingcomputer.com/ | TBV (/feed/) | No | 8–12 | Free | public-rss | Fastest ransomware/outage-adjacent incident reporting |
| The Record | Recorded Future News | https://therecord.media/ | TBV (/feed) | No | 5–8 | Free | public-rss | Cybercrime + critical-infrastructure policy newsroom |
| SANS Internet Storm Center | SANS | https://isc.sans.edu/ | TBV (rssfeed_full.xml) | No | 1–3 | Free | public-rss | Daily diaries + infocon — early anomaly signal |
| Krebs on Security | Brian Krebs | https://krebsonsecurity.com/ | TBV (/feed/) | No | 0.3 | Free | public-rss | Investigative breach reporting |
| MSRC Security Update Guide | Microsoft | https://msrc.microsoft.com/update-guide | TBV (api.msrc RSS) | No | burst monthly | Free | public-rss | Patch-Tuesday signal |

# D17 — Workforce & Labor Markets

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| BLS Latest Numbers | BLS | https://www.bls.gov/feed/ | https://www.bls.gov/feed/bls_latest.rss | Yes | 0.5–1 (release-day bursts) | Free | gov-public-domain | CPI/CES/JOLTS headline indicator feed |
| BLS program news releases | BLS | https://www.bls.gov/newsroom/ | Per-program RSS listed at https://www.bls.gov/feed/ | Yes | 1–2 | Free | gov-public-domain | OES/ECI/state employment — county wage inputs |
| DOL Newsroom RSS | U.S. Dept. of Labor | https://www.dol.gov/newsroom | https://www.dol.gov/rss | Yes | 2–4 | Free | gov-public-domain | OSHA, WHD, apprenticeship + Davis-Bacon actions |
| Construction Dive | Industry Dive | https://www.constructiondive.com/ | https://www.constructiondive.com/feeds/news/ | Yes | 4–8 | Free | public-rss | DC-construction labor beat (also D10) |
| HR Dive | Industry Dive | https://www.hrdive.com/ | TBV (/feeds/news/ standard) | No | 4–6 | Free | public-rss | Employer labor-market + policy news (also D8) |
| AGC of America Newsroom | AGC | https://www.agc.org/news | TBV | No | 0.5–1 | Free | public-rss (TBV) | Construction-employment data, workforce surveys (also D10) |
| ABC Newsroom | Associated Builders & Contractors | https://www.abc.org/News-Media | TBV | No | 0.5 | Free | public-rss (TBV) | Construction backlog/Confidence indices |
| The Conference Board — Press | The Conference Board | https://www.conference-board.org/press/ | TBV | No | 0.5–1 | Press free; data paywalled | paywalled | Employment Trends Index, C-suite labor outlook |
| ENR | BNP Media | https://www.enr.com/ | TBV (/rss topic feeds) | No | 3–5 | Paywalled, public headlines | paywalled | Construction cost/labor indices (also D10) |
| Lightcast blog | Lightcast | https://lightcast.io/resources/blog | TBV | No | 0.2 | Free | public-rss (TBV) | Labor-market analytics |
| Indeed Hiring Lab | Indeed | https://www.hiringlab.org/ | TBV (/feed/, WordPress) | No | 0.2–0.5 | Free | public-rss | Real-time job-posting trend research |
| ADP Research / National Employment Report | ADP | https://adpemploymentreport.com/ | TBV | No | monthly burst | Free | public-rss (TBV) | Private-payroll alt-data signal |
| Economic Policy Institute | EPI | https://www.epi.org/ | TBV (/feed/) | No | 0.5–1 | Free | public-rss | Wage/labor-standards research incl. DC-subsidy critiques |
| SHRM News | SHRM | https://www.shrm.org/ | TBV | No | 2–4 | Partial member-gating | restrictive-tos (flag) | HR/workforce policy coverage |
| Staffing Industry Analysts — Daily News | SIA (Crain) | https://www2.staffingindustry.com/ | TBV | No | 3–5 | Headlines free | paywalled | Skilled-trades staffing market signal (also D8) |

# D19 — Tax, Incentives & Fiscal Policy

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Good Jobs First | Good Jobs First | https://goodjobsfirst.org | https://goodjobsfirst.org/feed/ | No (WP pattern) | <1 | open | public-rss | The subsidy-accountability source; tracks DC megadeal incentives |
| Tax Foundation | Tax Foundation | https://taxfoundation.org | https://taxfoundation.org/feed/ | No (WP pattern) | 1–3 | open | public-rss | State tax policy incl. DC sales-tax exemptions |
| Route Fifty | GovExec | https://www.route-fifty.com | https://www.route-fifty.com/rss/ (TBV) | No | 5–8 | open | public-rss | State/local gov news; DC-incentive fights (also D13/18) |
| Governing | e.Republic | https://www.governing.com | https://www.governing.com/rss | Yes | 4–6 | open | public-rss | State/local fiscal policy (also D13/18) |
| Stateline | States Newsroom | https://stateline.org | https://stateline.org/feed/ | No (WP pattern) | 2–4 | open | public-rss (CC-republishable) | Nonprofit statehouse coverage of tax/incentive legislation |
| ITEP | ITEP | https://itep.org | https://itep.org/feed/ | No (WP pattern) | <1 | open | public-rss | Critical analyses of state corporate tax breaks |
| Tax Policy Center — TaxVox | Urban Institute/Brookings | https://www.taxpolicycenter.org | TBV | No | <1 | open | public-rss | Federal/state tax policy analysis |
| Center on Budget & Policy Priorities | CBPP | https://www.cbpp.org | TBV | No | 1–2 | open | public-rss | State fiscal condition + revenue policy |
| Tax Notes (State) | Tax Analysts | https://www.taxnotes.com | TBV | No | 10+ | paywall | paywalled | The state-tax journal of record |
| Bloomberg Tax — Daily Tax Report: State | Bloomberg Industry Group | https://news.bloombergtax.com | TBV | No | 10+ | paywall | paywalled | Fast statehouse tax-bill reporting |
| NCSL — News & In-Session updates | NCSL | https://www.ncsl.org | TBV | No | 1–3 | open | public-rss | Already a product source — add its newsfeed |
| MultiState Insider | MultiState Associates | https://www.multistate.us/insider | https://www.multistate.us/insider/rss.xml (TBV) | No | 1–2 | open | public-rss | State legislative tracking incl. DC taxation |
| IEDC — Economic Development Now | IEDC | https://www.iedconline.org | TBV | No | <1 | open | restrictive-tos | Economic-development profession signals |
| Law360 — Tax Authority | LexisNexis | https://www.law360.com/tax-authority | TBV | No | 10+ | paywall | restrictive-tos (legal read) | Litigation angle on state tax/incentive disputes |

# D20 — Facility IT & Operational Technology

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Mission Critical Magazine | BNP Media | https://www.missioncriticalmagazine.com | TBV (BNP RSS exists) | No | 1.5 | Open (reg-wall some) | public-rss | THE facility-ops trade magazine for data centers |
| Uptime Institute Journal | Uptime Institute | https://journal.uptimeinstitute.com | https://journal.uptimeinstitute.com/feed/ | No* | 0.2 | Open | public-rss | Authoritative research on facility ops, outage causes (also D22) |
| Memoori | Memoori Research | https://memoori.com | https://memoori.com/feed/ | No* | 0.3 | Open (reports paid) | public-rss | Smart-building/BMS market analysis incl. DC BMS |
| AutomatedBuildings.com | AutomatedBuildings | https://www.automatedbuildings.com | TBV | No | 0.1 | Open | public-rss | BAS/controls practitioner columns (BACnet, Niagara) |
| ACHR News | BNP Media | https://www.achrnews.com | TBV | No | 2 | Open | public-rss | HVAC industry news incl. DC cooling controls |
| FacilitiesNet | Trade Press Media | https://www.facilitiesnet.com | TBV | No | 2 | Open | public-rss | Facility management software + BAS coverage |
| Facility Executive | Group C Media | https://facilityexecutive.com | TBV (likely /feed) | No | 1 | Open | public-rss | Facility software/controls product news |
| Smart Buildings Technology | Endeavor Business Media | https://www.smartbuildingstech.com | TBV | No | 0.7 | Open | public-rss | Building controls, digital twin, IT/OT convergence |
| Phaidra Blog | Phaidra | https://www.phaidra.ai | TBV | No | 0.05 | Open | public-rss | AI closed-loop facility control — category-defining |
| Honeywell Newsroom | Honeywell | https://www.honeywell.com/us/en/press | TBV | No | 0.5 | Open | public-rss | Major BMS vendor announcements |
| Johnson Controls Newsroom | Johnson Controls | https://www.johnsoncontrols.com/media-center | TBV | No | 0.3 | Open | public-rss | Metasys/OpenBlue — BMS + digital twin signals |
| Siemens Press (Smart Infrastructure) | Siemens | https://press.siemens.com | TBV (Siemens publishes RSS) | No | 0.5 | Open | public-rss | Desigo/Building X + DC electrification |
| Nozomi Networks Blog | Nozomi Networks | https://www.nozominetworks.com/blog | TBV | No | 0.2 | Open | public-rss | OT/ICS security research on BMS attack surface |
| Claroty Blog | Claroty | https://claroty.com/blog | TBV | No | 0.2 | Open | public-rss | Team82 building-automation vuln research (also D16) |
| Dragos Blog | Dragos | https://www.dragos.com/blog/ | TBV (likely /feed) | No | 0.2 | Open | public-rss | ICS/OT threat intel for facility OT posture (also D16) |

# D21 — Insurance & Risk Markets

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Insurance Journal | Wells Media Group | https://www.insurancejournal.com | https://www.insurancejournal.com/rss/news | Yes | 20–30 | open | public-rss (credit required) | Highest-volume open P&C news feed; explicit syndication program |
| Artemis.bm | Steve Evans Ltd | https://www.artemis.bm | https://www.artemis.bm/feed/ | No (WP pattern) | 3–6 | open | public-rss | Cat bond/ILS/parametric market of record |
| Reinsurance News | Steve Evans Ltd | https://www.reinsurancene.ws | https://www.reinsurancene.ws/feed | Yes | 5–8 | open | public-rss | Reinsurance capacity/pricing (2nd Steve Evans — at cap) |
| Business Insurance | Business Insurance Holdings | https://www.businessinsurance.com | TBV | No | 8–12 | metered | paywalled | Commercial lines + large-account property/cyber |
| Risk & Insurance | LRP Media | https://riskandinsurance.com | https://riskandinsurance.com/feed/ | No (WP pattern) | 3–5 | open | public-rss | Risk-manager-facing incl. DC/critical-infrastructure risk |
| PropertyCasualty360 | ALM | https://www.propertycasualty360.com | TBV | No | 8–12 | free registration | paywalled | Broad P&C market news |
| Carrier Management | Wells Media Group | https://www.carriermanagement.com | https://www.carriermanagement.com/feed/ | No (WP pattern) | 4–6 | open | public-rss | C-suite carrier strategy incl. cyber/property appetite |
| Insurance Business America | Key Media | https://www.insurancebusinessmag.com/us/ | TBV | No | 10–15 | open | public-rss | High-cadence market + people coverage |
| The Insurer | Thomson Reuters | https://www.theinsurer.com | TBV | No | 8–12 | paywall | paywalled | Specialty/London-market scoops on large property programs |
| AM Best News (BestWire) | AM Best | https://news.ambest.com | TBV | No | 10+ | mixed | restrictive-tos (legal read) | Ratings actions — early solvency/appetite signal |
| Aon Newsroom | Aon | https://www.aon.com/en/media | TBV | No | <1 | open | restrictive-tos | Broker research: cyber market, cat models, parametric |
| Marsh McLennan Newsroom | Marsh McLennan | https://www.marshmclennan.com/news-insights.html | TBV | No | <1 | open | restrictive-tos | Largest broker; DC-relevant property/cyber reports |
| Lloyd's Media Centre | Lloyd's | https://www.lloyds.com/about-lloyds/media-centre | TBV | No | <1 | open | restrictive-tos | Specialty market capacity incl. cyber/parametric |
| Swiss Re News / Institute | Swiss Re | https://www.swissre.com/media.html | TBV | No | <1 | open | restrictive-tos | sigma research + nat-cat pricing signals |

# D22 — Industry Media & Analyst Coverage

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| Data Center Dynamics | DCD | https://www.datacenterdynamics.com | https://www.datacenterdynamics.com/en/atom/ | Pattern (/es/atom confirmed live) | 15–25 | open | public-rss | The global DC trade of record |
| Data Center Knowledge | Informa TechTarget | https://www.datacenterknowledge.com | TBV (legacy /rss.xml dead post-replatform) | No | 5–10 | open | public-rss | Core US DC trade |
| Data Center Frontier | Endeavor Business Media | https://www.datacenterfrontier.com | TBV | No | 3–5 | open | public-rss | DC development/energy analysis |
| Bisnow — National Data Center feed | Bisnow | https://www.bisnow.com/data-center | https://www.bisnow.com/rss (DC tag TBV) | Yes (main /rss) | 3–8 | free registration | public-rss | CRE-angle DC news (also D14) |
| Utility Dive | Industry Dive | https://www.utilitydive.com | https://www.utilitydive.com/feeds/news/ | Pattern | 8–10 | open | public-rss | Grid/load-growth coverage (also D3/D11) |
| Capacity Media | Euromoney/Delinian | https://www.capacitymedia.com | TBV | No | 5–8 | free registration | paywalled | Carrier/wholesale + DC interconnection (also D5/D12) |
| W.Media | W.Media | https://w.media | https://w.media/feed/ | No (WP pattern) | 3–5 | open | public-rss | APAC cloud/DC coverage (also D6) |
| TechTarget SearchDataCenter | Informa TechTarget | https://www.techtarget.com/searchdatacenter/ | https://www.techtarget.com/searchdatacenter/rss | Yes | 2–4 | free registration | public-rss | Enterprise DC tech (2nd Informa TechTarget — at cap) |
| Uptime Institute — Journal/Blog | Uptime Institute | https://journal.uptimeinstitute.com | https://journal.uptimeinstitute.com/feed/ (TBV) | No (WP pattern) | <1 | open | public-rss | Authoritative outage/resiliency research (also D20) |
| Synergy Research Group | Synergy Research | https://www.srgresearch.com | TBV | No | <1 (weekly) | open | restrictive-tos | Market-share data: hyperscale capex, colo M&A |
| Dell'Oro Group blog/press | Dell'Oro Group | https://www.delloro.com | https://www.delloro.com/feed/ | No (WP pattern) | <1 | open | restrictive-tos | DC capex, networking/optics forecasts |
| Omdia — press/analyst opinions | Informa (Omdia) | https://omdia.tech.informa.com | TBV | No | 1–2 | mixed | restrictive-tos | DC compute/power analyst coverage |
| Gartner Newsroom | Gartner | https://www.gartner.com/en/newsroom | TBV | No | 1–2 | open | restrictive-tos | Forecasts/MQ press releases (publication-fact use) |
| IDC Newsroom | IDC | https://www.idc.com/about/press | TBV | No | 1–3 | open | restrictive-tos | Server/infra tracker press releases |
| SemiAnalysis | SemiAnalysis LLC | https://semianalysis.com | https://semianalysis.com/feed/ | No (WP pattern) | <1 | headline free / paywall | paywalled | AI-infrastructure/GPU-economics analysis (also D1) |
| The Next Platform | Stackhouse Publishing | https://www.nextplatform.com | https://www.nextplatform.com/feed/ | No (WP pattern) | 1–2 | open | public-rss | HPC/AI systems economics (also D1) |
| The Register — On-Prem/Systems | Situation Publishing | https://www.theregister.com/on_prem/ | https://www.theregister.com/on_prem/headlines.atom | No (documented pattern) | 5–8 | open | public-rss | Fast DC/systems reporting (also D1) |

# D23 — Outage Intelligence & Emergency Response

**Status feeds are the hourly tier: mostly statuspage.io-standard `/history.rss` + `/api/v2/` JSON with conditional-GET support.**

| Source | Publisher | Homepage | Feed URL (or TBV) | Verified? | Est. cadence (items/day) | Access | License posture | Why relevant |
|---|---|---|---|---|---|---|---|---|
| AWS Health Dashboard | AWS | https://health.aws.amazon.com/ | Per service-region: https://status.aws.amazon.com/rss/{service}-{region}.rss (fan-out; no all-services feed) | Yes (pattern) | event-driven | Free | public-rss | Largest cloud; region-level incident signal |
| Azure Status | Microsoft | https://azure.status.microsoft/en-us/status | https://azure.status.microsoft/en-us/status/feed/ | Yes | event-driven | Free | public-rss | Major-incident feed for Azure regions |
| Google Cloud Status | Google | https://status.cloud.google.com/ | TBV /en/feed.atom + https://status.cloud.google.com/incidents.json | Partial (JSON documented) | event-driven | Free | public-rss | Most machine-friendly incident JSON of the big three |
| Cloudflare Status | Cloudflare | https://www.cloudflarestatus.com/ | TBV /history.rss (+ /api/v2/summary.json; statuspage.io standard) | No (platform-standard) | event-driven | Free | public-rss | Edge/network incidents; hourly-pollable |
| Cloudflare Blog / Radar outage reports | Cloudflare | https://blog.cloudflare.com/ | TBV (/rss/) | No | 1–3 | Free | public-rss | Post-incident analyses + internet-wide outage reporting |
| GitHub Status | GitHub | https://www.githubstatus.com/ | TBV /history.rss | No (platform-standard) | event-driven | Free | public-rss | Dev-infrastructure canary |
| Slack Status | Salesforce | https://slack-status.com/ | TBV /feed/rss + /api/v2.0.0/current | No | event-driven | Free | public-rss | Enterprise-SaaS outage canary |
| Zoom Status | Zoom | https://status.zoom.us/ | TBV /history.rss | No (platform-standard) | event-driven | Free | public-rss | Major-SaaS status |
| Datadog Status | Datadog | https://status.datadoghq.com/ | TBV /history.rss | No (platform-standard) | event-driven | Free | public-rss | Observability-layer outages precede broader awareness |
| Fastly Status | Fastly | https://status.fastly.com/ | TBV /history.rss | No (platform-standard) | event-driven | Free | public-rss | CDN/edge outage signal |
| Oracle Cloud (OCI) Status | Oracle | https://ocistatus.oraclecloud.com/ | TBV (RSS + JSON API) | No | event-driven | Free | public-rss | 4th hyperscaler, growing AI-compute footprint |
| Atlassian Statuspage metastatus | Atlassian | https://metastatuspage.com/ | TBV /history.rss | No (platform-standard) | event-driven | Free | public-rss | Meta-monitor: if Statuspage is down, the above go quiet |
| NWS Alerts (CAP) | NOAA/NWS | https://www.weather.gov/ | https://api.weather.gov/alerts (Atom + JSON-LD; filter by zone/county; conditional GET) | Yes | 100+ (filter to DC-market counties) | Free | gov-public-domain | Severe-weather alerts for facility counties — highest-value hourly poll |
| ThousandEyes blog / Internet Report | Cisco ThousandEyes | https://www.thousandeyes.com/blog/ | TBV | No | 0.2–0.5 | Free | public-rss | Authoritative internet-outage forensics (BGP, DNS, cloud) |
| Kentik blog | Kentik | https://www.kentik.com/blog/ | TBV | No | 0.2 | Free | public-rss | Network-telemetry outage analysis |
| NetBlocks | NetBlocks | https://netblocks.org/ | TBV (/feed) | No | 0.5–1 | Free | public-rss | Country-level connectivity disruptions — pairs with D15 |

---

## Next steps (in order)

1. **Myke:** approve this catalog as the Wave-1 superset (Jira FAR-368 decision 8d) — or strike/add rows.
2. **Build gate:** Vercel-side feed verification sweep (resolves every TBV; 0 LLM cost), then license read for `restrictive-tos` rows.
3. **Seed** verified rows into `source_registry` (now live in prod with `v_source_census`), `countable=true` only when license-cleared.
4. **Activate** via `source-poller` once AUTO-199 is granted.
