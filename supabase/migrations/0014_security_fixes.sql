-- Closes out the "before anything else ships to real users" bucket from
-- docs/audit-2026-08-20.md: SEC-2 (invite-code exposure), SEC-3 (RPC surface
-- callable by anon + join_group notification spam), LOGIC-1 (no return
-- flow -- an approved request reveals the pickup location forever),
-- LOGIC-2 (request_borrow has no tool-status guard or dedupe), LOGIC-3
-- (deny_borrow_request / resolve_malfunction assign tool status blindly),
-- LOGIC-4 (approve_borrow_request doesn't check the current status, and the
-- "row not found" NULL-comparison bypass -- distinct from the auth.uid()-is-
-- null one 0010 already fixed -- is still present in four functions).
--
-- PRIV-1, PRIV-2 and DOS-1 (the other three items in that bucket) are
-- already fixed, in 0009_critical_audit_fixes.sql and
-- 0010_fix_anon_bypass_in_owner_lender_checks.sql. SEC-1's remaining half
-- (moving the notify trigger's token into Vault) and SEC-4 (a shared secret
-- for the notify Edge Function) both need dashboard/Vault setup beyond a
-- plain SQL migration -- flagged to the user, not built here.
--
-- Safe to paste and re-run the whole file from the top: every CREATE here
-- is either CREATE OR REPLACE FUNCTION or CREATE ... IF NOT EXISTS, and the
-- REVOKE/GRANT statements are naturally idempotent. (A first attempt hit a
-- plain, non-idempotent CREATE INDEX partway through and errored there --
-- Supabase's SQL editor commits each statement as it runs rather than
-- wrapping the whole paste in one transaction, so everything before that
-- point had already landed. Fixed here so a retry from the top just works.)

-- ============================================================
-- LOGIC-4 (part 2) — four functions select a row by id with no existence
-- check, so a nonexistent id leaves the ownership variable NULL and
-- `v_owner != auth.uid()` evaluates to NULL, not true, which PL/pgSQL's IF
-- treats as false -- the same fall-through shape as the auth.uid()-is-null
-- bug 0010 fixed, but triggered by a bad id instead of a missing session.
-- Fixed here alongside LOGIC-4's actual subject (approve_borrow_request
-- re-approving an already-decided request) since it's the same function
-- family and the fix is one line each.
-- ============================================================

create or replace function approve_borrow_request(p_request_id uuid)
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
    raise exception 'Only the lender can approve this request';
  end if;

  if v_status != 'pending' then
    raise exception 'Request is no longer pending';
  end if;

  update borrow_requests
  set status = 'approved', decided_at = now(), pickup_location_revealed_at = now()
  where id = p_request_id;

  update tools set status = 'borrowed', updated_at = now() where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_borrower_id, 'borrow_approved', jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id));
end;
$$;

-- ============================================================
-- LOGIC-3 — deny_borrow_request unconditionally set the tool to 'available',
-- which is wrong the moment a second pending request exists on the same
-- tool (denying B after approving A would mark the tool available while A
-- still holds it). Recompute from the request set instead of assigning
-- blindly. Current signature is deny_borrow_request(uuid, text) --
-- 0011_borrow_denial_reason.sql added the optional reason param.
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

  update tools set status = case
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'approved') then 'borrowed'
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'pending') then 'requested'
    else 'available'
  end, updated_at = now()
  where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (
    v_borrower_id,
    'borrow_denied',
    jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id, 'reason', nullif(trim(p_reason), ''))
  );
end;
$$;

-- Same unconditional-write bug, same fix shape, plus the row-not-found guard.
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

  select crib_id into v_owner_id from tools where id = v_tool_id;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can resolve this report';
  end if;

  update tool_malfunction_reports set resolved_at = now() where id = p_report_id;

  update tools set status = case
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'approved') then 'borrowed'
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'pending') then 'requested'
    else 'available'
  end, updated_at = now()
  where id = v_tool_id;
end;
$$;

