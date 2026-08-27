-- ============================================================================
-- pgTAP: pickup_location / home coordinates — column grants + reveal RPC
-- ============================================================================
-- Run with:  supabase test db   (applies all migrations to a fresh DB first)
--
-- This is the single most important security boundary in Toolber: a tool's
-- exact pickup location is readable only by its owner, or by a borrower whose
-- specific request has been approved; a chest's real home coordinates are
-- readable by nobody. Neither is enforced by RLS — RLS is row-level, and these
-- rows are globally visible so search can work. The enforcement is Postgres
-- column-level GRANT/REVOKE plus the SECURITY DEFINER get_pickup_location()
-- RPC. The AVA suite mocks Supabase and cannot reach any of this.
--
-- Role switching is done inline (NOT via helper functions): a SET issued inside
-- a function is reverted at function exit, so each authentication is three
-- top-level statements — RESET ROLE (back to the superuser runner, RLS
-- bypassed, for setup/inspection), set the JWT claim, then SET ROLE
-- authenticated so auth.uid() resolves and the grants apply.

BEGIN;

SELECT plan(14);

-- ── Fixtures (as the superuser test runner) ─────────────────────────────────
--   owner    (…01) owns the tool
--   approved (…02) has an approved borrow request for it
--   pending  (…03) has a pending one
--   denied   (…04) has a denied one
--   outsider (…05) has no relationship to the tool at all
-- profiles rows are created by the on_auth_user_created trigger.

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'approved@test.dev'),
  ('00000000-0000-0000-0000-000000000003', 'pending@test.dev'),
  ('00000000-0000-0000-0000-000000000004', 'denied@test.dev'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.dev');

UPDATE profiles
SET display_name = 'Owner',
    home_lat = 38.4404, home_lng = -122.7141,
    approx_lat = 38.4451, approx_lng = -122.7208
WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO tools (id, chest_id, name, description, pickup_location)
VALUES ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000001',
        'Wet tile saw', 'Ridgid R4021', '142 Birchwood Ct');

INSERT INTO borrow_requests (tool_id, borrower_id, lender_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'approved'),
  ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'pending'),
  ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'denied');

-- ============================================================================
-- tools: the safe columns stay readable, pickup_location does not
-- ============================================================================
RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT name FROM tools WHERE id = '00000000-0000-0000-0000-0000000000aa'::uuid),
  'Wet tile saw',
  'any authenticated user can read a tool''s searchable columns (search is global)');

SELECT throws_ok(
  'SELECT pickup_location FROM tools',
  '42501',
  NULL,
  'a stranger selecting pickup_location is refused by the column grant');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT throws_ok(
  'SELECT pickup_location FROM tools',
  '42501',
  NULL,
  'even the owner cannot SELECT pickup_location directly — the grant is absolute');

-- ============================================================================
-- get_pickup_location(): the one sanctioned read path
-- ============================================================================
SELECT is(
  get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid),
  '142 Birchwood Ct',
  'the owner gets their own tool''s pickup location through the RPC (migration 0002)');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is(
  get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid),
  '142 Birchwood Ct',
  'an approved borrower gets the pickup location');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid)$$,
  'P0001',
  'No approved request for this tool',
  'a PENDING request does not reveal the pickup location');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid)$$,
  'P0001',
  'No approved request for this tool',
  'a DENIED request does not reveal the pickup location');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid)$$,
  'P0001',
  'No approved request for this tool',
  'a user with no request at all is refused');

RESET ROLE; SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid)$$,
  'P0001',
  'No approved request for this tool',
  'a logged-out visitor is refused (auth.uid() is null, so the owner branch cannot match)');

SELECT throws_ok(
  'SELECT pickup_location FROM tools',
  '42501',
  NULL,
  'anon cannot select pickup_location either (migration 0006 re-granted a safe column list only)');

-- ============================================================================
-- profiles: real home coordinates are readable by nobody
-- ============================================================================
SELECT throws_ok(
  'SELECT home_lat, home_lng FROM profiles',
  '42501',
  NULL,
  'anon cannot read a chest''s real home coordinates');

SELECT is(
  (SELECT display_name FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  'Owner',
  'anon can still read the public profile columns (public Search needs them)');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT throws_ok(
  'SELECT home_lat, home_lng FROM profiles',
  '42501',
  NULL,
  'an authenticated user cannot read anyone''s real home coordinates');

SELECT is(
  (SELECT approx_lat FROM profiles WHERE id = '00000000-0000-0000-0000-000000000001'),
  38.4451::numeric,
  'the jittered public pin IS readable — that is the whole point of storing it separately');

SELECT * FROM finish();
ROLLBACK;
