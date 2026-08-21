-- In-app chat between the borrower and lender of a specific approved (or
-- completed) request, replacing the need to fall back to personal email to
-- arrange a handoff. Supplements, doesn't replace, the existing email/phone
-- reveal (get_borrow_contact) from 0007 -- some people will still prefer a
-- phone call.
--
-- No RPC needed for sending/reading: RLS alone correctly scopes this to the
-- two parties of a specific request, the same way borrow_requests itself
-- has no insert/update RPC-only restriction beyond RLS + the approve/deny
-- RPCs for the *decision* (as opposed to messages, which aren't a decision).
--
-- A trigger creates the notification automatically on insert, rather than
-- the client doing it, so it fires reliably regardless of insert path and
-- matches the "notifications are a side effect of the event, not a second
-- client call" pattern already used for the rest of the app.

create table borrow_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references borrow_requests (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index borrow_messages_request_idx on borrow_messages (request_id, created_at);

alter table borrow_messages enable row level security;

create policy borrow_messages_select on borrow_messages for select to authenticated using (
  exists (
    select 1 from borrow_requests br
    where br.id = borrow_messages.request_id
      and (br.borrower_id = auth.uid() or br.lender_id = auth.uid())
      and br.status in ('approved', 'completed')
  )
);

create policy borrow_messages_insert on borrow_messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists (
    select 1 from borrow_requests br
    where br.id = borrow_messages.request_id
      and (br.borrower_id = auth.uid() or br.lender_id = auth.uid())
      and br.status in ('approved', 'completed')
  )
);
-- No update/delete policy -- messages are immutable once sent, same as email.

create function notify_new_borrow_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrower_id uuid;
  v_lender_id uuid;
  v_recipient_id uuid;
begin
  select borrower_id, lender_id into v_borrower_id, v_lender_id
  from borrow_requests where id = new.request_id;

  v_recipient_id := case when new.sender_id = v_borrower_id then v_lender_id else v_borrower_id end;

  insert into notifications (profile_id, type, payload)
  values (v_recipient_id, 'new_message', jsonb_build_object('request_id', new.request_id));

  return new;
end;
$$;

create trigger on_borrow_message_created
  after insert on borrow_messages
  for each row execute function notify_new_borrow_message();

-- So NotificationBell / any future chat UI gets new messages live.
alter publication supabase_realtime add table borrow_messages;
