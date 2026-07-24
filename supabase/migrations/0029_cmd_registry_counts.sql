-- CMD-1.0 — refresh company_attribute_registry.populated_count so the coverage report is honest.
-- Fact-backed attributes: distinct companies carrying a fact. Column-backed identity attributes:
-- non-null companies columns. Everything left at 0 is an explicit, registered gap.

-- 1) Fact-backed attributes.
update public.company_attribute_registry r
set populated_count = coalesce(fc.n, 0)
from (select attribute_code, count(distinct company_uid) n from public.company_facts group by 1) fc
where fc.attribute_code = r.attribute_code;

-- 2) Column-backed identity attributes (stored on public.companies, not as facts).
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where company_type is not null)             where attribute_code='company_type';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where ownership_public_private is not null)  where attribute_code='ownership_public_private';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where hq_location_raw is not null)           where attribute_code='hq_location_raw';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where ticker is not null)                    where attribute_code='ticker';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where website_url is not null)               where attribute_code='website_url';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where linkedin_url is not null)              where attribute_code='linkedin_url';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where nvidia_dsx_partner is not null)         where attribute_code='nvidia_dsx_partner';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where faraday_read is not null)              where attribute_code='faraday_read';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where slug is not null)                      where attribute_code='slug';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where public_id is not null)                 where attribute_code='public_id';
update public.company_attribute_registry set populated_count = (select count(*) from public.companies where entity_class <> 'unclassified')         where attribute_code='entity_class';
