-- Restructures what a listing actually asks for.
--
-- The free-text `description` box was doing too much work: it was the only
-- place to say what a tool is, what shape it's in, and who made it, which
-- made it both a chore to write and useless to search on. It is replaced by
-- structured fields -- condition, brand, and a real subcategory -- and the
-- form stops asking for it.
--
-- `description` itself is NOT dropped. It is already nullable, hundreds of
-- existing listings have one, and it is still worth showing on a tool's page
-- when it is there. New listings simply leave it null.
--
-- SEARCH: search_vector is a generated column, and a generated column's
-- expression cannot be altered in place -- it has to be dropped and rebuilt,
-- which also drops its index. Both are recreated below with brand and
-- subcategory folded in, so the new structured fields are searchable the way
-- description used to be.
--
-- Safe to paste and re-run from the top: every ADD COLUMN is IF NOT EXISTS,
-- constraints are dropped before being added, and the search_vector rebuild
-- is guarded on the column's current definition so a second run is a no-op.

alter table tools add column if not exists condition text;
alter table tools add column if not exists brand text;
alter table tools add column if not exists subcategory text;

grant select (condition, brand, subcategory) on tools to anon, authenticated;

-- Condition is required by the form for new listings, but must stay nullable
-- here: every tool listed before this migration has none, and backfilling a
-- guess would be inventing data about someone else's property.
alter table tools drop constraint if exists tools_condition_known;
alter table tools add constraint tools_condition_known
  check (condition is null or condition in ('new', 'good', 'fair'));

-- ============================================================
-- search_vector: fold in brand + subcategory
-- ============================================================

do $$
begin
  -- Only rebuild when the stored definition doesn't already mention brand,
  -- so re-running this file doesn't churn the index for nothing.
  if not exists (
    select 1 from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'tools'::regclass
      and a.attname = 'search_vector'
      and pg_get_expr(d.adbin, d.adrelid) like '%brand%'
  ) then
    alter table tools drop column if exists search_vector;

    alter table tools add column search_vector tsvector
      generated always as (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(brand, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(subcategory, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(category, '')), 'C')
      ) stored;

    create index if not exists tools_search_idx on tools using gin (search_vector);
  end if;
end;
$$;
