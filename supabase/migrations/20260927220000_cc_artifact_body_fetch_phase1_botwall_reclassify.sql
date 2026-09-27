-- CC-ARTIFACT-BODY-FETCH Phase 1 — reclassify bot-wall pages served with HTTP 200
--
-- federalregister.gov answers non-browser clients with a 200 "Request Access — due to
-- aggressive automated scraping ... programmatic access is limited to our developer APIs"
-- page (951 chars after extraction). The first extraction pass stored it as 'ok' on 6 URLs
-- / 57 artifact rows. It is a block, not a document: reclassify to 'blocked' and clear the
-- body. (The site names its sanctioned path — the Federal Register API; not used here.)
--
-- abf_extract_run gains a bot-wall check (short body + wall markers => 'blocked', error
-- 'bot_wall_200') so Phase 2 cannot repeat this.

update public.artifact_body_fetch_url
   set state = 'blocked', error = 'bot_wall_200', body_text = null, body_char_count = null,
       extractor = null, fetched_at = null, updated_at = now()
 where state = 'ok'
   and body_char_count < 3000
   and body_text ~* '(aggressive automated scraping|unusual traffic|are you a robot|verify you are (a )?human|checking your browser|enable javascript and cookies to continue)';

create or replace procedure public.abf_extract_run(p_max_urls integer default 500, p_budget_ms integer default 50000)
language plpgsql as $$
declare
  cfg public.artifact_body_fetch_config;
  t0 timestamptz := clock_timestamp();
  t1 timestamptz;
  u record;
  body text; st text; er text;
begin
  select * into cfg from public.artifact_body_fetch_config;
  for u in select source_url from public.artifact_body_fetch_url
           where state = 'fetched' order by length(raw_html) limit p_max_urls loop
    exit when extract(epoch from clock_timestamp() - t0) * 1000 > p_budget_ms;
    t1 := clock_timestamp();
    begin
      select case when f.content_type ilike '%html%' or f.content_type is null
                       or f.raw_html ~* '^\s*(<!doctype|<html)'
                  then public.abf_extract_html(f.raw_html) else btrim(f.raw_html) end,
             case when f.raw_html ~* '(subscribe (now )?to (continue|read|keep reading)|already a subscriber|sign in to (continue|read)|log in to (continue|read)|this (content|article) is (only )?(for|available to) (subscribers|members)|create a free account to continue)'
                  then 'paywall_marker' end
        into body, er
      from public.artifact_body_fetch_url f where f.source_url = u.source_url;
      if length(coalesce(body, '')) < 3000
         and body ~* '(aggressive automated scraping|unusual traffic|are you a robot|verify you are (a )?human|checking your browser|enable javascript and cookies to continue)' then
        st := 'blocked'; er := 'bot_wall_200'; body := null;
      elsif er = 'paywall_marker' and length(coalesce(body, '')) < 1500 then
        st := 'blocked'; er := 'paywall_or_login'; body := null;
      elsif length(coalesce(body, '')) < cfg.min_body_chars then
        st := 'empty'; er := 'no_extractable_text'; body := null;
      else
        st := 'ok'; er := null;
      end if;
    exception when others then
      st := 'failed'; er := left('extract: ' || sqlerrm, 200); body := null;
    end;
    update public.artifact_body_fetch_url
       set state = st, error = er, body_text = body, body_char_count = length(body),
           extractor = case when st = 'ok' then 'pg_http+abf_extract_html_v2' end,
           fetched_at = case when st = 'ok' then now() else fetched_at end,
           extract_ms = round(extract(epoch from clock_timestamp() - t1) * 1000),
           updated_at = now()
     where source_url = u.source_url;
    commit;
  end loop;
  perform public.abf_apply();
  commit;
end $$;
revoke all on procedure public.abf_extract_run(integer, integer) from public, anon, authenticated;

select public.abf_apply();
