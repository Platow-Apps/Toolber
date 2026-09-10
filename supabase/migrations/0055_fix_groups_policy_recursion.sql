-- ============================================================
-- 0055 — 0052's groups policy recursed, and broke every read
-- ============================================================
-- URGENT FIX. 0052 gave groups a SELECT policy that asks whether the viewer
-- is an approved member:
--
--     exists (select 1 from group_memberships gm where gm.group_id = groups.id ...)
--
-- group_memberships has had its own SELECT policy since 0001, and that one
-- asks whether the viewer administers the group:
--
--     exists (select 1 from groups g where g.id = group_memberships.group_id ...)
--
-- So reading a group evaluates the membership policy, which reads groups,
-- which evaluates the groups policy, which reads memberships. Postgres stops
-- it with "infinite recursion detected in policy for relation groups", and
-- every authenticated read of groups fails: the Groups screen, Group Detail,
-- the map's group pins, and the shared-groups trust signal on a borrow
-- request.
--
-- It was invisible to `npm run test:all`, which mocks Supabase and therefore
-- never evaluates a policy at all, and to the migration's own self-check,
-- which asserts grants rather than running a query. pgTAP caught it on the
-- first run against a real database — which is the argument for running that
-- suite before believing an RLS change, not after.
--
-- The fix is to look up membership through a SECURITY DEFINER function. It
-- executes as the owner, who is not subject to these policies, so the cycle
-- is broken at the first hop rather than being detected at the last.

create or replace function is_approved_group_member(p_group_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from group_memberships
    where group_id = p_group_id
      and profile_id = p_profile_id
      and status = 'approved'
  );
$$;

-- Unlike profile_is_set_up (0054), this one *must* be callable by
-- `authenticated`: a policy is evaluated as the querying role, so a role that
-- cannot execute it cannot read the table at all.
--
-- It discloses nothing new. 0004 already made approved memberships readable
-- by any authenticated user, so "is this person in that group" was answerable
-- before this existed.
revoke execute on function is_approved_group_member(uuid, uuid) from public, anon;
grant execute on function is_approved_group_member(uuid, uuid) to authenticated;

drop policy if exists groups_select_listed_or_member on groups;
create policy groups_select_listed_or_member on groups
  for select to authenticated
  using (
    listed
    or admin_id = auth.uid()
    or is_approved_group_member(id, auth.uid())
  );

-- ============================================================
-- Self-check
-- ============================================================
-- Runs a real query this time. The 0052 check asserted privileges, which were
-- all correct — the policy was the broken part, and only executing it says so.
do $chk$
declare
  v_count integer;
begin
  if not has_function_privilege('authenticated', 'is_approved_group_member(uuid, uuid)', 'EXECUTE') then
    raise exception 'the policy helper must be executable by authenticated or groups becomes unreadable';
  end if;

  -- As a signed-in caller, so the policy is actually evaluated. Recursion
  -- would raise 42P17 here rather than reaching the assertion below.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
  select count(*) into v_count from groups;
  reset role;

  if v_count is null then
    raise exception 'groups became unreadable';
  end if;
end;
$chk$;
