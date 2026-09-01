-- Pickup becomes a handshake instead of an automatic reveal.
--
-- Approving a request used to disclose the pickup location in the same
-- instant, and the app then told the borrower to "open a chat" to sort out
-- the details. That is backwards twice over. It hands over an address before
-- anyone has agreed to actually meet, and it leaves the one thing the two
-- people need to settle -- where and when -- to a free-text conversation.
--
-- The flow is now:
--
--   1. Lender approves the request. Nothing is disclosed yet.
--   2. Borrower asks for pickup when they are ready to collect.
--   3. Lender answers, choosing either the tool's own pickup address or a
--      one-off spot for this borrower ("the coffee shop on Main").
--   4. Only then does the address reach the borrower.
--
-- Step 3 is why the per-request location exists. A lender happy to lend but
-- not happy to hand out their home address can now say so per borrower,
-- without editing the listing.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- Columns
-- ============================================================

alter table borrow_requests
  add column if not exists pickup_requested_at timestamptz,
  add column if not exists pickup_released_at  timestamptz,
  add column if not exists pickup_location     text;

comment on column borrow_requests.pickup_requested_at is
  'When the borrower asked to collect. Null until they do.';
comment on column borrow_requests.pickup_released_at is
  'When the lender answered with a location. Null gates get_pickup_location().';
comment on column borrow_requests.pickup_location is
  'One-off pickup spot for this borrower only. Null means fall through to the tool. Never selectable by the client.';

-- Same shape as tools.pickup_location: RLS is row-level, so column secrecy has
-- to come from the grant.
--
-- Note the shape carefully. A column-level REVOKE does NOT override a
-- table-level grant -- if the role holds SELECT on the whole table, it can read
-- every column regardless, and the REVOKE silently does nothing. So the only
-- thing that works is to drop SELECT on the table entirely and then grant back
-- an explicit column list, exactly as 0001 does for tools and profiles.
--
-- Enumerating the allowed columns rather than excluding the forbidden one is
-- deliberate: a column added later is then unreadable until someone grants it,
-- which fails loudly, instead of being exposed by default, which does not.
revoke select on borrow_requests from public, anon, authenticated;

grant select (
  id, tool_id, borrower_id, lender_id, status,
  wants_instruction, auto_approved, delegated_approver_id,
  requested_at, decided_at, denial_reason,
  requested_days, due_at, overdue_reminded_at,
  pickup_location_revealed_at,
  -- Readable on purpose: the UI has to know which step of the handshake it is
  -- on, and a timestamp gives away no place.
  pickup_requested_at, pickup_released_at
) on borrow_requests to authenticated;
-- pickup_location intentionally NOT granted -- only reachable through
-- get_pickup_location(). anon gets nothing at all: a borrow request is never
-- readable without a session.

-- ============================================================
-- request_pickup -- step 2, the borrower
-- ============================================================

