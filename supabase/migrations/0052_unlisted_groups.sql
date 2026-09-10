-- ============================================================
-- 0052 — a group can keep itself out of the directory
-- ============================================================
-- Every group appears in Find a Group. For a street, a building or a
-- workshop's regulars that is wrong: they want the people they invited, not
-- the people who searched. Without this the only way to run a closed circle
-- is to hope nobody joins, since "Request to Join" is offered on every listed
-- group and an admin can only decline so many times.
--
-- Deliberately about *discovery*, not secrecy, and the UI says so. An unlisted
-- group is not advertised: it does not appear in the directory, and a stranger
-- cannot read its row. It is not a secure enclave — its members know it
-- exists, its invite code still works for anyone who is given one, and a
-- member who leaves remembers the name. The word "unlisted" is chosen over
-- "private" for exactly that reason.
--
-- Default listed, because that is what every existing group already is and
-- silently hiding them would be a worse surprise than the feature is worth.

alter table groups
  add column if not exists listed boolean not null default true;

comment on column groups.listed is
  'Whether the group appears in Find a Group and is readable by non-members. Discovery, not secrecy: the invite code still admits anyone who holds it.';

-- The column-grant trap (CLAUDE.md). groups had its table SELECT revoked in
-- 0014 and an explicit column list granted, so a new column is unreadable
-- until named here — and the client has to read this one to render the
-- admin's own toggle.
grant select (listed) on groups to anon, authenticated;
grant update (listed) on groups to authenticated;

-- ============================================================
-- Who can see a group at all
-- ============================================================
-- Previously `using (true)` for both roles. The row itself has to become
-- unreadable to non-members, or "unlisted" means only that one query does not
-- return it — and the group is still one direct fetch away for anyone holding
-- an id.
--
-- Members and the admin keep full access, which is what leaves the existing
-- features working: the shared-groups trust signal on a borrow request reads
-- groups the *viewer* already belongs to, and Group Detail is only reachable
-- by its own members.

drop policy if exists groups_select_all on groups;
create policy groups_select_listed_or_member on groups
  for select to authenticated
  using (
    listed
    or admin_id = auth.uid()
    or exists (
      select 1 from group_memberships gm
      where gm.group_id = groups.id
        and gm.profile_id = auth.uid()
        and gm.status = 'approved'
    )
  );

-- A signed-out visitor has no membership to check, so for them unlisted means
-- invisible, full stop.
drop policy if exists groups_select_anon on groups;
create policy groups_select_anon on groups
  for select to anon
  using (listed);

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not has_column_privilege('authenticated', 'groups', 'listed', 'SELECT') then
    raise exception 'listed is not readable -- see the column-grant trap in CLAUDE.md';
  end if;

  -- The half that fails silently: an admin toggling it would see the switch
  -- move, the write refused, and the switch move back.
  if not has_column_privilege('authenticated', 'groups', 'listed', 'UPDATE') then
    raise exception 'listed is not writable -- the UPDATE half of the column-grant trap';
  end if;

  -- invite_code must not have crept into the readable set while we were here.
  if has_column_privilege('authenticated', 'groups', 'invite_code', 'SELECT') then
    raise exception 'invite_code became readable -- it is RPC-only by design (0014)';
  end if;

  if (select count(*) from pg_policies
      where tablename = 'groups' and cmd = 'SELECT' and 'anon' = any(roles)) <> 1 then
    raise exception 'expected exactly one anon SELECT policy on groups';
  end if;
end;
$chk$;

-- ============================================================
-- create_group — decide it at creation, not a moment later
-- ============================================================
-- Dropped and recreated rather than overloaded. A defaulted sixth parameter
-- would leave the five-argument version callable and PostgREST could not tell
-- which a five-argument call meant — the trap that bit deny_borrow_request and
-- request_borrow (CLAUDE.md).
--
-- The alternative was to create the group and follow with an UPDATE, which
-- the admin policy would allow. Rejected: it leaves the group listed for the
-- round trip in between, and a failed second call leaves it listed for good
-- with nothing on screen to say so. Someone creating an unlisted group means
-- it from the first instant.
--
-- Otherwise identical to 0028's version.

drop function if exists create_group(text, text, text, text, text);

create or replace function create_group(
  p_name text,
  p_neighborhood_label text default null,
  p_city text default null,
  p_zip_code text default null,
  p_default_exchange_location text default null,
  p_listed boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_code text;
  v_attempt integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A group needs a name';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := generate_invite_code();
    begin
      insert into groups (
        name, neighborhood_label, city, zip_code,
        default_exchange_location, invite_code, admin_id, listed,
        -- LOGIC-8: deliberately NULL. A new group has no pin until it has
        -- enough approved members for a centroid that doesn't identify one
        -- of them -- see refresh_group_pin.
        approx_lat, approx_lng
      )
      values (
        trim(p_name), nullif(trim(p_neighborhood_label), ''), nullif(trim(p_city), ''),
        nullif(trim(p_zip_code), ''), nullif(trim(p_default_exchange_location), ''),
        v_code, auth.uid(), coalesce(p_listed, true), null, null
      )
      returning id into v_group_id;
      exit;
    exception when unique_violation then
      -- 31^7 is ~27 billion, so this is vanishingly rare; give up rather
      -- than spin if something else is wrong.
      if v_attempt >= 5 then
        raise exception 'Could not allocate an invite code, please try again';
      end if;
    end;
  end loop;

  insert into group_memberships (group_id, profile_id, status, decided_at)
  values (v_group_id, auth.uid(), 'approved'::membership_status, now());

  return v_group_id;
end;
$$;

revoke execute on function create_group(text, text, text, text, text, boolean) from public, anon;
grant execute on function create_group(text, text, text, text, text, boolean) to authenticated;

do $chk$
begin
  -- Exactly one, or a five-argument call is ambiguous.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_group') <> 1 then
    raise exception 'create_group is overloaded -- the old signature was not dropped';
  end if;
end;
$chk$;
