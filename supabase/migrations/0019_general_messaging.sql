-- Generalizes chat from "only between the two parties of an approved borrow
-- request" (0013_borrow_chat.sql) to "any two registered users, any time" --
-- explicit product decision: people should be able to chat with a tool's
-- owner *before* requesting to borrow, and a group admin should be able to
-- message any member of their group whether or not they've ever borrowed
-- from each other. borrow_messages/borrow_requests can't express a
-- conversation that isn't tied to a request, so this is a new, separate
-- pair of tables rather than a retrofit -- the request-scoped chat
-- (0013) now becomes a thin resolver that gets-or-creates the same kind of
-- conversation this migration adds, so the two features end up sharing one
-- actual thread per pair of people (see src/pages/BorrowChat.jsx, now a
-- redirect to /messages/:conversationId).
--
-- Safe to paste and re-run from the top: CREATE TABLE/INDEX use IF NOT
-- EXISTS, CREATE POLICY is preceded by DROP POLICY IF EXISTS (Postgres has
-- no CREATE POLICY IF NOT EXISTS), functions are CREATE OR REPLACE.

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  participant_a_id uuid not null references profiles (id) on delete cascade,
  participant_b_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversations_distinct_participants check (participant_a_id != participant_b_id)
);

-- One conversation per unordered pair, regardless of which side started it.
create unique index if not exists conversations_unique_pair on conversations (
  least(participant_a_id, participant_b_id),
  greatest(participant_a_id, participant_b_id)
);

create index if not exists conversations_participant_a_idx on conversations (participant_a_id);
create index if not exists conversations_participant_b_idx on conversations (participant_b_id);

alter table conversations enable row level security;

drop policy if exists conversations_select_own on conversations;
create policy conversations_select_own on conversations for select to authenticated using (
  auth.uid() = participant_a_id or auth.uid() = participant_b_id
);
-- No direct insert/update/delete policy -- always through start_conversation()
-- below, so the get-or-create-by-unordered-pair logic can't be bypassed by a
-- client inserting a duplicate/malformed row.

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversation_messages_conversation_idx on conversation_messages (conversation_id, created_at);

alter table conversation_messages enable row level security;

drop policy if exists conversation_messages_select on conversation_messages;
create policy conversation_messages_select on conversation_messages for select to authenticated using (
  exists (
    select 1 from conversations c
    where c.id = conversation_messages.conversation_id
      and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
  )
);

drop policy if exists conversation_messages_insert on conversation_messages;
create policy conversation_messages_insert on conversation_messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists (
    select 1 from conversations c
    where c.id = conversation_messages.conversation_id
      and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
  )
);
-- No update/delete policy -- messages are immutable once sent, same as borrow_messages.

-- Gets the existing conversation between the caller and p_other_user_id, or
-- creates one. This is the only path that can ever create a conversations
-- row (see the missing insert policy above), so it's also the one place the
-- "one row per unordered pair" invariant has to be enforced -- the unique
-- index catches a race between two concurrent first-messages and the
-- exception handler below just re-reads the row the other request created.
create or replace function start_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_other_user_id = auth.uid() then
    raise exception 'Cannot start a conversation with yourself';
  end if;
  if not exists (select 1 from profiles where id = p_other_user_id) then
    raise exception 'User not found';
  end if;

  select id into v_conversation_id from conversations
  where (participant_a_id = auth.uid() and participant_b_id = p_other_user_id)
     or (participant_a_id = p_other_user_id and participant_b_id = auth.uid());

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  begin
    insert into conversations (participant_a_id, participant_b_id)
    values (auth.uid(), p_other_user_id)
    returning id into v_conversation_id;
  exception when unique_violation then
    select id into v_conversation_id from conversations
    where (participant_a_id = auth.uid() and participant_b_id = p_other_user_id)
       or (participant_a_id = p_other_user_id and participant_b_id = auth.uid());
  end;

  return v_conversation_id;
end;
$$;

-- Reuses the 'new_message' notification type borrow chat already defined
-- copy for (src/lib/notifications.js) and the notify Edge Function's
-- in-app-only handling of it -- same event from the recipient's point of
-- view, just not tied to a request anymore. The payload carries
-- conversation_id instead of request_id.
create or replace function notify_new_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_recipient_id uuid;
begin
  select participant_a_id, participant_b_id into v_a, v_b
  from conversations where id = new.conversation_id;

  v_recipient_id := case when new.sender_id = v_a then v_b else v_a end;

  insert into notifications (profile_id, type, payload)
  values (v_recipient_id, 'new_message', jsonb_build_object('conversation_id', new.conversation_id));

  return new;
end;
$$;

drop trigger if exists on_conversation_message_created on conversation_messages;
create trigger on_conversation_message_created
  after insert on conversation_messages
  for each row execute function notify_new_conversation_message();

-- ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS in Postgres, and
-- errors ("relation is already member of publication") on a second run --
-- checked against pg_publication_tables instead so this stays re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_messages'
  ) then
    alter publication supabase_realtime add table conversation_messages;
  end if;
end $$;

revoke execute on function start_conversation(uuid) from public;
grant execute on function start_conversation(uuid) to authenticated;
