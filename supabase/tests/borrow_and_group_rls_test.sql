-- ============================================================================
-- pgTAP: borrow requests, tools, groups, analytics — RLS predicates + RPC guards
-- ============================================================================
-- Run with:  supabase test db   (applies all migrations to a fresh DB first)
--
-- Companion to pickup_location_rls_test.sql. That file covers the column-grant
-- boundary; this one covers the row-level policies and the SECURITY DEFINER
-- RPCs that own every trust-sensitive write (approval, group decisions).
--
-- The final section is wrapped in todo_start/todo_end: those assertions
-- describe the behaviour the schema SHOULD have and currently does not. They
-- are findings PRIV-1, PRIV-2 and DOS-1 in docs/audit-2026-08-20.md. Remove the
-- todo wrapper as each fix lands — the assertions are already written.
--
-- Role switching is inline (RESET ROLE -> set JWT claim -> SET ROLE
-- authenticated), same as the companion file.

BEGIN;

SELECT plan(25);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   lender   (…01) owns tool …aa and administers group …b1
--   borrower (…02) has a pending request on that tool, and is an approved member
--   pending  (…03) has a PENDING membership in the group
--   outsider (…04) is unrelated to everything
--   admin    (…05) is a platform admin

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'lender@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'borrower@test.dev'),
  ('00000000-0000-0000-0000-000000000003', 'pendingmember@test.dev'),
  ('00000000-0000-0000-0000-000000000004', 'outsider@test.dev'),
  ('00000000-0000-0000-0000-000000000005', 'platformadmin@test.dev');

UPDATE profiles SET is_platform_admin = true WHERE id = '00000000-0000-0000-0000-000000000005';

INSERT INTO tools (id, crib_id, name, pickup_location)
VALUES ('00000000-0000-0000-0000-0000000000aa'::uuid, '00000000-0000-0000-0000-000000000001',
        'Wet tile saw', '142 Birchwood Ct');

INSERT INTO borrow_requests (id, tool_id, borrower_id, lender_id, status)
VALUES ('00000000-0000-0000-0000-0000000000bb'::uuid, '00000000-0000-0000-0000-0000000000aa'::uuid,
        '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'pending');

INSERT INTO groups (id, name, invite_code, admin_id)
VALUES ('00000000-0000-0000-0000-0000000000b1'::uuid, 'Oak Hill Neighbors', 'XHGVFT2',
        '00000000-0000-0000-0000-000000000001');

INSERT INTO group_memberships (id, group_id, profile_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-000000000002', 'approved'),
  ('00000000-0000-0000-0000-0000000000c2'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-000000000003', 'pending');

INSERT INTO favorites (profile_id, tool_id)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000aa'::uuid);

INSERT INTO events (profile_id, event_type) VALUES ('00000000-0000-0000-0000-000000000002', 'tool_listed');
INSERT INTO feedback (profile_id, message) VALUES ('00000000-0000-0000-0000-000000000002', 'nice app');
INSERT INTO notifications (profile_id, type) VALUES ('00000000-0000-0000-0000-000000000001', 'borrow_requested');

-- ============================================================================
-- borrow_requests — visible to the two parties, nobody else
-- ============================================================================
RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM borrow_requests), 1, 'the borrower sees their own request');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM borrow_requests), 1, 'the lender sees the request on their tool');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM borrow_requests), 0, 'an outsider sees no borrow requests');

SELECT throws_ok(
  $$SELECT approve_borrow_request('00000000-0000-0000-0000-0000000000bb'::uuid)$$,
  'P0001',
  'Only the lender can approve this request',
  'only the lender can approve a request');

SELECT throws_ok(
  $$SELECT deny_borrow_request('00000000-0000-0000-0000-0000000000bb'::uuid)$$,
  'P0001',
  'Only the lender can deny this request',
  'only the lender can deny a request');

-- ============================================================================
-- tools — writes are owner-only
-- ============================================================================
WITH u AS (
  UPDATE tools SET name = 'hijacked' WHERE id = '00000000-0000-0000-0000-0000000000aa'::uuid RETURNING 1
)
SELECT is((SELECT count(*)::int FROM u), 0, 'an outsider cannot UPDATE someone else''s tool');

