-- Loan durations, plus a correction to what delete_tool() refuses.
--
-- 1. DELETING A TOOL
--    0023 blocked deletion while any pending *or* approved request existed.
--    That was too strict: a pending request is just an unanswered question,
--    and an owner should be able to retire a listing without first denying
--    everyone who happened to ask. What must not be deletable is a tool that
--    is physically out with someone -- an approved request -- because that
--    row is the only record either side has that the tool is gone.
--    Pending requesters are notified before the cascade removes their rows.
--
--    That notification carries the tool's *name*, unlike every other
--    notification in this app, which deliberately carries only ids and
--    generic copy (see src/lib/notifications.js). This is the one case where
--    the referenced row is about to stop existing, so an id would resolve to
--    nothing by the time anyone read it.
--
-- 2. LOAN DURATIONS
--    A borrower says how long they want a tool, the owner accepts or adjusts
--    that at approval, and the resulting due date is what "on lend until X"
--    reads from. An owner can also set a default period on the listing, which
--    is what the borrower's request is pre-filled with.
--
--    tools.due_at is a denormalized display cache, exactly like tools.status
--    already is: both are recomputed from borrow_requests by the same
--    refresh_tool_state() helper below, in the same places, so they cannot
--    drift apart from each other. borrow_requests.due_at remains the
--    authoritative per-loan value.
--
--    refresh_tool_state() also replaces three copy-pasted recompute blocks in
--    deny_borrow_request / resolve_malfunction / complete_borrow_request.
--
-- NOTE ON RE-RUNNING: this migration DROPs the old request_borrow(uuid,
-- boolean) and approve_borrow_request(uuid) signatures to replace them with
-- ones that take an extra defaulted argument. Do not re-run 0014 or 0023
-- after this file -- their REVOKE/GRANT statements name the old signatures
-- and will error. This file itself is safely re-runnable from the top.

-- ============================================================
-- Columns
-- ============================================================

alter table tools add column if not exists default_loan_days integer;
alter table tools add column if not exists due_at timestamptz;

grant select (default_loan_days, due_at) on tools to anon, authenticated;

alter table borrow_requests add column if not exists requested_days integer;
alter table borrow_requests add column if not exists due_at timestamptz;

-- Reject nonsense durations at the database, not just in the form.
alter table tools drop constraint if exists tools_default_loan_days_sane;
alter table tools add constraint tools_default_loan_days_sane
  check (default_loan_days is null or (default_loan_days >= 1 and default_loan_days <= 365));

alter table borrow_requests drop constraint if exists borrow_requests_requested_days_sane;
alter table borrow_requests add constraint borrow_requests_requested_days_sane
  check (requested_days is null or (requested_days >= 1 and requested_days <= 365));

-- ============================================================
-- Shared recompute: tools.status + tools.due_at from borrow_requests
-- ============================================================

