-- ============================================================================
-- pgTAP: asking a group for a tool nobody has listed (0062)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- Two properties carry this feature, and neither is visible to the AVA suite.
--
--   1. It is scoped to the group. A request is a member telling their
--      neighbours what they need; anyone outside must not be able to read it,
--      reply to it, or learn it exists.
--
--   2. Every write goes through an RPC, because posting sends a notification
--      to each approved member and an ask nobody hears about is worse than no
--      ask. The tables therefore carry no INSERT grant at all -- which a
--      privilege check can prove, unlike most things here, so it does.
--
-- The default-privileges trap is the reason that check exists. Supabase grants
-- anon and authenticated everything on a new table in public, so a migration
-- that only adds a GRANT restricts nothing; this suite is the standing guard
-- that the REVOKE in 0062 is still there.

BEGIN;

SELECT plan(21);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   asker    (…b1) approved member, posts the request
--   helper   (…b2) approved member, replies and owns a tool
--   outsider (…b3) in no group at all
--   admin    (…b4) administers the group

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'asker@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'helper@test.dev'),
  ('00000000-0000-0000-0000-0000000000b3', 'outsider@test.dev'),
  ('00000000-0000-0000-0000-0000000000b4', 'groupadmin@test.dev');

UPDATE profiles SET display_name = 'Asker Ash'   WHERE id = '00000000-0000-0000-0000-0000000000b1';
UPDATE profiles SET display_name = 'Helper Hal'  WHERE id = '00000000-0000-0000-0000-0000000000b2';
UPDATE profiles SET display_name = 'Outsider Oz' WHERE id = '00000000-0000-0000-0000-0000000000b3';
UPDATE profiles SET display_name = 'Admin Ada'   WHERE id = '00000000-0000-0000-0000-0000000000b4';

INSERT INTO groups (id, name, admin_id, invite_code)
VALUES ('00000000-0000-0000-0000-0000000000a9', 'Oak Hill',
        '00000000-0000-0000-0000-0000000000b4', 'OAKHILL3');

INSERT INTO group_memberships (group_id, profile_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b4', 'approved'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b1', 'approved'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b2', 'approved');

INSERT INTO tools (id, chest_id, name)
VALUES ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000b2', 'Wet tile saw'),
       ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000b1', 'Not the helper''s');

-- ============================================================================
-- 1. Nobody may write except through the RPCs
-- ============================================================================
SELECT ok(
  NOT has_table_privilege('authenticated', 'group_tool_requests', 'INSERT'),
  'no client can insert a request directly, so the notification cannot be skipped'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'group_tool_request_replies', 'INSERT'),
  'nor a reply'
);
SELECT ok(
  NOT has_table_privilege('anon', 'group_tool_requests', 'SELECT'),
  'and a logged-out visitor cannot read a group''s requests at all'
);

-- ============================================================================
-- 2. Posting
-- ============================================================================
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT create_group_tool_request('00000000-0000-0000-0000-0000000000a9', 'Wet tile saw')$$,
  'P0001', 'Only approved members can ask this group',
  'somebody outside the group cannot post to it'
);

RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT create_group_tool_request('00000000-0000-0000-0000-0000000000a9', '   ')$$,
  'P0001', 'Say what you are looking for',
  'whitespace is not a request'
);

SELECT lives_ok(
  $$SELECT create_group_tool_request('00000000-0000-0000-0000-0000000000a9', 'Wet tile saw', 'Small bathroom.')$$,
  'an approved member can ask the group'
);

-- The entire point of routing this through a function.
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'group_tool_request'
     AND profile_id IN ('00000000-0000-0000-0000-0000000000b2',
                        '00000000-0000-0000-0000-0000000000b4')),
  2,
  'every other approved member was told'
);

SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'group_tool_request' AND profile_id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'and the person asking was not notified of their own request'
);

-- ============================================================================
-- 3. Reading is scoped to the group
-- ============================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM group_tool_requests),
  0,
  'an outsider sees no requests through the table either -- the policy, not just the RPC'
);

