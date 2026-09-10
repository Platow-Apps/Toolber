-- ============================================================================
-- pgTAP: who may learn who owns a tool (0057)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- Two rules, tested from the outside in.
--
--   1. An account is required to see an owner's identity at all. A logged-out
--      visitor keeps the tools and the map and loses the name, the avatar and
--      -- the one that actually mattered -- tools.chest_id, which is a join
--      key: with it, any tool led to every other tool by the same person.
--
--   2. An owner who sets identity_private is invisible outside their approved
--      groups: no name, and no map pin. The pin is not optional. Every tool in
--      a chest sits on one stored, jittered point, so a shared coordinate
--      identifies an owner as well as a label does, and hiding one without the
--      other would be theatre. Their tools stay searchable throughout, which
--      is the whole point of the option.
--
-- Role switching is inline, three statements at a time, for the reason given
-- at the top of pickup_location_rls_test.sql. Note especially the anon blocks:
-- SET LOCAL ROLE anon does NOT clear request.jwt.claims, so the claim has to
-- be overwritten explicitly or auth.uid() keeps returning whoever was signed
-- in last and every "as anon" assertion silently runs as a member.

BEGIN;

SELECT plan(17);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   private  (…01) owns a tool and has identity_private on
--   member   (…02) shares an approved group with private
--   stranger (…03) shares nothing with anyone
--   borrower (…04) has a pending borrow request on private's tool
--   open     (…05) owns a tool and leaves identity_private off
-- profiles rows are created by the on_auth_user_created trigger.

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'private@test.dev'),
  ('00000000-0000-0000-0000-0000000000f2', 'member@test.dev'),
  ('00000000-0000-0000-0000-0000000000f3', 'stranger@test.dev'),
  ('00000000-0000-0000-0000-0000000000f4', 'borrower@test.dev'),
  ('00000000-0000-0000-0000-0000000000f5', 'open@test.dev');

UPDATE profiles
SET display_name = 'Private Pat', identity_private = true,
    approx_lat = 38.4451, approx_lng = -122.7208
WHERE id = '00000000-0000-0000-0000-0000000000f1';

UPDATE profiles
SET display_name = 'Open Ollie', identity_private = false,
    approx_lat = 38.4460, approx_lng = -122.7220
WHERE id = '00000000-0000-0000-0000-0000000000f5';

UPDATE profiles SET display_name = 'Member Mo'     WHERE id = '00000000-0000-0000-0000-0000000000f2';
UPDATE profiles SET display_name = 'Stranger Sam'  WHERE id = '00000000-0000-0000-0000-0000000000f3';
UPDATE profiles SET display_name = 'Borrower Bree' WHERE id = '00000000-0000-0000-0000-0000000000f4';

INSERT INTO groups (id, name, admin_id, invite_code)
VALUES ('00000000-0000-0000-0000-0000000000e1', 'Oak Hill',
        '00000000-0000-0000-0000-0000000000f1', 'OAKHILL1');

INSERT INTO group_memberships (group_id, profile_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'approved'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 'approved');

INSERT INTO tools (id, chest_id, name, description) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
   'Rotary hammer', 'Bosch Bulldog'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f5',
   'Wet tile saw', 'Ridgid R4021');

INSERT INTO borrow_requests (tool_id, borrower_id, lender_id, status)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f4',
        '00000000-0000-0000-0000-0000000000f1', 'pending');

-- ============================================================================
-- 1. Signed out
-- ============================================================================
RESET ROLE;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT throws_ok(
  'SELECT display_name FROM profiles LIMIT 1',
  '42501',
  NULL,
  'anon cannot read a display name off the profiles table'
);

SELECT throws_ok(
  'SELECT chest_id FROM tools LIMIT 1',
  '42501',
  NULL,
  'anon cannot read the chest_id join key off the tools table'
);

