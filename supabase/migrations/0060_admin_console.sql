-- The platform admin console.
--
-- `is_platform_admin` has existed since 0001 and gated exactly two things:
-- reading `feedback` and reading `user_reports`. Nothing displayed either, so
-- everything submitted through them has been invisible, and there has been no
-- way to remove an abusive listing or account short of hand-written SQL.
--
-- Everything here goes through RPCs rather than new grants, for three reasons
-- that matter more than convenience:
--
--   1. The column revokes stay absolute. `home_lat`, `home_lng` and `phone`
--      are readable by no role at all, and this migration does not change
--      that. An admin sees them by calling a function that decides, not by
--      selecting a column that has been opened up. If this were a grant, it
--      would be a grant on every row for as long as the flag is set.
--
--   2. Every sensitive read is logged. admin_user_detail() writes an events
--      row naming the admin and the person they looked at, before it returns
--      anything. A compromised admin session leaves a trail; a column grant
--      would leave none.
--
--   3. The guards stay in one place. Raw deletion bypasses four things the
--      self-service paths are careful about -- photos in Storage that
--      Postgres cannot see, groups left with no administrator, borrowers
--      holding a tool whose record is about to vanish, and the difference
--      between scrubbing a profile and cascading it out of other people's
--      histories. These functions reuse that care rather than working around
--      it.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- 0. The check every function below opens with
-- ============================================================
create or replace function is_platform_admin_now()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false);
$fn$;

revoke execute on function is_platform_admin_now() from public, anon;
grant execute on function is_platform_admin_now() to authenticated;

