-- ============================================================================
-- pgTAP: set_my_area / get_my_area — the location write path (0045)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- The reset is not optional. `supabase test db` runs against whatever the
-- local stack already has; it does not apply migrations. A stack left running
-- from before a migration lands will report that migration's functions as
-- "does not exist", which reads like a broken feature and is a stale database.
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
--
-- Every throws_ok here names a SQLSTATE. The first version passed NULL, which
-- accepts *any* error — and on a database that predated 0045 the six
-- validation assertions all passed against a function that did not exist,
-- because "function does not exist" is an error too. P0001 is what a bare
-- `raise exception` produces; 42501 is a refused EXECUTE. A test that cannot
-- tell those apart from the failure it is looking for is not a test.

BEGIN;

SELECT plan(18);

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
-- 42501, not P0001: anon is refused EXECUTE outright and never reaches the
-- body's own auth.uid() check.
SELECT throws_ok(
  $q$ SELECT set_my_area(38.44::numeric, -122.71::numeric, 800::numeric) $q$,
  '42501',
  NULL,
  'set_my_area refuses a caller with no identity'
);
RESET ROLE;

-- ── Validation ──────────────────────────────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $q$ SELECT set_my_area(NULL, -122.71::numeric, 800::numeric) $q$, 'P0001', NULL,
  'a missing latitude is refused'
);

SELECT throws_ok(
  $q$ SELECT set_my_area(91::numeric, -122.71::numeric, 800::numeric) $q$, 'P0001', NULL,
  'a latitude off the planet is refused'
);

SELECT throws_ok(
  $q$ SELECT set_my_area(38.44::numeric, -181::numeric, 800::numeric) $q$, 'P0001', NULL,
  'a longitude off the planet is refused'
);

-- The radius floor is the privacy floor: small enough and the "approximate"
-- point is the address.
SELECT throws_ok(
  $q$ SELECT set_my_area(38.44::numeric, -122.71::numeric, 5::numeric) $q$, 'P0001', NULL,
  'a radius below the floor is refused'
);

SELECT throws_ok(
  $q$ SELECT set_my_area(38.44::numeric, -122.71::numeric, 100000::numeric) $q$, 'P0001', NULL,
  'a radius above the ceiling is refused'
);

-- ── The write itself ────────────────────────────────────────────────────────

SELECT lives_ok(
  $q$ SELECT set_my_area(38.4404::numeric, -122.7141::numeric, 800::numeric) $q$,
  'a signed-in user can set their own area'
);

RESET ROLE;

SELECT is(
  (SELECT home_lat FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  38.4404::numeric,
  'the real point is stored exactly as given'
);

-- The claim the whole model rests on. Spelled as an explicit NOT NULL because
-- isnt(NULL, 38.4404) passes, which is how this asserted nothing at all
-- against a database where the write had never happened.
SELECT ok(
  (SELECT approx_lat IS NOT NULL AND approx_lat <> 38.4404::numeric
     FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  'the public pin is never the real position'
);

-- 800 m is ~0.0072° of latitude. Outside that and the pin is not where the
-- person was told it would be; a longitude check would need the cos() scaling,
-- and latitude alone is enough to catch a broken radius.
SELECT ok(
  (SELECT approx_lat IS NOT NULL AND abs(approx_lat - 38.4404::numeric) <= 0.0072
     FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
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

-- ...and the caller's own row did get one, so the assertion above is about
-- scope rather than about nothing having happened.
SELECT isnt(
  (SELECT home_lat FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  NULL,
  'the caller''s own home coordinates are set, so the check above means something'
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
