-- Asking a group for a tool nobody has listed.
--
-- Search only answers the question "who has already listed this?", and the
-- honest answer is usually nobody -- a chest holds what somebody thought to
-- write down, not what they own. The tool you want is frequently sitting in a
-- neighbour's garage, unlisted, because listing it never occurred to them
-- until somebody asked.
--
-- So: a member posts what they need to their group, every approved member is
-- told, and replies go back on the same thread. A reply can point at a tool
-- the responder has already listed, which turns "I've got one" into a link
-- to request it rather than a second conversation about where it is.
--
-- Scoped to one group on purpose. A request that fanned out to the whole app
-- would be a classifieds board, and every member would have to mute it; a
-- request inside a group reaches people who already admitted each other.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- 1. Tables
-- ============================================================
create table if not exists group_tool_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  requester_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  details text,
  needed_by date,
  -- open | fulfilled | withdrawn. Text rather than an enum: the states are
  -- likely to change while this is new, and an enum would need a migration to
  -- add one.
  status text not null default 'open',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint group_tool_requests_title_not_blank check (btrim(title) <> ''),
  constraint group_tool_requests_status_known check (status in ('open', 'fulfilled', 'withdrawn'))
);

create index if not exists group_tool_requests_group_idx
  on group_tool_requests (group_id, status, created_at desc);

create table if not exists group_tool_request_replies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references group_tool_requests (id) on delete cascade,
  responder_id uuid not null references profiles (id) on delete cascade,
  body text not null,
  -- Optional: "I have one, here it is". on delete set null so unlisting the
  -- tool later does not delete the conversation about it.
  tool_id uuid references tools (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint group_tool_request_replies_body_not_blank check (btrim(body) <> '')
);

create index if not exists group_tool_request_replies_request_idx
  on group_tool_request_replies (request_id, created_at);

alter table group_tool_requests enable row level security;
alter table group_tool_request_replies enable row level security;

-- ============================================================
-- 2. Grants
-- ============================================================
-- 0040's sweep granted the app's tables to authenticated and revoked writes
-- from anon, but it ran once over the tables that existed then. A table added
-- afterwards gets neither, so both halves are spelled out here.
-- REVOKE first, and this is not belt-and-braces: Supabase ships default
-- privileges that grant anon and authenticated everything on a new table in
-- public. Adding a grant on top of that restricts nothing -- the self-check
-- below caught exactly this, with INSERT already in the hands of every
-- signed-in client while the migration read as though it were locked down.
revoke all on group_tool_requests from public, anon, authenticated;
revoke all on group_tool_request_replies from public, anon, authenticated;

grant select on group_tool_requests to authenticated;
grant select on group_tool_request_replies to authenticated;

-- No INSERT/UPDATE/DELETE for anybody. Every write goes through the RPCs
-- below, so the notification that makes the feature work cannot be skipped by
-- a client that inserts the row directly -- an ask nobody hears about is
-- worse than no ask at all.
-- (anon was revoked above, along with the default INSERT/UPDATE/DELETE.)

-- ============================================================
-- 3. Row policies
-- ============================================================
-- Approved members of the group, and nobody else. is_approved_group_member is
-- SECURITY DEFINER (0055), which is what keeps this from recursing through
-- group_memberships' own policy back into groups.
drop policy if exists group_tool_requests_select on group_tool_requests;
create policy group_tool_requests_select on group_tool_requests for select to authenticated
using (is_approved_group_member(group_id, auth.uid()));

drop policy if exists group_tool_request_replies_select on group_tool_request_replies;
create policy group_tool_request_replies_select on group_tool_request_replies for select to authenticated
using (
  exists (
    select 1 from group_tool_requests r
    where r.id = group_tool_request_replies.request_id
      and is_approved_group_member(r.group_id, auth.uid())
  )
);

