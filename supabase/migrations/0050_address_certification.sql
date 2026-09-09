-- ============================================================
-- 0050 — the address is attested, not merely typed
-- ============================================================
-- A home address has always been required to finish a profile: onboarding
-- will not submit without street, city and state. What was missing is the
-- person saying it is *theirs* and *right*, and any record that they did.
--
-- That distinction matters more here than on most apps. The address is not
-- kept — 0045 geocodes it, keeps the point, and throws the words away — so
-- there is nothing to audit afterwards. What is kept is home_lat/home_lng,
-- which every distance, every map pin and every group's pin is derived from.
-- A careless address quietly degrades all three for the person and for their
-- neighbours, and nothing downstream can detect it.
--
-- So: a timestamp of when they last confirmed it. Not a boolean. "Confirmed
-- at some point" answers nothing once the address can be changed; "confirmed
-- on this date" says which address was attested and when.

alter table profiles
  add column if not exists home_address_certified_at timestamptz;

comment on column profiles.home_address_certified_at is
  'When the owner last confirmed their home address is theirs and correct. Set by set_my_area(); null for profiles created before 0050.';

-- Not granted for SELECT. Nobody else's business whether a neighbour has
-- confirmed their address, and nothing in the app renders it.

-- ============================================================
-- set_my_area — now carries the attestation
-- ============================================================
-- Dropped and recreated rather than overloaded. Adding a defaulted parameter
-- leaves the three-argument version in place, and PostgREST then cannot tell
-- which one a three-argument call meant -- the ambiguity that bit
-- deny_borrow_request and request_borrow before it (CLAUDE.md).

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
  v_radius_deg numeric;
  v_w numeric;
  v_t numeric;
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
-- Self-check
-- ============================================================
do $chk$
begin
  -- Exactly one, or a three-argument call is ambiguous.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_my_area') <> 1 then
    raise exception 'set_my_area is overloaded -- the old signature was not dropped';
  end if;

  if has_column_privilege('authenticated', 'profiles', 'home_address_certified_at', 'SELECT') then
    raise exception 'home_address_certified_at must not be readable by everyone';
  end if;

  if has_function_privilege('anon', 'set_my_area(numeric, numeric, numeric, boolean)', 'EXECUTE') then
    raise exception 'set_my_area must not be callable by anon';
  end if;
end;
$chk$;
