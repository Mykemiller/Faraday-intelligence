-- =====================================================================
-- Unit tests for dc_compute_facility_confidence / dc_compute_publishable.
--
-- Self-contained and NON-DESTRUCTIVE: every fixture is created inside a
-- plpgsql sub-transaction that is deliberately rolled back before results
-- are returned. Results survive because they are accumulated in a plpgsql
-- variable (memory), not a table.
--
-- Run:  psql "$DATABASE_URL" -f test/dc-inventory/fcs-unit-tests.sql
--   or paste the whole file into a SQL console. It leaves zero rows behind
--   (verify with: select count(*) from dc_facilities where fdc_id like 'FDC-TEST%').
--
-- Last run 2026-08-08 against prod ycadmmngkdhvpcsrcuaq: 6/6 PASS.
-- =====================================================================
create or replace function pg_temp.dc_fcs_unit_tests()
returns table(case_name text, expected text, actual text, pass boolean)
language plpgsql
as $fn$
declare
  v_results jsonb := '[]'::jsonb;
  f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; f6 uuid;
  s smallint; b text; p boolean;
  r jsonb;
begin
  begin  -- sub-transaction: every fixture below is rolled back before we return

    -- throwaway registry rows with known licence postures
    insert into public.source_registry
      (source_key, name, url, access_method, cadence, confidence_cap, license,
       license_status, status, source_type, countable)
    values
      ('test:official', 'T official', '', 'manual','one_time','SRC','t','cleared','registered','other',false),
      ('test:operator', 'T operator', '', 'manual','one_time','SRC','t','cleared','registered','other',false),
      ('test:dataset',  'T dataset',  '', 'manual','one_time','SRC','t','cleared','registered','other',false),
      ('test:blocked',  'T blocked',  '', 'manual','one_time','SRC','t','blocked','registered','other',false),
      ('test:news',     'T news',     '', 'manual','one_time','SRC','t','cleared','registered','other',false);

    -- ---------- fixtures ----------
    insert into public.dc_facilities (fdc_id,grain,primary_name,country_code,geo_precision,lifecycle_status,discovered_at)
    values ('FDC-TEST-000001','site','News Only','US','none','operational',current_date) returning id into f1;
    insert into public.dc_facilities (fdc_id,grain,primary_name,country_code,geo_precision,lifecycle_status,discovered_at)
    values ('FDC-TEST-000002','site','Single Source','US','none','operational',current_date) returning id into f2;
    insert into public.dc_facilities (fdc_id,grain,primary_name,country_code,geo_precision,lifecycle_status,discovered_at)
    values ('FDC-TEST-000003','site','Three Sources','US','none','operational',current_date) returning id into f3;
    insert into public.dc_facilities (fdc_id,grain,primary_name,country_code,geo_precision,lifecycle_status,discovered_at)
    values ('FDC-TEST-000004','site','Three One Blocked','US','none','operational',current_date) returning id into f4;
    insert into public.dc_facilities (fdc_id,grain,primary_name,country_code,geo_precision,lifecycle_status,discovered_at)
    values ('FDC-TEST-000005','site','Capacity Diff Basis','US','none','operational',current_date) returning id into f5;
    insert into public.dc_facilities (fdc_id,grain,primary_name,country_code,geo_precision,lifecycle_status,discovered_at)
    values ('FDC-TEST-000006','site','Capacity Same Basis','US','none','operational',current_date) returning id into f6;

    -- CASE 1: news only, three agreeing news lineages
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_text,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    select f1,'test:news','news',current_date,a.attr,a.val,'news-lin-'||g,true,'cleared','SRC'
    from generate_series(1,3) g, (values ('name','Acme DC'),('operator','Acme')) a(attr,val);

    -- CASE 2: single non-news official-record lineage
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_text,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    values (f2,'test:official','official_record',current_date,'name','Solo DC','solo-lin-1',true,'cleared','SRC'),
           (f2,'test:official','official_record',current_date,'operator','Solo','solo-lin-1',true,'cleared','SRC');

    -- CASE 3: three non-news lineages, one official record, all redistributable
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_text,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    select f3, x.sk, x.sc, current_date, a.attr, a.val, x.lin, true,'cleared','SRC'
    from (values ('test:official','official_record','tri-lin-1'),
                 ('test:operator','operator_first_party','tri-lin-2'),
                 ('test:dataset','commercial_dataset','tri-lin-3')) x(sk,sc,lin),
         (values ('name','Tri DC'),('operator','Tri Corp')) a(attr,val);

    -- CASE 4: same as 3, but the third lineage is licence-BLOCKED
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_text,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    select f4, x.sk, x.sc, current_date, a.attr, a.val, x.lin, x.redist, x.lic,'SRC'
    from (values ('test:official','official_record','blk-lin-1',true,'cleared'),
                 ('test:operator','operator_first_party','blk-lin-2',true,'cleared'),
                 ('test:blocked','directory','blk-lin-3',false,'blocked')) x(sk,sc,lin,redist,lic),
         (values ('name','Blk DC'),('operator','Blk Corp')) a(attr,val);

    -- CASE 5: two lineages, capacity quoted on DIFFERENT bases (must not read as disagreement)
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_text,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    values (f5,'test:official','official_record',current_date,'name','Cap DC','cap-lin-1',true,'cleared','SRC'),
           (f5,'test:operator','operator_first_party',current_date,'name','Cap DC','cap-lin-2',true,'cleared','SRC');
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_num,unit,capacity_basis,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    values (f5,'test:official','official_record',current_date,'capacity',100,'MW','it_load','cap-lin-1',true,'cleared','SRC'),
           (f5,'test:operator','operator_first_party',current_date,'capacity',150,'MW','gross_utility','cap-lin-2',true,'cleared','SRC');

    -- CASE 6 (control): same shape, capacity on the SAME basis with conflicting values
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_text,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    values (f6,'test:official','official_record',current_date,'name','Cap2 DC','cap2-lin-1',true,'cleared','SRC'),
           (f6,'test:operator','operator_first_party',current_date,'name','Cap2 DC','cap2-lin-2',true,'cleared','SRC');
    insert into public.dc_facility_observations
      (facility_id,source_key,source_class,observed_at,attribute,value_num,unit,capacity_basis,
       primary_lineage_key,redistributable,license_status_snap,confidence_cap)
    values (f6,'test:official','official_record',current_date,'capacity',100,'MW','it_load','cap2-lin-1',true,'cleared','SRC'),
           (f6,'test:operator','operator_first_party',current_date,'capacity',150,'MW','it_load','cap2-lin-2',true,'cleared','SRC');

    -- ---------- assertions ----------
    select c.score, c.band into s, b from public.dc_compute_facility_confidence(f1) c;
    v_results := v_results || jsonb_build_object(
      'case','1 news-only facility bands Suspect or lower',
      'expected','score<=39 (Suspect max)','actual', s::text||' / '||coalesce(b,'-'),
      'pass', s <= 39);

    select c.score, c.band into s, b from public.dc_compute_facility_confidence(f2) c;
    v_results := v_results || jsonb_build_object(
      'case','2 single-source facility',
      'expected','43 = a18 + b15 + c0 + d10 + e0','actual', s::text||' / '||coalesce(b,'-'),
      'pass', s = 43);

    select c.score, c.band into s, b from public.dc_compute_facility_confidence(f3) c;
    p := public.dc_compute_publishable(f3);
    v_results := v_results || jsonb_build_object(
      'case','3 three sources incl. one official record -> publishable',
      'expected','score 80, publishable true','actual', s::text||' / '||coalesce(b,'-')||' / publishable='||p::text,
      'pass', s = 80 and p is true);

    select c.score, c.band into s, b from public.dc_compute_facility_confidence(f4) c;
    p := public.dc_compute_publishable(f4);
    v_results := v_results || jsonb_build_object(
      'case','4 three sources but one licence-blocked -> NOT publishable',
      'expected','publishable false (only 2 countable lineages)',
      'actual', s::text||' / '||coalesce(b,'-')||' / publishable='||p::text,
      'pass', p is false);

    select c.score into s from public.dc_compute_facility_confidence(f5) c;
    v_results := v_results || jsonb_build_object(
      'case','5 capacity on DIFFERING bases is not a disagreement',
      'expected','70 = a30 + b15 + c15(name only) + d10 + e0','actual', s::text,
      'pass', s = 70);

    select c.score into s from public.dc_compute_facility_confidence(f6) c;
    v_results := v_results || jsonb_build_object(
      'case','6 control: capacity conflict on the SAME basis IS penalised',
      'expected','62 = a30 + b15 + c7(1 of 2 attrs) + d10 + e0','actual', s::text,
      'pass', s = 62);

    raise exception 'rollback_fixtures';
  exception when others then
    if sqlerrm <> 'rollback_fixtures' then raise; end if;
  end;

  for r in select * from jsonb_array_elements(v_results) loop
    case_name := r->>'case'; expected := r->>'expected';
    actual := r->>'actual';  pass := (r->>'pass')::boolean;
    return next;
  end loop;
end;
$fn$;

select * from pg_temp.dc_fcs_unit_tests();
