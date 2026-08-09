-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / resolve the 481 country-less candidates.
-- APPLIED to prod 2026-08-09.
--
-- ROOT CAUSE, and it is not "missing data": these rows are FIELD-SHIFTED. The upstream
-- address parser rotated the columns --
--   country_code   holds a street fragment or postcode ('100070', 'Ulitsa ...')
--   street_address often holds the COUNTRY ('Japan', 'China', 'Russia')
--   city           holds a phone-number fragment ('9500', '004934186970')
-- So the country is usually present, just in the wrong column.
--
-- Writes ONLY the derived column country_iso2 (+ a new country_iso2_basis). The raw
-- country_code is left exactly as found.
--
-- Dictionary = the 192 jurisdictions country stubs plus endonym/exonym aliases.
-- Word-boundary, LONGEST-MATCH-WINS: 'Papua New Guinea' beats 'Guinea';
-- 'Democratic Republic of the Congo' (CD) beats 'Republic of the Congo' (CG) beats
-- 'Congo'. A row resolves only when exactly ONE country survives.
--
-- RESULT: 278 of 481 resolved across 75 countries; 203 held.
-- Four classes of false positive were found by hand-review and are excluded:
--   Netherlands Antilles (4) -> would resolve NL, but the rows are Curacao/Sint Maarten
--   Serbia and Montenegro (2) -> names two countries
--   Beltelecom x2 -> street_address 'Russia' contradicts a Belarus operator / 'Minsk 2'
--   MCV Saipan -> 'Nauru Bldg' is a BUILDING; Susupe is on Saipan, and city says 'Guam'
alter table public.dc_candidate_facilities
  add column if not exists country_iso2_basis text;

comment on column public.dc_candidate_facilities.country_iso2_basis is
  'How country_iso2 was derived. NULL = from the original ingest. address_country_token = recovered from a country name found in the shifted street_address/country_code/city fields (migration 0080).';

with dict as (
  select country_code as iso2, lower(name) as term from jurisdictions where level='country'
  union all select * from (values
    ('DE','deutschland'),('DE','allemagne'),('DE','alemania'),('RU','russian federation'),('RU','russia'),
    ('SZ','swaziland'),('AE','emiratos árabes unidos'),('AE','emiratos arabes unidos'),('AE','uae'),
    ('AE','dubai'),('AE','dubái'),('AE','abu dhabi'),
    ('ES','españa'),('ES','espana'),('NL','nederland'),('NL','holanda'),('NL','países bajos'),('NL','paises bajos'),
    ('JP','japón'),('JP','japon'),('GB','england'),('GB','great britain'),('GB','scotland'),('GB','wales'),
    ('US','united states of america'),('US','usa'),('SA','saudi arabia'),
    ('BE','belgique'),('BE','belgië'),('BE','belgie'),('BE','bélgica'),('BR','brasil'),('IT','italia'),
    ('CH','suisse'),('CH','schweiz'),('CH','suiza'),('AT','österreich'),('SE','sverige'),('SE','suecia'),
    ('DK','danmark'),('NO','norge'),('FI','suomi'),('FI','finlandia'),('PL','polska'),('CZ','czech republic'),
    ('TR','türkiye'),('TR','turkiye'),('VN','viet nam'),('CI','ivory coast'),('MM','burma'),
    ('RO','românia'),('RO','rumanía'),('GR','grecia'),('CY','chipre'),('BG','българия'),('IE','irlanda'),
    ('FR','francia'),('FR','frankreich'),
    ('CD','democratic republic of the congo'),('CG','republic of the congo')
  ) v(iso2,term)
),
src as (
  select id, lower(concat_ws(' ~ ', street_address, country_code, city)) as hay_addr,
         lower(coalesce(name,'')) as hay_name
  from dc_candidate_facilities
  where country_iso2 is null
    and lower(concat_ws(' ',street_address,country_code,city,name)) not like '%netherlands antilles%'
    and lower(concat_ws(' ',street_address,country_code,city,name)) not like '%serbia and montenegro%'
    and id not in ('3f674527-bbc8-4bce-9456-e9f231a4b734',
                   'dfbaa1bf-fc6d-4577-9e95-f76fcce242f0',
                   '21887577-6928-4d0d-bc53-11d80733b529')
),
raw as (
  select s.id, d.iso2, d.term,
         (s.hay_addr ~ ('\m'||regexp_replace(d.term,'([.^$*+?()\[\]{}|\\-])','\\\1','g')||'\M')) as in_addr
  from src s join dict d
    on s.hay_addr ~ ('\m'||regexp_replace(d.term,'([.^$*+?()\[\]{}|\\-])','\\\1','g')||'\M')
    or s.hay_name ~ ('\m'||regexp_replace(d.term,'([.^$*+?()\[\]{}|\\-])','\\\1','g')||'\M')
),
pruned as (
  select r.* from raw r
  where not exists (select 1 from raw r2
                    where r2.id=r.id and r2.term<>r.term and position(r.term in r2.term)>0)
),
best as (
  select id, count(distinct iso2) filter (where in_addr) as n_addr, count(distinct iso2) as n_any,
         min(iso2) filter (where in_addr) as iso_addr, min(iso2) as iso_any
  from pruned group by id
)
update public.dc_candidate_facilities c
   set country_iso2 = coalesce(b.iso_addr, b.iso_any),
       country_iso2_basis = 'address_country_token'
  from best b
 where c.id = b.id
   and c.country_iso2 is null
   and (b.n_addr = 1 or (b.n_addr = 0 and b.n_any = 1));
