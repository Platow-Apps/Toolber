-- ============================================================
-- 0045 — your area becomes something you can change
-- ============================================================
-- It was captured once, at onboarding, and never again: a move, a typo, or a
-- pin dropped in the wrong neighborhood was unfixable from inside the app.
-- That point is the origin for proximity search, for your map pin, and for
-- Find a Group, so being stuck with a wrong one is not cosmetic.
--
-- Two reasons this is an RPC rather than another profiles.update from the
-- client:
--
--   1. The jitter is the whole privacy model, and it was being computed in
--      the browser. A client that wrote home_lat into approx_lat would have
--      published someone's front door, and nothing server-side would have
--      objected. Here the caller hands over a geocoded point and the fuzzing
--      is not theirs to skip.
--   2. A group's pin is the average of its approved members' approximate
--      points. Moving one member leaves every such group stale, and
--      refresh_group_pin() is not executable by the client by design. Doing
--      both in one function is the only way they stay in step.
--
-- The jitter is still computed exactly once and stored. Recomputing it per
-- read would let repeated samples be averaged back to the real location --
-- see docs/technical-design.md, Location & Privacy Model.

create or replace function set_my_area(
  p_lat numeric,
  p_lng numeric,
  p_radius_meters numeric default 800
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_radius_deg numeric;
  v_w numeric;
  v_t numeric;
  r record;
begin
  if v_me is null then
    raise exception 'You must be signed in to set your area.';
  end if;

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

  -- Uniform over the disc: sqrt() scaling, or points bunch near the centre and
  -- the average of a few samples lands on the real address.
  v_radius_deg := p_radius_meters / 111320.0;
  v_w := v_radius_deg * sqrt(random());
  v_t := 2 * pi() * random();

  update profiles set
    home_lat = p_lat,
    home_lng = p_lng,
    approx_lat = p_lat + v_w * sin(v_t),
    -- Longitude degrees shrink towards the poles; clamped so a near-polar
    -- point cannot divide by ~0.
    approx_lng = p_lng + (v_w * cos(v_t)) / greatest(cos(radians(p_lat)), 0.01),
    pin_radius_meters = p_radius_meters,
    pin_placement_mode = 'auto_jitter'
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

revoke execute on function set_my_area(numeric, numeric, numeric) from public, anon;
grant execute on function set_my_area(numeric, numeric, numeric) to authenticated;

-- ============================================================
-- get_my_area — what to show back, without showing coordinates
-- ============================================================
-- Settings needs to say which radius is in force. pin_radius_meters is
-- deliberately not in the profiles SELECT grant and should stay out of it: a
-- radius readable for *everyone* bounds each person's true location to a disc
-- of known size around their public pin, which is exactly the inference the
-- jitter exists to prevent. Scoped to the caller, it tells them only what they
-- chose themselves.
--
-- Returns no coordinates at all, so nothing here can become a way to read
-- home_lat/home_lng.

create or replace function get_my_area()
returns table (
  radius_meters numeric,
  placement_mode pin_placement_mode,
  has_area boolean
)
language sql
security definer
set search_path = public
as $$
  select
    pin_radius_meters,
    pin_placement_mode,
    (home_lat is not null and home_lng is not null)
  from profiles
  where id = auth.uid();
$$;

revoke execute on function get_my_area() from public, anon;
grant execute on function get_my_area() to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if has_function_privilege('anon', 'set_my_area(numeric, numeric, numeric)', 'EXECUTE') then
    raise exception 'set_my_area must not be callable by anon';
  end if;
  if not has_function_privilege('authenticated', 'set_my_area(numeric, numeric, numeric)', 'EXECUTE') then
    raise exception 'set_my_area should be callable by a signed-in user';
  end if;
end;
$chk$;
