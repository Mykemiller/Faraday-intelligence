-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / backfill, candidate side.
-- APPLIED to prod 2026-08-09.
--
-- Two tiers, and the TIER IS ENCODED IN THE KEY PREFIX so nobody has to guess how
-- strong a grouping is:
--   name:...  derived from the source's own '<Campus> - Building N' convention.
--             Deterministic and high confidence. 501 rows -> 113 campus stems.
--   addr:...  derived from a shared street address under ONE operator. Weaker --
--             a shared address often means multi-tenant, not one campus (Calle de
--             Albasanz, Madrid carries 8 different operators). grain left NULL.
--
-- campus_key is a GROUPING key, not a foreign key, and grain is a hint. Nothing here
-- mints a facility or asserts a parent edge. Reversible: null both columns.
--
-- NOTE: a name-derived key grouping ONE row is expected and correct -- a campus whose
-- other buildings we have not discovered yet. An address-derived key grouping one row
-- is not: it only exists because Tier 1 claimed its siblings, so it is swept below.

-- Tier 1a: the buildings themselves.
with b as (
  select id,
         lower(regexp_replace(coalesce(operator,''), '[^a-z0-9]+','','gi')) as nop,
         lower(regexp_replace(
           btrim(regexp_replace(name, '\s*[-–—]\s*(building|bldg)\s*[a-z0-9]+\s*$','','i')),
           '[^a-z0-9]+','','gi')) as nstem
  from dc_candidate_facilities
  where name ~* '\s[-–—]\s*(building|bldg)\s*[a-z0-9]+\s*$'
)
update public.dc_candidate_facilities c
   set grain = 'building',
       campus_key = 'name:' || b.nop || '|' || b.nstem
  from b
 where c.id = b.id and b.nstem <> '';

-- Tier 1b: the campus rows those buildings point at, where such a row exists.
with stems as (
  select distinct
         lower(regexp_replace(coalesce(operator,''), '[^a-z0-9]+','','gi')) as nop,
         lower(regexp_replace(
           btrim(regexp_replace(name, '\s*[-–—]\s*(building|bldg)\s*[a-z0-9]+\s*$','','i')),
           '[^a-z0-9]+','','gi')) as nstem
  from dc_candidate_facilities
  where name ~* '\s[-–—]\s*(building|bldg)\s*[a-z0-9]+\s*$'
)
update public.dc_candidate_facilities c
   set grain = 'campus',
       campus_key = 'name:' || s.nop || '|' || s.nstem
  from stems s
 where s.nstem <> ''
   and c.campus_key is null
   and lower(regexp_replace(coalesce(c.operator,''), '[^a-z0-9]+','','gi')) = s.nop
   and lower(regexp_replace(coalesce(c.name,''),    '[^a-z0-9]+','','gi')) = s.nstem;

-- Tier 2: address co-location under a single operator, only where Tier 1 found nothing.
with usable as (
  select id, country_iso2,
         lower(regexp_replace(street_address,'[^a-z0-9]+','','gi')) as naddr,
         lower(regexp_replace(operator,'[^a-z0-9]+','','gi')) as nop
  from dc_candidate_facilities
  where country_iso2 is not null
    and coalesce(street_address,'') <> ''
    and lower(btrim(street_address)) not in ('tbc','n/a','na','-','unknown','none')
    and street_address ~ '[0-9]'
    and coalesce(operator,'') <> ''
), grp as (
  select country_iso2, naddr, nop
  from usable group by 1,2,3 having count(*) > 1
)
update public.dc_candidate_facilities c
   set campus_key = 'addr:' || u.country_iso2 || '|' || u.nop || '|' || u.naddr
  from usable u
  join grp g on g.country_iso2 = u.country_iso2 and g.naddr = u.naddr and g.nop = u.nop
 where c.id = u.id and c.campus_key is null;

-- Sweep: an address-derived key left grouping a single row carries no information.
update public.dc_candidate_facilities
   set campus_key = null
 where campus_key in (
   select campus_key from public.dc_candidate_facilities
    where campus_key like 'addr:%'
    group by campus_key having count(*) < 2);
