-- CC-DC-SPRINT3 acceptance tests. Run inside BEGIN..ROLLBACK; leaves nothing behind.
-- Result 2026-08-09: 5/5 PASS against the live functions.
begin;
insert into source_registry (source_key,name,cadence,license_status,license) values
 ('t:cleared_a','T A','one_time','cleared','test'),('t:cleared_b','T B','one_time','cleared','test'),
 ('t:gov_cleared','T Gov','one_time','cleared','test'),('t:gov_unrev','T GovU','one_time','unreviewed','test'),
 ('t:sec','T SEC','one_time','cleared','test'),
 ('t:testcounty_planning','p','one_time','cleared','test'),
 ('t:testcounty_assessor','a','one_time','cleared','test'),
 ('t:testcounty_register','r','one_time','cleared','test')
on conflict (source_key) do update set license_status=excluded.license_status;

insert into dc_facilities (id,fdc_id,grain,primary_name,country_code,geo_precision,lifecycle_status,discovered_at) values
 ('11111111-1111-1111-1111-111111111111','FDC-TEST-01','site','T1','US','estimated','operational',current_date),
 ('22222222-2222-2222-2222-222222222222','FDC-TEST-02','site','T2','US','estimated','operational',current_date),
 ('33333333-3333-3333-3333-333333333333','FDC-TEST-03','site','T3','US','estimated','operational',current_date),
 ('44444444-4444-4444-4444-444444444444','FDC-TEST-04','site','T4','US','estimated','operational',current_date);

-- T1: three lineages from ONE county government (planning + assessor + register)
insert into dc_facility_observations (facility_id,source_key,source_class,source_document_ref,observed_at,attribute,value_text,primary_lineage_key,redistributable,license_status_snap)
select '11111111-1111-1111-1111-111111111111', s,'official_record','ref-'||s,current_date,'existence','y','lin-'||s,true,'cleared'
from unnest(array['t:testcounty_planning','t:testcounty_assessor','t:testcounty_register']) s;

insert into dc_facility_observations (facility_id,source_key,source_class,source_document_ref,observed_at,attribute,value_text,primary_lineage_key,redistributable,license_status_snap) values
 ('22222222-2222-2222-2222-222222222222','t:cleared_a','commercial_dataset','r1',current_date,'existence','y','l1',true,'cleared'),
 ('22222222-2222-2222-2222-222222222222','t:cleared_b','operator_first_party','r2',current_date,'existence','y','l2',true,'cleared'),
 ('22222222-2222-2222-2222-222222222222','t:gov_cleared','official_record','PERMIT-123',current_date,'existence','y','l3',true,'cleared'),
 ('33333333-3333-3333-3333-333333333333','t:cleared_a','commercial_dataset','r1',current_date,'existence','y','m1',true,'cleared'),
 ('33333333-3333-3333-3333-333333333333','t:cleared_b','operator_first_party','r2',current_date,'existence','y','m2',true,'cleared'),
 ('33333333-3333-3333-3333-333333333333','t:gov_unrev','official_record','PERMIT-999',current_date,'existence','y','m3',false,'unreviewed'),
 ('44444444-4444-4444-4444-444444444444','t:cleared_a','commercial_dataset','r1',current_date,'existence','y','n1',true,'cleared');

insert into dc_facility_attestations (facility_id,source_key,filer_cik,form_type,accession,source_url,source_document_ref,attested_attributes,operator_matched)
values ('44444444-4444-4444-4444-444444444444','t:sec','0000000001','10-K','0001-24-000001',
        'https://www.sec.gov/x','sec:0001-24-000001',array['existence','operator'],'TestCo');

select 'T1 three lineages, ONE publisher -> not publishable' test,
       dc_compute_publishable('11111111-1111-1111-1111-111111111111') got, false expected
union all select 'T2 three publishers + citable official -> publishable',
       dc_compute_publishable('22222222-2222-2222-2222-222222222222'), true
union all select 'T3 only official record non-citable -> not publishable',
       dc_compute_publishable('33333333-3333-3333-3333-333333333333'), false
union all select 'T4 attestation alone -> publishable',
       dc_compute_publishable('44444444-4444-4444-4444-444444444444'), true
union all select 'T4 attestation -> FCS = 100',
       (select score=100 from dc_compute_facility_confidence('44444444-4444-4444-4444-444444444444')), true;
rollback;
