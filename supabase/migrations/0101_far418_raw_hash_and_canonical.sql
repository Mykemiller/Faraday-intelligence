-- 0030_far418_raw_hash_and_canonical.sql
--
-- CC-BOUNDSTONE-INGEST-1.1 §3.4 + §4 + §5.2 (FAR-418).
--
-- ⚠️ UN-APPLIED. This CC authorizes no applied schema migration. Do not run
--    `supabase db push`. Promotion is a separate, gated step.
--
-- NUMBERING: the CC names this file `0016_raw_hash_and_canonical.sql`. 0016 is
-- taken (`0016_dc_hub_facility_intel.sql`) and the engine is at 0029, so this
-- lands at 0030. Content is unchanged from the spec; only the ordinal moved.
--
-- WHAT THIS DOES
--   1. artifacts gains raw_hash / canonical_url / tag_provenance / last_seen_at
--   2. a partial unique index makes (crawler_id, raw_hash) the real dedupe key
--   3. the ifs_domains / ifs_subdomains column confusion becomes a constraint
--   4. source-level tag inheritance is switched OFF at the trigger
--
-- WHAT IT DOES NOT DO
--   * No IDF taxonomy change. `faraday_subdomains` is not touched — FAR-177 is
--     always-human. The 'UNCLASSIFIED' sentinel added in step 3 is deliberately
--     NOT a taxonomy row: it is the marker for "the classifier looked and found
--     nothing", which is a different statement from "this is domain D-something".
--   * No backfill of raw_hash / canonical_url. That is scripts/far418-dedupe-
--     backfill.mjs, which reports duplicates and DELETES NOTHING (§4.5).
--   * No deletion of historical duplicates. That changes counts, and counts are
--     Myke's.

-- ---------------------------------------------------------------------------
-- 1. Columns.
-- ---------------------------------------------------------------------------
alter table public.artifacts
  add column if not exists raw_hash       text,
  add column if not exists canonical_url  text,
  add column if not exists last_seen_at   timestamptz,
  add column if not exists tag_provenance text not null default 'inherited';

-- `last_seen_at` did not exist. §4.3 requires the skip path to record that a
-- known document was seen again without creating an artifact; without this
-- column that observation had nowhere to go and the skip would be invisible.
alter table public.artifacts
  drop constraint if exists artifacts_tag_provenance_check;
alter table public.artifacts
  add constraint artifacts_tag_provenance_check
  check (tag_provenance in ('inherited','derived','human'));

comment on column public.artifacts.raw_hash is
  'sha256 of normalizeDocument(fetched bytes), computed AT FETCH TIME, upstream of '
  'enrichment. Never re-derived after enrichment: hashing summary text is what let one '
  'press release enter 20+ times over 25 days.';
comment on column public.artifacts.canonical_url is
  'Identity URL: lowercased host, tracking params stripped, fragment stripped, feed '
  'redirect wrappers resolved. source_url stays as fetched; this is what dedupe and '
  'citation matching compare.';
comment on column public.artifacts.last_seen_at is
  'Last time a poll re-encountered this exact document. Written by the §4.3 skip path, '
  'which does not create an artifact and does not enqueue enrichment.';
comment on column public.artifacts.tag_provenance is
  'inherited = tags copied wholesale from the SOURCE row (the defect: a statewide '
  'regulatory action filed under whatever its feed is nominally about). derived = the '
  'item earned its own tags from its own content. human = set by a person.';

-- ---------------------------------------------------------------------------
-- 2. The real dedupe key.
--
-- The CC specifies CREATE UNIQUE INDEX CONCURRENTLY. Dropped deliberately:
-- CONCURRENTLY cannot run inside a transaction block, and every Supabase
-- migration does. It also buys nothing here — raw_hash is a column added in
-- step 1, so it is NULL on every existing row and this PARTIAL index indexes
-- exactly zero rows at creation time. It builds instantly and takes no
-- meaningful lock. If the backfill is ever re-run against a populated column,
-- reissue this statement CONCURRENTLY by hand, outside a migration.
-- ---------------------------------------------------------------------------
create unique index if not exists artifacts_raw_dedupe
  on public.artifacts (crawler_id, raw_hash)
  where raw_hash is not null;

create index if not exists artifacts_canonical_url_idx
  on public.artifacts (canonical_url)
  where canonical_url is not null;

comment on index public.artifacts_raw_dedupe is
  'CC-BOUNDSTONE-INGEST-1.1 §4.3. Partial on raw_hash: rows predating the backfill are '
  'exempt rather than colliding. Scoped to crawler_id so two crawlers legitimately '
  'holding the same document each keep their own provenance row.';

-- ---------------------------------------------------------------------------
-- 3. End the column confusion (§5.2).
--
--    ifs_domains holds D#   only.
--    ifs_subdomains holds D#.# only, or the single sentinel 'UNCLASSIFIED'.
--
--    Measured 2026-08-06 on the trailing 30 days: 1,739 artifacts carry a D#.#
--    string in the DOMAINS column. The constraints are therefore added NOT
--    VALID — they bind every future write immediately while leaving the
--    existing rows to the backfill. Validate them (a separate, cheap
--    ALTER ... VALIDATE CONSTRAINT) only once the backfill reports zero
--    violations; validating early would fail the migration on known-bad
--    historical data and tell us nothing we did not already measure.
-- ---------------------------------------------------------------------------
alter table public.artifacts
  drop constraint if exists artifacts_ifs_domains_shape;
