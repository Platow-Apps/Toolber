-- ============================================================
-- 0047 — a borrow you can date, and a record you can clear
-- ============================================================
-- Two gaps in the same place: what a finished loan remembers, and what you
-- can do with it afterwards.
--
-- `returned_at` — complete_borrow_request() set status = 'completed' and
-- nothing else, so a returned loan carried no record of when it came back.
-- decided_at is the approval, due_at is when it was *meant* to come back.
-- Neither answers "when did I actually get it back", which is the one date a
-- lender wants when a tool comes back late or a dispute needs a timeline.
--
-- `*_hidden_at` — Requests could only ever grow. Notifications got a delete
-- policy for exactly this reason (0018), and a borrow list has the same
-- problem with worse consequences: the live requests that need answering get
-- buried under years of finished ones.
--
-- Hiding, not deleting. A borrow request has two parties and a real DELETE
-- would take the counterparty's copy with it -- a lender clearing their list
-- would erase the borrower's record of what they borrowed and when. Two
-- timestamps, one per side, so each person clears their own view and neither
-- can rewrite the other's history. It is also what keeps the row available if
-- the two of them later disagree about what happened.

alter table borrow_requests
  add column if not exists returned_at timestamptz,
  add column if not exists borrower_hidden_at timestamptz,
  add column if not exists lender_hidden_at timestamptz;

comment on column borrow_requests.returned_at is
  'When the tool actually came back, as distinct from due_at (when it was meant to) and decided_at (when it was approved).';
comment on column borrow_requests.borrower_hidden_at is
  'The borrower cleared this from their own list. Never affects the lender''s copy.';
comment on column borrow_requests.lender_hidden_at is
  'The lender cleared this from their own list. Never affects the borrower''s copy.';

-- The column-grant trap, UPDATE half and SELECT half (CLAUDE.md). 0035
-- revoked the table grant and enumerated the readable columns, so a column
-- added now is unreadable until it is named here.
grant select (returned_at, borrower_hidden_at, lender_hidden_at)
  on borrow_requests to authenticated;

-- ============================================================
-- complete_borrow_request — record when it came back
-- ============================================================
-- Otherwise identical to 0024's version; only the update line changes.

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

  update borrow_requests
  set status = 'completed', returned_at = now()
  where id = p_request_id;

  perform refresh_tool_state(v_tool_id);

  insert into notifications (profile_id, type, payload)
  values (
    case when auth.uid() = v_lender_id then v_borrower_id else v_lender_id end,
    'borrow_completed',
    jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id)
  );
end;
$$;

revoke execute on function complete_borrow_request(uuid) from public, anon;
grant execute on function complete_borrow_request(uuid) to authenticated;

-- ============================================================
-- hide_borrow_request — clear a finished loan from your own list
-- ============================================================
-- An RPC rather than a policy + client UPDATE, because which column may be
-- written depends on which side of the row the caller is on, and a grant
-- cannot express that. The status guard is the substantive part: a live
-- request is the thing this screen exists to show, and letting someone hide a
-- pending or approved one would lose a tool rather than tidy a list.

create or replace function hide_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status borrow_request_status;
  v_lender_id uuid;
  v_borrower_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select status, lender_id, borrower_id
  into v_status, v_lender_id, v_borrower_id
  from borrow_requests where id = p_request_id;

  if v_lender_id is null then
    raise exception 'Request not found';
  end if;

  if auth.uid() <> v_lender_id and auth.uid() <> v_borrower_id then
    raise exception 'Not a party to this request';
  end if;

  if v_status not in ('completed', 'denied', 'cancelled') then
    raise exception 'Only a finished borrow can be cleared from your list';
  end if;

  if auth.uid() = v_borrower_id then
    update borrow_requests set borrower_hidden_at = now() where id = p_request_id;
  else
    update borrow_requests set lender_hidden_at = now() where id = p_request_id;
  end if;
end;
$$;

revoke execute on function hide_borrow_request(uuid) from public, anon;
grant execute on function hide_borrow_request(uuid) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not has_column_privilege('authenticated', 'borrow_requests', 'returned_at', 'SELECT') then
    raise exception 'returned_at was added but not granted -- see the column-grant trap in CLAUDE.md';
  end if;
  if has_function_privilege('anon', 'hide_borrow_request(uuid)', 'EXECUTE') then
    raise exception 'hide_borrow_request must not be callable by anon';
  end if;
end;
$chk$;
