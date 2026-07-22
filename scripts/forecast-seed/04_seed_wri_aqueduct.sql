-- WRI Aqueduct 4.0 future projections - forecast-layer seed
-- Idempotent: vintage upsert on (source_id,vintage_label); observations delete-by-source then set-based insert.
-- Data: Aqueduct40_future_annual_y2023m07d05.csv (fields {scen}{yr}_ws_x_s/_x_c/_x_l). 8 primary DC-market basins x 3 scenarios x 3 years = 72 obs.
begin;

insert into forecast_vintages (source_id,vintage_label,published_date,horizon_end_year,source_url,archive_url,notes)
values ('wri-aqueduct-4-0-future-projections','Aqueduct 4.0 future-annual (2023)','2023-08-16',2080,'https://www.wri.org/data/aqueduct-water-risk-atlas','https://files.wri.org/aqueduct/aqueduct-4-0-water-risk-data.zip',
'WRI Aqueduct 4.0 future-annual dataset (Aqueduct40_future_annual_y2023m07d05.csv). Baseline water-stress projections under business-as-usual (SSP3 RCP7.0), optimistic (SSP1 RCP2.6), pessimistic (SSP5 RCP8.5) for 2030/2050/2080. Fields {scen}{yr}_ws_x_s=score(0-5), _x_c=category(0-4), _x_l=label. Basins mapped to Faraday jurisdictions via existing jurisdiction_water_stress crosswalk (pfaf_id).')
on conflict (source_id,vintage_label) do update set published_date=excluded.published_date, horizon_end_year=excluded.horizon_end_year, source_url=excluded.source_url, archive_url=excluded.archive_url, notes=excluded.notes;

delete from forecast_observations where source_id='wri-aqueduct-4-0-future-projections' and method='manual';

