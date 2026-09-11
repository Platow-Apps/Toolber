-- Messaging people from the admin console.
--
-- Two things stop this being a loop over start_conversation() in the client.
--
--   1. 0059 made start_conversation() refuse against anybody whose identity
--      the caller is not already entitled to see. An admin is usually in none
--      of a reported user's groups, so the one person who most needs to reach
--      them is exactly who it refuses. Widening that function for admins would
--      widen it for the unmasking case it was written to block, so the admin
--      path is its own function instead.
--
--   2. "From Toolber Admin" has to be a fact the server sets, not a name the
--      sender chose. display_name is user-editable: anyone could call
--      themselves Toolber Admin and message a neighbour asking them to confirm
--      their address. `conversation_messages.from_admin` is written only by the
--      function below, which checks the platform-admin flag first, so the badge
--      the recipient sees means something. The client cannot set it -- the
--      column is not in any insert grant, and the ordinary insert policy still
--      requires sender_id = auth.uid().
--
-- The message lands in the person's normal inbox as an ordinary 1:1
-- conversation, which is the point: a reply goes straight back, and there is no
-- second messaging system to maintain.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- 1. The flag the recipient can trust
-- ============================================================
alter table conversation_messages
  add column if not exists from_admin boolean not null default false;

comment on column conversation_messages.from_admin is
  'Set only by admin_message_users(). A display name can be edited by anyone; this cannot, which is what lets the recipient believe the badge.';

-- Readable, so the badge can render. Deliberately NOT writable: the ordinary
-- insert path must never be able to claim it. 0040 granted table-level INSERT
-- on every table to authenticated, so a column-level revoke would be a no-op
-- (CLAUDE.md) -- the protection is that the insert policy pins sender_id to
-- auth.uid() and this column defaults to false, plus the check below.
grant select (from_admin) on conversation_messages to authenticated;

-- The policy that makes the default stick. Without it a client could insert
-- its own row with from_admin = true, since it does hold INSERT on the table.
drop policy if exists conversation_messages_insert on conversation_messages;
create policy conversation_messages_insert on conversation_messages for insert to authenticated with check (
  sender_id = auth.uid()
  -- Nobody hand-inserts an admin message; that is what the RPC is for, and it
  -- runs as the owner so this policy does not apply to it.
  and from_admin = false
  and exists (
    select 1 from conversations c
    where c.id = conversation_messages.conversation_id
      and (c.participant_a_id = auth.uid() or c.participant_b_id = auth.uid())
  )
);

-- ============================================================
-- 2. Sending
-- ============================================================
-- Takes an array because the console sends to a selection. One conversation
-- per recipient, never a group thread: a moderation note to twelve people is
-- twelve private conversations, not a room where they can all read each
-- other's business.
create or replace function admin_message_users(p_profile_ids uuid[], p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me       uuid := auth.uid();
  v_body     text := btrim(coalesce(p_body, ''));
  v_target   uuid;
  v_convo    uuid;
  v_sent     integer := 0;
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;
  if v_body = '' then
    raise exception 'Write a message first';
  end if;
  if p_profile_ids is null or array_length(p_profile_ids, 1) is null then
    raise exception 'Nobody selected';
  end if;
  -- A cap, because this is the one control in the console that reaches
  -- outward. An accidental select-all on a large account list should fail
  -- loudly rather than quietly become a broadcast.
  if array_length(p_profile_ids, 1) > 50 then
    raise exception 'Too many recipients at once (maximum 50)';
  end if;

  foreach v_target in array p_profile_ids loop
    continue when v_target is null or v_target = v_me;
    -- A scrubbed or deleted account has nobody reading the inbox.
    continue when not exists (
      select 1 from profiles where id = v_target and deleted_at is null
    );

    select id into v_convo from conversations
    where (participant_a_id = v_me and participant_b_id = v_target)
       or (participant_a_id = v_target and participant_b_id = v_me);

    if v_convo is null then
      begin
        insert into conversations (participant_a_id, participant_b_id)
        values (v_me, v_target)
        returning id into v_convo;
      exception when unique_violation then
        -- Same race start_conversation() handles: re-read what the other
        -- request created rather than failing the send.
        select id into v_convo from conversations
        where (participant_a_id = v_me and participant_b_id = v_target)
           or (participant_a_id = v_target and participant_b_id = v_me);
      end;
    end if;

    insert into conversation_messages (conversation_id, sender_id, body, from_admin)
    values (v_convo, v_me, v_body, true);

    v_sent := v_sent + 1;
  end loop;

  insert into events (profile_id, event_type, metadata)
  values (v_me, 'admin_messaged_users',
          jsonb_build_object('recipients', v_sent, 'profile_ids', to_jsonb(p_profile_ids)));

  return v_sent;
end;
$fn$;

revoke execute on function admin_message_users(uuid[], text) from public, anon;
grant execute on function admin_message_users(uuid[], text) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_blocked boolean := false;
begin
  -- The badge is only worth anything if an ordinary account cannot claim it.
  -- Checked by attempting the write as a real role, because the column-level
  -- story here is a policy, not a grant, and a grant check would miss it.
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000beef","role":"authenticated"}';
  set local role authenticated;
  begin
    insert into conversation_messages (conversation_id, sender_id, body, from_admin)
    values (gen_random_uuid(), '00000000-0000-0000-0000-00000000beef', 'x', true);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'an ordinary account was able to send a message marked as from an admin';
  end if;
end;
$chk$;