SELECT throws_ok(
  $$SELECT * FROM group_tool_requests_for('00000000-0000-0000-0000-0000000000a9')$$,
  'P0001', NULL,
  'and is refused the listing function'
);

RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT title FROM group_tool_requests_for('00000000-0000-0000-0000-0000000000a9')),
  'Wet tile saw',
  'a fellow member sees it'
);

-- ============================================================================
-- 4. Replying, and the tool you may offer
-- ============================================================================
SELECT throws_ok(
  format($$SELECT reply_to_group_tool_request(%L, 'I have one', '00000000-0000-0000-0000-0000000000c9')$$,
         (SELECT id FROM group_tool_requests LIMIT 1)),
  'P0001', 'You can only offer a tool you have listed yourself',
  'you cannot volunteer somebody else''s drill'
);

SELECT lives_ok(
  format($$SELECT reply_to_group_tool_request(%L, 'I have one you can borrow', '00000000-0000-0000-0000-0000000000c8')$$,
         (SELECT id FROM group_tool_requests LIMIT 1)),
  'but you can offer your own'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM notifications
   WHERE type = 'group_tool_request_reply' AND profile_id = '00000000-0000-0000-0000-0000000000b1'),
  1,
  'and the person who asked hears about the reply'
);

-- ============================================================================
-- 4b. Reading the thread back
-- ============================================================================
-- This suite had seventeen assertions about writing and none about this, and
-- group_tool_request_thread() was broken from the day it shipped: `returns
-- table (id uuid, ...)` makes `id` a variable, so its own `where id =
-- p_request_id` was ambiguous and raised 42702 every time (0064). Posting
-- worked, replying worked, and the only screen anybody looks at did not.
--
-- Note which assertion catches it. A refusal test would not have: the refusal
-- is the first statement in the body and the ambiguous one is the second, so
-- the outsider case below passed against a function no member could use. It
-- takes a successful read by somebody entitled to it.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM group_tool_request_thread(
     (SELECT id FROM group_tool_requests LIMIT 1))),
  1,
  'the person who asked can read the reply they were notified about'
);

SELECT is(
  (SELECT (responder_name, tool_name)::text FROM group_tool_request_thread(
     (SELECT id FROM group_tool_requests LIMIT 1))),
  '("Helper Hal","Wet tile saw")',
  'with the responder named and the offered tool resolved'
);

SELECT throws_ok(
  $$SELECT * FROM group_tool_request_thread('00000000-0000-0000-0000-0000000000ff')$$,
  'P0001', 'No such request',
  'and a request that does not exist says so rather than returning nothing'
);

-- Pinned while a role that can still see it is current. An outsider's own
-- policy hides the row, so `(SELECT id FROM group_tool_requests LIMIT 1)`
-- evaluates to NULL for them and the function answers 'No such request' --
-- true, but not the refusal this is testing, and the assertion would pass for
-- the wrong reason if it were worded loosely enough.
RESET ROLE;
CREATE TEMP TABLE t_request AS SELECT id FROM group_tool_requests LIMIT 1;
GRANT SELECT ON t_request TO authenticated;

SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format($$SELECT * FROM group_tool_request_thread(%L)$$, (SELECT id FROM t_request)),
  'P0001', 'Only approved members can read this thread',
  'while an outsider is refused the thread'
);

-- ============================================================================
-- 5. Closing
-- ============================================================================
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format($$SELECT close_group_tool_request(%L)$$, (SELECT id FROM group_tool_requests LIMIT 1)),
  'P0001', 'Only the person who asked, or the group admin, can close this',
  'a bystander cannot close somebody else''s request'
);

RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  format($$SELECT close_group_tool_request(%L, 'withdrawn')$$, (SELECT id FROM group_tool_requests LIMIT 1)),
  'the group admin can, for the one left open forever'
);

-- A closed request stops taking replies, or "fulfilled" means nothing.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format($$SELECT reply_to_group_tool_request(%L, 'Still here')$$, (SELECT id FROM group_tool_requests LIMIT 1)),
  'P0001', 'That request is closed',
  'and it stops taking replies once closed'
);

SELECT * FROM finish();
ROLLBACK;
