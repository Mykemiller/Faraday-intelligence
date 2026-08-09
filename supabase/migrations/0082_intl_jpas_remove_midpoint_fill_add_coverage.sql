-- CC-EU-DC-REGISTRY-AND-SCORING-REVISION-1.0 / fix the international JPAS midpoint fill.
-- APPLIED to prod 2026-08-09.
--
-- THE DEFECT: when a tier had no data it was flagged ABS and then assigned
--     v_contrib := v_weight * 0.50
-- a midpoint that ALSO bypassed the confidence multiplier, so a tier with nothing
-- behind it was indistinguishable from measured evidence -- and, because the real
-- tiers carry an EST multiplier of 0.30, the FILL SCORED HIGHER THAN MEASUREMENT.
-- All 192 non-US countries carried a non-null rankable score built substantially from
-- placeholders; Germany read jpas_score 39.60 beside jpas_tier 'Unscored'.
--
-- WHAT THE FILL WAS HIDING: five of the ten tiers -- T4_labor, T5_environmental,
-- T6_real_estate, T9_connectivity, T10_financial -- are never assigned a confidence by
-- this function at all. They fall through to ABS unconditionally, whatever the data.
-- The REACHABLE CEILING IS THEREFORE 55% coverage. Observed: 55% x101, 50% x1,
-- 43% x80, 38% x9, 26% x1. Between 45% and 74% of every old score was fabricated.
--
-- THE FIX
--  1. An absent tier is excluded from BOTH numerator and denominator.
--  2. Coverage is written to the existing jpas_completeness / jpas_completeness_grade
--     columns (NULL for all 193 country rows until now -- purely additive), using the
--     same jw_completeness_grade() helper as the US quality lane.
--  3. The tier LABEL is capped by coverage -- a country can never be labelled better
--     than its coverage supports.
--  4. Below 40% coverage no composite is emitted: jpas_score NULL, label 'Unscored'.
--
-- NOT CHANGED: dim_* JPS-Lite values, tier weights, confidence multipliers, US lane.
--
-- ⚠️ WHAT THIS FIX REVEALED -- READ BEFORE TRUSTING jpas_score FOR ANY NON-US COUNTRY.
-- The per-tier raw_score is a COUNT OF ATTRIBUTES PRESENT, not a measurement of their
-- values: T2 = least(n_pwr,4)*25, T3 = least(n_reg,3)*100/3, T1/T8 = 100 if the row
-- merely exists, T7 = least(n_inc,2)*50. The actual measured values (WGI governance,
-- watts per capita, permitting days) are read into v_wgi_mean / v_capacity_wpc /
-- v_db_days and used ONLY for the dim_* JPS-Lite fields -- never for jpas_score.
-- Consequence, visible in prod after this migration: 98 countries share EXACTLY 31.09
-- and 74 share EXACTLY 35.58. Germany, France, Netherlands, Ireland, Sweden, Japan,
-- Singapore and Brazil are all identical. Worse, 43%-coverage countries score 35.58 --
-- HIGHER than 55%-coverage countries at 31.09 -- because the tier they are missing
-- (T7_incentives, raw 50) is the weakest one, so dropping it raises the mean.
-- A country we know LESS about scores BETTER. jpas_score is a data-presence metric
-- wearing the costume of a suitability score. Fixing that is a separate piece of work;
-- the all-'Unscored' labels this migration produces are the correct guard meanwhile.
create or replace function public.intl_compute_country_jpas()
returns jsonb
language plpgsql
set search_path to 'public'
as $fn$
DECLARE
  v_weights CONSTANT JSONB := '{"T1_municipality":5,"T2_power":18,"T3_regulatory":12,"T4_labor":8,"T5_environmental":12,"T6_real_estate":10,"T7_incentives":12,"T8_community":8,"T9_connectivity":8,"T10_financial":7}';
  v_mult CONSTANT JSONB := '{"VRF":1.00,"SRC":0.85,"INF":0.60,"EST":0.30}';
  v_min_coverage CONSTANT NUMERIC := 40.0;
  r RECORD;
  v_tier TEXT; v_weight NUMERIC;
  v_total NUMERIC; v_possible NUMERIC; v_all_weight NUMERIC;
  v_breakdown JSONB; v_flags JSONB;
  v_raw NUMERIC; v_conf TEXT; v_contrib NUMERIC;
  v_score NUMERIC; v_label TEXT; v_coverage NUMERIC; v_ceiling TEXT;
  v_n INT := 0; v_null_score INT := 0;
  v_pwr_n INT; v_reg_n INT; v_prm_n INT; v_com_n INT; v_inc_n INT;
  v_wgi_mean NUMERIC; v_db_score NUMERIC; v_db_days NUMERIC; v_capacity_wpc NUMERIC;
  v_access NUMERIC; v_com_cap NUMERIC; v_rri_open NUMERIC;
  v_dim_power NUMERIC; v_dim_reg NUMERIC; v_dim_prm NUMERIC; v_dim_opp NUMERIC; v_dim_inc NUMERIC;
