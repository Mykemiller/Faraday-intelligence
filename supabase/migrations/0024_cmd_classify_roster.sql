-- CMD-1.0 Wave A — classify all 7,824 tracking_companies rows into stg_company_classification.
-- Deterministic name-pattern rules + jw_facilities/jw_facility_operators membership signals.
-- PROPOSALS ONLY (nothing promoted here). Confidence tiers:
--   high   = municipal / coop / municipal-utility patterns (unambiguous, per spec §7.1)
--   medium = regulator / academic / association / standards / IOU-utility patterns,
--            and demonstrated jw_facilities operator/developer membership
--   low    = unclassified (default; pending human review)
-- Pattern matching uses the raw lowercased name (retains "city of", "co-op", ...).
-- Membership matching uses the normalized form (cmd_normalize_name).

insert into public.stg_company_classification
  (tracking_company_id, name, name_normalized, active, proposed_entity_class, rule_matched, rule_confidence)
with base as (
  select tc.company_id, tc.name, tc.active,
         public.cmd_normalize_name(tc.name) nn,
         lower(btrim(tc.name))              lname
  from public.tracking_companies tc
),
op  as (select public.cmd_normalize_name(operator) nn from public.jw_facilities where coalesce(btrim(operator),'')<>''
        union select public.cmd_normalize_name(operator_parent) from public.jw_facilities where coalesce(btrim(operator_parent),'')<>''),
dev as (select public.cmd_normalize_name(developer) nn from public.jw_facilities where coalesce(btrim(developer),'')<>''),
reg as (select public.cmd_normalize_name(operator_name) nn from public.jw_facility_operators where coalesce(btrim(operator_name),'')<>''),
tok as (
  select b.*,
    case
      when b.lname ~ '(university|\ycollege\y|polytechnic|institute of technology| school of )'                                         then 'academic_name'
      when b.lname ~ '(public utilit(y|ies) commission|public service commission|corporation commission|utility commission|regulatory commission|\yferc\y|\ynerc\y|department of energy)' then 'regulator_name'
      when b.lname ~ '(\yassociation\y|\ycoalition\y|\yconsortium\y|chamber of|\ysociety\y)'                                            then 'association_name'
      when b.lname ~ '(\ystandards\y|\yieee\y|ashrae|green grid|uptime institute)'                                                     then 'standards_name'
      when b.lname ~ '(cooperative|co-op|electric membership|rural electric|\yemc\y|\yrea\y|\yreca\y)'                                  then 'coop_name'
      when b.lname ~ '(municipal util|public utility district|\ypud\y|board of public util|municipal power|municipal light|\ypublic power\y|department of water)' then 'muni_utility_name'
      when b.lname ~ '^(city|town|village|borough|township|county|parish|municipality) of '                                           then 'municipality_prefix'
      when b.lname ~ '(\ycounty\y|\ytownship\y|\yparish\y|\ymunicipality\y)$'                                                          then 'municipality_suffix'
      when b.lname ~ '(electric compan|power compan|power corp|power author|power district|energy compan|light compan|gas (and|&) electric|electric cooperative|\yutilities\y|\yutility\y|transmission compan)' then 'utility_name'
      when b.nn in (select nn from op)  then 'jw_operator'
      when b.nn in (select nn from dev) then 'jw_developer'
      when b.nn in (select nn from reg) then 'jw_operator_registry'
      else 'unclassified'
    end rule_matched
  from base b
)
select tok.company_id, tok.name, tok.nn, tok.active, m.cls, tok.rule_matched, m.conf
from tok
join (values
  ('academic_name','academic','medium'),
  ('regulator_name','regulator','medium'),
  ('association_name','association','medium'),
  ('standards_name','standards_body','medium'),
  ('coop_name','utility_coop','high'),
  ('muni_utility_name','utility_municipal','high'),
  ('municipality_prefix','municipality','high'),
  ('municipality_suffix','municipality','medium'),
  ('utility_name','utility_iou','medium'),
  ('jw_operator','operator','medium'),
  ('jw_developer','developer','medium'),
  ('jw_operator_registry','operator','medium'),
  ('unclassified','unclassified','low')
) as m(rule_matched, cls, conf) on m.rule_matched = tok.rule_matched;
