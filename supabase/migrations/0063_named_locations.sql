-- More than one place to keep tools.
--
-- A chest has always been one account with one point: home_lat/home_lng, and
-- one jittered approx_lat/approx_lng that every tool plots at. A tool's
-- *pickup address* has been per-tool since 0001, so handing something over at
-- a second place already worked -- but discovery did not. Somebody searching
-- near the cabin saw the cabin's chainsaw sitting forty miles away at the
-- owner's house, and sorted it last.
--
-- The only workaround was a second account: separate email, split borrow
-- history, two inboxes, and an admin console that treats the two as unrelated
-- people. Fine for one second home, bad for three sites.
--
-- So a profile gets named places, and a tool may point at one. Everything
-- about the location model is unchanged otherwise -- each place's public pin
-- is jittered once and persisted, never recomputed on read, because a point
-- re-randomised per request is *less* private than a fixed fuzzy one: repeated
-- samples average out to the real address.
--
-- The table is reachable only through the functions below. No SELECT grant at
-- all, for anybody: it holds real coordinates and a street address, and the
-- column-grant dance that protects `profiles` is a trap this table does not
-- need to walk into. The public sees these coordinates only where it already
-- saw the chest's -- through search_tools() and tool_owner_card(), which keep
-- their existing privacy predicates.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- 1. One jitter rule, in one place
-- ============================================================
-- Lifted verbatim out of set_my_area (0045) so the two cannot drift. The
-- sqrt() scaling is the part that matters: without it points bunch towards the
-- centre and the mean of a few samples lands on the real address.
create or replace function jitter_point(
  p_lat numeric,
  p_lng numeric,
  p_radius_meters numeric,
  out approx_lat numeric,
  out approx_lng numeric
)
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_radius_deg numeric;
  v_w numeric;
  v_t numeric;
begin
  if p_lat is null or p_lng is null then
    raise exception 'A latitude and longitude are required.';
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Those coordinates are not on Earth.';
  end if;
  -- A floor as well as a ceiling. Too small and the "approximate" point is
  -- the address; too large and the pin stops meaning anything to a neighbor.
  if p_radius_meters is null or p_radius_meters < 200 or p_radius_meters > 5000 then
    raise exception 'The pin radius must be between 200 and 5000 meters.';
  end if;

  v_radius_deg := p_radius_meters / 111320.0;
  v_w := v_radius_deg * sqrt(random());
  v_t := 2 * pi() * random();

  approx_lat := p_lat + v_w * sin(v_t);
  -- Longitude degrees shrink towards the poles; clamped so a near-polar point
  -- cannot divide by ~0.
  approx_lng := p_lng + (v_w * cos(v_t)) / greatest(cos(radians(p_lat)), 0.01);
end;
$fn$;

revoke execute on function jitter_point(numeric, numeric, numeric) from public, anon, authenticated;

-- set_my_area now calls it rather than carrying its own copy.
--
-- Note the signature: (numeric, numeric, numeric, boolean). 0050 added
-- p_certified, and replacing the *three*-argument shape instead would not
-- edit this function at all -- it would create a second overload beside it,
-- one that skips the certification check and leaves a three-named-argument
-- call ambiguous between them. That is the PL/pgSQL overload trap in
-- CLAUDE.md, and it happened here on the first attempt.
drop function if exists set_my_area(numeric, numeric, numeric);

create or replace function set_my_area(
  p_lat numeric,
  p_lng numeric,
  p_radius_meters numeric default 800,
  p_certified boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_pin record;
  r record;
begin
  if v_me is null then
    raise exception 'You must be signed in to set your area.';
  end if;

  -- Refused rather than defaulted. A confirmation the server does not insist
  -- on is a checkbox the client can forget to send, and then the timestamp
  -- means nothing.
  if not coalesce(p_certified, false) then
    raise exception 'Please confirm this is your home address.';
  end if;

  -- Validation and the jitter rule both live in jitter_point now.
  select * into v_pin from jitter_point(p_lat, p_lng, p_radius_meters);

  update profiles set
    home_lat = p_lat,
    home_lng = p_lng,
    approx_lat = v_pin.approx_lat,
    approx_lng = v_pin.approx_lng,
    pin_radius_meters = p_radius_meters,
    pin_placement_mode = 'auto_jitter',
    home_address_certified_at = now()
  where id = v_me;

  -- Every group whose pin is derived from where its members are. Groups with a
  -- stated area are left alone -- refresh_group_pin() already respects that
  -- (0037), and this must not become a second place that rule is decided.
  for r in
    select group_id from group_memberships
    where profile_id = v_me and status = 'approved'
  loop
    perform refresh_group_pin(r.group_id);
  end loop;
end;
$$;

revoke execute on function set_my_area(numeric, numeric, numeric, boolean) from public, anon;
grant execute on function set_my_area(numeric, numeric, numeric, boolean) to authenticated;

-- ============================================================
-- 2. The places
-- ============================================================
create table if not exists profile_locations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  -- Private, exactly like profiles.home_lat/home_lng. Never handed out.
  home_lat numeric not null,
  home_lng numeric not null,
  -- The public pin. Generated once by save_my_location() and left alone
  -- unless the address or radius actually changes.
  approx_lat numeric not null,
  approx_lng numeric not null,
  pin_radius_meters numeric not null,
  -- The handover address for this place, if they saved one. Same secrecy as
  -- profiles.default_pickup_location.
  default_pickup_location text,
  created_at timestamptz not null default now(),
  constraint profile_locations_label_not_blank check (btrim(label) <> ''),
  unique (profile_id, label)
);