BEGIN
  SELECT sum(value::numeric) INTO v_all_weight FROM jsonb_each_text(v_weights);

  FOR r IN SELECT id, country_code FROM jurisdictions WHERE level = 'country' AND country_code <> 'US'
  LOOP
    SELECT
      count(*) FILTER (WHERE attribute_code LIKE 'CTY-PWR-%'),
      count(*) FILTER (WHERE attribute_code LIKE 'CTY-REG-%'),
      count(*) FILTER (WHERE attribute_code = 'CTY-PRM-DB2020'),
      count(*) FILTER (WHERE attribute_code = 'CTY-COM-CAPACITY'),
      count(*) FILTER (WHERE attribute_code LIKE 'CTY-INC-%'),
      avg((value->>'wgi_score_0_100')::numeric) FILTER (WHERE attribute_code LIKE 'CTY-REG-%'),
      max((value->>'db_score_0_100')::numeric) FILTER (WHERE attribute_code = 'CTY-PRM-DB2020'),
      max((value->>'days')::numeric) FILTER (WHERE attribute_code = 'CTY-PRM-DB2020'),
      max((value->>'watts_per_capita')::numeric) FILTER (WHERE attribute_code = 'CTY-PWR-CAP-PC'),
      max((value->>'electricity_access_pct')::numeric) FILTER (WHERE attribute_code = 'CTY-PWR-RELIABILITY'),
      max((value->>'capacity_0_100')::numeric) FILTER (WHERE attribute_code = 'CTY-COM-CAPACITY'),
      max((value->>'openness_0_100')::numeric) FILTER (WHERE attribute_code = 'CTY-INC-FDI-RRI')
    INTO v_pwr_n, v_reg_n, v_prm_n, v_com_n, v_inc_n,
         v_wgi_mean, v_db_score, v_db_days, v_capacity_wpc, v_access, v_com_cap, v_rri_open
    FROM jpas_attributes
    WHERE jurisdiction_id = r.id AND source LIKE 'intl:%';

    v_total := 0; v_possible := 0; v_breakdown := '{}'; v_flags := '{}';

    FOR v_tier, v_weight IN SELECT key, value::numeric FROM jsonb_each_text(v_weights)
    LOOP
      v_conf := CASE
        WHEN v_tier = 'T2_power'       AND v_pwr_n > 0 THEN 'EST'
        WHEN v_tier = 'T3_regulatory'  AND v_reg_n > 0 THEN 'EST'
        WHEN v_tier = 'T1_municipality' AND v_prm_n > 0 THEN 'EST'
        WHEN v_tier = 'T8_community'   AND v_com_n > 0 THEN 'INF'
        WHEN v_tier = 'T7_incentives'  AND v_inc_n > 0 THEN 'EST'
        ELSE 'ABS' END;
      v_raw := CASE v_tier
        WHEN 'T2_power'        THEN least(v_pwr_n, 4) * 25.0
        WHEN 'T3_regulatory'   THEN least(v_reg_n, 3) * 100.0 / 3
        WHEN 'T1_municipality' THEN CASE WHEN v_prm_n > 0 THEN 100.0 ELSE NULL END
        WHEN 'T8_community'    THEN CASE WHEN v_com_n > 0 THEN 100.0 ELSE NULL END
        WHEN 'T7_incentives'   THEN least(v_inc_n, 2) * 50.0
        ELSE NULL END;

      IF v_conf = 'ABS' OR v_raw IS NULL THEN
        -- ABSENT: contributes NOTHING and claims NO share of the denominator.
        -- This is the fix. Do NOT reintroduce a midpoint here.
        v_conf := 'ABS';
        v_breakdown := v_breakdown || jsonb_build_object(v_tier, jsonb_build_object(
          'raw_score', NULL, 'confidence', 'ABS', 'multiplier', 0,
          'weighted_contribution', 0, 'tier_weight', v_weight, 'counted', false));
      ELSE
        v_contrib := (v_raw / 100.0) * v_weight * (v_mult->>v_conf)::numeric;
        v_total    := v_total + v_contrib;
        v_possible := v_possible + v_weight;
        v_breakdown := v_breakdown || jsonb_build_object(v_tier, jsonb_build_object(
          'raw_score', round(v_raw, 2), 'confidence', v_conf,
          'multiplier', (v_mult->>v_conf)::numeric,
          'weighted_contribution', round(v_contrib, 2), 'tier_weight', v_weight, 'counted', true));
      END IF;
      v_flags := v_flags || jsonb_build_object(v_tier, v_conf);
    END LOOP;

    v_coverage := round(v_possible / v_all_weight * 100, 2);

    IF v_possible = 0 OR v_coverage < v_min_coverage THEN
      v_score := NULL;
      v_label := 'Unscored';
      v_null_score := v_null_score + 1;
    ELSE
      v_score := least(100, round(v_total / v_possible * 100, 2));
      v_ceiling := CASE WHEN v_coverage >= 80 THEN 'Verified'
                        WHEN v_coverage >= 60 THEN 'Estimated'
                        ELSE 'Inferred' END;
      v_label := CASE WHEN v_score >= 80 THEN 'Verified'
                      WHEN v_score >= 60 THEN 'Estimated'
                      WHEN v_score >= 40 THEN 'Inferred'
                      ELSE 'Unscored' END;
      IF (v_label = 'Verified' AND v_ceiling <> 'Verified')
         OR (v_label = 'Estimated' AND v_ceiling = 'Inferred') THEN
        v_label := v_ceiling;
      END IF;
    END IF;

    v_breakdown := v_breakdown || jsonb_build_object('_meta', jsonb_build_object(
      'covered_weight', v_possible, 'total_weight', v_all_weight,
      'coverage_pct', v_coverage, 'min_coverage_for_score', v_min_coverage,
      'reachable_ceiling_pct', 55,
      'note', 'T4_labor, T5_environmental, T6_real_estate, T9_connectivity and T10_financial have no source wired in this function and are always ABS; 55% is therefore the maximum attainable coverage.'));

    v_dim_power := CASE
      WHEN v_capacity_wpc IS NULL THEN NULL
      ELSE greatest(1, least(5,
        least(
          CASE WHEN v_capacity_wpc >= 1000 THEN 5 WHEN v_capacity_wpc >= 300 THEN 4
               WHEN v_capacity_wpc >= 100 THEN 3 WHEN v_capacity_wpc >= 20 THEN 2 ELSE 1 END,
          CASE WHEN v_access IS NULL THEN 5 WHEN v_access >= 95 THEN 5 WHEN v_access >= 80 THEN 4
               WHEN v_access >= 50 THEN 3 ELSE 2 END))) END;
    v_dim_reg := CASE WHEN v_wgi_mean IS NULL THEN NULL
      ELSE greatest(1, least(5, round(v_wgi_mean / 20.0 + 0.5))) END;
    v_dim_prm := COALESCE(
      CASE WHEN v_db_score IS NULL THEN NULL
           ELSE greatest(1, least(5, round(v_db_score / 20.0 + 0.5))) END,
      intl_dim_permitting_from_days(v_db_days));
    v_dim_opp := CASE WHEN v_com_cap IS NULL THEN NULL
      ELSE greatest(1, least(5, round(5 - 4 * v_com_cap / 100.0))) END;
    v_dim_inc := CASE WHEN v_rri_open IS NULL THEN NULL
      ELSE greatest(1, least(5, round(1 + 4 * v_rri_open / 100.0))) END;

    UPDATE jurisdictions SET
      jpas_score = v_score, jpas_tier = v_label,
      jpas_breakdown = v_breakdown, jpas_confidence_flags = v_flags,
      jpas_computed_at = now(),
      jpas_completeness = v_coverage,
      jpas_completeness_grade = jw_completeness_grade(v_coverage),
      dim_power = v_dim_power, dim_regulatory = v_dim_reg, dim_permitting = v_dim_prm,
      dim_opposition = v_dim_opp, dim_incentives = v_dim_inc
    WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'countries_scored', v_n,
    'countries_null_score_low_coverage', v_null_score,
    'min_coverage_for_score', v_min_coverage,
    'reachable_ceiling_pct', 55);
END
$fn$;

comment on function public.intl_compute_country_jpas() is
  'International (non-US) country JPAS. Absent tiers are EXCLUDED from numerator and denominator -- never midpoint-filled (that defect made all 192 countries carry a fabricated rankable score). Coverage is written to jpas_completeness/_grade. The tier label is capped by coverage. Below 40% coverage no composite is emitted. NOTE: 5 of 10 tiers have no source wired, so 55% is the maximum attainable coverage. WARNING: per-tier raw_score counts ATTRIBUTES PRESENT, not their values, so 98 countries share the same score -- jpas_score is not yet a usable non-US ranking signal.';