create or replace function request_pickup(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status    borrow_request_status;
  v_tool_id   uuid;
  v_lender_id uuid;
  v_borrower  uuid;
  v_already   timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select status, tool_id, lender_id, borrower_id, pickup_requested_at
    into v_status, v_tool_id, v_lender_id, v_borrower, v_already
  from borrow_requests where id = p_request_id;

  if v_borrower is null then
    raise exception 'Request not found';
  end if;
  if v_borrower <> auth.uid() then
    raise exception 'Only the borrower can ask for pickup';
  end if;
  if v_status <> 'approved' then
    raise exception 'This request has not been approved';
  end if;

  -- Idempotent. A second tap must not fire a second notification at the
  -- lender, which is exactly what an impatient borrower will do.
  if v_already is not null then
    return;
  end if;

  update borrow_requests
     set pickup_requested_at = now()
   where id = p_request_id;

  insert into notifications (profile_id, type, payload)
  values (v_lender_id, 'pickup_requested', jsonb_build_object(
    'request_id', p_request_id, 'tool_id', v_tool_id
  ));
end;
$fn$;

revoke execute on function request_pickup(uuid) from public;
grant execute on function request_pickup(uuid) to authenticated;

-- ============================================================
-- set_pickup_for_request -- step 3, the lender
-- ============================================================
-- p_use_default true  -> hand over the tool's own saved pickup address
-- p_use_default false -> hand over p_location, this borrower only

create or replace function set_pickup_for_request(
  p_request_id  uuid,
  p_location    text default null,
  p_use_default boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status      borrow_request_status;
  v_tool_id     uuid;
  v_lender_id   uuid;
  v_borrower    uuid;
  v_tool_pickup text;
  v_location    text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select status, tool_id, lender_id, borrower_id
    into v_status, v_tool_id, v_lender_id, v_borrower
  from borrow_requests where id = p_request_id;

  if v_lender_id is null then
    raise exception 'Request not found';
  end if;
  if v_lender_id <> auth.uid() then
    raise exception 'Only the lender can set the pickup location';
  end if;
  if v_status <> 'approved' then
    raise exception 'This request has not been approved';
  end if;

  if p_use_default then
    select pickup_location into v_tool_pickup from tools where id = v_tool_id;
    if coalesce(trim(v_tool_pickup), '') = '' then
      raise exception 'This tool has no saved pickup address -- enter one instead';
    end if;
    -- Null means "fall through to the tool's own", so the answer stays correct
    -- if the owner later edits the listing address.
    v_location := null;
  else
    v_location := nullif(trim(p_location), '');
    if v_location is null then
      raise exception 'Enter a pickup location, or use the saved address';
    end if;
  end if;

  update borrow_requests
     set pickup_location = v_location,
         pickup_released_at = now(),
         -- Kept in step for anything still reading the older column.
         pickup_location_revealed_at = now()
   where id = p_request_id;

  insert into notifications (profile_id, type, payload)
  values (v_borrower, 'pickup_ready', jsonb_build_object(
    'request_id', p_request_id, 'tool_id', v_tool_id
  ));
end;
$fn$;

revoke execute on function set_pickup_for_request(uuid, text, boolean) from public;
grant execute on function set_pickup_for_request(uuid, text, boolean) to authenticated;

-- ============================================================
-- approve_borrow_request -- stop revealing on approval
-- ============================================================
-- Identical to 0024/0027 except that pickup_location_revealed_at is no longer
-- stamped here. Approval means "yes, you may borrow it", not "here is my
-- address".

create or replace function approve_borrow_request(p_request_id uuid, p_days integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
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
  if v_lender_id <> auth.uid() then
    raise exception 'Only the lender can approve this request';
  end if;
  if v_status <> 'pending' then
    raise exception 'Request is no longer pending';
  end if;

  select default_loan_days into v_default_days from tools where id = v_tool_id;

  v_days := coalesce(p_days, v_requested_days, v_default_days, 7);
  if v_days < 1 or v_days > 365 then
    raise exception 'A borrow has to be between 1 and 365 days';
  end if;
  v_due_at := now() + make_interval(days => v_days);

  update borrow_requests
  set status = 'approved',
      decided_at = now(),
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
$fn$;

revoke execute on function approve_borrow_request(uuid, integer) from public;
grant execute on function approve_borrow_request(uuid, integer) to authenticated;

-- ============================================================
-- get_pickup_location -- gated on the handshake, not on approval
-- ============================================================

create or replace function get_pickup_location(p_tool_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner_id uuid;
  v_address  text;
  v_general  text;
  v_reveal   boolean;
  v_per_req  text;
  v_released timestamptz;
begin
  select chest_id, pickup_location, general_location, reveal_exact_location
    into v_owner_id, v_address, v_general, v_reveal
  from tools where id = p_tool_id;

  -- The owner always sees their own exact address back; that is how the edit
  -- form pre-fills.
  if v_owner_id = auth.uid() then
    return v_address;
  end if;

  -- Most recent approved request by this caller for this tool.
  select br.pickup_location, br.pickup_released_at
    into v_per_req, v_released
  from borrow_requests br
  where br.tool_id = p_tool_id
    and br.borrower_id = auth.uid()
    and br.status = 'approved'
    and br.decided_at > now() - interval '30 days'
  order by br.decided_at desc
  limit 1;

  -- FOUND rather than a null check on v_per_req: a released request with no
  -- one-off spot legitimately has a null there.
  if not found then
    raise exception 'No approved request for this tool';
  end if;

  -- Approval is no longer enough. The borrower has to have asked, and the
  -- lender has to have answered.
  if v_released is null then
    raise exception 'The pickup location has not been shared yet';
  end if;

  -- A one-off spot the lender set for this borrower wins over the listing.
  if v_per_req is not null then
    return v_per_req;
  end if;

  if coalesce(v_reveal, true) then
    return v_address;
  end if;

  return coalesce(
    nullif(trim(v_general), ''),
    'The owner will share the exact pickup spot by message.'
  );
end;
$fn$;

revoke execute on function get_pickup_location(uuid) from public;
grant execute on function get_pickup_location(uuid) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
-- This block is the reason the first attempt at this migration failed rather
-- than shipping a hole: the original column-level REVOKE looked right and did
-- nothing, because a table-wide grant still conferred SELECT on every column.
do $chk$
declare
  v_col text;
begin
  if has_column_privilege('authenticated', 'borrow_requests', 'pickup_location', 'select') then
    raise exception 'borrow_requests.pickup_location is still selectable by authenticated';
  end if;
  if has_column_privilege('anon', 'borrow_requests', 'pickup_location', 'select') then
    raise exception 'borrow_requests.pickup_location is still selectable by anon';
  end if;

  -- The other half of the trap: revoking the table grant takes every column
  -- with it, so a column the app reads but the grant list forgot would fail at
  -- runtime as "permission denied for table borrow_requests". Check each one
  -- the client actually selects.
  foreach v_col in array array[
    'id', 'tool_id', 'borrower_id', 'lender_id', 'status',
    'wants_instruction', 'requested_days', 'due_at', 'requested_at',
    'denial_reason', 'pickup_requested_at', 'pickup_released_at'
  ] loop
    if not has_column_privilege('authenticated', 'borrow_requests', v_col, 'select') then
      raise exception 'borrow_requests.% is not selectable by authenticated -- the app reads it', v_col;
    end if;
  end loop;
end;
$chk$;