insert into forecast_observations (vintage_id,source_id,jurisdiction_id,attribute_code,target_year,metric_name,value,unit,scenario,confidence,method,notes)
select (select vintage_id from forecast_vintages where source_id='wri-aqueduct-4-0-future-projections' and vintage_label='Aqueduct 4.0 future-annual (2023)'),
       'wri-aqueduct-4-0-future-projections', d.jur::uuid, 'WTR-03', d.ty,
       'Aqueduct 4.0 future baseline water stress (score)',
       d.score, 'water stress score (0-5; cat '||d.cat||': '||d.lab||')', d.scen, 'modeled','manual',
       'WRI Aqueduct 4.0 future-annual (y2023m07d05); pfaf_id='||d.pfaf||' ('||d.place||'); field '||d.fld||'='||d.score::text||'; category '||d.cat||' '''||d.lab||'''; scenario='||d.scen||'; mapped via Faraday jurisdiction_water_stress crosswalk.'
from (values
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2030,0.565,0,'Low (<10%)','business-as-usual','bau30_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2050,0.323,0,'Low (<10%)','business-as-usual','bau50_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2080,0.0674,0,'Low (<10%)','business-as-usual','bau80_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2030,0.6971,0,'Low (<10%)','optimistic','opt30_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2050,0.8998,0,'Low (<10%)','optimistic','opt50_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2080,1.1278,1,'Low-medium (10-20%)','optimistic','opt80_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2030,0.52,0,'Low (<10%)','pessimistic','pes30_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2050,0.8563,0,'Low (<10%)','pessimistic','pes50_ws_x_s'),
('aee898f0-1802-4386-8e34-15050a8c386b','772330','Clark County, NV',2080,0.8566,0,'Low (<10%)','pessimistic','pes80_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2030,4.0364,4,'Extremely high (>80%)','business-as-usual','bau30_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2050,3.7087,3,'High (40-80%)','business-as-usual','bau50_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2080,3.9973,3,'High (40-80%)','business-as-usual','bau80_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2030,4.0458,4,'Extremely high (>80%)','optimistic','opt30_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2050,4.2348,4,'Extremely high (>80%)','optimistic','opt50_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2080,3.5232,3,'High (40-80%)','optimistic','opt80_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2030,4.5208,4,'Extremely high (>80%)','pessimistic','pes30_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2050,4.6694,4,'Extremely high (>80%)','pessimistic','pes50_ws_x_s'),
('0b8ce5d0-8edc-4362-abdd-4165da16f4a0','772217','Maricopa County, AZ',2080,4.6221,4,'Extremely high (>80%)','pessimistic','pes80_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2030,1.6402,1,'Low-medium (10-20%)','business-as-usual','bau30_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2050,1.9425,1,'Low-medium (10-20%)','business-as-usual','bau50_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2080,1.3477,1,'Low-medium (10-20%)','business-as-usual','bau80_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2030,2.0949,2,'Medium-high (20-40%)','optimistic','opt30_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2050,2.366,2,'Medium-high (20-40%)','optimistic','opt50_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2080,2.2753,2,'Medium-high (20-40%)','optimistic','opt80_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2030,2.0364,2,'Medium-high (20-40%)','pessimistic','pes30_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2050,2.3917,2,'Medium-high (20-40%)','pessimistic','pes50_ws_x_s'),
('8d7029a9-3af4-46d0-96a3-1db3d30db740','774300','Santa Clara County, CA',2080,2.9066,2,'Medium-high (20-40%)','pessimistic','pes80_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2030,0.416,0,'Low (<10%)','business-as-usual','bau30_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2050,0.5588,0,'Low (<10%)','business-as-usual','bau50_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2080,0.0,0,'Low (<10%)','business-as-usual','bau80_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2030,0.597,0,'Low (<10%)','optimistic','opt30_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2050,0.8932,0,'Low (<10%)','optimistic','opt50_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2080,0.968,0,'Low (<10%)','optimistic','opt80_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2030,0.465,0,'Low (<10%)','pessimistic','pes30_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2050,0.8327,0,'Low (<10%)','pessimistic','pes50_ws_x_s'),
('cd890b5a-9bb4-47e2-bc75-dbe0165ebd66','731801','Loudoun County, VA',2080,1.045,1,'Low-medium (10-20%)','pessimistic','pes80_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2030,3.8756,3,'High (40-80%)','business-as-usual','bau30_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2050,3.9801,3,'High (40-80%)','business-as-usual','bau50_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2080,3.3636,3,'High (40-80%)','business-as-usual','bau80_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2030,4.1509,4,'Extremely high (>80%)','optimistic','opt30_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2050,3.9946,3,'High (40-80%)','optimistic','opt50_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2080,4.3717,4,'Extremely high (>80%)','optimistic','opt80_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2030,3.9317,3,'High (40-80%)','pessimistic','pes30_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2050,4.2035,4,'Extremely high (>80%)','pessimistic','pes50_ws_x_s'),
('43ad104c-f88c-4f68-ac1f-1e6a84f5d212','731901','Prince William County, VA',2080,4.4331,4,'Extremely high (>80%)','pessimistic','pes80_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2030,2.9016,2,'Medium-high (20-40%)','business-as-usual','bau30_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2050,2.9188,2,'Medium-high (20-40%)','business-as-usual','bau50_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2080,2.5822,2,'Medium-high (20-40%)','business-as-usual','bau80_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2030,2.9497,2,'Medium-high (20-40%)','optimistic','opt30_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2050,3.2313,3,'High (40-80%)','optimistic','opt50_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2080,3.2122,3,'High (40-80%)','optimistic','opt80_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2030,3.0149,3,'High (40-80%)','pessimistic','pes30_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2050,3.291,3,'High (40-80%)','pessimistic','pes50_ws_x_s'),
('7a3137c1-cdd4-4b33-9c3a-a42ec73e00e9','742678','Franklin County, OH',2080,3.5502,3,'High (40-80%)','pessimistic','pes80_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2030,2.2147,2,'Medium-high (20-40%)','business-as-usual','bau30_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2050,2.2509,2,'Medium-high (20-40%)','business-as-usual','bau50_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2080,2.0285,2,'Medium-high (20-40%)','business-as-usual','bau80_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2030,2.2433,2,'Medium-high (20-40%)','optimistic','opt30_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2050,2.1593,2,'Medium-high (20-40%)','optimistic','opt50_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2080,2.4364,2,'Medium-high (20-40%)','optimistic','opt80_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2030,1.9757,1,'Low-medium (10-20%)','pessimistic','pes30_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2050,2.5442,2,'Medium-high (20-40%)','pessimistic','pes50_ws_x_s'),
('45914406-887e-4416-ae55-a6bf7635e516','751407','Dallas County, TX',2080,2.4331,2,'Medium-high (20-40%)','pessimistic','pes80_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2030,4.5987,4,'Extremely high (>80%)','business-as-usual','bau30_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2050,4.728,4,'Extremely high (>80%)','business-as-usual','bau50_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2080,4.473,4,'Extremely high (>80%)','business-as-usual','bau80_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2030,4.4538,4,'Extremely high (>80%)','optimistic','opt30_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2050,4.5932,4,'Extremely high (>80%)','optimistic','opt50_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2080,4.7036,4,'Extremely high (>80%)','optimistic','opt80_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2030,4.3526,4,'Extremely high (>80%)','pessimistic','pes30_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2050,4.8839,4,'Extremely high (>80%)','pessimistic','pes50_ws_x_s'),
('b5364aea-1f44-4b82-a8e1-721aba850055','751409','Tarrant County, TX',2080,4.5951,4,'Extremely high (>80%)','pessimistic','pes80_ws_x_s')
) as d(jur,pfaf,place,ty,score,cat,lab,scen,fld);

commit;