create or replace function refresh_tool_state(p_tool_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update tools set
    status = case
      when exists (select 1 from borrow_requests where tool_id = p_tool_id and status = 'approved') then 'borrowed'
      when exists (select 1 from borrow_requests where tool_id = p_tool_id and status = 'pending') then 'requested'
      else 'available'
    end,
    -- Latest due date among live loans; NULL once nothing is out, which is
    -- what clears "on lend until" from the card.
    due_at = (
      select max(br.due_at) from borrow_requests br
      where br.tool_id = p_tool_id and br.status = 'approved'
    ),
    updated_at = now()
  where id = p_tool_id;
end;
$$;

-- Internal helper only -- never called straight from the client.
revoke execute on function refresh_tool_state(uuid) from public;

-- ============================================================
-- request_borrow: borrower proposes a duration
-- ============================================================
-- Signature gains p_days. The old 2-arg version is dropped rather than left
-- as an overload, so PostgREST cannot resolve a call to a version that
-- ignores the duration.

drop function if exists request_borrow(uuid, boolean);

create or replace function request_borrow(
  p_tool_id uuid,
  p_wants_instruction boolean default false,
  p_days integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  if v_tool_status != 'available' then
    raise exception 'This tool is not currently available';
  end if;

  -- Borrower's ask, else the owner's listed default, else a one-week
  -- fallback so a loan always has an end date to show and chase.
  v_days := coalesce(p_days, v_default_days, 7);
  if v_days < 1 or v_days > 365 then
    raise exception 'A borrow has to be between 1 and 365 days';
  end if;

  select auto_approve_vetted_borrowers into v_auto_approve from profiles where id = v_lender_id;

  -- vetted = shares an approved group with the lender, or has a payment method on file
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

  begin
    insert into borrow_requests (
      tool_id, borrower_id, lender_id, status, wants_instruction, auto_approved,
      requested_days, decided_at, pickup_location_revealed_at, due_at
    )
    values (
      p_tool_id, auth.uid(), v_lender_id, v_status, p_wants_instruction, v_auto_approved,
      v_days,
      case when v_status = 'approved' then now() else null end,
      case when v_status = 'approved' then now() else null end,
      -- Only an approved (auto-approved) request has a real due date; a
      -- pending one gets its clock started when the owner approves.
      case when v_status = 'approved' then now() + make_interval(days => v_days) else null end
    )
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'You already have a pending request for this tool';
  end;

  perform refresh_tool_state(p_tool_id);
  -- refresh_tool_state resolves 'pending' to 'requested' on its own, so the
  -- explicit status writes the old version carried are no longer needed.

  insert into notifications (profile_id, type, payload)
  values (v_lender_id, 'borrow_requested', jsonb_build_object(
    'request_id', v_request_id, 'tool_id', p_tool_id,
    'auto_approved', v_auto_approved, 'days', v_days
  ));

  return v_request_id;
end;
$$;

revoke execute on function request_borrow(uuid, boolean, integer) from public;
grant execute on function request_borrow(uuid, boolean, integer) to authenticated;

-- ============================================================
-- approve_borrow_request: owner accepts or adjusts the duration
-- ============================================================

drop function if exists approve_borrow_request(uuid);

create or replace function approve_borrow_request(p_request_id uuid, p_days integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status borrow_request_status;
  v_tool_id uuid;
  v_lender_id uuid;
  v_borrower_id uuid;
  v_requested_days integer;
  v_default_days integer;
  v_days integer;
  v_due_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select status, tool_id, lender_id, borrower_id, requested_days
    into v_status, v_tool_id, v_lender_id, v_borrower_id, v_requested_days
  from borrow_requests where id = p_request_id;

  if v_lender_id is null then
    raise exception 'Request not found';
  end if;
  if v_lender_id != auth.uid() then
    raise exception 'Only the lender can approve this request';
  end if;
  if v_status != 'pending' then
    raise exception 'Request is no longer pending';
  end if;

  select default_loan_days into v_default_days from tools where id = v_tool_id;

  -- Owner's adjustment wins over the borrower's ask.
  v_days := coalesce(p_days, v_requested_days, v_default_days, 7);
  if v_days < 1 or v_days > 365 then
    raise exception 'A borrow has to be between 1 and 365 days';
  end if;
  v_due_at := now() + make_interval(days => v_days);

  update borrow_requests
  set status = 'approved',
      decided_at = now(),
      pickup_location_revealed_at = now(),
      requested_days = v_days,
      due_at = v_due_at
  where id = p_request_id;

  perform refresh_tool_state(v_tool_id);

  insert into notifications (profile_id, type, payload)
  values (v_borrower_id, 'borrow_approved', jsonb_build_object(
    'request_id', p_request_id, 'tool_id', v_tool_id,
    'due_at', v_due_at, 'days', v_days
  ));
end;
$$;

revoke execute on function approve_borrow_request(uuid, integer) from public;
grant execute on function approve_borrow_request(uuid, integer) to authenticated;

-- ============================================================
-- deny / resolve / complete: use the shared recompute
-- ============================================================

create or replace function deny_borrow_request(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status borrow_request_status;
  v_tool_id uuid;
  v_lender_id uuid;
  v_borrower_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select status, tool_id, lender_id, borrower_id into v_status, v_tool_id, v_lender_id, v_borrower_id
  from borrow_requests where id = p_request_id;

  if v_lender_id is null then
    raise exception 'Request not found';
  end if;
  if v_lender_id != auth.uid() then
    raise exception 'Only the lender can deny this request';
  end if;
  if v_status != 'pending' then
    raise exception 'Request is no longer pending';
  end if;

  update borrow_requests
  set status = 'denied', decided_at = now(), denial_reason = nullif(trim(p_reason), '')
  where id = p_request_id;

  perform refresh_tool_state(v_tool_id);

  insert into notifications (profile_id, type, payload)
  values (
    v_borrower_id,
    'borrow_denied',
    jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id, 'reason', nullif(trim(p_reason), ''))
  );
end;
$$;

create or replace function resolve_malfunction(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool_id uuid;
  v_owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select tool_id into v_tool_id from tool_malfunction_reports where id = p_report_id;
  if v_tool_id is null then
    raise exception 'Report not found';
  end if;

  select chest_id into v_owner_id from tools where id = v_tool_id;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can resolve this report';
  end if;

  update tool_malfunction_reports set resolved_at = now() where id = p_report_id;

  perform refresh_tool_state(v_tool_id);
end;
$$;

create or replace function complete_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status borrow_request_status;
  v_tool_id uuid;
  v_lender_id uuid;
  v_borrower_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select status, tool_id, lender_id, borrower_id into v_status, v_tool_id, v_lender_id, v_borrower_id
  from borrow_requests where id = p_request_id;

  if v_tool_id is null then
    raise exception 'Request not found';
  end if;
  if auth.uid() != v_lender_id and auth.uid() != v_borrower_id then
    raise exception 'Not a party to this request';
  end if;
  if v_status != 'approved' then
    raise exception 'Only an approved request can be marked returned';
  end if;

  update borrow_requests set status = 'completed' where id = p_request_id;

  perform refresh_tool_state(v_tool_id);

  insert into notifications (profile_id, type, payload)
  values (
    case when auth.uid() = v_lender_id then v_borrower_id else v_lender_id end,
    'borrow_completed',
    jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id)
  );
end;
$$;

-- ============================================================
-- delete_tool: refuse only while the tool is actually out
-- ============================================================

create or replace function delete_tool(p_tool_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_name text;
  v_photos text[];
  v_on_loan integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select chest_id, name, photos into v_owner_id, v_name, v_photos from tools where id = p_tool_id;
  if v_owner_id is null then
    raise exception 'Tool not found';
  end if;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can delete this listing';
  end if;

  select count(*) into v_on_loan
  from borrow_requests
  where tool_id = p_tool_id and status = 'approved';

  if v_on_loan > 0 then
    raise exception 'This tool is out on loan. Mark it returned before deleting it.';
  end if;

  -- Tell anyone still waiting on an answer, before the cascade takes their
  -- request row with the tool. Carries the name because the tool id is about
  -- to point at nothing.
  insert into notifications (profile_id, type, payload)
  select br.borrower_id, 'borrow_tool_removed',
         jsonb_build_object('tool_name', v_name)
  from borrow_requests br
  where br.tool_id = p_tool_id and br.status = 'pending';

  delete from tools where id = p_tool_id;

  return coalesce(v_photos, array[]::text[]);
end;
$$;

revoke execute on function delete_tool(uuid) from public;
grant execute on function delete_tool(uuid) to authenticated;

-- Backfill: every already-approved loan predates requested_days/due_at, so
-- give them the fallback window from when they were decided rather than
-- leaving live loans with no end date at all.
update borrow_requests
set requested_days = coalesce(requested_days, 7),
    due_at = coalesce(due_at, coalesce(decided_at, requested_at) + interval '7 days')
where status = 'approved' and due_at is null;

update tools t set due_at = (
  select max(br.due_at) from borrow_requests br
  where br.tool_id = t.id and br.status = 'approved'
)
where t.due_at is null;
