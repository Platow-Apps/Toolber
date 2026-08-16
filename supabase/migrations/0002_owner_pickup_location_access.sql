-- Fixes a gap found while building List a Tool: the column-level GRANT/REVOKE
-- on tools.pickup_location (see 0001_init.sql) blocks ALL direct client reads,
-- including the tool's own owner. get_pickup_location() only checked for an
-- approved borrow_requests row, which an owner never has for their own tool.
--
-- This adds the owner as a second valid path, alongside the existing
-- approved-borrower path. Safe to re-run — CREATE OR REPLACE, no drop needed.

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
  ) then
    raise exception 'No approved request for this tool';
  end if;

  return v_location;
end;
$$;
