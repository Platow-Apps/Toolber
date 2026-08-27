-- Renames tools.crib_id -> tools.chest_id, completing the product-wide
-- vocabulary change from "crib" to "chest" (one person owns a chest of
-- tools). This is purely internal: "crib" was never rendered in any UI
-- string, so no user sees a difference.
--
-- WHY THIS MIGRATION IS LONGER THAN A ONE-LINE RENAME
--
-- Postgres updates *parsed* references automatically but not *textual* ones:
--
--   follows the rename by itself   RLS policies (stored as expression trees),
--                                  indexes, FK constraints, the generated
--                                  search_vector column, and column-level
--                                  GRANTs (bound to attnum, not to the name)
--
--   does NOT follow the rename     plpgsql function bodies, which are stored
--                                  as plain text and would fail at runtime
--                                  the next time they were called
--
-- So every function whose body mentions the column has to be recreated here.
-- Exactly six do; the rest of the RPC surface never touches it:
--   get_pickup_location, request_borrow, resolve_malfunction,
--   set_borrower_supervision, report_malfunction, get_asking_price
-- Each body below is character-identical to its current definition except
-- for the column name -- 0014 (0010 for report_malfunction, 0021 for
-- get_asking_price) is the version being carried forward.
--
-- CREATE OR REPLACE preserves existing privileges, so the revoke-from-public
-- / grant-to-authenticated posture set in 0014 and 0021 survives untouched.
-- The grants are restated at the bottom anyway: cheap, idempotent, and it
-- keeps this file self-contained if it is ever replayed onto a fresh database.
--
-- DEPLOY ORDERING: this is a breaking change in both directions -- the
-- frontend selects the column by name. Whichever side lands first, the app
-- errors until the other catches up, so apply this and ship the matching
-- frontend build close together.
--
-- Safe to paste and re-run from the top: the rename and the index rename are
-- both guarded by catalog lookups (ALTER TABLE ... RENAME COLUMN has no
-- IF NOT EXISTS form), and everything else is CREATE OR REPLACE or a GRANT.

-- ============================================================
-- The rename itself
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tools' and column_name = 'crib_id'
  ) then
    alter table tools rename column crib_id to chest_id;
  end if;
end
$$;

-- Cosmetic, but leaving it would strand the old word in \d output.
do $$
begin
  if exists (select 1 from pg_class where relname = 'tools_crib_idx') then
    alter index tools_crib_idx rename to tools_chest_idx;
  end if;
end
$$;

-- ============================================================
-- The six functions whose text bodies reference the column
-- ============================================================

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
  select chest_id, pickup_location into v_owner_id, v_location from tools where id = p_tool_id;

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

  select chest_id, status into v_lender_id, v_tool_status from tools where id = p_tool_id;
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

  update tools set status = case
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'approved') then 'borrowed'
    when exists (select 1 from borrow_requests where tool_id = v_tool_id and status = 'pending') then 'requested'
    else 'available'
  end, updated_at = now()
  where id = v_tool_id;
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

  select chest_id into v_owner_id from tools where id = p_tool_id;
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

  select chest_id into v_owner_id from tools where id = p_tool_id;

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

create or replace function get_asking_price(p_tool_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_price numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select chest_id, asking_price into v_owner_id, v_price from tools where id = p_tool_id;
  if v_owner_id is null then
    raise exception 'Tool not found';
  end if;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can view the asking price';
  end if;

  return v_price;
end;
$$;

-- ============================================================
-- Restated for self-containment (CREATE OR REPLACE already preserved these)
-- ============================================================

revoke execute on function
  get_pickup_location(uuid),
  request_borrow(uuid, boolean),
  resolve_malfunction(uuid),
  set_borrower_supervision(uuid, uuid, boolean),
  report_malfunction(uuid, text),
  get_asking_price(uuid)
from public;

grant execute on function
  get_pickup_location(uuid),
  request_borrow(uuid, boolean),
  resolve_malfunction(uuid),
  set_borrower_supervision(uuid, uuid, boolean),
  report_malfunction(uuid, text),
  get_asking_price(uuid)
to authenticated;