-- ============================================================
-- 1. Site statistics
-- ============================================================
create or replace function admin_overview()
returns table (
  accounts bigint,
  accounts_active bigint,
  accounts_complete bigint,
  accounts_private bigint,
  signups_7d bigint,
  signups_30d bigint,
  tools bigint,
  tools_paused bigint,
  tools_on_loan bigint,
  groups_total bigint,
  memberships_approved bigint,
  requests_pending bigint,
  requests_approved bigint,
  requests_completed bigint,
  requests_denied bigint,
  reports_open bigint,
  feedback_total bigint,
  searches_30d bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;

  return query
  select
    (select count(*) from profiles),
    (select count(*) from profiles where deleted_at is null),
    (select count(*) from profiles where profile_complete and deleted_at is null),
    (select count(*) from profiles where identity_private and deleted_at is null),
    (select count(*) from profiles where created_at > now() - interval '7 days'),
    (select count(*) from profiles where created_at > now() - interval '30 days'),
    (select count(*) from tools),
    (select count(*) from tools where paused),
    (select count(*) from tools where status = 'borrowed'),
    (select count(*) from groups),
    (select count(*) from group_memberships where status = 'approved'),
    (select count(*) from borrow_requests where status = 'pending'),
    (select count(*) from borrow_requests where status = 'approved'),
    (select count(*) from borrow_requests where status = 'completed'),
    (select count(*) from borrow_requests where status = 'denied'),
    (select count(*) from user_reports where resolved_at is null),
    (select count(*) from feedback),
    (select count(*) from events where event_type = 'search_performed'
       and created_at > now() - interval '30 days');
end;
$fn$;

revoke execute on function admin_overview() from public, anon;
grant execute on function admin_overview() to authenticated;

-- Activity over time, for a chart. Days with no events are filled in as zero
-- rather than omitted -- a line that skips its empty days reads as busier
-- than it was.
create or replace function admin_activity(p_days integer default 30)
returns table (
  day date,
  event_type text,
  n bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;

  return query
  select d::date, t.event_type, coalesce(c.n, 0)
  from generate_series(current_date - (v_days - 1), current_date, interval '1 day') d
  cross join (select distinct e.event_type from events e
              where e.created_at > now() - make_interval(days => v_days)) t
  left join (
    select e.created_at::date as day, e.event_type, count(*) as n
    from events e
    where e.created_at > now() - make_interval(days => v_days)
    group by 1, 2
  ) c on c.day = d::date and c.event_type = t.event_type
  order by d, t.event_type;
end;
$fn$;

revoke execute on function admin_activity(integer) from public, anon;
grant execute on function admin_activity(integer) to authenticated;

-- ============================================================
-- 2. People
-- ============================================================
-- The list carries no home coordinates and no phone number. Those are one
-- function further in, so that looking someone up and looking someone *over*
-- are different acts and only the second is recorded.
create or replace function admin_list_users(
  p_query  text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  display_name text,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  deleted_at timestamptz,
  is_platform_admin boolean,
  identity_private boolean,
  profile_complete boolean,
  tools_count bigint,
  borrowed_count bigint,
  lent_count bigint,
  reports_against bigint
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;

  return query
  select
    p.id,
    p.display_name,
    u.email::text,
    p.created_at,
    u.last_sign_in_at,
    p.deleted_at,
    p.is_platform_admin,
    p.identity_private,
    p.profile_complete,
    (select count(*) from tools t where t.chest_id = p.id),
    (select count(*) from borrow_requests br where br.borrower_id = p.id),
    (select count(*) from borrow_requests br
      join tools t on t.id = br.tool_id where t.chest_id = p.id),
    (select count(*) from user_reports r where r.reported_id = p.id and r.resolved_at is null)
  from profiles p
  join auth.users u on u.id = p.id
  where v_q is null
     or p.display_name ilike '%' || v_q || '%'
     or u.email ilike '%' || v_q || '%'
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$fn$;

revoke execute on function admin_list_users(text, integer, integer) from public, anon;
grant execute on function admin_list_users(text, integer, integer) to authenticated;

-- The columns no role can select. This function is the only way to see them,
-- and it records that you did before it hands them over. That record is the
-- point: a grant would let an admin read every home address in the system
-- leaving nothing behind, and the whole location model rests on those
-- coordinates never being handed out.
create or replace function admin_user_detail(p_profile_id uuid)
returns table (
  id uuid,
  display_name text,
  email text,
  phone text,
  home_lat numeric,
  home_lng numeric,
  approx_lat numeric,
  approx_lng numeric,
  pin_radius_meters numeric,
  default_pickup_location text,
  home_address_certified_at timestamptz,
  tos_accepted_at timestamptz,
  tos_version text,
  created_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;
  if p_profile_id is null then
    raise exception 'No account named';
  end if;

  -- Written before the read, not after, so an error partway through still
  -- leaves the attempt on the record.
  insert into events (profile_id, event_type, metadata)
  values (auth.uid(), 'admin_viewed_user',
          jsonb_build_object('viewed_profile_id', p_profile_id));

  return query
  select
    p.id, p.display_name, u.email::text, p.phone,
    p.home_lat, p.home_lng, p.approx_lat, p.approx_lng, p.pin_radius_meters,
    p.default_pickup_location, p.home_address_certified_at,
    p.tos_accepted_at, p.tos_version, p.created_at, p.deleted_at
  from profiles p
  join auth.users u on u.id = p.id
  where p.id = p_profile_id;
end;
$fn$;

revoke execute on function admin_user_detail(uuid) from public, anon;
grant execute on function admin_user_detail(uuid) to authenticated;

-- ============================================================
-- 3. Removing a listing
-- ============================================================
-- Returns the photo paths, the same contract delete_my_account() uses, because
-- Postgres cannot see the Storage bucket and a caller that ignores the return
-- value leaves the images behind.
create or replace function admin_delete_tool(p_tool_id uuid, p_reason text default null)
returns text[]
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_photos text[];
  v_owner  uuid;
  v_name   text;
  r        record;
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;

  select chest_id, name, coalesce(photos, array[]::text[])
    into v_owner, v_name, v_photos
  from tools where id = p_tool_id;

  if v_owner is null then
    raise exception 'No such tool';
  end if;

  -- Unlike delete_tool(), this does not refuse while the tool is out -- an
  -- admin removing a listing is usually doing it *because* something is
  -- wrong. But the people affected are told first: the row is about to be
  -- cascaded away, and a borrower holding the tool would otherwise watch
  -- their record of it disappear with no explanation.
  for r in
    select br.borrower_id, br.status from borrow_requests br
    where br.tool_id = p_tool_id and br.status in ('pending', 'approved')
  loop
    insert into notifications (profile_id, type, payload)
    values (r.borrower_id, 'tool_removed',
            jsonb_build_object('tool_name', v_name, 'was', r.status));
  end loop;

  insert into notifications (profile_id, type, payload)
  values (v_owner, 'tool_removed',
          jsonb_build_object('tool_name', v_name, 'by_admin', true));

  insert into events (profile_id, event_type, metadata)
  values (auth.uid(), 'admin_deleted_tool',
          jsonb_build_object('tool_id', p_tool_id, 'owner_id', v_owner,
                             'tool_name', v_name, 'reason', p_reason));

  delete from tools where id = p_tool_id;
  return v_photos;
end;
$fn$;

revoke execute on function admin_delete_tool(uuid, text) from public, anon;
grant execute on function admin_delete_tool(uuid, text) to authenticated;

-- ============================================================
-- 4. Removing an account -- the scrub
-- ============================================================
-- The default, and it mirrors delete_my_account(): identifying fields wiped,
-- owned content removed, the row kept. Keeping the row is what lets the other
-- party's borrow history and messages still resolve to *somebody* rather than
-- to a hole. Someone who did nothing wrong should not lose their own records
-- because a counterparty was removed.
create or replace function admin_scrub_account(p_profile_id uuid, p_reason text default null)
returns text[]
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_photos    text[];
  v_successor uuid;
  g           record;
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;
  if p_profile_id is null then
    raise exception 'No account named';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Use Delete account in Settings to remove your own account';
  end if;
  -- One compromised admin session must not be able to remove the others.
  if coalesce((select is_platform_admin from profiles where id = p_profile_id), false) then
    raise exception 'Remove the platform admin flag first';
  end if;

  select coalesce(array_agg(p), array[]::text[]) into v_photos
  from (select unnest(photos) as p from tools where chest_id = p_profile_id) paths;

  -- Groups they administer are handed to the longest-standing other approved
  -- member rather than deleted. delete_my_account() refuses outright in this
  -- situation because nothing in the app can appoint a replacement -- here
  -- something can, and dissolving a working group because one person left is
  -- a worse outcome than an unexpected new administrator.
  for g in
    select id from groups where admin_id = p_profile_id
  loop
    select gm.profile_id into v_successor
    from group_memberships gm
    where gm.group_id = g.id and gm.profile_id <> p_profile_id and gm.status = 'approved'
    order by gm.requested_at asc
    limit 1;

    if v_successor is null then
      delete from groups where id = g.id;
    else
      update groups set admin_id = v_successor where id = g.id;
      insert into notifications (profile_id, type, payload)
      values (v_successor, 'group_handover',
              jsonb_build_object('group_id', g.id));
    end if;
  end loop;

  delete from tools where chest_id = p_profile_id;
  delete from favorites where profile_id = p_profile_id;
  delete from group_memberships where profile_id = p_profile_id;
  delete from notifications where profile_id = p_profile_id;
  delete from notification_preferences where profile_id = p_profile_id;

  update profiles set
    display_name = 'Deleted user',
    avatar_url = null,
    phone = null,
    home_lat = null,
    home_lng = null,
    approx_lat = null,
    approx_lng = null,
    pin_radius_meters = null,
    default_pickup_location = null,
    map_pin_hidden = true,
    profile_complete = false,
    auto_approve_vetted_borrowers = false,
    is_platform_admin = false,
    deleted_at = now()
  where id = p_profile_id;

  insert into events (profile_id, event_type, metadata)
  values (auth.uid(), 'admin_scrubbed_account',
          jsonb_build_object('profile_id', p_profile_id, 'reason', p_reason));

  return v_photos;
end;
$fn$;

revoke execute on function admin_scrub_account(uuid, text) from public, anon;
grant execute on function admin_scrub_account(uuid, text) to authenticated;

-- ============================================================
-- 5. Removing an account -- the hard delete
-- ============================================================
-- For the cases where the record genuinely must go. profiles.id references
-- auth.users on delete cascade, so removing the auth row takes the profile
-- and everything hanging off it -- including rows in *other people's* borrow
-- histories and conversations. That is the cost, and it is why this is the
-- second button rather than the first.
create or replace function admin_hard_delete_account(p_profile_id uuid, p_reason text default null)
returns text[]
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_photos text[];
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;
  if p_profile_id is null then
    raise exception 'No account named';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'You cannot hard-delete your own account from here';
  end if;
  if coalesce((select is_platform_admin from profiles where id = p_profile_id), false) then
    raise exception 'Remove the platform admin flag first';
  end if;

  select coalesce(array_agg(p), array[]::text[]) into v_photos
  from (select unnest(photos) as p from tools where chest_id = p_profile_id) paths;

  -- Logged before the delete. events.profile_id is the acting admin, who
  -- survives; the target only appears in the metadata, which is what keeps
  -- the record readable after the row it describes is gone.
  insert into events (profile_id, event_type, metadata)
  values (auth.uid(), 'admin_hard_deleted_account',
          jsonb_build_object('profile_id', p_profile_id, 'reason', p_reason));

  delete from auth.users where id = p_profile_id;
  return v_photos;
end;
$fn$;

revoke execute on function admin_hard_delete_account(uuid, text) from public, anon;
grant execute on function admin_hard_delete_account(uuid, text) to authenticated;

-- ============================================================
-- 6. The reports queue
-- ============================================================
create or replace function admin_resolve_report(p_report_id uuid, p_resolved boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;

  update user_reports
  set resolved_at = case when p_resolved then now() else null end
  where id = p_report_id;

  if not found then
    raise exception 'No such report';
  end if;
end;
$fn$;

revoke execute on function admin_resolve_report(uuid, boolean) from public, anon;
grant execute on function admin_resolve_report(uuid, boolean) to authenticated;

-- Reports with both sides named. user_reports is already admin-readable
-- (0015), but the names on it are not: a reported account that has gone
-- private is invisible through an ordinary embed, which is precisely the
-- account a moderator needs to see.
create or replace function admin_list_reports(p_open_only boolean default true)
returns table (
  id uuid,
  reason text,
  created_at timestamptz,
  resolved_at timestamptz,
  reporter_id uuid,
  reporter_name text,
  reported_id uuid,
  reported_name text,
  tool_id uuid,
  tool_name text
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not is_platform_admin_now() then
    raise exception 'Not permitted';
  end if;

  return query
  select r.id, r.reason, r.created_at, r.resolved_at,
         r.reporter_id, rep.display_name,
         r.reported_id, sub.display_name,
         r.context_tool_id, t.name
  from user_reports r
  left join profiles rep on rep.id = r.reporter_id
  left join profiles sub on sub.id = r.reported_id
  left join tools t on t.id = r.context_tool_id
  where not coalesce(p_open_only, true) or r.resolved_at is null
  order by r.created_at desc
  limit 200;
end;
$fn$;

revoke execute on function admin_list_reports(boolean) from public, anon;
grant execute on function admin_list_reports(boolean) to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_denied boolean := false;
begin
  -- The columns this console reads must still be ungranted. If a future
  -- migration "helpfully" grants them, the console keeps working and the
  -- protection is gone silently -- so fail here instead.
  if has_column_privilege('authenticated', 'profiles', 'home_lat', 'SELECT')
     or has_column_privilege('authenticated', 'profiles', 'phone', 'SELECT')
     or has_column_privilege('anon', 'profiles', 'home_lat', 'SELECT')
  then
    raise exception 'home_lat/phone became directly selectable -- the admin RPC is no longer the only path';
  end if;

  -- A signed-in non-admin must be refused. Runs as a real role rather than
  -- inspecting grants, because EXECUTE is deliberately granted to every
  -- authenticated user -- the refusal is inside the function body.
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000dead","role":"authenticated"}';
  set local role authenticated;
  begin
    perform * from admin_overview();
  exception when others then
    v_denied := true;
  end;
  reset role;

  if not v_denied then
    raise exception 'admin_overview did not refuse a non-admin';
  end if;
end;
$chk$;
