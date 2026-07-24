-- CMD-1.0 — merge the tracking_companies roster into the spine (Decision 1: merge, minimize
-- duplicates), build aliases from every internal source, add the company_uid FK to
-- tracking_companies (Decision 3), and record the merge-candidate evidence.
-- company_uid = 'cmp_'||substr(md5(name_normalized),1,16). Airtable rows (0025) already occupy
-- their normalized names, so ON CONFLICT keeps Airtable identity authoritative; the roster only
-- creates the entities Airtable did not curate. This is where the ~112 duplicate raw names and
-- the 149 normalization-duplicates collapse to one canonical company each.

-- 1) Roster -> canonical companies (one per normalized name; richest classification wins the label).
insert into public.companies (company_uid, canonical_name, name_normalized, entity_class, identity_source)
select 'cmp_'||substr(md5(s.name_normalized),1,16), s.name, s.name_normalized, s.proposed_entity_class, 'tracking_companies'
from (
  select distinct on (name_normalized) name_normalized, name, proposed_entity_class
  from public.stg_company_classification
  where name_normalized is not null
  order by name_normalized,
           (rule_confidence='high') desc,
           (proposed_entity_class <> 'unclassified') desc,
           length(name) asc
) s
on conflict (name_normalized) do nothing;

-- 2) Backfill the staging resolution link for all 7,824 rows.
update public.stg_company_classification s
set company_uid = 'cmp_'||substr(md5(s.name_normalized),1,16),
    resolution_method = case when c.identity_source = 'airtable' then 'normalized_to_airtable' else 'created' end
from public.companies c
where c.name_normalized = s.name_normalized and s.name_normalized is not null;

-- 3) Aliases from the roster (approved: exact/normalized).
insert into public.company_aliases (company_uid, alias_raw, alias_normalized, alias_source, match_method, match_confidence, approved)
select 'cmp_'||substr(md5(public.cmd_normalize_name(tc.name)),1,16), tc.name, public.cmd_normalize_name(tc.name),
       'tracking_companies',
       case when lower(btrim(tc.name)) = public.cmd_normalize_name(tc.name) then 'exact' else 'normalized' end,
       1.0, true
from public.tracking_companies tc
where public.cmd_normalize_name(tc.name) is not null
on conflict (company_uid, alias_normalized, alias_source) do nothing;

-- 4) Aliases from jw_facilities (operator / operator_parent / developer) — normalized match to a company.
insert into public.company_aliases (company_uid, alias_raw, alias_normalized, alias_source, match_method, match_confidence, approved)
select c.company_uid, x.raw, x.nn, 'jw_facilities', 'normalized', 1.0, true
from (
  select distinct operator raw, public.cmd_normalize_name(operator) nn from public.jw_facilities where coalesce(btrim(operator),'')<>''
  union select distinct operator_parent, public.cmd_normalize_name(operator_parent) from public.jw_facilities where coalesce(btrim(operator_parent),'')<>''
  union select distinct developer, public.cmd_normalize_name(developer) from public.jw_facilities where coalesce(btrim(developer),'')<>''
) x
join public.companies c on c.name_normalized = x.nn
where x.nn is not null
on conflict (company_uid, alias_normalized, alias_source) do nothing;

-- 5) Aliases from jw_facility_operators — normalized match to a company.
insert into public.company_aliases (company_uid, alias_raw, alias_normalized, alias_source, match_method, match_confidence, approved)
select c.company_uid, o.operator_name, public.cmd_normalize_name(o.operator_name), 'jw_facility_operators', 'normalized', 1.0, true
from public.jw_facility_operators o
join public.companies c on c.name_normalized = public.cmd_normalize_name(o.operator_name)
where coalesce(btrim(o.operator_name),'')<>''
on conflict (company_uid, alias_normalized, alias_source) do nothing;

-- 6) Trigram PROPOSALS (approved=false; Decision 5) for jw operator names NOT resolved by normalized
--    match — the poor-match cohort (jw_facility_operators 216/857 exact). similarity >= 0.92. Never
--    used to resolve until a human approves.
insert into public.company_aliases (company_uid, alias_raw, alias_normalized, alias_source, match_method, match_confidence, approved)
select c.company_uid, u.raw, u.nn, u.src, 'trigram', round(similarity(c.name_normalized, u.nn)::numeric, 3), false
from (
  select distinct operator_name raw, public.cmd_normalize_name(operator_name) nn, 'jw_facility_operators' src
  from public.jw_facility_operators where coalesce(btrim(operator_name),'')<>''
  union
  select distinct operator, public.cmd_normalize_name(operator), 'jw_facilities'
  from public.jw_facilities where coalesce(btrim(operator),'')<>''
) u
join public.companies c
  on c.name_normalized % u.nn
 and similarity(c.name_normalized, u.nn) >= 0.92
where u.nn is not null
  and not exists (select 1 from public.companies c2 where c2.name_normalized = u.nn)   -- only the unresolved
on conflict (company_uid, alias_normalized, alias_source) do nothing;

-- 7) Add the company_uid FK to tracking_companies (Decision 3). Additive nullable column ONLY —
--    the original 3 columns (company_id, name, active) are never touched.
alter table public.tracking_companies add column if not exists company_uid text references public.companies(company_uid);
update public.tracking_companies tc
set company_uid = 'cmp_'||substr(md5(public.cmd_normalize_name(tc.name)),1,16)
where public.cmd_normalize_name(tc.name) is not null;
create index if not exists tracking_companies_company_uid_idx on public.tracking_companies (company_uid);

-- 8) Merge-candidate evidence (STOP §6.1, executed per Decision 1). Groups where >1 distinct raw
--    name collapsed to one normalized name; decision='merge' records what was merged.
insert into public.cmd_merge_candidates (name_normalized, member_count, raw_names, tracking_company_ids, proposed_classes, evidence, decision)
select nn, cnt, raws, ids, classes,
  'Collapsed to one canonical company on normalized name (Decision 1).', 'merge'
from (
  select public.cmd_normalize_name(tc.name) nn,
         count(*) cnt,
         array_agg(distinct tc.name order by tc.name) raws,
         array_agg(tc.company_id) ids,
         array_agg(distinct s.proposed_entity_class) classes
  from public.tracking_companies tc
  left join public.stg_company_classification s on s.tracking_company_id = tc.company_id
  where public.cmd_normalize_name(tc.name) is not null
  group by public.cmd_normalize_name(tc.name)
  having count(distinct tc.name) > 1
) g;

-- 9) Stable subscriber-facing identifiers (§7.14; frozen at assignment).
update public.companies set slug = regexp_replace(name_normalized, '\s+', '-', 'g') where slug is null;
with ordered as (select company_uid, row_number() over (order by name_normalized) rn from public.companies)
update public.companies c set public_id = 'FDY-C-'||lpad(o.rn::text, 6, '0')
from ordered o where o.company_uid = c.company_uid and c.public_id is null;
