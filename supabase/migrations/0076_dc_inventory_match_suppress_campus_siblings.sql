-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / R3. APPLIED to prod 2026-08-09.
-- dc_match_facilities suppressed merge pairs between a parent and ITS OWN CHILD, but
-- not between two children of the same parent. A campus with 5 buildings therefore
-- emitted 10 sibling merge pairs into the review queue -- precisely the noise the
-- hierarchy exists to remove, and a standing invitation to merge away real buildings.
--
-- Baseline prosrc md5 before this change: 78c861e4a85135e8441f235bfabb75c3
-- The ONLY edit is the added sibling clause in the _dcm_pairs DELETE; the in-migration
-- gate (see prod migration record) proved the rest of the 9,137-char body byte-identical.
create or replace function public.dc_match_facilities(p_apply boolean DEFAULT false, p_actor text DEFAULT 'CC-DC-SPINE-SPRINT2'::text)
 RETURNS TABLE(run_id uuid, candidate_pairs integer, auto_merged integer, queued integer, rejected integer, merges_applied integer, applied boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn$
declare
  v_run uuid := gen_random_uuid();
  v_w_name numeric; v_w_geo numeric; v_w_op numeric; v_w_ext numeric; v_w_life numeric;
  v_t_auto numeric; v_t_queue numeric; v_t_autodist numeric;
  v_t_blockdist numeric; v_t_blocksim numeric; v_t_maxshare numeric;
  v_pairs int := 0; v_auto int := 0; v_queued int := 0; v_rejected int := 0; v_applied int := 0;
begin
  select weight into v_w_name from dc_match_weights where component='name' and enabled;
  select weight into v_w_geo  from dc_match_weights where component='geo' and enabled;
  select weight into v_w_op   from dc_match_weights where component='operator' and enabled;
  select weight into v_w_ext  from dc_match_weights where component='external_id' and enabled;
  select weight into v_w_life from dc_match_weights where component='lifecycle' and enabled;
  v_w_name:=coalesce(v_w_name,0); v_w_geo:=coalesce(v_w_geo,0); v_w_op:=coalesce(v_w_op,0);
  v_w_ext:=coalesce(v_w_ext,0); v_w_life:=coalesce(v_w_life,0);
  select value into v_t_auto from dc_match_thresholds where key='auto_merge_min_score';
  select value into v_t_queue from dc_match_thresholds where key='queue_min_score';
  select value into v_t_autodist from dc_match_thresholds where key='auto_merge_max_distance_m';
  select value into v_t_blockdist from dc_match_thresholds where key='block_distance_m';
  select value into v_t_blocksim from dc_match_thresholds where key='block_name_similarity';
  select value into v_t_maxshare from dc_match_thresholds where key='auto_merge_max_share';
  perform set_limit(v_t_blocksim::real);

  create temp table _dcm_f on commit drop as
  select c.id, coalesce(c.name,c.primary_name) as disp_name, c.operator, c.operator_parent,
         c.geog, c.country_code, c.subdivision_code, c.parent_facility_id, c.grain,
         c.lifecycle_status, c.facility_confidence_score, c.discovered_at, c.fdc_id,
         c.resolved_lineages,
         dc_match_norm_name(coalesce(c.name,c.primary_name)) as norm_name,
         coalesce(dc_match_strip_operator(coalesce(c.name,c.primary_name), c.operator),
                  dc_match_norm_name(coalesce(c.name,c.primary_name))) as site_name,
         dc_match_norm_operator(c.operator) as norm_operator,
         dc_match_norm_operator(coalesce(c.operator_parent,c.operator)) as norm_parent,
         dc_match_site_qualifiers(coalesce(c.name,c.primary_name)) as quals
  from dc_facility_current c where c.superseded_by is null;
  create index _dcm_f_geog_gix on _dcm_f using gist (geog);
  create index _dcm_f_name_gix on _dcm_f using gin (norm_name gin_trgm_ops);
  create index _dcm_f_op_ix on _dcm_f (norm_operator, subdivision_code);
  analyze _dcm_f;

  create temp table _dcm_pairs on commit drop as
  with blocked as (
    select a.id a_id, b.id b_id, 'geo_2km'::text reason from _dcm_f a join _dcm_f b
      on a.id<b.id and a.country_code is not distinct from b.country_code
     and a.geog is not null and b.geog is not null and st_dwithin(a.geog,b.geog,v_t_blockdist)
    union
    select a.id,b.id,'name_trgm' from _dcm_f a join _dcm_f b
      on a.id<b.id and a.country_code is not distinct from b.country_code
     and a.norm_name is not null and b.norm_name is not null and a.norm_name % b.norm_name
    union
    select a.id,b.id,'operator_subdivision' from _dcm_f a join _dcm_f b
      on a.id<b.id and a.norm_operator is not null and a.norm_operator<>''
     and a.norm_operator=b.norm_operator and a.subdivision_code is not null
     and a.subdivision_code=b.subdivision_code)
  select a_id,b_id,array_agg(distinct reason order by reason) as reasons
  from blocked group by a_id,b_id;

  delete from _dcm_pairs p using _dcm_f a, _dcm_f b
  where a.id=p.a_id and b.id=p.b_id
    and (a.parent_facility_id=b.id or b.parent_facility_id=a.id
         or (a.parent_facility_id is not null
             and a.parent_facility_id=b.parent_facility_id));

  create temp table _dcm_scored on commit drop as
  select p.a_id, p.b_id, p.reasons,
    case when st_distance(a.geog,b.geog) is not null
         then round(st_distance(a.geog,b.geog)::numeric,1) end as distance_m,
    case when a.site_name is not null and b.site_name is not null
         then round(similarity(a.site_name,b.site_name)::numeric,4) end as score_name,
    dc_match_geo_decay(st_distance(a.geog,b.geog)) as score_geo,
    case when a.norm_operator is null or b.norm_operator is null
           or a.norm_operator='' or b.norm_operator='' then null
         when a.norm_operator=b.norm_operator then 1.0000
         when a.norm_parent is not null and a.norm_parent=b.norm_parent then 0.7500
         when similarity(a.norm_operator,b.norm_operator)>=0.80 then 0.6000
         else 0.0000 end as score_operator,
    case when exists (select 1 from dc_facility_identifiers ia
           join dc_facility_identifiers ib on ia.source_key=ib.source_key and ia.external_id=ib.external_id
           where ia.facility_id=a.id and ib.facility_id=b.id) then 1.0000 end as score_external_id,
    1.0000::numeric as score_lifecycle,
    (a.quals is distinct from b.quals) as site_qualifier_conflict,
    exists (select 1 from dc_facility_identifiers ia
           join dc_facility_identifiers ib on ia.source_key=ib.source_key and ia.external_id=ib.external_id
           where ia.facility_id=a.id and ib.facility_id=b.id) as external_id_match
  from _dcm_pairs p join _dcm_f a on a.id=p.a_id join _dcm_f b on b.id=p.b_id;

  create temp table _dcm_final on commit drop as
  select s.*, case when wsum=0 then 0 else round((num/wsum)::numeric,4) end as match_score
  from (select s.*,
      (coalesce(s.score_name*v_w_name,0)+coalesce(s.score_geo*v_w_geo,0)
      +coalesce(s.score_operator*v_w_op,0)+coalesce(s.score_external_id*v_w_ext,0)
      +coalesce(s.score_lifecycle*v_w_life,0)) as num,
      (case when s.score_name is not null then v_w_name else 0 end
      +case when s.score_geo is not null then v_w_geo else 0 end
      +case when s.score_operator is not null then v_w_op else 0 end
      +case when s.score_external_id is not null then v_w_ext else 0 end
      +case when s.score_lifecycle is not null then v_w_life else 0 end) as wsum
    from _dcm_scored s) s;

  select count(*) into v_pairs from _dcm_final;

  insert into dc_facility_match_candidates (run_id,facility_a_id,facility_b_id,block_reasons,
    score_name,score_geo,score_operator,score_external_id,score_lifecycle,match_score,
    distance_m,external_id_match,site_qualifier_conflict,decision,decision_reason)
  select v_run,f.a_id,f.b_id,f.reasons,f.score_name,f.score_geo,f.score_operator,
    f.score_external_id,f.score_lifecycle,f.match_score,f.distance_m,f.external_id_match,
    f.site_qualifier_conflict,
    case when f.match_score>=v_t_auto and not f.site_qualifier_conflict
          and (f.external_id_match or (f.distance_m is not null and f.distance_m<=v_t_autodist))
         then 'auto_merged'
         when f.match_score>=v_t_queue then 'queued' else 'rejected' end,
    case when f.match_score>=v_t_auto and not f.site_qualifier_conflict
          and (f.external_id_match or (f.distance_m is not null and f.distance_m<=v_t_autodist))
         then 'score>='||v_t_auto||' with '||case when f.external_id_match then 'external-ID match'
              else 'coordinate agreement '||f.distance_m||'m' end
         when f.match_score>=v_t_auto and f.site_qualifier_conflict
         then 'score>='||v_t_auto||' but site-qualifier conflict - demoted to review'
         when f.match_score>=v_t_auto
         then 'score>='||v_t_auto||' but no coordinate agreement or external-ID match - demoted to review'
         when f.match_score>=v_t_queue then 'score in queue band - human review'
         else 'score below queue threshold' end
  from _dcm_final f
  on conflict (facility_a_id,facility_b_id) do update set
    run_id=excluded.run_id, block_reasons=excluded.block_reasons, score_name=excluded.score_name,
    score_geo=excluded.score_geo, score_operator=excluded.score_operator,
    score_external_id=excluded.score_external_id, score_lifecycle=excluded.score_lifecycle,
    match_score=excluded.match_score, distance_m=excluded.distance_m,
    external_id_match=excluded.external_id_match,
    site_qualifier_conflict=excluded.site_qualifier_conflict,
    decision=excluded.decision, decision_reason=excluded.decision_reason
  where dc_facility_match_candidates.review_decision is null;

  select count(*) filter (where mc.decision='auto_merged'),
         count(*) filter (where mc.decision='queued'),
         count(*) filter (where mc.decision='rejected')
    into v_auto,v_queued,v_rejected
  from dc_facility_match_candidates mc where mc.run_id=v_run;

  if v_pairs>0 and (v_auto::numeric/v_pairs)>v_t_maxshare then
    raise exception 'dc_match_facilities: auto-merge would fire on % of % candidate pairs (% percent), above the % share rail. Retune dc_match_thresholds; this is a threshold problem, not a data windfall.',
      v_auto,v_pairs,round(100.0*v_auto/v_pairs,1),v_t_maxshare;
  end if;

  if p_apply then
    select dc_match_apply_merges(v_run, p_actor) into v_applied;
  end if;

  run_id:=v_run; candidate_pairs:=v_pairs; auto_merged:=v_auto; queued:=v_queued;
  rejected:=v_rejected; merges_applied:=v_applied; applied:=p_apply;
  return next;
end; $fn$;
