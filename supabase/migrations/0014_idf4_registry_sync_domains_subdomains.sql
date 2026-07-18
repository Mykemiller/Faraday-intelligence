-- ============================================================================
-- idf4_registry_sync_domains_subdomains  (DRAFT — DO NOT APPLY without Myke go)
-- CC-IDF-OPEN3 Item 3 · FAR-199 · 2026-07-18
-- ----------------------------------------------------------------------------
-- Context: the Coverage Matrix page (Notion 38889a0c…) still claims
-- faraday_domains=16 / faraday_subdomains=4. That claim is stale: migrations
-- 0007b_subdomains_fullseed (2026-06-24) and
-- backfill_faraday_subdomains_idf40_full_116 (2026-07-02) already brought the
-- live project (ycadmmngkdhvpcsrcuaq) to 23 domains / 116 sub-domains.
--
-- Row-by-row diff vs IDF 4.0 canon (Notion 37189a0c…, approved 2026-06-11):
--   * faraday_domains: all 23 codes + names match canon. No changes.
--   * faraday_subdomains: all 116 codes present, counts per domain match canon.
--     14 display_name deltas remain — 12 cosmetic (short-form / word drift)
--     and 2 substantive (D18.2, D2.2), handled in separate sections below.
--
-- Idempotent: every UPDATE is keyed on subdomain_code and safe to re-run.
-- ============================================================================

begin;

-- ── Section 1 · Cosmetic display-name alignment to canon ────────────────────
-- Canon "Registry Name (full)" is authoritative per the source-of-truth rule
-- (§06: registries "must not diverge"). Current value shown in each comment.

update faraday_subdomains set display_name = 'Rack & Power Density Progression'
 where subdomain_code = 'D1.2';  -- was: Rack Density & Power Density Progression

update faraday_subdomains set display_name = 'Competing Silicon & Merchant Accelerators'
 where subdomain_code = 'D1.3';  -- was: Competing Silicon & Alternative Accelerators

update faraday_subdomains set display_name = 'GC/EPC Capacity & Stick-Built Execution'
 where subdomain_code = 'D10.2'; -- was: GC/EPC Capacity & Construction Execution

update faraday_subdomains set display_name = 'Modular & Prefabricated Delivery'
 where subdomain_code = 'D10.3'; -- was: Modular & Prefabricated Data Center Delivery

update faraday_subdomains set display_name = 'Carbon Accounting & Scope 1-3'
 where subdomain_code = 'D11.2'; -- was: Carbon Accounting & Scope 1-3 Reporting

update faraday_subdomains set display_name = 'Site Selection Methodology'
 where subdomain_code = 'D14.1'; -- was: Site Selection Criteria & Market Scoring

update faraday_subdomains set display_name = 'Chip Export Controls & Outbound Dual-Use'
 where subdomain_code = 'D15.1'; -- was: Chip Export Controls & BIS Regime

update faraday_subdomains set display_name = 'Enterprise IT & Cloud Security'
 where subdomain_code = 'D16.1'; -- was: Enterprise IT Cybersecurity & Cloud Security

update faraday_subdomains set display_name = 'DC Property & Casualty Insurance'
 where subdomain_code = 'D21.1'; -- was: Data Center Property & Casualty Insurance

update faraday_subdomains set display_name = 'Lender Insurance & Risk Transfer'
 where subdomain_code = 'D21.4'; -- was: Lender Insurance Requirements & Risk Transfer

update faraday_subdomains set display_name = 'Business Continuity & Disaster Recovery'
 where subdomain_code = 'D23.4'; -- was: Business Continuity & Disaster Recovery Practice

-- Intentionally NOT touched (valid canon short-form display names):
--   D1.5  'Inference-Class Silicon'        (canon display-short)
--   D5.2  'Hyperscaler Custom Silicon'     (canon: … Strategy — display-short OK)
--   D14.2 'Primary Market Intelligence'    (canon: … (NA Tier 1) — display-short OK)

-- ── Section 2 · Substantive conflicts — REQUIRES MYKE RULING before apply ───
-- 2a. D18.2: canon says 'Regulatory & Permitting Denial Tracking'; live value
--     is 'Jurisdiction Posture Intelligence (JPS)' (introduced by the JW-side
--     jw_0007_registry_reconciliation_sync, 2026-06-21; Airtable Sub-Domain
--     Registry carries the same JPS row). Canon ID-immutability rule (§06)
--     says D#.# is never reused, so JPS-as-D18.2 is a canon violation UNLESS
--     Myke amends canon. Option A (below, default): restore canon; JPS then
--     needs a new code minted in canon (D18.4 proposed) before re-adding.
--     Option B: strike the UPDATE and amend the canon page instead.
update faraday_subdomains set display_name = 'Regulatory & Permitting Denial Tracking'
 where subdomain_code = 'D18.2'; -- was: Jurisdiction Posture Intelligence (JPS)

-- 2b. D2.2: canon says 'BTM Strategy & Cross-Cutting Economics'; live value is
--     'Behind-the-Meter Generation (BYOP/BYOG)' (same divergence exists in the
--     Airtable Sub-Domain Registry — shared non-canon source). Aligning to
--     canon; strike if Myke prefers the BYOP/BYOG label and amends canon.
update faraday_subdomains set display_name = 'BTM Strategy & Cross-Cutting Economics'
 where subdomain_code = 'D2.2';  -- was: Behind-the-Meter Generation (BYOP/BYOG)

-- ── Section 3 · faraday_domains ─────────────────────────────────────────────
-- No-op: all 23 rows (D1–D23) already match canon codes and names exactly.

commit;
