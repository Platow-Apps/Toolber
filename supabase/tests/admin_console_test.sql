-- ============================================================================
-- pgTAP: the admin console (0060)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- These functions are the only path to columns that no database role can
-- select -- home_lat, home_lng, phone. That makes two things worth proving
-- rather than assuming:
--
--   1. The refusal is real. EXECUTE is deliberately granted to every
--      authenticated user, because the check lives in the function body, not
--      in the grant. So a privilege test proves nothing here; each assertion
--      below actually calls the function as an ordinary signed-in account.
--
--   2. The logging happens. admin_user_detail() is the difference between "an
--      admin can look up a home address" and "an admin can look up every home
--      address and leave no trace". If the events row stops being written,
--      the console still works and the accountability is silently gone.
--
-- Role switching is inline for the reason at the top of
-- pickup_location_rls_test.sql, and the anon blocks reset request.jwt.claims
-- explicitly or they run as whoever was signed in last.

BEGIN;

SELECT plan(20);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   admin   (…a1) is_platform_admin
--   ordinary(…a2) a normal signed-in account
--   subject (…a3) the person being administered; owns a tool and a group
--   member  (…a4) the group's other approved member, i.e. the successor

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'ordinary@test.dev'),
  ('00000000-0000-0000-0000-0000000000a3', 'subject@test.dev'),
  ('00000000-0000-0000-0000-0000000000a4', 'successor@test.dev');

UPDATE profiles SET display_name = 'Admin Ada', is_platform_admin = true
WHERE id = '00000000-0000-0000-0000-0000000000a1';
UPDATE profiles SET display_name = 'Ordinary Ozzy'
WHERE id = '00000000-0000-0000-0000-0000000000a2';
UPDATE profiles SET display_name = 'Subject Sue', phone = '555-0101',
  home_lat = 38.4404, home_lng = -122.7141, approx_lat = 38.4451, approx_lng = -122.7208
WHERE id = '00000000-0000-0000-0000-0000000000a3';
UPDATE profiles SET display_name = 'Successor Sal'
WHERE id = '00000000-0000-0000-0000-0000000000a4';

INSERT INTO tools (id, chest_id, name, description, photos)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3',
        'Chainsaw', 'Stihl MS170', array['a3/one.jpg']);

INSERT INTO groups (id, name, admin_id, invite_code)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'Oak Hill',
        '00000000-0000-0000-0000-0000000000a3', 'OAKHILL2');

INSERT INTO group_memberships (group_id, profile_id, status, requested_at) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'approved', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a4', 'approved', now() - interval '1 day');

INSERT INTO user_reports (id, reporter_id, reported_id, reason)
VALUES ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000a3', 'Listed something that is not theirs');

-- ============================================================================
-- 1. Signed out
-- ============================================================================
RESET ROLE;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT throws_ok('SELECT * FROM admin_overview()', '42501', NULL,
  'anon holds no EXECUTE on admin_overview');
SELECT throws_ok($$SELECT * FROM admin_user_detail('00000000-0000-0000-0000-0000000000a3')$$, '42501', NULL,
  'anon holds no EXECUTE on admin_user_detail');
SELECT throws_ok($$SELECT admin_hard_delete_account('00000000-0000-0000-0000-0000000000a3')$$, '42501', NULL,
  'anon holds no EXECUTE on admin_hard_delete_account');

-- ============================================================================
-- 2. Signed in, but not an admin
-- ============================================================================
-- EXECUTE *is* granted to authenticated on every one of these. The refusal is
-- inside the body, which is exactly why it has to be exercised rather than
-- inferred from a grant.
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok('SELECT * FROM admin_overview()', 'P0001', 'Not permitted',
  'an ordinary account is refused the statistics');
SELECT throws_ok('SELECT * FROM admin_list_users()', 'P0001', 'Not permitted',
  'an ordinary account cannot list accounts');
SELECT throws_ok($$SELECT * FROM admin_user_detail('00000000-0000-0000-0000-0000000000a3')$$, 'P0001', 'Not permitted',
  'an ordinary account cannot read a home address');
SELECT throws_ok($$SELECT admin_delete_tool('00000000-0000-0000-0000-0000000000c1')$$, 'P0001', 'Not permitted',
  'an ordinary account cannot delete someone else''s tool');
SELECT throws_ok($$SELECT admin_scrub_account('00000000-0000-0000-0000-0000000000a3')$$, 'P0001', 'Not permitted',
  'an ordinary account cannot scrub anybody');
SELECT throws_ok($$SELECT admin_hard_delete_account('00000000-0000-0000-0000-0000000000a3')$$, 'P0001', 'Not permitted',
  'an ordinary account cannot hard-delete anybody');
SELECT throws_ok('SELECT * FROM admin_list_reports()', 'P0001', 'Not permitted',
  'an ordinary account cannot read the reports queue');

-- The refusal must not be reachable around: the columns stay ungranted.
SELECT throws_ok('SELECT home_lat, phone FROM profiles', '42501', NULL,
  'and the columns behind it are still selectable by nobody');

-- ============================================================================
-- 3. The admin
-- ============================================================================
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT accounts::int FROM admin_overview()),
  (SELECT count(*)::int FROM profiles),
  'the admin gets real numbers back'
);

SELECT is(
  (SELECT tools_count::int FROM admin_list_users('Subject')),
  1,
  'the account list counts what each person has listed'
);

SELECT is(
  (SELECT phone FROM admin_user_detail('00000000-0000-0000-0000-0000000000a3')),
  '555-0101',
  'the admin can read the contact details no role can select'
);

-- The whole justification for the RPC over a grant.
SELECT is(
  (SELECT count(*)::int FROM events
   WHERE event_type = 'admin_viewed_user'
     AND profile_id = '00000000-0000-0000-0000-0000000000a1'
     AND metadata->>'viewed_profile_id' = '00000000-0000-0000-0000-0000000000a3'),
  1,
  'and reading them left a record naming who looked at whom'
);

SELECT is(
  (SELECT reported_name FROM admin_list_reports()),
  'Subject Sue',
  'the reports queue names both sides'
);

-- ============================================================================
-- 4. Scrubbing, and what it protects
-- ============================================================================
SELECT is(
  (SELECT admin_scrub_account('00000000-0000-0000-0000-0000000000a3', 'test')),
  array['a3/one.jpg'],
  'scrub hands back the photo paths, because Postgres cannot clear the bucket'
);

RESET ROLE;
SELECT is(
  (SELECT display_name FROM profiles WHERE id = '00000000-0000-0000-0000-0000000000a3'),
  'Deleted user',
  'the profile row survives, scrubbed -- so the other side''s history still resolves'
);

-- delete_my_account() refuses outright here because nothing could appoint a
-- replacement. Something can now, and dissolving a working group because one
-- person left is the worse outcome.
SELECT is(
  (SELECT admin_id FROM groups WHERE id = '00000000-0000-0000-0000-0000000000b1'),
  '00000000-0000-0000-0000-0000000000a4'::uuid,
  'a group they administered went to its longest-standing other member'
);

-- ============================================================================
-- 5. One admin cannot remove another
-- ============================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok($$SELECT admin_scrub_account('00000000-0000-0000-0000-0000000000a1')$$, 'P0001',
  'Use Delete account in Settings to remove your own account',
  'an admin cannot scrub themselves from the console');

SELECT * FROM finish();
ROLLBACK;
