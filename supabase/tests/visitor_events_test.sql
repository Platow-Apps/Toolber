-- ============================================================================
-- pgTAP: counting the people who never sign in (0065, audit RLS-3)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- `events` keeps its closed insert policy — `profile_id = auth.uid()`, which is
-- NULL for anon — and a single SECURITY DEFINER function is the only way an
-- anonymous action is ever recorded. Three things have to hold at once for that
-- to work, and no privilege check can see them together: the EXECUTE grant to
-- anon (which 0046 made opt-in), the definer body, and the policy the definer
-- is not subject to. So this suite calls the function as a real anon session.
--
-- The other half is what the function refuses. It is reachable by every visitor
-- on the internet, so the things that keep it from being a write endpoint —
-- the two-type whitelist, metadata built here rather than accepted as a blob,
-- profile_id taken from the JWT and never from an argument — are the feature,
-- not hardening around it.

BEGIN;

SELECT plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   visitor (…d1) a signed-in account, for the attribution assertion

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'visitor@test.dev');

-- ============================================================================
-- 1. The table stays shut
-- ============================================================================
SELECT ok(
  NOT has_table_privilege('anon', 'events', 'INSERT'),
  'anon holds no direct INSERT on events, so the whitelist cannot be walked around'
);

SELECT ok(
  has_function_privilege('anon', 'log_visitor_event(text,uuid,uuid,text,integer,boolean)', 'EXECUTE'),
  'but it can execute the one function -- 0046 made that an explicit grant, not a default'
);

RESET ROLE;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$INSERT INTO events (profile_id, event_type) VALUES (NULL, 'search_performed')$$,
  '42501', NULL,
  'and the direct insert is refused when actually attempted, not merely ungranted'
);

-- ============================================================================
-- 2. What a visitor can record
-- ============================================================================
SELECT lives_ok(
  $$SELECT log_visitor_event('search_performed', '00000000-0000-0000-0000-0000000000e1',
                             NULL, '   chainsaw   ', 4, true)$$,
  'a signed-out visitor can log a search'
);

SELECT lives_ok(
  $$SELECT log_visitor_event('tool_viewed', '00000000-0000-0000-0000-0000000000e1',
                             '00000000-0000-0000-0000-0000000000c1')$$,
  'and a tool view, under the same session'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM events WHERE profile_id IS NULL),
  2,
  'both landed, unattributed -- which is the entire point of RLS-3'
);

SELECT is(
  (SELECT metadata ->> 'query' FROM events
    WHERE profile_id IS NULL AND event_type = 'search_performed'),
  'chainsaw',
  'with metadata built server-side from typed arguments, trimmed'
);

SELECT is(
  (SELECT count(DISTINCT metadata ->> 'session')::int FROM events WHERE profile_id IS NULL),
  1,
  'and one session across both, so two views are one visitor'
);

-- ============================================================================
-- 3. What it refuses
-- ============================================================================
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT log_visitor_event('borrow_requested', '00000000-0000-0000-0000-0000000000e1')$$,
  'P0001', 'log_visitor_event does not accept borrow_requested',
  'an event type outside the two public pages is refused, not quietly written'
);

SELECT throws_ok(
  $$SELECT log_visitor_event('search_performed', NULL)$$,
  'P0001', 'A session id is required, or the counts cannot tell people apart',
  'and so is a missing session, which would make the visitor count meaningless'
);

-- ============================================================================
-- 4. A signed-in caller is attributed, never anonymised
-- ============================================================================
-- The function is granted to `authenticated` on purpose: a returning visitor's
-- session restores asynchronously, so the client cannot always say who they
-- are. It takes the answer from the JWT instead, which means a call that
-- arrives once the token has is recorded as theirs — there is no argument to
-- forge and no way to use this to write somebody else's row.
RESET ROLE;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT log_visitor_event('tool_viewed', '00000000-0000-0000-0000-0000000000e2',
                             '00000000-0000-0000-0000-0000000000c1')$$,
  'a signed-in caller may use it too'
);

RESET ROLE;

SELECT is(
  (SELECT profile_id FROM events WHERE metadata ->> 'session' = '00000000-0000-0000-0000-0000000000e2'),
  '00000000-0000-0000-0000-0000000000d1'::uuid,
  'and their row carries their id, taken from the JWT rather than an argument'
);

SELECT * FROM finish();
ROLLBACK;
