-- ============================================================================
-- pgTAP: a borrow request requires a finished profile (0053)
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- The reset is not optional. `supabase test db` runs against whatever the
-- local stack already has; it does not apply migrations.
--
-- This is exactly the kind of rule the AVA suite cannot test. It mocks
-- Supabase, so it can only prove the *button* is hidden — and the button was
-- never the rule. The RPC is callable directly by anyone holding the
-- publishable key, which is public by design, so the only question worth
-- asking is what happens when someone calls it anyway.

BEGIN;

SELECT plan(8);

-- ── Fixtures ────────────────────────────────────────────────────────────────
--   lender     (…01) owns the tool, fully set up
--   ready      (…02) finished onboarding: complete, with a home point
--   unfinished (…03) signed up and stopped: no address, not complete
--   flagged    (…04) profile_complete somehow true but no address at all

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'lender@test.dev'),
  ('00000000-0000-0000-0000-000000000002', 'ready@test.dev'),
  ('00000000-0000-0000-0000-000000000003', 'unfinished@test.dev'),
  ('00000000-0000-0000-0000-000000000004', 'flagged@test.dev');

UPDATE profiles SET profile_complete = true, home_lat = 38.44, home_lng = -122.71
WHERE id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

-- Deliberately inconsistent: the flag set, the address absent. Onboarding
-- writes both together, so this should be unreachable — which is the reason
-- to check the address rather than trusting the flag to stand for it.
UPDATE profiles SET profile_complete = true, home_lat = NULL, home_lng = NULL
WHERE id = '00000000-0000-0000-0000-000000000004';

INSERT INTO tools (id, chest_id, name, pickup_location)
VALUES ('00000000-0000-0000-0000-0000000000aa'::uuid,
        '00000000-0000-0000-0000-000000000001', 'Wet tile saw', '142 Birchwood Ct');

-- ── The rule ────────────────────────────────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $q$ SELECT request_borrow('00000000-0000-0000-0000-0000000000aa'::uuid) $q$,
  'P0001',
  'Finish setting up your profile before requesting a tool',
  'someone who never finished onboarding cannot request a tool'
);

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $q$ SELECT request_borrow('00000000-0000-0000-0000-0000000000aa'::uuid) $q$,
  'P0001',
  'Finish setting up your profile before requesting a tool',
  'the completion flag alone is not enough -- an address has to exist'
);

-- ── Someone who did finish ──────────────────────────────────────────────────

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $q$ SELECT request_borrow('00000000-0000-0000-0000-0000000000aa'::uuid) $q$,
  'a set-up member can still request a tool'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM borrow_requests
    WHERE borrower_id = '00000000-0000-0000-0000-000000000002'),
  1,
  'and the request actually exists'
);

SELECT is(
  (SELECT count(*)::int FROM borrow_requests
    WHERE borrower_id IN ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004')),
  0,
  'while the refused ones left nothing behind'
);

-- ── The older rules still hold ──────────────────────────────────────────────
-- 0053 rewrote the whole function, so the guards it inherited are worth
-- re-asserting rather than assumed to have survived the copy.

RESET ROLE; SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $q$ SELECT request_borrow('00000000-0000-0000-0000-0000000000aa'::uuid) $q$,
  'P0001',
  'Cannot request your own tool',
  'the owner still cannot borrow from themselves'
);

RESET ROLE;

SELECT ok(
  NOT has_function_privilege('anon', 'request_borrow(uuid, boolean, integer, text)', 'EXECUTE'),
  'anon still cannot call it at all'
);

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'request_borrow'),
  1,
  'exactly one request_borrow -- no older signature survived the rewrite'
);

SELECT * FROM finish();
ROLLBACK;