-- Row-not-found guard only -- set_borrower_supervision has no blind-status-write bug.
create or replace function set_borrower_supervision(p_tool_id uuid, p_borrower_id uuid, p_supervision_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select crib_id into v_owner_id from tools where id = p_tool_id;
  if v_owner_id is null then
    raise exception 'Tool not found';
  end if;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can set supervision requirements';
  end if;

  insert into tool_authorizations (tool_id, borrower_id, supervision_required, updated_by)
  values (p_tool_id, p_borrower_id, p_supervision_required, auth.uid())
  on conflict (tool_id, borrower_id)
  do update set supervision_required = excluded.supervision_required, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- ============================================================
-- LOGIC-2 — request_borrow() never checked the tool was actually available,
-- and could fire N pending requests for the same (tool, borrower). The UI
-- already blocks both at ToolDetail.jsx, but the RPC is directly callable.
-- The unconditional `update tools set status = 'requested'` could also drag
-- an already-borrowed or malfunctioning tool back to 'requested'.
-- ============================================================

create unique index if not exists borrow_requests_one_pending_per_borrower
  on borrow_requests (tool_id, borrower_id)
  where status = 'pending';

create or replace function request_borrow(p_tool_id uuid, p_wants_instruction boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lender_id uuid;
  v_tool_status tool_status;
  v_auto_approve boolean;
  v_vetted boolean;
  v_status borrow_request_status := 'pending';
  v_auto_approved boolean := false;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select crib_id, status into v_lender_id, v_tool_status from tools where id = p_tool_id;
  if v_lender_id is null then
    raise exception 'Tool not found';
  end if;
  if v_lender_id = auth.uid() then
    raise exception 'Cannot request your own tool';
  end if;
  if v_tool_status != 'available' then
    raise exception 'This tool is not currently available';
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
    insert into borrow_requests (tool_id, borrower_id, lender_id, status, wants_instruction, auto_approved, decided_at, pickup_location_revealed_at)
    values (
      p_tool_id, auth.uid(), v_lender_id, v_status, p_wants_instruction, v_auto_approved,
      case when v_status = 'approved' then now() else null end,
      case when v_status = 'approved' then now() else null end
    )
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'You already have a pending request for this tool';
  end;

  if v_status = 'approved' then
    update tools set status = 'borrowed', updated_at = now() where id = p_tool_id;
  else
    update tools set status = 'requested', updated_at = now() where id = p_tool_id;
  end if;

  insert into notifications (profile_id, type, payload)
  values (v_lender_id, 'borrow_requested', jsonb_build_object('request_id', v_request_id, 'tool_id', p_tool_id, 'auto_approved', v_auto_approved));

  return v_request_id;
end;
$$;

-- ============================================================
-- LOGIC-1 — nothing ever moved a request to 'completed' or a tool back to
-- 'available' after a real return, so get_pickup_location() kept revealing
-- the address forever once a request was approved. Adds the return/complete
-- flow the audit calls "the single biggest gap between the schema and the
-- stated privacy model", plus a 30-day expiry on the reveal as recommended
-- defense-in-depth for a borrow nobody ever marks returned.
-- ============================================================

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

  update tools set status = case
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'approved') then 'borrowed'
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'pending') then 'requested'
    else 'available'
  end, updated_at = now()
  where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (
    case when auth.uid() = v_lender_id then v_borrower_id else v_lender_id end,
    'borrow_completed',
    jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id)
  );
end;
$$;

