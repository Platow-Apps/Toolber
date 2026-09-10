-- The map is not part of the identity.
--
-- 0057 hid three things behind one predicate -- the owner's name, the
-- chest_id join key, and the map pin -- when only the first two belong there.
-- owner_identity_visible() is false for anyone signed out, so a logged-out
-- visitor got a search page with no pins on it at all. The migration that
-- said "a lending map nobody can look at is not a lending map" shipped
-- exactly that.
--
-- The two rules were never the same rule:
--
--   identity (name, avatar, chest_id) -- needs an account, always.
--   pin -- public by construction, unless the owner turned identity_private
--          on, in which case it goes with the name because a chest's tools
--          all sit on one stored jittered point and a shared coordinate
--          identifies an owner as well as a label does.
--
-- So a private owner's pin is hidden from strangers, signed in or not; and
-- everyone else's pin is visible to everyone, including anon. That is what
-- 0057's own commentary described and its SQL did not do.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- 1. The second predicate
-- ============================================================
create or replace function owner_pin_visible(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when p_owner is null then false
    -- The ordinary case: a pin is public, and is already a fuzzed point that
    -- was never the owner's real position.
    when not coalesce((select identity_private from profiles where id = p_owner), false)
      then true
    -- A private owner's pin travels with their name, for everyone.
    else owner_identity_visible(p_owner)
  end;
$fn$;

revoke execute on function owner_pin_visible(uuid) from public;
grant execute on function owner_pin_visible(uuid) to anon, authenticated;

-- ============================================================
-- 2. Search: identity on one predicate, the pin on the other
-- ============================================================
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
security definer
set search_path = public
as $fn$
  with visible as (
    select
      t.id, t.name, t.category, t.subcategory, t.condition, t.brand,
      t.description, t.status, t.monetize, t.price, t.price_duration_unit,
      t.for_sale, t.due_at, t.chest_id, t.photos, t.paused, t.search_vector,
      t.created_at,
      p.display_name   as p_display_name,
      p.map_pin_hidden as p_map_pin_hidden,
      owner_identity_visible(t.chest_id) as owner_visible,
      -- Null unless the pin may be shown, so every use below -- the two
      -- returned columns, the distance, and both ordering keys -- reads the
      -- same value and cannot drift out of step with each other.
      case when owner_pin_visible(t.chest_id) then p.approx_lat end as p_approx_lat,
      case when owner_pin_visible(t.chest_id) then p.approx_lng end as p_approx_lng
    from tools t
    -- LEFT so a private owner's tools stay in the results with the owner
    -- blanked out, rather than dropping out of search entirely.
    left join profiles p on p.id = t.chest_id
  )
  select
    v.id, v.name, v.category, v.subcategory, v.condition, v.brand, v.description,
    v.status, v.monetize, v.price, v.price_duration_unit, v.for_sale, v.due_at,
    -- The join key, only for someone who could have followed it anyway.
    case when v.owner_visible then v.chest_id end,
    v.photos,
    case when v.owner_visible then v.p_display_name end,
    v.p_approx_lat,
    v.p_approx_lng,
    v.p_map_pin_hidden,
    case
      when p_lat is null or p_lng is null
        or v.p_approx_lat is null or v.p_approx_lng is null then null
      else 3958.8 * 2 * asin(least(1, sqrt(
             sin(radians(v.p_approx_lat - p_lat) / 2) ^ 2
             + cos(radians(p_lat)) * cos(radians(v.p_approx_lat))
               * sin(radians(v.p_approx_lng - p_lng) / 2) ^ 2
           )))
    end as distance_miles
  from visible v
  where v.paused = false
    and (
      p_query is null or trim(p_query) = ''
      or v.search_vector @@ websearch_to_tsquery('english', p_query)
    )
  order by
    -- Tools with no distance -- a hidden pin, or no origin given -- sort last
    -- rather than first, which is what a plain ORDER BY on nulls would do.
    (case
       when p_lat is null or p_lng is null
         or v.p_approx_lat is null or v.p_approx_lng is null then 1 else 0
     end),
    (case
       when p_lat is null or p_lng is null
         or v.p_approx_lat is null or v.p_approx_lng is null then null
       else 3958.8 * 2 * asin(least(1, sqrt(
              sin(radians(v.p_approx_lat - p_lat) / 2) ^ 2
              + cos(radians(p_lat)) * cos(radians(v.p_approx_lat))
                * sin(radians(v.p_approx_lng - p_lng) / 2) ^ 2
            )))
     end) asc,
    v.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$fn$;

revoke execute on function search_tools(text, numeric, numeric, integer) from public;
grant execute on function search_tools(text, numeric, numeric, integer) to anon, authenticated;

-- ============================================================
-- 3. The tool page, same split
-- ============================================================
-- "View on map" is offered off these coordinates, so a signed-out visitor was
-- losing that link too.
create or replace function tool_owner_card(p_tool_id uuid)
returns table (
  chest_id uuid,
  display_name text,
  approx_lat numeric,
  approx_lng numeric,
  map_pin_hidden boolean,
  chest_public boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    case when owner_identity_visible(t.chest_id) then t.chest_id end,
    case when owner_identity_visible(t.chest_id) then p.display_name end,
    case when owner_pin_visible(t.chest_id) then p.approx_lat end,
    case when owner_pin_visible(t.chest_id) then p.approx_lng end,
    p.map_pin_hidden,
    -- No chest link for someone who cannot see whose chest it is.
    coalesce(p.chest_public, false) and owner_identity_visible(t.chest_id)
  from tools t
  join profiles p on p.id = t.chest_id
  where t.id = p_tool_id;
$fn$;

revoke execute on function tool_owner_card(uuid) from public;
grant execute on function tool_owner_card(uuid) to anon, authenticated;

-- ============================================================
-- Self-check
-- ============================================================
-- Runs a query as anon rather than inspecting privileges, because the bug
-- this migration fixes was invisible to a privilege check: every grant was
-- correct and the function still returned nothing anyone could plot.
do $chk$
declare
  v_rows    integer;
  v_pinned  integer;
  v_named   integer;
begin
  set local request.jwt.claims = '{"role":"anon"}';
  set local role anon;

  select count(*),
         count(*) filter (where owner_approx_lat is not null),
         count(*) filter (where owner_display_name is not null or chest_id is not null)
    into v_rows, v_pinned, v_named
  from search_tools(null, null, null, 200);

  reset role;

  -- Only meaningful where there is data to look at; a fresh scratch database
  -- has none, and this must not fail there.
  if v_rows > 0 then
    if v_pinned = 0 then
      raise exception 'anon can search but every pin is blank -- the public map is empty';
    end if;
    if v_named > 0 then
      raise exception 'anon is being handed an owner name or a chest_id';
    end if;
  end if;
end;
$chk$;
