-- =====================================================================
-- DC INVENTORY ENTITY MODEL — Sprint 1, migration 8 of 9
-- Applied to prod ycadmmngkdhvpcsrcuaq as 20260808213228
--   dc_inventory_0051_agreement_term_capacity_basis_fix
--
-- Term (c) correction.
--
-- The first cut (0045) put an attribute in the DENOMINATOR whenever any
-- lineage asserted it. That silently penalised the exact case the ticket
-- says must NOT be penalised: two sources quoting capacity on DIFFERENT
-- bases (it_load vs gross_utility). They are measuring different things, so
-- agreement is not merely absent - it is UNTESTABLE, and an untestable
-- attribute must not drag the ratio down.
--
-- Corrected rule:
--   denominator = attributes where >=2 distinct lineages make a COMPARABLE
--                 claim (for capacity, comparable means at the SAME basis)
--   numerator   = of those, the ones where >=2 lineages agree on the value
--
-- A genuine same-basis capacity disagreement is still penalised, which is
-- the behaviour we want. Both cases are covered by the unit tests in
-- test/dc-inventory/fcs-unit-tests.sql (cases 5 and 6).
--
-- Signature unchanged => this REPLACES the function, it does not overload it.
-- =====================================================================
create or replace function public.fn_dc_attribute_agreement_points(
  p_facility_id uuid,
  p_include_news boolean
)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with obs as (
    select o.*
    from public.dc_facility_observations o
    where o.facility_id = p_facility_id
      and not o.retracted
      and (p_include_news or o.source_class <> 'news')
      and o.attribute in ('name','operator','coordinates','capacity')
  ),
  norm as (
    select
      attribute,
      -- claims are only comparable within the same basis_group
      case when attribute = 'capacity' then coalesce(capacity_basis, '?') else '-' end as basis_group,
      case attribute
        when 'name'     then lower(regexp_replace(coalesce(value_text,''), '\s+', ' ', 'g'))
        when 'operator' then lower(regexp_replace(coalesce(value_text,''), '\s+', ' ', 'g'))
        when 'coordinates' then
          round((value_json->>'lat')::numeric, 3)::text || ',' ||
          round((value_json->>'lng')::numeric, 3)::text
        when 'capacity' then round(coalesce(value_num, 0), 1)::text
      end as bucket,
      primary_lineage_key
    from obs
  ),
  usable as (
    select * from norm where bucket is not null and bucket <> ''
  ),
  comparable as (            -- the denominator: agreement is testable here
    select attribute
    from usable
    group by attribute, basis_group
    having count(distinct primary_lineage_key) >= 2
  ),
  agreeing as (              -- the numerator: >=2 lineages on the same value
    select attribute
    from usable
    group by attribute, basis_group, bucket
    having count(distinct primary_lineage_key) >= 2
  )
  select case
           when (select count(distinct attribute) from comparable) = 0 then 0
           else floor(
                  15.0
                  * (select count(distinct attribute) from agreeing)
                  / (select count(distinct attribute) from comparable)
                )::int
         end;
$$;

comment on function public.fn_dc_attribute_agreement_points(uuid, boolean) is
  'Term (c) of the Facility-Confidence Score, 0..15. An attribute only enters the denominator '
  'when >=2 distinct lineages make a COMPARABLE claim about it. For capacity, comparable '
  'means at the SAME capacity_basis - differing bases are different measurements and must '
  'never be scored as a disagreement. A same-basis conflict IS still penalised.';

revoke all on function public.fn_dc_attribute_agreement_points(uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_dc_attribute_agreement_points(uuid, boolean) to service_role;

-- rescore with the corrected term
select public.fn_dc_recompute_facility_scores();
