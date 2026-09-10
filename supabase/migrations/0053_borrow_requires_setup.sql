-- ============================================================
-- 0053 — a borrow request requires a finished profile
-- ============================================================
-- request_borrow checked that you were signed in, that the tool existed and
-- was available, and that the duration and message were sane. It did not
-- check that the person asking had ever completed onboarding.
--
-- The gate was entirely in the browser: ToolDetail renders "Finish Setup to
-- Request" and RequireAuth sends an incomplete profile to /onboarding. Both
-- are prompts. The RPC is callable directly by anyone holding the publishable
-- key, which is public by design, so the rule did not exist anywhere it could
-- be relied on.
--
-- Checks the address as well as the flag. profile_complete is the app's own
-- notion of "finished", but the question worth answering is the concrete one:
-- has this person given an address at all. Onboarding writes both together,
-- so requiring both costs nothing and stops the flag alone from being the
-- whole guarantee.
--
-- Otherwise identical to 0043's version.

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
  if not exists (
    select 1 from profiles
    where id = auth.uid()
      and profile_complete
      and home_lat is not null
      and home_lng is not null
  ) then
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
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'request_borrow') <> 1 then
    raise exception 'request_borrow is overloaded -- an older signature survived';
  end if;

  if has_function_privilege('anon', 'request_borrow(uuid, boolean, integer, text)', 'EXECUTE') then
    raise exception 'request_borrow must not be callable by anon';
  end if;
end;
$chk$;
