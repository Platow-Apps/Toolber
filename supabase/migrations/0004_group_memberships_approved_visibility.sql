-- The existing memberships_select policy (0001_init.sql) only lets a user see
-- their own membership rows, or every row for a group they administer. That's
-- correct for pending/denied (those are private), but it silently blocks the
-- Groups feature's actual requirements:
--   - Group Detail's "tapping a group shows its tools" (tools whose owning
--     crib is an *approved* member of the group) needs to read other people's
--     approved membership rows.
--   - Member counts on Find a Group / Group Detail need the same.
-- Approved membership is meant to be public within the app (same trust level
-- as the groups table itself, which is already "browsable by anyone
-- authenticated" per groups_select_all) — only pending/denied requests are
-- actually private. This policy is additive (RLS OR's policies together for
-- select), so it only *adds* visibility for approved rows; the existing
-- own-row/admin-row policy still governs pending/denied.
create policy memberships_select_approved_public on group_memberships
  for select to authenticated
  using (status = 'approved');
