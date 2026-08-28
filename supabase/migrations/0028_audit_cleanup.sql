-- Closes the remaining Medium/Low findings from docs/audit-2026-08-20.md that
-- are fixable in SQL: LOGIC-5, LOGIC-6, LOGIC-7 (server half), LOGIC-8,
-- RLS-1, RLS-2, RLS-4, and SEC-5's schema half.
--
-- Safe to paste and re-run from the top. Note it DROPs join_group(text) and
-- request_to_join_group(uuid) to change their return types, so do not re-run
-- 0014 after this file.

-- ============================================================
-- LOGIC-7 (server half) — invite codes generated in Postgres
-- ============================================================
-- Previously the browser generated the code and retried on collision, which
-- meant the uniqueness retry loop lived outside the transaction that used it.
-- Same alphabet as src/lib/inviteCode.js: no 0/O or 1/I/L, since people read
-- these aloud.

create or replace function generate_invite_code(p_length integer default 7)
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_out text := '';
  i integer;
begin
  for i in 1..p_length loop
    -- floor(random()*31) is uniform over the alphabet; this is a
    -- human-readable code whose secrecy nothing depends on (see SEC-2 --
    -- codes are only readable through get_group_invite_details anyway).
    v_out := v_out || substr(v_alphabet, floor(random() * length(v_alphabet))::integer + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- ============================================================
-- LOGIC-6 — create a group and its admin's membership atomically
-- ============================================================
-- CreateGroup.jsx did two separate inserts. If the second failed, the group
-- existed with no members and its creator locked out -- exactly the state
-- 0005 was written to prevent -- and the invite code was burnt. A function
-- body is a single transaction, so both rows land or neither does.

create or replace function create_group(
  p_name text,
  p_neighborhood_label text default null,
  p_city text default null,
  p_zip_code text default null,
  p_default_exchange_location text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_code text;
  v_attempt integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A group needs a name';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := generate_invite_code();
    begin
      insert into groups (
        name, neighborhood_label, city, zip_code,
        default_exchange_location, invite_code, admin_id,
        -- LOGIC-8: deliberately NULL. A new group has no pin until it has
        -- enough approved members for a centroid that doesn't identify one
        -- of them -- see refresh_group_pin below.
        approx_lat, approx_lng
      )
      values (
        trim(p_name), nullif(trim(p_neighborhood_label), ''), nullif(trim(p_city), ''),
        nullif(trim(p_zip_code), ''), nullif(trim(p_default_exchange_location), ''),
        v_code, auth.uid(), null, null
      )
      returning id into v_group_id;
      exit;
    exception when unique_violation then
      -- 31^7 is ~27 billion, so this is vanishingly rare; give up rather
      -- than spin if something else is wrong.
      if v_attempt >= 5 then
        raise exception 'Could not allocate an invite code, please try again';
      end if;
    end;
  end loop;

  insert into group_memberships (group_id, profile_id, status, decided_at)
  values (v_group_id, auth.uid(), 'approved'::membership_status, now());

  return v_group_id;
end;
$$;

revoke execute on function create_group(text, text, text, text, text) from public;
grant execute on function create_group(text, text, text, text, text) to authenticated;

-- ============================================================
-- LOGIC-8 — a group's pin is a centroid, never a member's own point
-- ============================================================
-- Copying the creator's chest coordinate onto the group made the group pin
-- land on exactly the admin's chest pin, identifying which chest is theirs.
-- The map fans co-located pins apart visually, which hid it from the eye but
-- not from the API response.
--
-- The pin is now the mean of approved members' approximate points, and only
-- once there are enough of them that the mean doesn't single anyone out. Two
-- members would make it the midpoint of a line between them -- still a leak --
-- so the floor is three.

create or replace function refresh_group_pin(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_members constant integer := 3;
  v_count integer;
  v_lat numeric;
  v_lng numeric;
begin
  select count(*), avg(p.approx_lat), avg(p.approx_lng)
  into v_count, v_lat, v_lng
  from group_memberships gm
  join profiles p on p.id = gm.profile_id
  where gm.group_id = p_group_id
    and gm.status = 'approved'
    and p.approx_lat is not null
    and p.approx_lng is not null
    and not p.map_pin_hidden;

  if v_count >= v_min_members then
    update groups set approx_lat = v_lat, approx_lng = v_lng where id = p_group_id;
  else
    update groups set approx_lat = null, approx_lng = null where id = p_group_id;
  end if;
end;
$$;

revoke execute on function refresh_group_pin(uuid) from public;

-- ============================================================
-- LOGIC-5 — join paths report what actually happened
-- ============================================================
-- Both returned the new membership id, which is NULL when
-- `on conflict do nothing` fires. The client only checked `error`, so a
-- repeat join -- or a join against a membership that was already *denied* --
-- rendered "Request sent." to a user whose request had been ignored.
--
-- Return type changes, so these have to be dropped rather than replaced.

drop function if exists join_group(text);
drop function if exists request_to_join_group(uuid);

create or replace function join_group(p_invite_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_admin_id uuid;
  v_existing membership_status;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select id, admin_id into v_group_id, v_admin_id from groups where invite_code = p_invite_code;
  if v_group_id is null then
    raise exception 'Invalid invite code';
  end if;

  select status into v_existing
  from group_memberships where group_id = v_group_id and profile_id = auth.uid();

  if v_existing is not null then
    return 'already_' || v_existing::text;   -- already_pending / already_approved / already_denied
  end if;

  insert into group_memberships (group_id, profile_id, status)
  values (v_group_id, auth.uid(), 'pending'::membership_status)
  returning id into v_membership_id;

  insert into notifications (profile_id, type, payload)
  values (v_admin_id, 'group_join_requested', jsonb_build_object('group_id', v_group_id, 'profile_id', auth.uid()));

  return 'requested';
end;
$$;

create or replace function request_to_join_group(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_existing membership_status;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select admin_id into v_admin_id from groups where id = p_group_id;
  if v_admin_id is null then
    raise exception 'Group not found';
  end if;

  select status into v_existing
  from group_memberships where group_id = p_group_id and profile_id = auth.uid();

  if v_existing is not null then
    return 'already_' || v_existing::text;
  end if;

  insert into group_memberships (group_id, profile_id, status)
  values (p_group_id, auth.uid(), 'pending'::membership_status)
  returning id into v_membership_id;

  insert into notifications (profile_id, type, payload)
  values (v_admin_id, 'group_join_requested', jsonb_build_object('group_id', p_group_id, 'profile_id', auth.uid()));

  return 'requested';
end;
$$;

revoke execute on function join_group(text) from public;
grant execute on function join_group(text) to authenticated;
revoke execute on function request_to_join_group(uuid) from public;
grant execute on function request_to_join_group(uuid) to authenticated;

-- decide_group_membership now keeps the group pin in step, since approving or
-- denying changes the approved-member set the centroid is drawn from.
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

  select group_id, profile_id into v_group_id, v_profile_id
  from group_memberships where id = p_membership_id;
  if v_group_id is null then
    raise exception 'Membership not found';
  end if;

  if not exists (select 1 from groups where id = v_group_id and admin_id = auth.uid()) then
    raise exception 'Only the group admin can decide this request';
  end if;

  update group_memberships
  set status = case when p_approve then 'approved'::membership_status else 'denied'::membership_status end,
      decided_at = now()
  where id = p_membership_id;

  perform refresh_group_pin(v_group_id);

  insert into notifications (profile_id, type, payload)
  values (v_profile_id,
          case when p_approve then 'group_join_approved' else 'group_join_denied' end,
          jsonb_build_object('group_id', v_group_id));
end;
$$;

-- ============================================================
-- RLS-1 — an admin could forge a membership for anyone
-- ============================================================
-- memberships_admin_update had a USING clause and no WITH CHECK, so Postgres
-- reused USING as the check. That constrained the *group*, not the *member*:
-- an admin could UPDATE ... SET profile_id = '<any user>' inside their own
-- group and manufacture an approved membership for someone who never asked.
-- Approved co-membership is what makes a borrower "vetted", so this was a
-- real trust bypass.
--
-- Dropped rather than patched with a WITH CHECK: every legitimate decision
-- already goes through decide_group_membership(), which is SECURITY DEFINER
-- and checks admin rights itself. Leaving a direct UPDATE path open is a
-- second thing to keep correct for no benefit.

drop policy if exists memberships_admin_update on group_memberships;

-- ============================================================
-- RLS-2 — leaving a group, and cancelling a request
-- ============================================================
-- Membership was a permanent trust grant: no DELETE policy meant a member
-- could never leave. And borrow_requests had no UPDATE policy and no cancel
-- RPC, so the 'cancelled' enum value was unreachable and a borrower could not
-- withdraw a request they had second thoughts about.
--
-- Both are RPCs rather than policies so the refusals can explain themselves
-- -- a policy that matches no rows just silently does nothing.

create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select admin_id into v_admin_id from groups where id = p_group_id;
  if v_admin_id is null then
    raise exception 'Group not found';
  end if;
  if v_admin_id = auth.uid() then
    -- Leaving would orphan the group: nobody could approve joins or see the
    -- invite code. Transferring or deleting a group is a separate feature.
    raise exception 'A group admin cannot leave their own group';
  end if;

  select id into v_membership_id
  from group_memberships where group_id = p_group_id and profile_id = auth.uid();
  if v_membership_id is null then
    raise exception 'You are not a member of this group';
  end if;

  delete from group_memberships where id = v_membership_id;
  perform refresh_group_pin(p_group_id);
end;
$$;

revoke execute on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;

create or replace function cancel_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status borrow_request_status;
  v_tool_id uuid;
  v_borrower_id uuid;
  v_lender_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select status, tool_id, borrower_id, lender_id
  into v_status, v_tool_id, v_borrower_id, v_lender_id
  from borrow_requests where id = p_request_id;

  if v_borrower_id is null then
    raise exception 'Request not found';
  end if;
  if v_borrower_id != auth.uid() then
    raise exception 'Only the borrower can cancel this request';
  end if;
  if v_status != 'pending' then
    -- An approved request is a real loan; ending that is complete_borrow_request.
    raise exception 'Only a pending request can be cancelled';
  end if;

  update borrow_requests set status = 'cancelled', decided_at = now() where id = p_request_id;

  perform refresh_tool_state(v_tool_id);

  insert into notifications (profile_id, type, payload)
  values (v_lender_id, 'borrow_cancelled',
          jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id));
end;
$$;

revoke execute on function cancel_borrow_request(uuid) from public;
grant execute on function cancel_borrow_request(uuid) to authenticated;

-- remove_group_member keeps the pin in step too.
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
    raise exception 'A group admin cannot remove themselves';
  end if;

  delete from group_memberships where id = p_membership_id;
  perform refresh_group_pin(v_group_id);
end;
$$;

revoke execute on function remove_group_member(uuid) from public;
grant execute on function remove_group_member(uuid) to authenticated;

-- ============================================================
-- RLS-4 — index the column every membership lookup filters on
-- ============================================================

create index if not exists group_memberships_profile_idx on group_memberships (profile_id);

-- ============================================================
-- SEC-5 (schema half) — group activity gets its own preference
-- ============================================================
-- group_join_requested/approved/denied were all mapped to
-- borrower_reminders, so turning off borrow reminders silently stopped group
-- decisions too. The Edge Function's TYPE_TO_PREFERENCE is updated alongside.

alter table notification_preferences
  add column if not exists group_activity boolean not null default true;

-- ============================================================
-- LOGIC-8 data fix
-- ============================================================
-- Live data already carries the leak: at audit time `Rock'n Tool Chest` and
-- the chest `Jim B.` had byte-identical approx coordinates. Recompute every
-- group; any group without enough approved members simply loses its pin.

do $$
declare r record;
begin
  for r in select id from groups loop
    perform refresh_group_pin(r.id);
  end loop;
end;
$$;