SELECT throws_ok(
  'SELECT is_platform_admin FROM profiles LIMIT 1',
  '42501',
  NULL,
  'anon cannot see which accounts are platform admins'
);

-- Search is the one thing anon must keep, so it has to still return rows.
SELECT ok(
  (SELECT count(*) FROM search_tools(NULL, NULL, NULL, 50)) >= 2,
  'anon can still search, and both tools come back'
);

SELECT is(
  (SELECT count(*)::int FROM search_tools(NULL, NULL, NULL, 50)
   WHERE owner_display_name IS NOT NULL OR chest_id IS NOT NULL),
  0,
  'search hands anon no owner name and no chest_id, for any tool'
);

-- The pin is NOT part of the identity, and gating it on the same predicate is
-- the mistake 0058 had to undo: owner_identity_visible() is false for anyone
-- signed out, so hanging the pin off it emptied the public map completely.
-- Losing the name is the point; losing the map is a broken product.
SELECT isnt(
  (SELECT owner_approx_lat FROM search_tools(NULL, NULL, NULL, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d2'),
  NULL,
  'anon still gets a map pin for an ordinary owner'
);

-- The one pin anon does lose, because a private owner's pin travels with
-- their name -- a chest's tools all sit on one coordinate.
SELECT is(
  (SELECT owner_approx_lat FROM search_tools(NULL, NULL, NULL, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  NULL,
  'anon gets no pin for an owner who went private'
);

-- Proximity ordering is computed from that same pin, so it dies with it.
SELECT isnt(
  (SELECT distance_miles FROM search_tools(NULL, 38.4460, -122.7220, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d2'),
  NULL,
  'anon can still sort by distance, which needs the pin to survive'
);

-- ============================================================================
-- 2. Signed in, no relationship to a private owner
-- ============================================================================
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM profiles WHERE id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'a stranger cannot see a private owner''s profile row at all'
);

SELECT is(
  (SELECT owner_display_name FROM search_tools(NULL, NULL, NULL, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  NULL,
  'a stranger gets no name for a private owner''s tool'
);

-- The half that is easy to forget, and the half that makes the option real.
SELECT is(
  (SELECT owner_approx_lat FROM search_tools(NULL, NULL, NULL, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  NULL,
  'a stranger gets no map pin either -- name and pin travel together'
);

-- Searchable throughout. Anything else would make this a way to withdraw a
-- listing, which is what pausing is for.
SELECT ok(
  EXISTS (SELECT 1 FROM search_tools(NULL, NULL, NULL, 50)
          WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  'a private owner''s tool is still in the search results'
);

-- An open owner is unaffected: this is opt-in, and off by default.
SELECT is(
  (SELECT owner_display_name FROM search_tools(NULL, NULL, NULL, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d2'),
  'Open Ollie',
  'an owner who did not turn it on is named as before'
);

SELECT is(
  (SELECT chest_id FROM tool_owner_card('00000000-0000-0000-0000-0000000000d1')),
  NULL,
  'the tool page hands a stranger no chest_id for a private owner'
);

-- ============================================================================
-- 3. Signed in, inside the group
-- ============================================================================
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT owner_display_name FROM search_tools(NULL, NULL, NULL, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  'Private Pat',
  'an approved group member sees the name'
);

SELECT isnt(
  (SELECT owner_approx_lat FROM search_tools(NULL, NULL, NULL, 50)
   WHERE id = '00000000-0000-0000-0000-0000000000d1'),
  NULL,
  'an approved group member sees the pin'
);

-- ============================================================================
-- 4. Signed in, asked to borrow
-- ============================================================================
-- Asking is an introduction: the borrower needs to know whose tool it is, and
-- the owner needs to know who is asking in order to answer.
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT display_name FROM tool_owner_card('00000000-0000-0000-0000-0000000000d1')),
  'Private Pat',
  'someone with a request in flight sees who they are asking'
);

SELECT * FROM finish();
ROLLBACK;
