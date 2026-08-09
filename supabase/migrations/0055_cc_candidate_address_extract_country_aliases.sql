-- CC-CANDIDATE-ADDRESS-EXTRACT-1.0 — Part 3 of 3 (country alias top-up)
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-08-09.
--
-- 0054 authored its country map from an ASCII-only sample of the vocabulary,
-- which wrongly treated accented / native-script country NAMES as junk and
-- swept them into the unmapped bucket. These are resolvable countries, not
-- guesses. Recovered 264 rows (country_iso2 18,406 -> 18,670).
-- Still no external API, no new facts.

with m(nm, code) as (values
  ('bélgica','BE'),('belgië','BE'),('canadá','CA'),('côte d''ivoire','CI'),
  ('democratic republic of the congo','CD'),('españa','ES'),('japón','JP'),
  ('la réunion','RE'),('méxico','MX'),('moldávia','MD'),('países bajos','NL'),
  ('república dominicana','DO'),('românia','RO'),('rumanía','RO'),
  ('são tomé and príncipe','ST'),('sudáfrica','ZA'),('taiwán','TW'),
  ('türkiye','TR'),('turquía','TR'),('việt nam','VN'),
  ('българия','BG'),('россия','RU'),('香港','HK')
)
update public.dc_candidate_facilities d
set country_iso2  = m.code,
    address_basis = coalesce(d.address_basis, 'country_only')
from m
where d.country_iso2 is null
  and m.nm = lower(trim(d.country_code));

-- "<country> <postcode>" values: the country half is unambiguous.
update public.dc_candidate_facilities
set country_iso2  = 'SG',
    address_basis = coalesce(address_basis, 'country_only')
where country_iso2 is null and country_code ~ '^Singapore\s+[0-9]{6}$';

update public.dc_candidate_facilities
set country_iso2  = 'TW',
    address_basis = coalesce(address_basis, 'country_only')
where country_iso2 is null and country_code ~* '^Taiw[áa]n\s+[0-9]{3}$';

update public.dc_candidate_facilities
set address_parsed_at = now()
where address_basis is not null and address_parsed_at is null;

-- The 220 rows still unmapped are genuine junk and stay NULL by design:
-- bare numeric postcodes ("100070"), CJK street fragments ("兴云西路90号"),
-- "Unknown", non-country strings ("Apple Store", "Petah Tikva"), and
-- deprecated codes ("Netherlands Antilles", "Serbia and Montenegro").
