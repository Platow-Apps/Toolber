-- ============================================================
-- 0048 — a pickup spot you only type once
-- ============================================================
-- Listing a tool requires a pickup location, typed in full, every time. Most
-- people lend every one of their tools from the same place, so the second
-- listing onwards is retyping an address the app just asked for.
--
-- It cannot be filled from the default location set in Settings, and that is
-- worth being precise about: that location is *coordinates*. 0045 geocodes the
-- address, keeps the point, and throws the words away deliberately — a fuzzed
-- point cannot be turned back into a street address, which is the entire
-- reason the map is safe to publish. Prefilling a pickup address therefore
-- needs the address itself, kept on purpose.
--
-- So this is opt-in and says so in the UI. The protection matches
-- tools.pickup_location exactly, which is the same class of data already
-- stored per tool: not in the profiles SELECT grant, reachable only through
-- an RPC scoped to the owner, and disclosed to a borrower only by the
-- existing approve-then-release handshake on the tool itself. Saving it here
-- stores one copy of something that was already being stored per listing.

alter table profiles
  add column if not exists default_pickup_location text;

comment on column profiles.default_pickup_location is
  'Opt-in convenience only: the pickup spot to prefill when listing a tool. Never granted for SELECT -- reachable through get_my_default_pickup() by its owner. Disclosure to a borrower still happens per tool, via tools.pickup_location and get_pickup_location().';

-- Deliberately NOT added to the profiles SELECT grant. Stated rather than
-- assumed, because the failure mode is silent: a column added to a table whose
-- grant is an explicit list is unreadable until named, and the mistake here
-- would be naming it.

create or replace function set_my_default_pickup(p_location text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  -- Blank clears it. Someone removing a saved address should not have to find
  -- a separate control to do it.
  update profiles
  set default_pickup_location = nullif(btrim(coalesce(p_location, '')), '')
  where id = auth.uid();
end;
$$;

revoke execute on function set_my_default_pickup(text) from public, anon;
grant execute on function set_my_default_pickup(text) to authenticated;

create or replace function get_my_default_pickup()
returns text
language sql
security definer
set search_path = public
as $$
  select default_pickup_location from profiles where id = auth.uid();
$$;

revoke execute on function get_my_default_pickup() from public, anon;
grant execute on function get_my_default_pickup() to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  -- The important one: this must not have leaked into the readable column list.
  if has_column_privilege('authenticated', 'profiles', 'default_pickup_location', 'SELECT') then
    raise exception 'default_pickup_location must not be SELECT-grantable -- it is an address';
  end if;
  if has_column_privilege('anon', 'profiles', 'default_pickup_location', 'SELECT') then
    raise exception 'default_pickup_location is readable by anon';
  end if;
  if has_function_privilege('anon', 'get_my_default_pickup()', 'EXECUTE') then
    raise exception 'get_my_default_pickup must not be callable by anon';
  end if;
end;
$chk$;
