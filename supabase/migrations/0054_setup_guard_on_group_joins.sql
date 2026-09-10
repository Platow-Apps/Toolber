-- ============================================================
-- 0054 — one setup rule, three doors
-- ============================================================
-- 0053 closed the borrow door and left the two group doors open. join_group
-- and request_to_join_group check that you are signed in and nothing else, so
-- somebody who stopped halfway through onboarding can still join a
-- neighborhood group.
--
-- Lower stakes than borrowing: joining discloses nothing, and the no-code
-- path waits for an admin anyway. But a group is the trust signal lenders are
-- told to judge by -- "you are both in Oak Hill" is supposed to mean someone
-- vouched for them -- and it means less if the person it describes never
-- finished setting up. Consistency here is the point: a rule enforced on one
-- of three entrances is a rule people learn to route around.
--
-- The predicate moves into a function rather than being copied a third time.
-- Three inline copies of a security check is precisely the thing that drifts:
-- one gets a condition added and the others quietly do not.

create or replace function profile_is_set_up(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- The address as well as the flag. Onboarding writes both together, so
  -- requiring both costs nothing and stops profile_complete from being the
  -- whole guarantee on its own.
  select exists (
    select 1 from profiles
    where id = p_profile_id
      and profile_complete
      and home_lat is not null
      and home_lng is not null
  );
$$;

-- Internal. It reads home_lat, which is granted to nobody, and every caller
-- is a SECURITY DEFINER function running as the owner -- so no client role
-- needs to reach it, and none should.
revoke execute on function profile_is_set_up(uuid) from public, anon, authenticated;

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

  if not profile_is_set_up(auth.uid()) then
    raise exception 'Finish setting up your profile before joining a group';
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

  if not profile_is_set_up(auth.uid()) then
    raise exception 'Finish setting up your profile before joining a group';
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


revoke execute on function join_group(text) from public, anon;
grant execute on function join_group(text) to authenticated;
revoke execute on function request_to_join_group(uuid) from public, anon;
grant execute on function request_to_join_group(uuid) to authenticated;

-- ============================================================
-- request_borrow uses the same predicate
-- ============================================================
-- 0053 inlined it. Replacing only the body's first lines is not possible in
-- SQL, so this re-creates the function to point at the helper -- otherwise
-- the copy 0053 left behind is the one that drifts.

create or replace function request_borrow(
  p_tool_id uuid,
  p_wants_instruction boolean default false,
  p_days integer default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lender_id uuid;
  v_tool_status tool_status;
  v_paused boolean;
  v_default_days integer;
  v_days integer;
  v_auto_approve boolean;
  v_vetted boolean;
  v_status borrow_request_status := 'pending';
  v_auto_approved boolean := false;
  v_request_id uuid;
  v_message text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  -- Setup has to be finished before anyone can ask to borrow. This was
  -- enforced only in the browser -- ToolDetail offers "Finish Setup to
  -- Request" and RequireAuth redirects -- which is a prompt, not a rule: the
  -- RPC is callable directly by anyone holding the publishable key, and that
  -- key is public by design.
  --
  -- Nothing is disclosed by a bare request, so this is accountability rather
  -- than containment. Since 0050 every member confirms a home address is
  -- theirs, and lenders are told shared groups and a written note are what
  -- they have to judge by; a requester who attested to nothing undercuts
  -- both, and the app said so without meaning it.
  if not profile_is_set_up(auth.uid()) then
    raise exception 'Finish setting up your profile before requesting a tool';
  end if;

  select chest_id, status, paused, default_loan_days
    into v_lender_id, v_tool_status, v_paused, v_default_days
  from tools where id = p_tool_id;

  if v_lender_id is null then
    raise exception 'Tool not found';
  end if;
  if v_lender_id = auth.uid() then
    raise exception 'Cannot request your own tool';
  end if;
  if v_paused then
    raise exception 'This tool is not currently available';
  end if;
  if v_tool_status <> 'available' then
    raise exception 'This tool is not currently available';
  end if;

  v_days := coalesce(p_days, v_default_days, 7);
  if v_days < 1 or v_days > 365 then
    raise exception 'A borrow has to be between 1 and 365 days';
  end if;

  -- Long enough to explain yourself, short enough not to be an essay the
  -- owner will not read. Trimmed to null so an empty box is not stored as a
  -- message that was never written.
  v_message := nullif(trim(coalesce(p_message, '')), '');
  if length(v_message) > 500 then
    raise exception 'Keep the message under 500 characters';
  end if;

  select auto_approve_vetted_borrowers into v_auto_approve
  from profiles where id = v_lender_id;

  select exists (
    select 1
    from group_memberships gm1
    join group_memberships gm2 on gm1.group_id = gm2.group_id
    where gm1.profile_id = auth.uid() and gm1.status = 'approved'
      and gm2.profile_id = v_lender_id and gm2.status = 'approved'
  ) or exists (
    select 1 from profiles where id = auth.uid() and has_payment_method_on_file
  ) into v_vetted;

  if v_vetted and coalesce(v_auto_approve, false) then
    v_status := 'approved';
    v_auto_approved := true;
  end if;

  -- The exception block is load-bearing: a partial unique index stops one
  -- person stacking pending requests on the same tool, and without this the
  -- owner would see a raw constraint violation instead of a sentence.
  begin
    insert into borrow_requests (
      tool_id, borrower_id, lender_id, status, wants_instruction, auto_approved,
      requested_days, decided_at, due_at, message
    )
    values (
      p_tool_id, auth.uid(), v_lender_id, v_status, p_wants_instruction, v_auto_approved,
      v_days,
      case when v_status = 'approved' then now() else null end,
      -- Only an approved (auto-approved) request has a real due date; a
      -- pending one gets its clock started when the owner approves.
      case when v_status = 'approved' then now() + make_interval(days => v_days) else null end,
      v_message
    )
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'You already have a pending request for this tool';
  end;

  perform refresh_tool_state(p_tool_id);

  insert into notifications (profile_id, type, payload)
  values (v_lender_id, 'borrow_requested', jsonb_build_object(
    'request_id', v_request_id, 'tool_id', p_tool_id,
    'auto_approved', v_auto_approved, 'days', v_days
  ));

  return v_request_id;
end;
$fn$;

revoke execute on function request_borrow(uuid, boolean, integer, text) from public, anon;
grant execute on function request_borrow(uuid, boolean, integer, text) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if has_function_privilege('authenticated', 'profile_is_set_up(uuid)', 'EXECUTE') then
    raise exception 'profile_is_set_up is internal -- no client role should hold EXECUTE';
  end if;

  -- All three doors, since this migration touched all three and the anon
  -- default is to grant EXECUTE (0046).
  if has_function_privilege('anon', 'join_group(text)', 'EXECUTE')
     or has_function_privilege('anon', 'request_to_join_group(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'request_borrow(uuid, boolean, integer, text)', 'EXECUTE') then
    raise exception 'a join or borrow entry point is callable by anon';
  end if;
end;
$chk$;
