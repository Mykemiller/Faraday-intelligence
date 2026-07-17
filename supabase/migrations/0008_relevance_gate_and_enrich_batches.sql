-- v8 poller relevance gate + v20 enrichment Batches API plumbing.
-- Applied to prod 2026-07-17 as 'relevance_gate_and_enrich_batches'.
-- 'skipped' = stored for audit, deliberately never enriched (query-lane noise).
alter type enrich_status_enum add value if not exists 'skipped';

create table if not exists enrich_batches (
  batch_id text primary key,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress',
  artifact_count integer not null default 0,
  succeeded integer not null default 0,
  errored integer not null default 0
);
alter table enrich_batches enable row level security;
create policy "service role only" on enrich_batches for all using (false);
revoke all on enrich_batches from anon, authenticated;
