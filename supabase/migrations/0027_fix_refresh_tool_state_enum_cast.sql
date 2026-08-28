-- Fixes: column "status" is of type tool_status but expression is of type text
--
-- refresh_tool_state() (0024_loan_duration.sql) assigns a CASE expression to
-- tools.status. Every branch is an untyped string literal, so Postgres
-- resolves the CASE's result type to `text` and then refuses to assign text
-- to an enum column. A bare literal (`set status = 'borrowed'`) is fine --
-- unknown resolves against the target column -- but a CASE is typed as a
-- whole, before the assignment is considered, so it needs explicit casts.
--
-- Identical in shape to the bug 0017 fixed in decide_group_membership. It
-- should have been caught by that precedent when 0024 was written.
--
-- BLAST RADIUS: five RPCs route through this helper, so the whole borrow
-- lifecycle was failing -- request_borrow, approve_borrow_request,
-- deny_borrow_request, complete_borrow_request and resolve_malfunction.
-- Only the function body changes here; no signatures, grants or data.
--
-- Safe to paste and re-run from the top.

create or replace function refresh_tool_state(p_tool_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update tools set
    status = case
      when exists (select 1 from borrow_requests where tool_id = p_tool_id and status = 'approved') then 'borrowed'::tool_status
      when exists (select 1 from borrow_requests where tool_id = p_tool_id and status = 'pending') then 'requested'::tool_status
      else 'available'::tool_status
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

revoke execute on function refresh_tool_state(uuid) from public;
