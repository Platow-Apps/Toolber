-- `IF x != auth.uid() THEN raise exception` is silently skipped for a fully
-- anonymous caller (no session at all): auth.uid() is NULL, `anything !=
-- NULL` evaluates to SQL NULL rather than true, and PL/pgSQL treats a NULL
-- condition in IF as false. Found while verifying 0009's report_malfunction
-- fix (which had the same shape); confirmed by SQL/PL-pgSQL semantics, not
-- by testing against real data. The same pattern turned out to already
-- exist in four functions from the original schema (0001_init.sql).
--
-- Real-world exploitability varies: approve/deny_borrow_request and
-- resolve_malfunction need a request/report UUID that isn't exposed to
-- anonymous users anywhere in the app (borrow_requests/tool_malfunction_
-- reports are only ever readable by their own borrower/lender/owner), so
-- guessing one is infeasible. set_borrower_supervision needs a tool_id,
-- which *is* public (tools are search-public), plus a real borrower_id.
-- Fixing all four the same way regardless, since the fix is trivial and
-- leaving a known instance of the same bug unpatched isn't defensible.
--
-- Fix: an explicit `auth.uid() is null` guard up front, which is an
-- unambiguous true/false and can't fall through the same way.

create or replace function approve_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool_id uuid;
  v_lender_id uuid;
  v_borrower_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select tool_id, lender_id, borrower_id into v_tool_id, v_lender_id, v_borrower_id
  from borrow_requests where id = p_request_id;

  if v_lender_id != auth.uid() then
    raise exception 'Only the lender can approve this request';
  end if;

  update borrow_requests
  set status = 'approved', decided_at = now(), pickup_location_revealed_at = now()
  where id = p_request_id;

  update tools set status = 'borrowed', updated_at = now() where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_borrower_id, 'borrow_approved', jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id));
end;
$$;

create or replace function deny_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool_id uuid;
  v_lender_id uuid;
  v_borrower_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select tool_id, lender_id, borrower_id into v_tool_id, v_lender_id, v_borrower_id
  from borrow_requests where id = p_request_id;

  if v_lender_id != auth.uid() then
    raise exception 'Only the lender can deny this request';
  end if;

  update borrow_requests set status = 'denied', decided_at = now() where id = p_request_id;
  update tools set status = 'available', updated_at = now() where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_borrower_id, 'borrow_denied', jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id));
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
  select crib_id into v_owner_id from tools where id = v_tool_id;

  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can resolve this report';
  end if;

  update tool_malfunction_reports set resolved_at = now() where id = p_report_id;
  update tools set status = 'available', updated_at = now() where id = v_tool_id;
end;
$$;

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
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can set supervision requirements';
  end if;

  insert into tool_authorizations (tool_id, borrower_id, supervision_required, updated_by)
  values (p_tool_id, p_borrower_id, p_supervision_required, auth.uid())
  on conflict (tool_id, borrower_id)
  do update set supervision_required = excluded.supervision_required, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- report_malfunction's own fix, same shape -- see 0009_critical_audit_fixes.sql
-- for the DOS-1 authorization check this sits alongside.
create or replace function report_malfunction(p_tool_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to report a malfunction';
  end if;

  select crib_id into v_owner_id from tools where id = p_tool_id;

  if v_owner_id is null then
    raise exception 'Tool not found';
  end if;

  if v_owner_id != auth.uid() and not exists (
    select 1 from borrow_requests
    where tool_id = p_tool_id and borrower_id = auth.uid()
      and status in ('approved', 'completed')
  ) then
    raise exception 'Only the owner or a past borrower can report this tool';
  end if;

  insert into tool_malfunction_reports (tool_id, reported_by, note)
  values (p_tool_id, auth.uid(), p_note)
  returning id into v_report_id;

  update tools set status = 'unavailable_malfunction', updated_at = now() where id = p_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_owner_id, 'tool_malfunctioning', jsonb_build_object('tool_id', p_tool_id, 'report_id', v_report_id));

  return v_report_id;
end;
$$;
