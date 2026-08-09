-- CC-CANDIDATE-ADDRESS-EXTRACT-1.0 — Part 2 of 3 (backfill)
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-08-09.
--
-- Idempotent: every statement is a pure function of raw / country_code.
-- Proven by re-running the two order-sensitive statements: 0 rows changed.
--
-- Writes NOTHING to latitude, longitude, geo_precision or geo_basis.
-- city / subdivision_code are filled ONLY where currently NULL (Myke, 2026-08-09).

------------------------------------------------------------------ shape A
-- raw.street is a literal prefix of raw.address on 9,328/9,329 rows, so it is
-- never fabricated - but the upstream tokenizer under-consumes it on ~64% of
-- rows ("7400 Infantry Ridge" for "7400 Infantry Ridge Road"). Promoted as-is
-- per decision 1; the truncation is recorded by the atlas_presplit stamp.
update public.dc_candidate_facilities set
  street_address = nullif(trim(raw->>'street'), ''),
  postal_code    = nullif(trim(raw->>'zip'), ''),
  address_basis  = 'atlas_presplit'
where source_key = 'dc:atlas'
  and raw ? 'street'
  and (nullif(trim(raw->>'street'), '') is not null
       or nullif(trim(raw->>'zip'), '') is not null);

------------------------------------------------------- shape B, strict US tail
-- Parsed RIGHT-TO-LEFT (country, then state[+zip], then city). Positional
-- left-to-right parsing is wrong here: "Historic District, 11680 Hayden Road,
-- Manassas, VA, USA" has a district in segment 1, so segment 2 is a STREET, not
-- a city. Right-to-left lands Manassas/VA correctly. 18/18 hand-checked.
with seg as (
  select id,
         (select array_agg(trim(x) order by o)
            from unnest(string_to_array(trim(raw->>'address'), ',')) with ordinality t(x,o)) as p
  from public.dc_candidate_facilities
  where source_key = 'dc:atlas'
    and not (raw ? 'street')
    and nullif(trim(raw->>'address'), '') is not null
), parsed as (
  select id,
         p[1] as street,
         p[array_length(p,1)]   as seg_last,
         p[array_length(p,1)-1] as seg_state,
         p[array_length(p,1)-2] as seg_city
  from seg where array_length(p,1) >= 3
), us as (
  select id, street, seg_city as city,
         trim(regexp_replace(seg_state, '\s+[0-9]{5}(-[0-9]{4})?$', '')) as state_raw,
         (regexp_match(seg_state, '([0-9]{5}(-[0-9]{4})?)$'))[1] as postal
  from parsed
  where seg_last ~* '^(USA|United States)$'
    and seg_state ~ '^[A-Za-z][A-Za-z .]*( +[0-9]{5}(-[0-9]{4})?)?$'
    and seg_city  ~ '^[A-Za-z][A-Za-z .''\-]*$'
), st(nm, code) as (values
  ('alabama','AL'),('alaska','AK'),('arizona','AZ'),('arkansas','AR'),('california','CA'),
  ('colorado','CO'),('connecticut','CT'),('delaware','DE'),('florida','FL'),('georgia','GA'),
  ('hawaii','HI'),('idaho','ID'),('illinois','IL'),('indiana','IN'),('iowa','IA'),
  ('kansas','KS'),('kentucky','KY'),('louisiana','LA'),('maine','ME'),('maryland','MD'),
  ('massachusetts','MA'),('michigan','MI'),('minnesota','MN'),('mississippi','MS'),('missouri','MO'),
  ('montana','MT'),('nebraska','NE'),('nevada','NV'),('new hampshire','NH'),('new jersey','NJ'),
  ('new mexico','NM'),('new york','NY'),('north carolina','NC'),('north dakota','ND'),('ohio','OH'),
  ('oklahoma','OK'),('oregon','OR'),('pennsylvania','PA'),('rhode island','RI'),('south carolina','SC'),
  ('south dakota','SD'),('tennessee','TN'),('texas','TX'),('utah','UT'),('vermont','VT'),
  ('virginia','VA'),('washington','WA'),('west virginia','WV'),('wisconsin','WI'),('wyoming','WY'),
  ('district of columbia','DC'),('washington dc','DC'),('puerto rico','PR')
)
update public.dc_candidate_facilities d set
  street_address    = us.street,
  postal_code       = us.postal,
  city              = coalesce(d.city, us.city),
  subdivision_code  = coalesce(
                        d.subdivision_code,
                        st.code,
                        case when us.state_raw ~ '^[A-Za-z]{2}$' then upper(us.state_raw) end
                      ),
  address_basis     = 'atlas_freetext_us'
from us left join st on st.nm = lower(us.state_raw)
where d.id = us.id;

--------------------------------------------- shape B, everything else (street only)
with seg as (
  select id,
         (select array_agg(trim(x) order by o)
            from unnest(string_to_array(trim(raw->>'address'), ',')) with ordinality t(x,o)) as p
  from public.dc_candidate_facilities
  where source_key = 'dc:atlas'
    and not (raw ? 'street')
    and nullif(trim(raw->>'address'), '') is not null
)
update public.dc_candidate_facilities d set
  street_address = nullif(seg.p[1], ''),
  address_basis  = case when array_length(seg.p,1) = 1
                        then 'atlas_freetext_unsegmented'
                        else 'atlas_freetext' end