create or replace function get_pickup_location(p_tool_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location text;
  v_owner_id uuid;
begin
  select crib_id, pickup_location into v_owner_id, v_location from tools where id = p_tool_id;

  if v_owner_id = auth.uid() then
    return v_location;
  end if;

  if not exists (
    select 1 from borrow_requests
    where tool_id = p_tool_id
      and borrower_id = auth.uid()
      and status = 'approved'
      and decided_at > now() - interval '30 days'
  ) then
    raise exception 'No approved request for this tool';
  end if;

  return v_location;
end;
$$;

-- ============================================================
-- SEC-2 — groups.invite_code and groups.default_exchange_location (a real-
-- world physical meeting spot) were world-readable via `select *` on groups,
-- with no column grant restricting them -- confirmed live with the anon key
-- and no session at all. Neither conferred any actual access control.
--
-- Fix keeps two genuinely different join paths distinct instead of
-- collapsing them: request_to_join_group(group_id) is the path Find a Group
-- already uses (a group discovered via public search/proximity, no code
-- involved) and join_group(invite_code) stays for someone who was handed a
-- code out of band. Only the second one needs the code to be readable by
-- its holder -- and even then, only the group's own admin/approved members
-- can read it back through get_group_invite_details(), same "readable only
-- via a checked RPC" shape as pickup_location.
-- ============================================================

revoke select on groups from anon, authenticated;
grant select (id, name, neighborhood_label, city, zip_code, admin_id, approx_lat, approx_lng, created_at)
  on groups to anon, authenticated;
-- invite_code and default_exchange_location intentionally NOT granted.

create or replace function request_to_join_group(p_group_id uuid)
returns uuid
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

  insert into group_memberships (group_id, profile_id, status)
  values (p_group_id, auth.uid(), 'pending')
  on conflict (group_id, profile_id) do nothing
  returning id into v_membership_id;

  -- SEC-3: only notify when a row was actually created, not on a repeat call
  -- (or a call against a membership that's already pending/approved/denied).
  if v_membership_id is not null then
    insert into notifications (profile_id, type, payload)
    values (v_admin_id, 'group_join_requested', jsonb_build_object('group_id', p_group_id, 'profile_id', auth.uid()));
  end if;

  return v_membership_id;
end;
$$;

create or replace function get_group_invite_details(p_group_id uuid)
returns table (invite_code text, default_exchange_location text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  if not exists (
    select 1 from groups g where g.id = p_group_id and g.admin_id = auth.uid()
  ) and not exists (
    select 1 from group_memberships gm
    where gm.group_id = p_group_id and gm.profile_id = auth.uid() and gm.status = 'approved'
  ) then
    raise exception 'Only an approved member can view this';
  end if;

  return query select g.invite_code, g.default_exchange_location from groups g where g.id = p_group_id;
end;
$$;

-- ============================================================
-- SEC-3 — join_group(text) is EXECUTE-granted to PUBLIC by Postgres default,
-- so it's callable by `anon` with no session at all. Confirmed live: an anon
-- call returns a distinct error for "no such code" vs. "valid code, but no
-- profile row" -- a free code-validity oracle that also leaks a generated
-- membership uuid and the group id in the error detail. Separately, it
-- notified on every call regardless of whether `on conflict do nothing`
-- fired, so a user could flood a group admin's inbox by calling it in a
-- loop, including re-notifying for a membership that was already denied.
-- ============================================================

create or replace function join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_admin_id uuid;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select id, admin_id into v_group_id, v_admin_id from groups where invite_code = p_invite_code;
  if v_group_id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into group_memberships (group_id, profile_id, status)
  values (v_group_id, auth.uid(), 'pending')
  on conflict (group_id, profile_id) do nothing
  returning id into v_membership_id;

  if v_membership_id is not null then
    insert into notifications (profile_id, type, payload)
    values (v_admin_id, 'group_join_requested', jsonb_build_object('group_id', v_group_id, 'profile_id', auth.uid()));
  end if;

  return v_membership_id;
end;
$$;

-- Lock down the whole client-callable RPC surface to authenticated only.
-- Postgres grants EXECUTE to PUBLIC (which includes anon) by default; every
-- one of these was reachable by a fully anonymous caller until now, on top
-- of whatever auth.uid()-is-null guard each function has individually.
revoke execute on function
  get_pickup_location(uuid),
  request_borrow(uuid, boolean),
  approve_borrow_request(uuid),
  deny_borrow_request(uuid, text),
  complete_borrow_request(uuid),
  report_malfunction(uuid, text),
  resolve_malfunction(uuid),
  set_borrower_supervision(uuid, uuid, boolean),
  join_group(text),
  request_to_join_group(uuid),
  decide_group_membership(uuid, boolean),
  get_group_invite_details(uuid),
  get_my_contact_info(),
  get_borrow_contact(uuid)
from public;

grant execute on function
  get_pickup_location(uuid),
  request_borrow(uuid, boolean),
  approve_borrow_request(uuid),
  deny_borrow_request(uuid, text),
  complete_borrow_request(uuid),
  report_malfunction(uuid, text),
  resolve_malfunction(uuid),
  set_borrower_supervision(uuid, uuid, boolean),
  join_group(text),
  request_to_join_group(uuid),
  decide_group_membership(uuid, boolean),
  get_group_invite_details(uuid),
  get_my_contact_info(),
  get_borrow_contact(uuid)
to authenticated;
