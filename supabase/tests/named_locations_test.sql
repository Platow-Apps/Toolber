-- ============================================================================
-- pgTAP: named places, and the pin that follows the tool (0063)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- profile_locations holds real coordinates and a street address, so it carries
-- no SELECT grant for any role -- every read and write goes through a
-- function. That is a stronger shape than the column-grant dance protecting
-- `profiles`, and this file is the standing guard that nobody "helpfully"
-- grants it later.
--
-- The other thing proved here is the one the feature exists for: a tool kept
-- at a named place plots *there*, not at the owner's house, so somebody
-- searching near the cabin finds the cabin's chainsaw.
--
-- And a regression guard. Rewriting set_my_area to share the jitter helper was
-- first written against its pre-0050 three-argument signature, which does not
-- replace the live function at all -- it creates a second overload that skips
-- the address certification and makes a three-named-argument call ambiguous.
-- Exactly one set_my_area must exist, and it must still record the
-- certification.

BEGIN;

SELECT plan(18);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   owner   (…d1) has a house and a cabin
--   nosy    (…d2) has nothing to do with them

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'places-owner@test.dev'),
  ('00000000-0000-0000-0000-0000000000d2', 'places-nosy@test.dev');

UPDATE profiles SET display_name = 'Owner Ollie',
  home_lat = 38.4404, home_lng = -122.7141,
  approx_lat = 38.4451, approx_lng = -122.7208
WHERE id = '00000000-0000-0000-0000-0000000000d1';
UPDATE profiles SET display_name = 'Nosy Ned' WHERE id = '00000000-0000-0000-0000-0000000000d2';

-- ============================================================================
-- 1. The table is function-only
-- ============================================================================
SELECT ok(
  NOT has_table_privilege('anon', 'profile_locations', 'SELECT'),
  'anon cannot read anyone''s places'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'profile_locations', 'SELECT'),
  'nor can a signed-in account, even its own -- reads go through my_locations()'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'profile_locations', 'INSERT'),
  'and nothing writes it directly, so the jitter cannot be skipped'
);
SELECT ok(
  NOT has_column_privilege('anon', 'tools', 'location_id', 'SELECT'),
  'anon cannot read the location_id join key, same rule as chest_id (0057)'
);

-- ============================================================================
-- 2. set_my_area survived the refactor intact
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'set_my_area'),
  1,
  'exactly one set_my_area -- a second overload would skip the certification'
);

RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT set_my_area(38.5, -122.8, 400, false)$$,
  'P0001', 'Please confirm this is your home address.',
  'and it still refuses without the address certification'
);

-- ============================================================================
-- 3. Saving a place
-- ============================================================================
SELECT lives_ok(
  $$SELECT save_my_location('The cabin', 39.0000, -123.0000, 400, '1600 Ridge Rd')$$,
  'an owner can save a place'
);

SELECT is(
  (SELECT label FROM my_locations()),
  'The cabin',
  'and read it back'
);

-- The owner is entitled to their own handover address; nobody is entitled to
-- the real coordinates, not even them -- nothing in the client needs them, and
-- a value the client never holds cannot leak from it.
SELECT is(
  (SELECT pickup_address FROM my_locations()),
  '1600 Ridge Rd',
  'the saved pickup address comes back to its owner'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.parameters pa
    JOIN information_schema.routines r ON r.specific_name = pa.specific_name
    WHERE r.routine_name = 'my_locations' AND pa.parameter_name IN ('home_lat', 'home_lng')
  ),
  'and the real coordinates are not in what it returns'
);

-- ============================================================================
-- 4. The pin is generated once
-- ============================================================================
-- Re-rolling on every save would let repeated saves average out to the real
-- address, which is the whole reason the jitter is stored rather than computed.
RESET ROLE;
CREATE TEMP TABLE pin_before AS SELECT approx_lat, approx_lng FROM profile_locations LIMIT 1;
-- Captured as the superuser runner. Every later block runs as a role that
-- deliberately cannot read this table, so a subquery against it there fails
-- on permissions rather than testing anything.
CREATE TEMP TABLE cabin AS SELECT id FROM profile_locations WHERE profile_id = '00000000-0000-0000-0000-0000000000d1';
-- Readable by the roles the later blocks run as; it holds only an id.
GRANT SELECT ON cabin TO authenticated, anon;

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  format($$SELECT save_my_location('The cabin (renamed)', 39.0000, -123.0000, 400, '1600 Ridge Rd', %L)$$,
         (SELECT id FROM my_locations())),
  'the place can be renamed'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM profile_locations l, pin_before b
   WHERE l.approx_lat = b.approx_lat AND l.approx_lng = b.approx_lng),
  1,
  'and its pin did not move, because the address did not'
);

-- ============================================================================
-- 5. Somebody else's places
-- ============================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM my_locations()),
  0,
  'a stranger sees none of the owner''s places'
);

SELECT throws_ok(
  format($$SELECT delete_my_location(%L)$$,
         (SELECT id FROM cabin)),
  'P0001', 'No such place',
  'and cannot delete one'
);

-- ============================================================================
-- 6. The point of the whole thing
-- ============================================================================
-- A tool kept at the cabin must plot at the cabin, not at the house.
RESET ROLE;
INSERT INTO tools (id, chest_id, name, location_id)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d1', 'Chainsaw',
        (SELECT id FROM cabin));
INSERT INTO tools (id, chest_id, name)
VALUES ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000d1', 'Drill');

SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT cmp_ok(
  (SELECT owner_approx_lat FROM search_tools(NULL, NULL, NULL, 200)
   WHERE id = '00000000-0000-0000-0000-0000000000e5'),
  '>', 38.9::numeric,
  'the cabin''s chainsaw plots at the cabin'
);

SELECT cmp_ok(
  (SELECT owner_approx_lat FROM search_tools(NULL, NULL, NULL, 200)
   WHERE id = '00000000-0000-0000-0000-0000000000e6'),
  '<', 38.5::numeric,
  'and a tool with no place still plots at the chest, exactly as before'
);

-- ============================================================================
-- 7. Removing a place strands nothing
-- ============================================================================
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  format($$SELECT delete_my_location(%L)$$, (SELECT id FROM my_locations())),
  'the owner can remove a place'
);

RESET ROLE;
SELECT is(
  (SELECT location_id FROM tools WHERE id = '00000000-0000-0000-0000-0000000000e5'),
  NULL,
  'and its tools fall back to the chest''s own area rather than vanishing'
);

SELECT * FROM finish();
ROLLBACK;
