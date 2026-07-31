-- CC-STATE-BRIEF-SCAFFOLD-1.0 / advisor follow-up
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-07-31 as
-- `state_brief_fk_covering_indexes`.
--
-- v_jw_brief_failed_sections joins audits -> sections on section_id, and the
-- carry-forward chain (D4 staleness) walks prior_section_id. Both tables grow
-- one row per section per state per week.
create index if not exists idx_brief_audits_section on jw_brief_audits (section_id);
create index if not exists idx_brief_sec_prior      on jw_brief_sections (prior_section_id);

-- The FKs on jw_brief_auditor_shards (10 rows) and jw_source_candidates
-- (single-digit rows) are deliberately left unindexed - a seq scan is optimal
-- at that cardinality and an index there would only trip the unused_index
-- advisor. Both remain as INFO-level advisor notes by design.
