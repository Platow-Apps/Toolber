-- Three optional spec rows on a listing, for the attributes that vary by tool
-- type -- power, voltage, size, length, blade diameter, weight capacity.
--
-- WHY LABEL+VALUE PAIRS RATHER THAN THREE NAMED COLUMNS
--
-- "Voltage" is meaningless on a ladder and "height" is meaningless on a drill.
-- Fixed columns would leave most listings with mostly-empty fields and still
-- fail to cover the attribute that actually matters for a given tool. A pair
-- is strictly more capable: an owner who wants exactly Power / Voltage / Size
-- just types those three labels.
--
-- Stored as jsonb rather than six text columns so the shape can stay
-- [{label, value}, ...] and the cap can move without another migration.
--
-- SEARCH: specs join the vector at weight D -- the lowest -- so "18V" finds a
-- drill without a spec value ever outranking a tool's actual name. As in
-- 0026, a generated column's expression cannot be altered in place, so the
-- column and its index are dropped and rebuilt.
--
-- Safe to paste and re-run from the top.

alter table tools add column if not exists specs jsonb;

grant select (specs) on tools to anon, authenticated;

-- Shape guard: an array of at most 3 objects. Cheap to enforce here, and it
-- means the client cannot quietly start storing something else.
alter table tools drop constraint if exists tools_specs_shape;
alter table tools add constraint tools_specs_shape
  check (
    specs is null
    or (jsonb_typeof(specs) = 'array' and jsonb_array_length(specs) <= 3)
  );

do $$
begin
  if not exists (
    select 1 from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'tools'::regclass
      and a.attname = 'search_vector'
      and pg_get_expr(d.adbin, d.adrelid) like '%specs%'
  ) then
    alter table tools drop column if exists search_vector;

    alter table tools add column search_vector tsvector
      generated always as (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(brand, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(subcategory, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(category, '')), 'C') ||
        -- specs::text carries the JSON punctuation too; harmless noise that
        -- never matches a real query term.
        setweight(to_tsvector('english', coalesce(specs::text, '')), 'D')
      ) stored;

    create index if not exists tools_search_idx on tools using gin (search_vector);
  end if;
end;
$$;