from seg
where d.id = seg.id
  and d.address_basis is distinct from 'atlas_freetext_us'
  and nullif(seg.p[1], '') is not null;

------------------------------------------------------------- country_code -> ISO2
-- Unresolvable values (address fragments, "Unknown", deprecated codes) are left
-- NULL per decision 3 rather than guessed. "Georgia" resolves to the COUNTRY on
-- evidence: that row is name='Tbilisi', address='Gldani District Tbilisi Georgia'.
-- address_basis is stamped in THIS statement, not a later one: the
-- address_basis_required constraint is checked at end of statement, so a row
-- gaining country_iso2 with no stamp yet would violate it.
with m(nm, code) as (values
  ('us','US'),('usa','US'),('united states','US'),('in','IN'),
  ('united kingdom','GB'),('germany','DE'),('duitsland','DE'),('niederlande','NL'),
  ('france','FR'),('china','CN'),('netherlands','NL'),('nederland','NL'),('canada','CA'),
  ('australia','AU'),('india','IN'),('brazil','BR'),('italy','IT'),('japan','JP'),
  ('spain','ES'),('indonesia','ID'),('switzerland','CH'),('svizzera','CH'),('sweden','SE'),
  ('sverige','SE'),('russia','RU'),('russian federation','RU'),('singapore','SG'),
  ('south africa','ZA'),('malaysia','MY'),('malasia','MY'),('hong kong','HK'),('poland','PL'),
  ('polska','PL'),('ireland','IE'),('new zealand','NZ'),('belgium','BE'),('austria','AT'),
  ('south korea','KR'),('republic of korea','KR'),('denmark','DK'),('danmark','DK'),
  ('norway','NO'),('norge','NO'),('noorwegen','NO'),('finland','FI'),('finlandia','FI'),
  ('suomi','FI'),('mexico','MX'),('portugal','PT'),('bulgaria','BG'),('chile','CL'),
  ('thailand','TH'),('tailandia','TH'),('israel','IL'),('saudi arabia','SA'),('argentina','AR'),
  ('colombia','CO'),('romania','RO'),('turkey','TR'),('vietnam','VN'),('nigeria','NG'),
  ('ukraine','UA'),('kenya','KE'),('czech republic','CZ'),('czechia','CZ'),('cyprus','CY'),
  ('chipre','CY'),('ghana','GH'),('taiwan','TW'),('luxembourg','LU'),('latvia','LV'),
  ('greece','GR'),('grecia','GR'),('pakistan','PK'),('estonia','EE'),('egypt','EG'),
  ('hungary','HU'),('philippines','PH'),('slovakia','SK'),('lithuania','LT'),('tanzania','TZ'),
  ('united arab emirates','AE'),('uganda','UG'),('morocco','MA'),('angola','AO'),
  ('mauritius','MU'),('peru','PE'),('costa rica','CR'),('mozambique','MZ'),('malta','MT'),
  ('cameroon','CM'),('algeria','DZ'),('slovenia','SI'),('qatar','QA'),('zambia','ZM'),
  ('panama','PA'),('tunisia','TN'),('jordan','JO'),('senegal','SN'),('iran','IR'),
  ('namibia','NA'),('croatia','HR'),('bahrain','BH'),('liechtenstein','LI'),('uruguay','UY'),
  ('oman','OM'),('rwanda','RW'),('ecuador','EC'),('puerto rico','PR'),('serbia','RS'),
  ('armenia','AM'),('benin','BJ'),('kuwait','KW'),('botswana','BW'),('bangladesh','BD'),
  ('trinidad and tobago','TT'),('sudan','SD'),('republic of the congo','CG'),('congo','CG'),
  ('guam','GU'),('djibouti','DJ'),('cambodia','KH'),('gabon','GA'),('mauritania','MR'),
  ('venezuela','VE'),('jersey','JE'),('liberia','LR'),('ethiopia','ET'),('bolivia','BO'),
  ('belarus','BY'),('swaziland','SZ'),('malawi','MW'),('kazakhstan','KZ'),('gibraltar','GI'),
  ('togo','TG'),('burkina faso','BF'),('guinea','GN'),('lebanon','LB'),('madagascar','MG'),
  ('montenegro','ME'),('libya','LY'),('iceland','IS'),('afghanistan','AF'),('albania','AL'),
  ('azerbaijan','AZ'),('bosnia and herzegovina','BA'),('cabo verde','CV'),('cape verde','CV'),
  ('chad','TD'),('dominican republic','DO'),('equatorial guinea','GQ'),('french polynesia','PF'),
  ('georgia','GE'),('greenland','GL'),('guatemala','GT'),('guernsey','GG'),('guinea-bissau','GW'),
  ('iraq','IQ'),('isle of man','IM'),('ivory coast','CI'),('macedonia','MK'),
  ('north macedonia','MK'),('mali','ML'),('moldova','MD'),('monaco','MC'),('myanmar','MM'),
  ('myanmar (burma)','MM'),('nepal','NP'),('sierra leone','SL'),('south sudan','SS'),
  ('sri lanka','LK'),('the gambia','GM'),('uzbekistan','UZ'),('zimbabwe','ZW')
)
update public.dc_candidate_facilities d
set country_iso2  = m.code,
    address_basis = coalesce(d.address_basis, 'country_only')
from m
where m.nm = lower(trim(d.country_code));

update public.dc_candidate_facilities
set address_parsed_at = now()
where address_basis is not null;
