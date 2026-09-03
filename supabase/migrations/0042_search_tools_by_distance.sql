-- Search results ordered by how far away they are.
--
-- Until now the client asked for the 60 newest tools and, with a typed query,
-- the 60 newest matching ones. That is fine while everyone is in one
-- neighborhood and wrong the moment they are not: a person in Montana gets
-- Utah drills, and -- worse -- sorting those 60 by distance in the browser
-- cannot help, because the *server* already chose them by recency. The
-- nearest tool might never be in the set at all.
--
-- So the ordering has to happen here, before the limit is applied.
--
-- A tool's location is its owner's approximate point, not the tool's own: the
-- exact pickup address is column-REVOKEd and reachable only through
-- get_pickup_location(). approx_lat/lng is the deliberately fuzzed, already
-- public coordinate that map pins use, so ordering by it discloses nothing
-- that the map does not.
--
-- SECURITY INVOKER (the default) on purpose. This function reads only columns
-- the caller could already select, so running it with the caller's own
-- privileges means the existing column grants keep protecting
-- pickup_location, home_lat and home_lng with no special care taken here. A
-- SECURITY DEFINER version would have to be audited for leaks every time the
-- column list changed.
--
-- Safe to paste and re-run from the top.

create or replace function search_tools(
  p_query text default null,
  p_lat   numeric default null,
  p_lng   numeric default null,
  p_limit integer default 60
)
returns table (
  id uuid,
  name text,
  category text,
  subcategory text,
  condition text,
  brand text,
  description text,
  status tool_status,
  monetize boolean,
  price numeric,
  price_duration_unit price_duration_unit,
  for_sale boolean,
  due_at timestamptz,
  chest_id uuid,
  photos text[],
  owner_display_name text,
  owner_approx_lat numeric,
  owner_approx_lng numeric,
  owner_map_pin_hidden boolean,
  distance_miles numeric
)
language sql
stable
set search_path = public
as $fn$
  select
    t.id, t.name, t.category, t.subcategory, t.condition, t.brand, t.description,
    t.status, t.monetize, t.price, t.price_duration_unit, t.for_sale, t.due_at,
    t.chest_id, t.photos,
    p.display_name, p.approx_lat, p.approx_lng, p.map_pin_hidden,
    -- Haversine, in miles. Null whenever either end has no point: an owner who
    -- hid their pin, or a caller who has not told us where they are.
    case
      when p_lat is null or p_lng is null
        or p.approx_lat is null or p.approx_lng is null then null
      else 3958.8 * 2 * asin(least(1, sqrt(
             sin(radians(p.approx_lat - p_lat) / 2) ^ 2
             + cos(radians(p_lat)) * cos(radians(p.approx_lat))
               * sin(radians(p.approx_lng - p_lng) / 2) ^ 2
           )))
    end as distance_miles
  from tools t
  join profiles p on p.id = t.chest_id
  where t.paused = false
    -- Same withdrawal rule as before (0023): a paused listing is off the map
    -- and out of search.
    and (
      p_query is null or trim(p_query) = ''
      or t.search_vector @@ websearch_to_tsquery('english', p_query)
    )
  order by
    -- Tools with no distance -- a hidden pin, or no origin given -- sort last
    -- rather than first, which is what a plain ORDER BY on nulls would do.
    (case
       when p_lat is null or p_lng is null
         or p.approx_lat is null or p.approx_lng is null then 1 else 0
     end),
    (case
       when p_lat is null or p_lng is null
         or p.approx_lat is null or p.approx_lng is null then null
       else 3958.8 * 2 * asin(least(1, sqrt(
              sin(radians(p.approx_lat - p_lat) / 2) ^ 2
              + cos(radians(p_lat)) * cos(radians(p.approx_lat))
                * sin(radians(p.approx_lng - p_lng) / 2) ^ 2
            )))
     end) asc,
    -- Ties, and the no-origin case, keep the previous behaviour.
    t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$fn$;

-- Search is public: a logged-out visitor browses tools, so anon needs this too.
revoke execute on function search_tools(text, numeric, numeric, integer) from public;
grant execute on function search_tools(text, numeric, numeric, integer) to anon, authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_count integer;
begin
  -- Runs at all, and returns the shape the client destructures.
  select count(*) into v_count from search_tools(null, null, null, 5);

  -- The protected columns must not have crept into the return type. This is
  -- the check that matters: the function's whole risk is someone adding a
  -- column to the SELECT without noticing which ones are secret.
  if exists (
    select 1
    from information_schema.routines r
    join information_schema.parameters pa on pa.specific_name = r.specific_name
    where r.routine_name = 'search_tools'
      and pa.parameter_name in ('pickup_location', 'home_lat', 'home_lng', 'asking_price')
  ) then
    raise exception 'search_tools returns a protected column';
  end if;
end;
$chk$;
