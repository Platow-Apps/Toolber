-- Lets an owner actually manage a listing: pause it, or delete it.
--
-- WHY DELETE NEEDS AN RPC RATHER THAN A PLAIN .delete()
--
-- The tools_delete_own RLS policy already permits an owner to delete their
-- own row at any time, and every child table cascades (0001_init.sql):
-- favorites, borrow_requests, tool_malfunction_reports, tool_authorizations.
-- So a bare client-side delete on a tool somebody is *currently borrowing*
-- would erase the borrow record from both sides -- the owner would lose the
-- only record that their tool is out, and the borrower would lose theirs.
-- Nothing in the schema stops that today.
--
-- delete_tool() refuses while any pending or approved request exists, so a
-- live borrow has to be denied or marked returned first. Completed/denied
-- history still cascades away with the tool, which is the intended meaning
-- of deleting a listing outright; an owner who wants to keep the history
-- should pause instead.
--
-- It returns the tool's photo paths so the caller can clean up the Storage
-- objects afterwards -- Postgres has no visibility into the storage bucket,
-- and orphaned files would otherwise accumulate forever.
--
-- PAUSING is a separate boolean rather than a new tool_status enum value:
-- status tracks where a tool is in the borrow lifecycle (available ->
-- requested -> borrowed), and "the owner has temporarily withdrawn this
-- listing" is orthogonal to that. Folding it into the enum would mean losing
-- the underlying state every time someone paused, and having to reconstruct
-- it on resume.
--
-- Safe to paste and re-run from the top: ADD COLUMN uses IF NOT EXISTS,
-- GRANT is additive, and both functions are CREATE OR REPLACE.

alter table tools add column if not exists paused boolean not null default false;

grant select (paused) on tools to anon, authenticated;

-- ============================================================
-- Guarded delete
-- ============================================================

create or replace function delete_tool(p_tool_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_photos text[];
  v_active integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select chest_id, photos into v_owner_id, v_photos from tools where id = p_tool_id;
  if v_owner_id is null then
    raise exception 'Tool not found';
  end if;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can delete this listing';
  end if;

  select count(*) into v_active
  from borrow_requests
  where tool_id = p_tool_id and status in ('pending', 'approved');

  if v_active > 0 then
    raise exception 'This tool has % open request(s). Deny or mark them returned first.', v_active;
  end if;

  delete from tools where id = p_tool_id;

  return coalesce(v_photos, array[]::text[]);
end;
$$;

revoke execute on function delete_tool(uuid) from public;
grant execute on function delete_tool(uuid) to authenticated;

-- ============================================================
-- request_borrow: refuse a paused listing
-- ============================================================
-- Pausing hides a tool from search, but a direct /tool/:id link still
-- resolves, and request_borrow is callable on its own regardless. Without
-- this the pause would be presentational only. Body is otherwise identical
-- to the version carried forward in 0022.

create or replace function request_borrow(p_tool_id uuid, p_wants_instruction boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lender_id uuid;
  v_tool_status tool_status;
  v_paused boolean;
  v_auto_approve boolean;
  v_vetted boolean;
  v_status borrow_request_status := 'pending';
  v_auto_approved boolean := false;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select chest_id, status, paused into v_lender_id, v_tool_status, v_paused from tools where id = p_tool_id;
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

revoke execute on function request_borrow(uuid, boolean) from public;
grant execute on function request_borrow(uuid, boolean) to authenticated;
