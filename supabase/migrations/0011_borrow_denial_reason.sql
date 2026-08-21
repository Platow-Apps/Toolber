-- Lets a lender optionally explain why they denied a request. borrow_requests
-- has no column-level grant restrictions (see 0001_init.sql -- it relies on
-- borrow_requests_select's RLS policy alone: readable by the borrower or
-- lender), so the new column needs no extra grant, just adding it and
-- writing to it from the RPC. The reason also rides along in the
-- notification payload so the borrower's email/in-app notification can
-- surface it directly.

alter table borrow_requests add column denial_reason text;

create or replace function deny_borrow_request(p_request_id uuid, p_reason text default null)
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

  update borrow_requests
  set status = 'denied', decided_at = now(), denial_reason = nullif(trim(p_reason), '')
  where id = p_request_id;

  update tools set status = 'available', updated_at = now() where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (
    v_borrower_id,
    'borrow_denied',
    jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id, 'reason', nullif(trim(p_reason), ''))
  );
end;
$$;
