-- ============================================================================
-- pgTAP: unlisted groups (0052)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- The reset is not optional. `supabase test db` runs against whatever the
-- local stack already has; it does not apply migrations.
--
-- This is a row-policy change, which the AVA suite cannot see at all — it
-- mocks Supabase, so every policy is a no-op there. What matters here is the
-- difference between "one query stopped returning it" and "the row is
-- unreadable": the first is a filter anyone can route around by fetching an
-- id directly, and only the second is what "unlisted" claims.

BEGIN;

SELECT plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   admin    (…01) runs both groups
--   member   (…02) is approved in the unlisted one
--   outsider (…03) is in neither
--   pending  (…04) has asked to join the unlisted one but is not approved

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'member@test.dev'),
  ('00000000-0000-0000-0000-000000000003', 'outsider@test.dev'),
  ('00000000-0000-0000-0000-000000000004', 'pending@test.dev');

INSERT INTO groups (id, name, invite_code, admin_id, listed) VALUES
  ('00000000-0000-0000-0000-0000000000a1'::uuid, 'Oak Hill Neighbors', 'LISTED1', '00000000-0000-0000-0000-000000000001', true),
  ('00000000-0000-0000-0000-0000000000a2'::uuid, 'Back Shed Regulars', 'QUIET77', '00000000-0000-0000-0000-000000000001', false);

INSERT INTO group_memberships (group_id, profile_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000a2'::uuid, '00000000-0000-0000-0000-000000000002', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2'::uuid, '00000000-0000-0000-0000-000000000004', 'pending');

-- ── The default is unchanged ────────────────────────────────────────────────

SELECT is(
  (SELECT listed FROM groups WHERE name = 'Oak Hill Neighbors'),
  true,
  'a group is listed unless it says otherwise'
);

-- ── An outsider ─────────────────────────────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM groups WHERE id = '00000000-0000-0000-0000-0000000000a1'::uuid),
  1,
  'an outsider still sees a listed group'
);

-- The assertion this migration exists for. Not "the directory query filters it
-- out" -- the row itself is gone, so fetching it by id finds nothing either.
SELECT is(
  (SELECT count(*)::int FROM groups WHERE id = '00000000-0000-0000-0000-0000000000a2'::uuid),
  0,
  'an outsider cannot read an unlisted group even by its id'
);

SELECT is(
  (SELECT count(*)::int FROM groups),
  1,
  'an unlisted group is absent from an unfiltered listing'
);

-- ── A pending request is not membership ─────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM groups WHERE id = '00000000-0000-0000-0000-0000000000a2'::uuid),
  0,
  'asking to join an unlisted group does not make it visible'
);

-- ── An approved member ──────────────────────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT name FROM groups WHERE id = '00000000-0000-0000-0000-0000000000a2'::uuid),
  'Back Shed Regulars',
  'an approved member reads the unlisted group they belong to'
);

-- ── The admin ───────────────────────────────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM groups),
  2,
  'the admin sees both of their own groups'
);

SELECT lives_ok(
  $q$ UPDATE groups SET listed = false WHERE id = '00000000-0000-0000-0000-0000000000a1'::uuid $q$,
  'the admin can unlist their own group'
);

-- ── A signed-out visitor ────────────────────────────────────────────────────
-- Public search exists, so anon reads groups. With no membership to check,
-- unlisted means invisible outright.

RESET ROLE; SET LOCAL request.jwt.claims = '{"role":"anon"}'; SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM groups WHERE id = '00000000-0000-0000-0000-0000000000a2'::uuid),
  0,
  'a signed-out visitor cannot read an unlisted group'
);

RESET ROLE;

-- ── The invite code stays RPC-only ──────────────────────────────────────────
-- Unlisting must not have loosened the column that 0014 locked down: the code
-- is what still admits anyone who is given one, so reading it off the row
-- would defeat both features at once.

SELECT ok(
  NOT has_column_privilege('authenticated', 'groups', 'invite_code', 'SELECT'),
  'invite_code is still not selectable by a signed-in user'
);

SELECT ok(
  NOT has_column_privilege('anon', 'groups', 'invite_code', 'SELECT'),
  'nor by anon'
);

SELECT ok(
  has_column_privilege('authenticated', 'groups', 'listed', 'UPDATE'),
  'an admin can actually write the flag -- the silent half of the column-grant trap'
);

SELECT * FROM finish();
ROLLBACK;
