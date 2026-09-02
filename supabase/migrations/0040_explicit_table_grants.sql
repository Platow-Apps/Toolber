-- Write privileges become part of the schema, instead of an accident of how
-- the project was created.
--
-- Running `supabase start` against these migrations for the first time turned
-- up something worth knowing: the resulting database cannot be written to at
-- all. `authenticated` had no INSERT, UPDATE or DELETE on any table except
-- push_subscriptions -- the one table whose migration (0036) happened to grant
-- them explicitly.
--
-- Production works because Supabase grants those privileges by default when a
-- project is created, and every migration since has been applied on top of
-- them. Nothing in this directory says so. The consequences:
--
--   * a rebuild into a fresh project -- disaster recovery, a staging
--     environment -- produces an app that cannot list a tool or approve a
--     request, and fails with "permission denied for table tools"
--   * the pgTAP suite cannot exercise a single write path, which is half of
--     what it exists for
--   * nobody can read the migrations and learn who is allowed to write what
--
-- The grants below were read off the live database rather than invented, so
-- applying this changes nothing there. It makes local match production, which
-- is what lets the tests mean anything.
--
-- ONE DELIBERATE DIFFERENCE: anon loses its write privileges. Supabase's
-- defaults hand anon INSERT, UPDATE and DELETE on every table, including
-- profiles, where `authenticated` was deliberately narrowed to a column list
-- by 0009. Nothing uses them -- every write path in the app requires a
-- session -- and RLS already refuses them, because every policy tests
-- auth.uid() and anon has none. This removes the second lock's reliance on the
-- first.
--
-- Safe to paste and re-run from the top.

do $grants$
declare
  t text;
  -- SELECT on these stays column-restricted. Granting it at table level would
  -- silently undo the protection on tools.pickup_location, tools.asking_price,
  -- profiles.home_lat/home_lng, groups.invite_code and
  -- borrow_requests.pickup_location -- the app's central privacy promise.
  v_column_select constant text[] :=
    array['tools', 'profiles', 'borrow_requests', 'groups'];
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    execute format('grant insert, delete on public.%I to authenticated', t);

    -- profiles.UPDATE is column-restricted by 0009 so that nobody can set
    -- is_platform_admin or has_payment_method_on_file on themselves. A
    -- table-level grant here would hand back exactly that escalation.
    if t <> 'profiles' then
      execute format('grant update on public.%I to authenticated', t);
    end if;

    if not (t = any (v_column_select)) then
      execute format('grant select on public.%I to authenticated', t);
    end if;

    -- The tightening. SELECT is left alone: public search legitimately reads
    -- tools, groups and profiles as anon, through the column grants in 0001,
    -- 0006 and later.
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t);
  end loop;
end;
$grants$;

-- ============================================================
-- Scope the push_subscriptions policies to authenticated
-- ============================================================
-- 0036 wrote these without a `to` clause, so they default to `public` and are
-- the only policies in the schema that do. Not exploitable -- the check is
-- profile_id = auth.uid(), which is NULL for anon, and 0036 also revokes
-- anon's table privileges -- but a policy that names its role is easier to
-- audit than one whose safety has to be argued.

drop policy if exists push_subscriptions_select_own on push_subscriptions;
create policy push_subscriptions_select_own on push_subscriptions
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on push_subscriptions;
create policy push_subscriptions_insert_own on push_subscriptions
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_update_own on push_subscriptions;
create policy push_subscriptions_update_own on push_subscriptions
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on push_subscriptions;
create policy push_subscriptions_delete_own on push_subscriptions
  for delete to authenticated using (profile_id = auth.uid());

-- ============================================================
-- Drop the stale deny_borrow_request(uuid)
-- ============================================================
-- 0001 created deny_borrow_request(uuid); 0011 added
-- deny_borrow_request(uuid, text default null) without dropping it. Both are
-- live, so a call with one argument is ambiguous -- "function
-- deny_borrow_request(uuid) is not unique" -- which is what the pgTAP suite
-- hit.
--
-- The client always passes both arguments, so production resolves to the
-- two-argument version and is unaffected. But the one-argument version is
-- still executable by any signed-in user, and it is 0010-era logic: it lacks
-- the denial reason entirely and predates everything 0014 and 0024 added. A
-- stale, callable copy of a trust-sensitive function is worth removing on its
-- own account.

drop function if exists deny_borrow_request(uuid);

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  -- The writes the app actually performs.
  if not has_table_privilege('authenticated', 'tools', 'update') then
    raise exception 'authenticated cannot UPDATE tools -- editing and pausing a listing would fail';
  end if;
  if not has_table_privilege('authenticated', 'tools', 'insert') then
    raise exception 'authenticated cannot INSERT tools -- listing a tool would fail';
  end if;
  if not has_table_privilege('authenticated', 'events', 'insert') then
    raise exception 'authenticated cannot INSERT events -- analytics would be silently empty';
  end if;
  if not has_table_privilege('authenticated', 'favorites', 'insert') then
    raise exception 'authenticated cannot INSERT favorites';
  end if;

  -- The column-level protections must survive.
  if has_table_privilege('authenticated', 'tools', 'select') then
    raise exception 'authenticated has table-level SELECT on tools -- that exposes pickup_location';
  end if;
  if has_table_privilege('authenticated', 'profiles', 'update') then
    raise exception 'authenticated has table-level UPDATE on profiles -- that is the PRIV-1 escalation 0009 closed';
  end if;
  if not has_column_privilege('authenticated', 'profiles', 'display_name', 'update') then
    raise exception 'the profiles column-level UPDATE grant was lost';
  end if;

  -- The tightening.
  if has_table_privilege('anon', 'tools', 'insert') then
    raise exception 'anon can still INSERT tools';
  end if;
  if has_table_privilege('anon', 'profiles', 'update') then
    raise exception 'anon can still UPDATE profiles';
  end if;

  -- Public search still has to work signed out.
  if not has_column_privilege('anon', 'tools', 'name', 'select') then
    raise exception 'anon lost SELECT on tools.name -- public search would break';
  end if;

  -- The ambiguity is gone.
  if (select count(*) from pg_proc where proname = 'deny_borrow_request') <> 1 then
    raise exception 'deny_borrow_request still has more than one overload';
  end if;
end;
$chk$;
