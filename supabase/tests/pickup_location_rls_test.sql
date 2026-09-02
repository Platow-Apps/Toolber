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

SELECT plan(19);

-- ── Fixtures (as the superuser test runner) ─────────────────────────────────
--   owner    (…01) owns the tool
--   approved (…02) has an approved borrow request for it
--   pending  (…03) has a pending one
--   denied   (…04) has a denied one
--   outsider (…05) has no relationship to the tool at all
--   awaiting  (…06) is approved and has asked to collect, but the lender has
--                   not shared a place yet (0035)
-- profiles rows are created by the on_auth_user_created trigger.

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'approved@test.dev'),
  ('00000000-0000-0000-0000-000000000003', 'pending@test.dev'),
  ('00000000-0000-0000-0000-000000000004', 'denied@test.dev'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.dev'),
  ('00000000-0000-0000-0000-000000000006', 'awaiting-pickup@test.dev');

UPDATE profiles
SET display_name = 'Owner',
    home_lat = 38.4404, home_lng = -122.7141,
    approx_lat = 38.4451, approx_lng = -122.7208
WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO tools (id, chest_id, name, description, pickup_location)
VALUES ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000001',
        'Wet tile saw', 'Ridgid R4021', '142 Birchwood Ct');

-- Borrower …02 has completed the pickup handshake (0035): approved, collection
-- asked for, and a place released. Approval alone no longer discloses
-- anything, and get_pickup_location() also requires decided_at inside its
-- 30-day window — a fixture that leaves either null tests the refusal path
-- rather than the reveal.
INSERT INTO borrow_requests
  (tool_id, borrower_id, lender_id, status, decided_at, pickup_requested_at, pickup_released_at)
VALUES
  ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001', 'approved', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001', 'pending', null, null, null),
  ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001', 'denied', now(), null, null),
  -- …06 is approved and has asked, but the lender has not answered. This is
  -- the state 0035 introduced, and the one most worth guarding: an approved
  -- borrower is not automatically told where to go.
  ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000001', 'approved', now(), now(), null);

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
  'a borrower gets the pickup location once the lender has released it');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid)$$,
  'P0001',
  'The pickup location has not been shared yet',
  'approval alone does not disclose the address -- the lender has to answer the pickup request (0035)');

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

-- Refused harder than this test originally expected. It was written when anon
-- could call the function and be turned away by its internal check; 0033 and
-- 0035 revoked EXECUTE from public and granted it to authenticated only, so a
-- logged-out visitor cannot reach the body at all. Asserting the P0001 would
-- now pass only on a database where that EXECUTE grant had been loosened.
RESET ROLE; SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT get_pickup_location('00000000-0000-0000-0000-0000000000aa'::uuid)$$,
  '42501',
  NULL,
  'a logged-out visitor cannot even execute the reveal function');

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

-- ============================================================
-- borrow_requests.pickup_location -- the per-request one-off spot (0035)
-- ============================================================
-- This is the trap 0035 fell into on its first run: a column-level REVOKE is
-- a no-op while the role still holds SELECT on the whole table. The grant has
-- to be dropped at table level and handed back column by column. These
-- assertions test the outcome, not the wording of the migration.

SELECT ok(
  NOT has_column_privilege('authenticated', 'borrow_requests', 'pickup_location', 'select'),
  'a one-off pickup spot is not selectable by authenticated -- only get_pickup_location() reads it');

SELECT ok(
  NOT has_column_privilege('anon', 'borrow_requests', 'pickup_location', 'select'),
  'nor by anon');

SELECT ok(
  has_column_privilege('authenticated', 'borrow_requests', 'pickup_released_at', 'select'),
  'the handshake timestamps ARE readable -- the UI needs them, and they name no place');

SELECT ok(
  has_column_privilege('authenticated', 'borrow_requests', 'status', 'select'),
  'revoking the table grant did not take the ordinary columns with it');

SELECT * FROM finish();
ROLLBACK;