alter table public.artifacts
  add constraint artifacts_ifs_domains_shape
  check (
    ifs_domains is null
    or not exists (select 1 from unnest(ifs_domains) c where c !~ '^D[0-9]+$')
  ) not valid;

alter table public.artifacts
  drop constraint if exists artifacts_ifs_subdomains_shape;
alter table public.artifacts
  add constraint artifacts_ifs_subdomains_shape
  check (
    ifs_subdomains is null
    or not exists (
      select 1 from unnest(ifs_subdomains) c
      where c !~ '^D[0-9]+\.[0-9]+$' and c <> 'UNCLASSIFIED'
    )
  ) not valid;

-- The existing validator silently strips anything not present in
-- faraday_subdomains. It must keep doing that — an invented D9.9 is a defect —
-- while letting the UNCLASSIFIED sentinel through, so "the classifier looked
-- and found nothing" survives the write instead of becoming an empty array
-- indistinguishable from "nobody has looked yet".
create or replace function public.artifacts_validate_ifs_subdomains()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  cleaned  text[];
  stripped text[];
begin
  if new.ifs_subdomains is null or array_length(new.ifs_subdomains, 1) is null then
    new.ifs_subdomains := '{}'::text[];
    return new;
  end if;

  select coalesce(array_agg(distinct c order by c), '{}'::text[])
    into cleaned
  from unnest(new.ifs_subdomains) as c
  where c = 'UNCLASSIFIED'
     or (c ~ '^D[0-9]+\.[0-9]+$'
         and exists (select 1 from public.faraday_subdomains fs
                     where fs.subdomain_code = c));

  select array_agg(distinct x)
    into stripped
  from unnest(new.ifs_subdomains) as x
  where not (x = any (cleaned));

  if stripped is not null then
    raise warning 'artifacts.ifs_subdomains: stripped invalid codes % (artifact %)',
      stripped, new.artifact_id;
  end if;

  -- UNCLASSIFIED is a statement about the whole artifact, not one tag among
  -- many. If a real subdomain survived, the sentinel is redundant and goes.
  if 'UNCLASSIFIED' = any (cleaned) and cardinality(cleaned) > 1 then
    select array_agg(c order by c) into cleaned
      from unnest(cleaned) as c where c <> 'UNCLASSIFIED';
  end if;

  new.ifs_subdomains := cleaned;
  return new;
end;
$function$;

comment on function public.artifacts_validate_ifs_subdomains() is
  'Keeps ifs_subdomains to real D#.# codes from faraday_subdomains, plus the single '
  'sentinel UNCLASSIFIED. UNCLASSIFIED is NOT a taxonomy row and is never added to '
  'faraday_subdomains — the IDF taxonomy is always-human (FAR-177).';

-- ---------------------------------------------------------------------------
-- 4. Stop inheriting source-level tags (§5.2, Decision 2).
--
--    trg_artifacts_fill_ifs_domains copied signal_envelope.idf_domains — a
--    SOURCE-level property — onto every item that source emitted. That is the
--    mechanism by which a statewide regulatory action arriving through a
--    general-news feed got filed under whatever that feed is nominally about,
--    and it is why 98.3% of artifacts carry no subdomain at all: nothing in the
--    pipeline ever asked the ITEM what it was about.
--
--    The function is kept, unused, so the rollback is one CREATE TRIGGER. The
--    envelope value is NOT deleted: enrich-artifacts v22 reads it as a PRIOR
--    for the classifier prompt (§5.2), which is the only role it should ever
--    have had.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_artifacts_fill_ifs_domains on public.artifacts;

comment on function public.artifacts_fill_ifs_domains_from_envelope() is
  'RETIRED by CC-BOUNDSTONE-INGEST-1.1 §5.2 (FAR-418) — no longer attached to any '
  'trigger. Copied source-level idf_domains onto every item the source emitted. Tags '
  'are now DERIVED per item by enrich-artifacts v22; the envelope value survives as a '
  'prompt prior only. Rollback: recreate trg_artifacts_fill_ifs_domains on '
  'public.artifacts BEFORE INSERT OR UPDATE FOR EACH ROW.';

-- ---------------------------------------------------------------------------
-- 5. Post-conditions. Cheap, and they fail loudly if the file is applied twice
--    against a drifted schema.
-- ---------------------------------------------------------------------------
do $post$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='artifacts'
                   and column_name='raw_hash') then
    raise exception 'ABORT: artifacts.raw_hash missing after migration';
  end if;
  if exists (select 1 from pg_trigger
             where tgrelid='public.artifacts'::regclass
               and tgname='trg_artifacts_fill_ifs_domains') then
    raise exception 'ABORT: tag-inheritance trigger still attached — Decision 2 not honoured';
  end if;
  raise notice 'FAR-418 0030 applied: raw_hash/canonical_url/tag_provenance live, inheritance trigger retired.';
end
$post$;
