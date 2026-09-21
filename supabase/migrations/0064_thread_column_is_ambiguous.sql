-- Reading the replies to a group's ask has never worked.
--
--   ERROR: column reference "id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--   QUERY: select group_id from group_tool_requests where id = p_request_id
--
-- `returns table (id uuid, body text, ...)` declares every one of those names
-- as a PL/pgSQL variable in the function's own scope. So the lookup on line
-- five, `where id = p_request_id`, is genuinely ambiguous between the OUT
-- column `id` and `group_tool_requests.id`, and plpgsql's default
-- variable_conflict setting is `error` -- correctly, because guessing would be
-- worse. The sibling function two hundred lines up aliases its table and
-- writes `r.id`, which is why `group_tool_requests_for` works and this one
-- never did.
--
-- It presented as the feature being half-alive rather than broken: posting an
-- ask worked, the notification arrived, and replying worked -- the reply row
-- is written and returned before this statement is ever reached. The failure
-- is on the *read* that both sides do immediately afterwards, so the replier
-- watched their reply vanish and the person who asked saw an error where the
-- answer should have been.
--
-- Two things let it ship. 0062's self-check exercised `group_tool_requests_for`
-- and not this function -- reasonably, since it was testing the refusal, and
-- the refusal is the first statement, before the ambiguous one. And
-- `group_tool_requests_test.sql` has seventeen assertions about asking,
-- replying and closing, and not one that reads a thread back: everything that
-- writes was checked, and the only thing anybody actually looks at was not.
-- Both are corrected here and in that suite.
--
-- Safe to paste and re-run from the top.

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
  -- Aliased, so `r.id` cannot be read as the OUT column of the same name.
  -- Qualifying would be enough; aliasing matches group_tool_requests_for and
  -- leaves nothing unqualified for the next person to copy.
  select r.group_id into v_group from group_tool_requests r where r.id = p_request_id;
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
-- The point of this one is that it *runs the query*. A privilege check, or a
-- check that only proves the refusal fires, is exactly what missed this: the
-- refusal is the first statement in the body and the broken one is the second,
-- so a test that only asserts "an outsider is refused" passes against a
-- function no member can use.
do $chk$
declare
  v_user    uuid := gen_random_uuid();
  v_group   uuid;
  v_request uuid;
  v_replies integer;
begin
  insert into auth.users (id, email) values (v_user, 'selfcheck-0064@toolber.invalid');

  insert into groups (name, admin_id, invite_code)
  values ('Self-check 0064', v_user, 'CHK0064')
  returning id into v_group;

  insert into group_memberships (group_id, profile_id, status)
  values (v_group, v_user, 'approved');

  insert into group_tool_requests (group_id, requester_id, title)
  values (v_group, v_user, 'Self-check')
  returning id into v_request;

  insert into group_tool_request_replies (request_id, responder_id, body)
  values (v_request, v_user, 'Self-check reply');

  set local request.jwt.claims = '{"role":"authenticated"}';
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_replies from group_tool_request_thread(v_request);

  reset role;
  reset request.jwt.claims;

  if v_replies <> 1 then
    raise exception 'group_tool_request_thread returned % replies, expected 1', v_replies;
  end if;

  -- The group first: groups.admin_id references profiles with no cascade, so
  -- removing the account while it still administers one is refused.
  -- Memberships, the request and its reply all cascade from the group.
  delete from groups where id = v_group;
  delete from auth.users where id = v_user;
end;
$chk$;
