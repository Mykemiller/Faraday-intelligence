-- CMD-1.0 Wave A — staging + report tables.
-- stg_company_classification: every tracking_companies row gets a PROPOSED entity_class
--   with a rule trace. Nothing here is auto-promoted into public.companies without
--   the merge step (0026); it is the audit surface for classification.
-- cmd_merge_candidates: the duplicate-name report (STOP §6.1) — evidence only.
-- Both RLS-on, service-role-only (internal).

create table public.stg_company_classification (
  stg_id                bigint generated always as identity primary key,
  tracking_company_id   text not null,   -- public.tracking_companies.company_id (source-membership key)
  name                  text not null,
  name_normalized       text,
  active                boolean,
  proposed_entity_class text not null,
  rule_matched          text not null,
  rule_confidence       text not null check (rule_confidence in ('high','medium','low')),
  company_uid           text references public.companies(company_uid),  -- resolved link, backfilled in 0026
  resolution_method     text,            -- 'exact' | 'normalized' | 'created' | null
  created_at            timestamptz default now()
);
create index stg_company_classification_norm_idx  on public.stg_company_classification (name_normalized);
create index stg_company_classification_class_idx on public.stg_company_classification (proposed_entity_class);
create index stg_company_classification_uid_idx   on public.stg_company_classification (company_uid);
comment on table public.stg_company_classification is 'CMD-1.0 proposed entity_class for all 7,824 tracking_companies rows, with rule trace. Not authoritative until merged.';

create table public.cmd_merge_candidates (
  cand_id              bigint generated always as identity primary key,
  name_normalized      text not null,
  member_count         integer not null,
  raw_names            text[] not null,
  tracking_company_ids text[] not null,
  proposed_classes     text[],
  evidence             text,
  decision             text not null default 'pending' check (decision in ('pending','merge','keep_separate')),
  created_at           timestamptz default now()
);
comment on table public.cmd_merge_candidates is 'CMD-1.0 duplicate-name merge candidates (STOP §6.1). Reported, not auto-merged.';

alter table public.stg_company_classification enable row level security;
alter table public.cmd_merge_candidates       enable row level security;
create policy cmd_stg_service_only  on public.stg_company_classification as restrictive for all to anon, authenticated using (false) with check (false);
create policy cmd_cand_service_only on public.cmd_merge_candidates       as restrictive for all to anon, authenticated using (false) with check (false);
