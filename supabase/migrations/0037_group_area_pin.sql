-- A group's map pin becomes something its admin states, not something derived
-- from where its members live.
--
-- History, because it explains the shape. 0001 copied the creator's own chest
-- coordinate onto the group, which put the group pin exactly on the admin's
-- chest and gave away which chest was theirs (audit LOGIC-8; `Rock'n Tool
-- Chest` and the chest `Jim B.` had byte-identical coordinates in live data).
-- 0028 fixed the leak by making the pin the mean of approved members'
-- approximate points, and withholding it below three members so the mean
-- could not single anyone out.
--
-- That fix was right about the leak and wrong about the product. A group with
-- one or two members is precisely the group that needs to be found, because it
-- is recruiting; the rule made new groups invisible on the map for exactly as
-- long as visibility mattered most. And it stripped the pin from every
-- existing group, which is why a group that had always shown on the map
-- suddenly did not.
--
-- The real mistake was deriving a group's location from its members at all.
-- A group already states where it is -- neighborhood, city, zip, typed by the
-- admin at creation. Geocoding *that* gives a pin that is public by
-- construction, describes an area rather than a person, works from the first
-- member, and cannot leak anyone's home however few members there are.
--
-- The member-average path stays as a fallback for groups that never set an
-- area, still floored at three.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- Columns
-- ============================================================

alter table groups
  add column if not exists pin_is_manual boolean not null default false;

comment on column groups.pin_is_manual is
  'True when approx_lat/lng came from the group''s stated area rather than from averaging members. refresh_group_pin() will not overwrite it.';

-- ============================================================
-- set_group_pin -- admin states where the group is
-- ============================================================

create or replace function set_group_pin(
  p_group_id uuid,
  p_lat      numeric,
  p_lng      numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select admin_id into v_admin from groups where id = p_group_id;
  if v_admin is null then
    raise exception 'Group not found';
  end if;
  if v_admin <> auth.uid() then
    raise exception 'Only the group admin can set its location';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'A pin needs both a latitude and a longitude';
  end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'That is not a point on Earth';
  end if;

  update groups
     set approx_lat = p_lat,
         approx_lng = p_lng,
         pin_is_manual = true
   where id = p_group_id;
end;
$fn$;

revoke execute on function set_group_pin(uuid, numeric, numeric) from public;
grant execute on function set_group_pin(uuid, numeric, numeric) to authenticated;

-- ============================================================
-- clear_group_pin -- back to the derived behaviour
-- ============================================================

create or replace function clear_group_pin(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select admin_id into v_admin from groups where id = p_group_id;
  if v_admin is null then
    raise exception 'Group not found';
  end if;
  if v_admin <> auth.uid() then
    raise exception 'Only the group admin can clear its location';
  end if;

  update groups set pin_is_manual = false where id = p_group_id;
  perform refresh_group_pin(p_group_id);
end;
$fn$;

revoke execute on function clear_group_pin(uuid) from public;
grant execute on function clear_group_pin(uuid) to authenticated;

-- ============================================================
-- refresh_group_pin -- leave a stated area alone
-- ============================================================
-- Otherwise the next join or departure would silently overwrite the admin's
-- pin with a member average, which is the very thing this migration removes.

create or replace function refresh_group_pin(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_min_members constant integer := 3;
  v_manual boolean;
  v_count integer;
  v_lat numeric;
  v_lng numeric;
begin
  select pin_is_manual into v_manual from groups where id = p_group_id;
  if coalesce(v_manual, false) then
    return;
  end if;

  select count(*), avg(p.approx_lat), avg(p.approx_lng)
    into v_count, v_lat, v_lng
  from group_memberships gm
  join profiles p on p.id = gm.profile_id
  where gm.group_id = p_group_id
    and gm.status = 'approved'
    and p.approx_lat is not null
    and p.approx_lng is not null
    and not p.map_pin_hidden;

  -- Still floored at three for the derived case: the mean of one member is
  -- that member's own point, and of two is the midpoint of a line between
  -- them. Both identify a home. This path only runs for groups that never
  -- stated an area.
  if v_count >= v_min_members then
    update groups set approx_lat = v_lat, approx_lng = v_lng where id = p_group_id;
  else
    update groups set approx_lat = null, approx_lng = null where id = p_group_id;
  end if;
end;
$fn$;

revoke execute on function refresh_group_pin(uuid) from public;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'groups' and column_name = 'pin_is_manual'
  ) then
    raise exception 'groups.pin_is_manual was not created';
  end if;

  -- refresh_group_pin is called from create_group, join_group,
  -- decide_group_membership and leave_group (0028). If this migration ever
  -- runs before those exist, the redefinition above would be the only copy.
  if not exists (
    select 1 from pg_proc where proname = 'refresh_group_pin'
  ) then
    raise exception 'refresh_group_pin is missing -- run 0028 first';
  end if;
end;
$chk$;
