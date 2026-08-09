-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / R1 + R2
-- Campus/building hierarchy integrity for dc_facilities.
-- The grain vocabulary ('campus','site','building') and parent_facility_id FK have
-- existed since 0044 but carried NO integrity rules: nothing ordered parent grain
-- above child grain, nothing prevented a cycle, and a facility could be made its own
-- grandparent. All 1,418 rows were flat 'site' with 0 parents.
-- APPLIED to prod 2026-08-09.

alter table public.dc_facilities
  add constraint dc_facilities_campus_is_root
  check (grain <> 'campus' or parent_facility_id is null);

-- SECURITY INVOKER deliberately: every dc_facilities write is service-role (which
-- bypasses RLS), so a definer wrapper would add an advisor finding for no gain.
create or replace function public.fn_dc_facilities_hierarchy_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_parent_grain text;
  v_rank_child   int;
  v_rank_parent  int;
  v_cur          uuid;
  v_depth        int := 0;
begin
  if new.parent_facility_id is null then
    return new;
  end if;

  if new.parent_facility_id = new.id then
    raise exception 'DCH01: facility % cannot be its own parent', new.id
      using errcode = '23514';
  end if;

  select grain into v_parent_grain
    from public.dc_facilities where id = new.parent_facility_id;

  if v_parent_grain is null then
    raise exception 'DCH02: parent facility % not found', new.parent_facility_id
      using errcode = '23503';
  end if;

  v_rank_child  := case new.grain
                     when 'campus' then 3 when 'site' then 2 when 'building' then 1 end;
  v_rank_parent := case v_parent_grain
                     when 'campus' then 3 when 'site' then 2 when 'building' then 1 end;

  if v_rank_parent <= v_rank_child then
    raise exception 'DCH03: parent grain % does not strictly outrank child grain %',
      v_parent_grain, new.grain using errcode = '23514';
  end if;

  v_cur := new.parent_facility_id;
  while v_cur is not null loop
    v_depth := v_depth + 1;
    if v_cur = new.id then
      raise exception 'DCH04: parent assignment creates a cycle at %', new.id
        using errcode = '23514';
    end if;
    if v_depth > 3 then
      raise exception 'DCH05: hierarchy deeper than 3 levels at %', new.id
        using errcode = '23514';
    end if;
    select parent_facility_id into v_cur
      from public.dc_facilities where id = v_cur;
  end loop;

  return new;
end
$fn$;

drop trigger if exists trg_dc_facilities_hierarchy on public.dc_facilities;
create trigger trg_dc_facilities_hierarchy
  before insert or update of parent_facility_id, grain on public.dc_facilities
  for each row execute function public.fn_dc_facilities_hierarchy_guard();
