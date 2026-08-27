-- decide_group_membership() has been broken since 0001_init.sql and was
-- apparently never actually exercised until now: approving/denying a group
-- join request failed with "column status is of type membership_status but
-- expression is of type text".
--
-- `case when p_approve then 'approved' else 'denied' end` resolves to type
-- `text` (Postgres needs a common type across CASE branches and defaults
-- untyped string literals to text once there's no other cue), and enum
-- columns don't have an automatic implicit assignment cast from `text` --
-- only from bare `unknown`-typed literals. Fix: cast each branch to the
-- enum explicitly.
--
-- Safe to paste and re-run from the top -- CREATE OR REPLACE is already
-- idempotent, nothing else in this file needs it.

create or replace function decide_group_membership(p_membership_id uuid, p_approve boolean)
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

  select group_id, profile_id into v_group_id, v_profile_id from group_memberships where id = p_membership_id;

  if not exists (select 1 from groups where id = v_group_id and admin_id = auth.uid()) then
    raise exception 'Only the group admin can decide this request';
  end if;

  update group_memberships
  set status = case when p_approve then 'approved'::membership_status else 'denied'::membership_status end,
      decided_at = now()
  where id = p_membership_id;

  insert into notifications (profile_id, type, payload)
  values (v_profile_id, case when p_approve then 'group_join_approved' else 'group_join_denied' end, jsonb_build_object('group_id', v_group_id));
end;
$$;
