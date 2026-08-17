-- CreateGroup.jsx inserts an approved group_memberships row for the group's
-- own creator right after creating the group, so they're immediately a
-- member of their own group. group_memberships had no INSERT policy at all
-- (the only writes came through the join_group/decide_group_membership RPCs,
-- which run SECURITY DEFINER and bypass RLS) — so that insert was silently
-- rejected, leaving every newly-created group with 0 members and its
-- creator unable to see it under "My Groups".
-- Scoped narrowly: only lets a group's admin insert an *approved* row for
-- *themselves*, in a group they administer. Approving anyone else's
-- membership still has to go through decide_group_membership.
create policy memberships_admin_self_insert on group_memberships
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and status = 'approved'
    and exists (select 1 from groups g where g.id = group_memberships.group_id and g.admin_id = auth.uid())
  );