WITH d AS (
  DELETE FROM tools WHERE id = '00000000-0000-0000-0000-0000000000aa'::uuid RETURNING 1
)
SELECT is((SELECT count(*)::int FROM d), 0, 'an outsider cannot DELETE someone else''s tool');

SELECT throws_ok(
  $$INSERT INTO tools (crib_id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'planted')$$,
  '42501',
  NULL,
  'an outsider cannot plant a tool in someone else''s crib');

-- ============================================================================
-- favorites — strictly owner-scoped
-- ============================================================================
SELECT is((SELECT count(*)::int FROM favorites), 0, 'an outsider cannot see anyone else''s favorites');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM favorites), 1, 'a user sees their own favorites');

-- ============================================================================
-- events / feedback — write-only for users, readable only by platform admins
-- ============================================================================
SELECT is((SELECT count(*)::int FROM events), 0, 'a normal user cannot read the analytics stream');
SELECT is((SELECT count(*)::int FROM feedback), 0, 'a normal user cannot read other people''s feedback');

SELECT throws_ok(
  $$INSERT INTO events (profile_id, event_type) VALUES ('00000000-0000-0000-0000-000000000001', 'spoofed')$$,
  '42501',
  NULL,
  'a user cannot log an event as somebody else');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM events), 1, 'a platform admin can read the analytics stream');
SELECT is((SELECT count(*)::int FROM feedback), 1, 'a platform admin can read feedback');

-- ============================================================================
-- notifications — recipient only
-- ============================================================================
RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM notifications), 0, 'a user cannot read notifications addressed to someone else');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM notifications), 1, 'a user reads their own notifications');

-- ============================================================================
-- groups & memberships
-- ============================================================================
RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM group_memberships WHERE status = 'approved'),
  1,
  'approved memberships are public within the app (migration 0004) so group tool lists work');

SELECT is(
  (SELECT count(*)::int FROM group_memberships WHERE status = 'pending'),
  0,
  'pending membership requests stay private from non-admins');

SELECT throws_ok(
  $$INSERT INTO groups (name, invite_code, admin_id) VALUES ('Fake', 'AAAAAAA', '00000000-0000-0000-0000-000000000001')$$,
  '42501',
  NULL,
  'a user cannot create a group owned by somebody else');

SELECT throws_ok(
  $$SELECT decide_group_membership('00000000-0000-0000-0000-0000000000c2'::uuid, true)$$,
  'P0001',
  'Only the group admin can decide this request',
  'only the group admin can approve a membership');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM group_memberships WHERE status = 'pending'),
  1,
  'the group admin does see pending requests for their own group');

-- ============================================================================
-- Known gaps — these assert the intended behaviour, which the schema does not
-- yet have. See docs/audit-2026-08-20.md: PRIV-1, PRIV-2, DOS-1.
-- ============================================================================
SELECT todo_start('open findings PRIV-1 / PRIV-2 / DOS-1 — see docs/audit-2026-08-20.md');

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; SET LOCAL ROLE authenticated;

-- PRIV-1: profiles has no column-level UPDATE grant, so a user can promote
-- themselves to platform admin and read the whole analytics + feedback stream.
WITH u AS (
  UPDATE profiles SET is_platform_admin = true WHERE id = auth.uid() RETURNING 1
)
SELECT is((SELECT count(*)::int FROM u), 0, 'a user cannot make themselves a platform admin');

-- PRIV-2: the same gap lets a user mark themselves as having a payment method,
-- which makes them "vetted" — and a vetted borrower is auto-approved by any
-- lender who opted in, which reveals the pickup location with no human step.
WITH u AS (
  UPDATE profiles SET has_payment_method_on_file = true WHERE id = auth.uid() RETURNING 1
)
SELECT is((SELECT count(*)::int FROM u), 0, 'a user cannot mark themselves as a vetted borrower');

-- DOS-1: report_malfunction() has no authorization check at all, so any signed-in
-- user can flip any tool in the app to unavailable_malfunction.
SELECT throws_ok(
  $$SELECT report_malfunction('00000000-0000-0000-0000-0000000000aa'::uuid, 'vandalism')$$,
  'P0001',
  NULL,
  'a user with no borrow history cannot report someone else''s tool as broken');

SELECT todo_end();

SELECT * FROM finish();
ROLLBACK;