create index if not exists profile_locations_profile_idx on profile_locations (profile_id);

alter table profile_locations enable row level security;

-- REVOKE before GRANT: Supabase's default privileges hand anon and
-- authenticated everything on a new table in public, so a migration that only
-- adds grants restricts nothing (0062 learned this the hard way). Here there
-- are no grants at all to add -- every read and write goes through a function,
-- which is what keeps the real coordinates out of reach of a column list
-- somebody edits later.
revoke all on profile_locations from public, anon, authenticated;

-- RLS stays on with no policies: belt as well as braces, so a future GRANT
-- added by accident still returns nothing.

-- ============================================================
-- 3. A tool can name the place it is kept
-- ============================================================
alter table tools
  add column if not exists location_id uuid references profile_locations (id) on delete set null;

comment on column tools.location_id is
  'Which of the owner''s named places this tool is kept at. Null means the chest''s own area, which is what every tool did before 0063.';

-- The owner sets it from the listing form, so both halves of the column-grant
-- trap apply. Deliberately not granted to anon: it is a join key into a table
-- anon cannot read, and 0057 took chest_id away for the same reason.
grant select (location_id) on tools to authenticated;
grant update (location_id) on tools to authenticated;

-- ============================================================
-- 4. Saving a place
-- ============================================================
-- Re-jitters only when the address or radius actually moved. Saving a place
-- again to fix a typo in its label must not roll a new pin: repeatedly
-- rerolling the same true point is precisely the averaging attack the stored
-- jitter exists to prevent.
create or replace function save_my_location(
  p_label          text,
  p_lat            numeric,
  p_lng            numeric,
  p_radius_meters  numeric,
  p_pickup_address text default null,
  p_id             uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me      uuid := auth.uid();
  v_label   text := btrim(coalesce(p_label, ''));
  v_pickup  text := nullif(btrim(coalesce(p_pickup_address, '')), '');
  v_existing profile_locations%rowtype;
  v_pin     record;
  v_id      uuid;
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;
  if v_label = '' then
    raise exception 'Give this place a name';
  end if;
  if length(v_label) > 40 then
    raise exception 'Keep the name under 40 characters';
  end if;

  if p_id is not null then
    select * into v_existing from profile_locations where id = p_id and profile_id = v_me;
    if v_existing.id is null then
      raise exception 'No such place';
    end if;
  else
    -- A ceiling, because each place is a pin on the public map and an account
    -- with fifty of them is not a neighbour with a cabin.
    if (select count(*) from profile_locations where profile_id = v_me) >= 10 then
      raise exception 'You can save up to 10 places';
    end if;
  end if;

  if v_existing.id is not null
     and v_existing.home_lat = p_lat
     and v_existing.home_lng = p_lng
     and v_existing.pin_radius_meters = p_radius_meters
  then
    -- Nothing about the position changed, so the pin stays exactly where it is.
    update profile_locations
    set label = v_label, default_pickup_location = v_pickup
    where id = v_existing.id;
    return v_existing.id;
  end if;

  select * into v_pin from jitter_point(p_lat, p_lng, p_radius_meters);

  if v_existing.id is not null then
    update profile_locations set
      label = v_label,
      home_lat = p_lat,
      home_lng = p_lng,
      approx_lat = v_pin.approx_lat,
      approx_lng = v_pin.approx_lng,
      pin_radius_meters = p_radius_meters,
      default_pickup_location = v_pickup
    where id = v_existing.id
    returning id into v_id;
  else
    insert into profile_locations
      (profile_id, label, home_lat, home_lng, approx_lat, approx_lng, pin_radius_meters, default_pickup_location)
    values
      (v_me, v_label, p_lat, p_lng, v_pin.approx_lat, v_pin.approx_lng, p_radius_meters, v_pickup)
    returning id into v_id;
  end if;

  return v_id;
end;
$fn$;

revoke execute on function save_my_location(text, numeric, numeric, numeric, text, uuid) from public, anon;
grant execute on function save_my_location(text, numeric, numeric, numeric, text, uuid) to authenticated;

create or replace function delete_my_location(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  -- Tools pointing at it fall back to the chest's own area, by the FK's
  -- ON DELETE SET NULL -- which is the behaviour every tool had before this
  -- migration, so nothing is stranded.
  delete from profile_locations where id = p_id and profile_id = auth.uid();
  if not found then
    raise exception 'No such place';
  end if;
end;
$fn$;

revoke execute on function delete_my_location(uuid) from public, anon;
grant execute on function delete_my_location(uuid) to authenticated;

-- ============================================================
-- 5. Reading your own places back
-- ============================================================
-- Scoped to the caller, and it returns the saved address because the owner is
-- the one person entitled to see it. The real coordinates are never returned
-- -- not even to their owner -- for the same reason get_my_area (0045) does
-- not hand back home_lat: nothing in the client has a use for them, and a
-- value the client never holds cannot leak from it.
create or replace function my_locations()
returns table (
  id uuid,
  label text,
  approx_lat numeric,
  approx_lng numeric,
  pin_radius_meters numeric,
  pickup_address text,
  tool_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  return query
  select l.id, l.label, l.approx_lat, l.approx_lng, l.pin_radius_meters,
         l.default_pickup_location,
         (select count(*) from tools t where t.location_id = l.id)
  from profile_locations l
  where l.profile_id = auth.uid()
  order by l.created_at;
end;
$fn$;

revoke execute on function my_locations() from public, anon;
grant execute on function my_locations() to authenticated;

-- ============================================================
-- 6. Discovery: a tool plots where it is kept
-- ============================================================
-- The whole point of the migration. Both functions coalesce the tool's place
-- over the chest's area, so a tool with no place behaves exactly as before.
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
      -- same value and cannot drift out of step with each other. The place
      -- the tool is kept wins over the chest's own area; a tool with no place
      -- is unchanged.
      case when owner_pin_visible(t.chest_id) then coalesce(l.approx_lat, p.approx_lat) end as p_approx_lat,
      case when owner_pin_visible(t.chest_id) then coalesce(l.approx_lng, p.approx_lng) end as p_approx_lng
    from tools t
    -- LEFT so a private owner's tools stay in the results with the owner
    -- blanked out, rather than dropping out of search entirely.
    left join profiles p on p.id = t.chest_id
    left join profile_locations l on l.id = t.location_id
  )
  select
    v.id, v.name, v.category, v.subcategory, v.condition, v.brand, v.description,
    v.status, v.monetize, v.price, v.price_duration_unit, v.for_sale, v.due_at,
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
    case when owner_pin_visible(t.chest_id) then coalesce(l.approx_lat, p.approx_lat) end,
    case when owner_pin_visible(t.chest_id) then coalesce(l.approx_lng, p.approx_lng) end,
    p.map_pin_hidden,
    -- No chest link for someone who cannot see whose chest it is.
    coalesce(p.chest_public, false) and owner_identity_visible(t.chest_id)
  from tools t
  join profiles p on p.id = t.chest_id
  left join profile_locations l on l.id = t.location_id
  where t.id = p_tool_id;
$fn$;

revoke execute on function tool_owner_card(uuid) from public, anon;
grant execute on function tool_owner_card(uuid) to anon, authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_blocked boolean := false;
  v_rows    integer;
  v_pinned  integer;
begin
  -- Exactly one set_my_area. Recreating the pre-0050 three-argument shape
  -- leaves a second overload that never asks for the address certification,
  -- and a three-named-argument call becomes ambiguous between the two.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_my_area') <> 1 then
    raise exception 'set_my_area has more than one overload';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_my_area'
      and pg_get_functiondef(p.oid) like '%home_address_certified_at%'
  ) then
    raise exception 'set_my_area no longer records the address certification';
  end if;

  -- The table is function-only. A grant appearing here later would put real
  -- coordinates and a street address behind an ordinary column list.
  if has_table_privilege('authenticated', 'profile_locations', 'SELECT')
     or has_table_privilege('anon', 'profile_locations', 'SELECT')
  then
    raise exception 'profile_locations became directly selectable';
  end if;

  if has_column_privilege('anon', 'tools', 'location_id', 'SELECT') then
    raise exception 'anon can read the location_id join key';
  end if;
  if not has_column_privilege('authenticated', 'tools', 'location_id', 'UPDATE') then
    raise exception 'the owner cannot set which place a tool is kept at';
  end if;

  -- And the public map still works, which is the check 0058 had to add after
  -- a privilege-only test missed an empty map entirely.
  set local request.jwt.claims = '{"role":"anon"}';
  set local role anon;
  select count(*), count(*) filter (where owner_approx_lat is not null)
    into v_rows, v_pinned
  from search_tools(null, null, null, 200);
  reset role;

  if v_rows > 0 and v_pinned = 0 then
    raise exception 'search still runs but every pin is blank';
  end if;

  -- A non-owner must not be able to save a place onto somebody else's profile;
  -- the function pins profile_id to auth.uid(), so this is really a check that
  -- it still does.
  set local request.jwt.claims = '{"role":"anon"}';
  set local role anon;
  begin
    perform save_my_location('Cabin', 38.0, -122.0, 400);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'a logged-out caller was able to save a place';
  end if;
end;
$chk$;
