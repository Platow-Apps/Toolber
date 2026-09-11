-- ============================================================================
-- pgTAP: every column is granted or deliberately withheld
-- ============================================================================
-- Run with:  supabase db reset && supabase test db
--
-- This file exists because the same mistake has now been made six times.
-- tools, profiles, groups and borrow_requests each had their table-level
-- SELECT revoked and an explicit column list granted, which is the only shape
-- that actually protects a column (CLAUDE.md). The cost is that every column
-- added afterwards is unreadable until someone remembers to name it — and
-- forgetting does not fail where the column is used. It fails on the whole
-- query, as "permission denied for table tools", from a screen that may not
-- be visited for weeks.
--
-- So: each table lists what is withheld *on purpose*. Anything else must be
-- granted. A new column therefore fails here, at the point it is added, with
-- a message naming it — rather than silently, in front of somebody trying to
-- edit their tool.
--
-- Adding a column means adding it to a grant, or adding it to the list below
-- with a reason. Both are deliberate acts, which is the entire point.

BEGIN;

SELECT plan(6);

-- tools: the exact address and the asking price are RPC-only (0002, 0021).
SELECT is(
  (SELECT coalesce(string_agg(column_name, ', ' ORDER BY column_name), '')
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tools'
     AND NOT has_column_privilege('authenticated', 'tools', column_name, 'SELECT')),
  'asking_price, pickup_location',
  'tools withholds only the asking price and the exact pickup address'
);

-- profiles: real coordinates, contact details, the saved pickup address, and
-- the server-owned flags nobody may read off the row.
SELECT is(
  (SELECT coalesce(string_agg(column_name, ', ' ORDER BY column_name), '')
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND NOT has_column_privilege('authenticated', 'profiles', column_name, 'SELECT')),
  'auto_approve_vetted_borrowers, default_pickup_location, has_payment_method_on_file, '
  || 'home_address_certified_at, home_lat, home_lng, phone, pin_placement_mode, '
  || 'pin_radius_meters, tos_accepted_at, tos_version',
  'profiles withholds coordinates, contact details and server-owned fields'
);

-- groups: the invite code is the credential (0014), and the exchange spot is
-- for members.
SELECT is(
  (SELECT coalesce(string_agg(column_name, ', ' ORDER BY column_name), '')
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'groups'
     AND NOT has_column_privilege('authenticated', 'groups', column_name, 'SELECT')),
  'default_exchange_location, invite_code, pin_is_manual',
  'groups withholds the invite code and the default exchange spot'
);

-- borrow_requests: the one-off pickup spot, same rule as the tool's own.
SELECT is(
  (SELECT coalesce(string_agg(column_name, ', ' ORDER BY column_name), '')
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'borrow_requests'
     AND NOT has_column_privilege('authenticated', 'borrow_requests', column_name, 'SELECT')),
  'pickup_location',
  'borrow_requests withholds only the one-off pickup spot'
);

-- ============================================================================
-- anon: the same discipline, one step stricter
-- ============================================================================
-- A logged-out visitor browses tools and the map, and that is all. 0057 took
-- away the three columns that turned a browse into a dossier: the owner's
-- name, their avatar, and -- the one that mattered -- tools.chest_id, which
-- is a join key. With it, any tool led to every other tool by the same owner.

SELECT is(
  (SELECT coalesce(string_agg(column_name, ', ' ORDER BY column_name), '')
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tools'
     AND NOT has_column_privilege('anon', 'tools', column_name, 'SELECT')),
  'asking_price, chest_id, location_id, pickup_location',
  'anon additionally withholds the chest_id join key on tools'
);

SELECT is(
  (SELECT coalesce(string_agg(column_name, ', ' ORDER BY column_name), '')
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND NOT has_column_privilege('anon', 'profiles', column_name, 'SELECT')),
  -- Everything authenticated withholds, plus the identity columns 0057 took
  -- away, plus four that anon was simply never granted: three personal
  -- switches and the deletion timestamp, none of which a logged-out visitor
  -- has any use for.
  'auto_approve_vetted_borrowers, avatar_url, default_pickup_location, deleted_at, '
  || 'display_name, has_payment_method_on_file, home_address_certified_at, home_lat, '
  || 'home_lng, identity_private, is_platform_admin, phone, pin_placement_mode, '
  || 'pin_radius_meters, share_email_on_approval, share_phone_on_approval, '
  || 'show_own_tools, tos_accepted_at, tos_version',
  'anon additionally withholds the owner identity columns on profiles'
);

SELECT * FROM finish();
ROLLBACK;
