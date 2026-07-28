-- CC-INGEST-STATE-INCENTIVE-ALL-WAVES-1.0 · per-source confidence tiering
-- Rationale: fn_state_incentives_resolve_and_score() hardcoded SRC/0.85/primary
-- for EVERY resolved disclosure. That is correct for Waves 1–2 (all primary
-- APIs) but wrong for Waves 3–4, where scraped/PDF/estimated sources must land
-- as INF/EST at a lower multiplier — otherwise scraped HTML would masquerade as
-- primary disclosure. This makes the confidence PER-SOURCE, read from the
-- jw_data_source_registry row's confidence_cap + source_level.
--
-- Precedence (Good Jobs First / Upjohn): a jurisdiction fed by multiple sources
-- takes the HIGHEST-confidence contributor's tier, and source_level='primary' if
-- ANY contributor is primary (an aggregator never demotes a primary source).
--
-- Back-compat: every current source is SRC/primary, so re-scoring the 9 live
-- states yields byte-identical INC-01..05 (verified read-only before apply).
-- Unregistered source_keys default to EST/0.40 — conservative, never over-claims.
--
-- ADDITIVE + REVERSIBLE. UN-APPLIED as of 2026-07-26 — apply at promotion
-- (this REWRITES confidence on existing jpas_attributes, unlike the additive
-- Wave 1–2 seeds, so it is gated on review). Rollback: restore the prior
-- function body (all-SRC/0.85) and `alter table ... drop column source_level`.

-- 1) Per-source disclosure level (primary disclosure vs third-party aggregator).
alter table public.jw_data_source_registry
  add column if not exists source_level text not null default 'primary'
    check (source_level in ('primary', 'aggregator'));

comment on column public.jw_data_source_registry.source_level is
  'primary = first-party government disclosure; aggregator = third-party compiler '
  '(Good Jobs First / Upjohn). Primary wins over aggregator in INC-* scoring.';

-- 2) Confidence-aware resolve + score.
create or replace function public.fn_state_incentives_resolve_and_score(p_state_abbr text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '240s'
as $function$
declare
  v_resolved int;
  v_juris    int;
begin
  set local statement_timeout = '180s';

  -- Resolve county_name -> county jurisdiction (unchanged).
  with cty as (
    select id, lower(regexp_replace(name, '\s+county$', '', 'i')) as nname
      from public.jurisdictions
     where is_active and level = 'county' and state_abbr = p_state_abbr
  )
  update public.state_incentive_disclosures d
     set jurisdiction_id   = cty.id,
         resolution_method = 'county_name',
         resolution_status = 'resolved',
         candidate_count   = 1,
         updated_at        = now()
    from cty
   where d.state_abbr = p_state_abbr
     and d.jurisdiction_id is null
     and d.county_name is not null
     and cty.nname = lower(regexp_replace(d.county_name, '\s+county$', '', 'i'));
  get diagnostics v_resolved = row_count;

  update public.state_incentive_disclosures d
     set resolution_status = 'unresolved', updated_at = now()
   where d.state_abbr = p_state_abbr
     and d.jurisdiction_id is null
     and d.resolution_status <> 'unresolved';

  -- Per-disclosure confidence from the source's registry row.
  with conf as (
    select d.jurisdiction_id, d.award_value_usd, d.incentive_type, d.term_years,
           d.term_start, d.term_end, d.program_name, d.statute_citation,
           case coalesce(r.confidence_cap, 'EST')
             when 'VRF' then 0.95 when 'SRC' then 0.85
             when 'INF' then 0.60 else 0.40 end                as mult,
           coalesce(r.source_level, 'primary')                 as slevel
      from public.state_incentive_disclosures d
      left join public.jw_data_source_registry r on r.source_key = d.source_key
     where d.state_abbr = p_state_abbr
       and d.jurisdiction_id is not null
  ),
  agg as (
    select jurisdiction_id,
           count(*)                                                                     as cnt,
           array_agg(distinct incentive_type) filter (where incentive_type is not null) as types,
           sum(award_value_usd)                                                         as total_val,
           max(award_value_usd)                                                         as max_val,
           max(term_years)                                                              as max_term,
           min(term_start)                                                              as earliest,
           max(term_end)                                                                as latest,
           array_agg(distinct program_name)     filter (where program_name is not null)     as programs,
           array_agg(distinct statute_citation) filter (where statute_citation is not null) as statutes,
           max(mult)                                                                    as best_mult,
           bool_or(slevel = 'primary')                                                  as any_primary
      from conf
     group by jurisdiction_id
  ),
  scored as (
    select *,
           case when best_mult >= 0.95 then 'VRF'
                when best_mult >= 0.85 then 'SRC'
                when best_mult >= 0.60 then 'INF'
                else 'EST' end                                  as best_tier,
           case when any_primary then 'primary' else 'aggregator' end as best_level
      from agg
  ),
  rows as (
    select jurisdiction_id, 'INC-01' as code,
           jsonb_build_object('present',true,'disclosure_count',cnt,'state',p_state_abbr,
                              'via','CC-INGEST-STATE-INCENTIVE-API-1.0') as val
      from scored
    union all
    select jurisdiction_id, 'INC-02',
           jsonb_build_object('types',to_jsonb(coalesce(types,'{}')),'disclosure_count',cnt) from scored
    union all
    select jurisdiction_id, 'INC-03',
           jsonb_build_object('total_award_usd',total_val,'max_award_usd',max_val,
                              'currency','USD','record_count',cnt) from scored
    union all
    select jurisdiction_id, 'INC-04',
           jsonb_build_object('max_term_years',max_term,'earliest_start',earliest,'latest_end',latest) from scored
    union all
    select jurisdiction_id, 'INC-05',
           jsonb_build_object('programs',to_jsonb(coalesce(programs,'{}')),
                              'statutes',to_jsonb(coalesce(statutes,'{}'))) from scored
  )
  insert into public.jpas_attributes
      (jurisdiction_id, tier_code, attribute_code, value,
       confidence_tier, confidence_multiplier, source, source_level, captured_at)
  select r.jurisdiction_id, 'INC', r.code, r.val,
         sc.best_tier, sc.best_mult, 'state_disclosure', sc.best_level, now()
    from rows r
    join scored sc using (jurisdiction_id)
  on conflict (jurisdiction_id, attribute_code, source) do update
     set value                 = excluded.value,
         tier_code             = excluded.tier_code,
         confidence_tier       = excluded.confidence_tier,
         confidence_multiplier = excluded.confidence_multiplier,
         source_level          = excluded.source_level,
         captured_at           = excluded.captured_at;

  select count(distinct jurisdiction_id) into v_juris
    from public.state_incentive_disclosures
   where state_abbr = p_state_abbr and jurisdiction_id is not null;

  return jsonb_build_object('state', p_state_abbr,
                            'newly_resolved', v_resolved,
                            'jurisdictions_written', v_juris);
end
$function$;
