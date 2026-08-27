-- Lets a group admin remove an approved member. group_memberships has no
-- delete policy at all (RLS-2 in docs/audit-2026-08-20.md notes the same
-- gap for a member leaving on their own, which this doesn't address --
-- admin-initiated removal only), so this goes through an RPC rather than a
-- direct client delete, matching the rest of the trust-sensitive group
-- decisions (decide_group_membership, join_group).

create or replace function remove_group_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_profile_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select group_id, profile_id into v_group_id, v_profile_id
  from group_memberships where id = p_membership_id;

  if v_group_id is null then
    raise exception 'Membership not found';
  end if;

  if not exists (select 1 from groups where id = v_group_id and admin_id = auth.uid()) then
    raise exception 'Only the group admin can remove a member';
  end if;

  if v_profile_id = auth.uid() then
    raise exception 'Cannot remove yourself as admin';
  end if;

  delete from group_memberships where id = p_membership_id;
end;
$$;

revoke execute on function remove_group_member(uuid) from public;
grant execute on function remove_group_member(uuid) to authenticated;