-- ============================================================
-- 4. Posting an ask
-- ============================================================
create or replace function create_group_tool_request(
  p_group_id  uuid,
  p_title     text,
  p_details   text default null,
  p_needed_by date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me    uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_id    uuid;
  v_member uuid;
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;
  if v_title = '' then
    raise exception 'Say what you are looking for';
  end if;
  if length(v_title) > 120 then
    raise exception 'Keep the title under 120 characters';
  end if;
  if not is_approved_group_member(p_group_id, v_me) then
    raise exception 'Only approved members can ask this group';
  end if;

  insert into group_tool_requests (group_id, requester_id, title, details, needed_by)
  values (p_group_id, v_me, v_title, nullif(btrim(coalesce(p_details, '')), ''), p_needed_by)
  returning id into v_id;

  -- Everyone but the person asking. This is the whole feature: an ask that
  -- sits on a page nobody revisits is a note to self.
  for v_member in
    select gm.profile_id from group_memberships gm
    where gm.group_id = p_group_id and gm.status = 'approved' and gm.profile_id <> v_me
  loop
    insert into notifications (profile_id, type, payload)
    values (v_member, 'group_tool_request',
            jsonb_build_object('request_id', v_id, 'group_id', p_group_id, 'title', v_title));
  end loop;

  insert into events (profile_id, event_type, metadata)
  values (v_me, 'group_tool_request_created',
          jsonb_build_object('request_id', v_id, 'group_id', p_group_id));

  return v_id;
end;
$fn$;

revoke execute on function create_group_tool_request(uuid, text, text, date) from public, anon;
grant execute on function create_group_tool_request(uuid, text, text, date) to authenticated;

-- ============================================================
-- 5. Replying
-- ============================================================
create or replace function reply_to_group_tool_request(
  p_request_id uuid,
  p_body       text,
  p_tool_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me        uuid := auth.uid();
  v_body      text := btrim(coalesce(p_body, ''));
  v_group     uuid;
  v_requester uuid;
  v_status    text;
  v_title     text;
  v_id        uuid;
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;
  if v_body = '' then
    raise exception 'Write a reply first';
  end if;

  select group_id, requester_id, status, title
    into v_group, v_requester, v_status, v_title
  from group_tool_requests where id = p_request_id;

  if v_group is null then
    raise exception 'No such request';
  end if;
  if not is_approved_group_member(v_group, v_me) then
    raise exception 'Only approved members can reply';
  end if;
  if v_status <> 'open' then
    raise exception 'That request is closed';
  end if;

  -- You may only point at a tool that is yours. Otherwise a reply could
  -- volunteer somebody else's drill, and the owner would find out when a
  -- borrow request arrived.
  if p_tool_id is not null and not exists (
    select 1 from tools where id = p_tool_id and chest_id = v_me
  ) then
    raise exception 'You can only offer a tool you have listed yourself';
  end if;

  insert into group_tool_request_replies (request_id, responder_id, body, tool_id)
  values (p_request_id, v_me, v_body, p_tool_id)
  returning id into v_id;

  -- The requester, unless they are the one replying.
  if v_requester <> v_me then
    insert into notifications (profile_id, type, payload)
    values (v_requester, 'group_tool_request_reply',
            jsonb_build_object('request_id', p_request_id, 'group_id', v_group, 'title', v_title));
  end if;

  insert into events (profile_id, event_type, metadata)
  values (v_me, 'group_tool_request_replied',
          jsonb_build_object('request_id', p_request_id, 'offered_tool', p_tool_id is not null));

  return v_id;
end;
$fn$;

revoke execute on function reply_to_group_tool_request(uuid, text, uuid) from public, anon;
grant execute on function reply_to_group_tool_request(uuid, text, uuid) to authenticated;

-- ============================================================
-- 6. Closing it
-- ============================================================
-- The requester, or the group's admin. An ask left open forever is the thing
-- that makes a board like this stop being read.
create or replace function close_group_tool_request(p_request_id uuid, p_status text default 'fulfilled')
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me        uuid := auth.uid();
  v_requester uuid;
  v_group     uuid;
begin
  if v_me is null then
    raise exception 'Sign in required';
  end if;
  if p_status not in ('fulfilled', 'withdrawn', 'open') then
    raise exception 'Unknown status';
  end if;

  select requester_id, group_id into v_requester, v_group
  from group_tool_requests where id = p_request_id;

  if v_requester is null then
    raise exception 'No such request';
  end if;
  if v_me <> v_requester
     and not exists (select 1 from groups g where g.id = v_group and g.admin_id = v_me)
  then
    raise exception 'Only the person who asked, or the group admin, can close this';
  end if;

  update group_tool_requests
  set status = p_status,
      closed_at = case when p_status = 'open' then null else now() end
  where id = p_request_id;
end;
$fn$;

revoke execute on function close_group_tool_request(uuid, text) from public, anon;
grant execute on function close_group_tool_request(uuid, text) to authenticated;

-- ============================================================
-- 7. Reading a group's asks, with the names attached
-- ============================================================
-- A function rather than an embed because a requester who has gone private
-- (0057) has no visible profile row to a fellow member outside their other
-- groups -- but inside *this* group they are visible, and an ordinary
-- PostgREST embed cannot express "visible because of this group".
create or replace function group_tool_requests_for(p_group_id uuid, p_include_closed boolean default false)
returns table (
  id uuid,
  title text,
  details text,
  needed_by date,
  status text,
  created_at timestamptz,
  requester_id uuid,
  requester_name text,
  reply_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not is_approved_group_member(p_group_id, auth.uid()) then
    raise exception 'Only approved members can see this group''s requests';
  end if;

  return query
  select r.id, r.title, r.details, r.needed_by, r.status, r.created_at,
         r.requester_id, p.display_name,
         (select count(*) from group_tool_request_replies rr where rr.request_id = r.id)
  from group_tool_requests r
  join profiles p on p.id = r.requester_id
  where r.group_id = p_group_id
    and (coalesce(p_include_closed, false) or r.status = 'open')
  order by r.created_at desc
  limit 100;
end;
$fn$;

revoke execute on function group_tool_requests_for(uuid, boolean) from public, anon;
grant execute on function group_tool_requests_for(uuid, boolean) to authenticated;

create or replace function group_tool_request_thread(p_request_id uuid)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  responder_id uuid,
  responder_name text,
  tool_id uuid,
  tool_name text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_group uuid;
begin
  select group_id into v_group from group_tool_requests where id = p_request_id;
  if v_group is null then
    raise exception 'No such request';
  end if;
  if not is_approved_group_member(v_group, auth.uid()) then
    raise exception 'Only approved members can read this thread';
  end if;

  return query
  select rr.id, rr.body, rr.created_at, rr.responder_id, p.display_name, rr.tool_id, t.name
  from group_tool_request_replies rr
  join profiles p on p.id = rr.responder_id
  left join tools t on t.id = rr.tool_id
  where rr.request_id = p_request_id
  order by rr.created_at asc
  limit 200;
end;
$fn$;

revoke execute on function group_tool_request_thread(uuid) from public, anon;
grant execute on function group_tool_request_thread(uuid) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_blocked boolean := false;
begin
  -- Writes must be impossible outside the RPCs, or the notification that
  -- makes this feature work becomes optional.
  if has_table_privilege('authenticated', 'group_tool_requests', 'INSERT')
     or has_table_privilege('authenticated', 'group_tool_request_replies', 'INSERT')
  then
    raise exception 'a client can insert an ask directly, bypassing the notifications';
  end if;

  if has_table_privilege('anon', 'group_tool_requests', 'SELECT') then
    raise exception 'anon can read a group''s tool requests';
  end if;

  -- And reads must actually be refused to a non-member, which is a policy
  -- rather than a grant -- so it has to be exercised.
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000cafe","role":"authenticated"}';
  set local role authenticated;
  begin
    perform * from group_tool_requests_for(gen_random_uuid());
  exception when others then
    v_blocked := true;
  end;
  reset role;

  if not v_blocked then
    raise exception 'a non-member was not refused a group''s requests';
  end if;
end;
$chk$;
