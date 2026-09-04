-- ============================================================================
-- pgTAP: set_my_area / get_my_area — the location write path (0045)
-- ============================================================================
-- Run with:  supabase test db   (applies all migrations to a fresh DB first)
--
-- This is the only layer that can test any of this. The AVA suite mocks
-- Supabase, so it can prove the client *sends* a real point and no approximate
-- one — but not that the server fuzzes it, not that the fuzz lands inside the
-- radius, not that a caller cannot write someone else's row, and not that the
-- group pins derived from the point are refreshed. All four are here.
--
-- The privacy claim being tested is specific: a person's public pin must never
-- equal their real position, and must sit within the radius they chose. That
-- is the whole protection — approx_lat/lng is world-readable while
-- home_lat/lng is granted to nobody.

BEGIN;

SELECT plan(16);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   mover   (…01) is the one changing their area
--   two others (…02, …03) exist so the shared group clears the 3-member floor
--     refresh_group_pin() requires before it will publish a pin at all

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'mover@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'neighbor-a@test.dev'),
  ('00000000-0000-0000-0000-000000000003', 'neighbor-b@test.dev');

-- The two neighbours already have areas; the mover does not yet.
UPDATE profiles SET approx_lat = 38.44, approx_lng = -122.71
WHERE id IN ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003');

INSERT INTO groups (id, name, invite_code, admin_id)
VALUES ('00000000-0000-0000-0000-0000000000b1'::uuid, 'Oak Hill Neighbors', 'QQ4TZ9M',
        '00000000-0000-0000-0000-000000000001');

INSERT INTO group_memberships (group_id, profile_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-000000000001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-000000000002', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-000000000003', 'approved');

-- ── Who may call it ─────────────────────────────────────────────────────────

SELECT function_privs_are(
  'public', 'set_my_area', ARRAY['numeric', 'numeric', 'numeric'], 'anon', ARRAY[]::text[],
  'anon cannot call set_my_area'
);

SELECT function_privs_are(
  'public', 'set_my_area', ARRAY['numeric', 'numeric', 'numeric'], 'authenticated', ARRAY['EXECUTE'],
  'a signed-in user can call set_my_area'
);

SELECT function_privs_are(
  'public', 'get_my_area', ARRAY[]::text[], 'anon', ARRAY[]::text[],
  'anon cannot call get_my_area'
);

-- A signed-out caller reaching the body anyway must be refused by the body.
RESET ROLE; SET LOCAL request.jwt.claims = '{"role":"anon"}'; SET LOCAL ROLE anon;
SELECT throws_ok(
  $q$ SELECT set_my_area(38.44, -122.71, 800) $q$,
  NULL,
  NULL,
  'set_my_area refuses a caller with no identity'
);
RESET ROLE;

-- ── Validation ──────────────────────────────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $q$ SELECT set_my_area(NULL, -122.71, 800) $q$, NULL, NULL,
  'a missing latitude is refused'
);

SELECT throws_ok(
  $q$ SELECT set_my_area(91, -122.71, 800) $q$, NULL, NULL,
  'a latitude off the planet is refused'
);

SELECT throws_ok(
  $q$ SELECT set_my_area(38.44, -181, 800) $q$, NULL, NULL,
  'a longitude off the planet is refused'
);

-- The radius floor is the privacy floor: small enough and the "approximate"
-- point is the address.
SELECT throws_ok(
  $q$ SELECT set_my_area(38.44, -122.71, 5) $q$, NULL, NULL,
  'a radius below the floor is refused'
);

SELECT throws_ok(
  $q$ SELECT set_my_area(38.44, -122.71, 100000) $q$, NULL, NULL,
  'a radius above the ceiling is refused'
);

-- ── The write itself ────────────────────────────────────────────────────────

SELECT lives_ok(
  $q$ SELECT set_my_area(38.4404, -122.7141, 800) $q$,
  'a signed-in user can set their own area'
);

RESET ROLE;

SELECT is(
  (SELECT home_lat FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  38.4404::numeric,
  'the real point is stored exactly as given'
);

-- The claim the whole model rests on.
SELECT isnt(
  (SELECT approx_lat FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  38.4404::numeric,
  'the public pin is never the real position'
);

-- 800 m is ~0.0072° of latitude. Outside that and the pin is not where the
-- person was told it would be; a longitude check would need the cos() scaling,
-- and latitude alone is enough to catch a broken radius.
SELECT ok(
  (SELECT abs(approx_lat - 38.4404) FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001') <= 0.0072,
  'the public pin lands inside the chosen radius'
);

SELECT is(
  (SELECT pin_placement_mode::text FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  'auto_jitter',
  'setting an area records how the pin was placed'
);

-- ── One caller, one row ─────────────────────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM profiles
    WHERE id <> '00000000-0000-0000-0000-000000000001' AND home_lat IS NOT NULL),
  0,
  'nobody else''s home coordinates are touched'
);

-- ── Groups derived from the point ───────────────────────────────────────────
-- A group's pin is the average of its approved members' approximate points, so
-- moving one member leaves it stale. refresh_group_pin() is not callable by
-- the client, which is why set_my_area() has to do this itself.

SELECT isnt(
  (SELECT approx_lat FROM groups WHERE id = '00000000-0000-0000-0000-0000000000b1'::uuid),
  NULL,
  'a group whose member moved has its pin refreshed, not left stale'
);

-- ── What comes back ─────────────────────────────────────────────────────────
-- get_my_area exists so Settings can show the radius without pin_radius_meters
-- being readable for everyone: a radius published beside a public pin bounds
-- the real address to a disc of known size, which is the exact inference the
-- jitter prevents. It must therefore return no coordinates at all.

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT radius_meters FROM get_my_area()),
  800::numeric,
  'get_my_area reports the radius the caller chose'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
