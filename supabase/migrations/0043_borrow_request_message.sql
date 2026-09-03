-- A borrower can say why they want the tool.
--
-- An owner deciding on a request from someone they have never met sees a
-- display name -- which need not be a real name -- and nothing else. That is
-- very little to go on, and the honest consequence is that owners either
-- decline strangers or accept on no information at all.
--
-- The cheapest thing that helps is letting the borrower speak first. "Putting
-- up a shelf on Saturday, I'll have it back Sunday" is worth more than any
-- badge, and it costs the app nothing to carry.
--
-- Optional on purpose. Requiring it would turn a two-tap action into a writing
-- task and quietly stop people asking at all.
--
-- Safe to paste and re-run from the top.

alter table borrow_requests
  add column if not exists message text;

comment on column borrow_requests.message is
  'The borrower''s optional note to the owner, written when they asked. Not editable afterwards -- a message the owner already read should not change under them.';

-- 0035 revoked table-level SELECT on borrow_requests and granted an explicit
-- column list, so a new column is unreadable until it is named here.
grant select (message) on borrow_requests to authenticated;

-- ============================================================
-- request_borrow -- carry the message
-- ============================================================
-- The old three-argument version is dropped rather than left alongside. Adding
-- a defaulted fourth parameter while it still existed would make every
-- three-argument call ambiguous -- which is exactly the trap
-- deny_borrow_request fell into (see 0040), discovered only when the pgTAP
-- suite finally ran.

drop function if exists request_borrow(uuid, boolean, integer);

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

revoke execute on function request_borrow(uuid, boolean, integer, text) from public;
grant execute on function request_borrow(uuid, boolean, integer, text) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not has_column_privilege('authenticated', 'borrow_requests', 'message', 'select') then
    raise exception 'borrow_requests.message is not readable -- the owner could not see it';
  end if;
  -- The ambiguity guard. Two overloads would make a three-argument call fail
  -- with "function request_borrow(...) is not unique".
  if (select count(*) from pg_proc where proname = 'request_borrow') <> 1 then
    raise exception 'request_borrow has more than one overload';
  end if;
end;
$chk$;
