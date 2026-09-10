-- Who owns what, and who is allowed to know.
--
-- Two changes that answer the same question from opposite ends.
--
-- 1. An account is now required to see *who* owns a tool. Until now a
--    logged-out visitor could read `display_name`, `avatar_url` and -- the
--    one that mattered -- `tools.chest_id`, which is a join key: given any
--    tool you could ask PostgREST for every other tool with the same
--    chest_id and read a stranger's whole inventory, attached to a name,
--    without ever making an account. The tools themselves stay public,
--    because a lending map nobody can look at is not a lending map. What
--    goes behind sign-in is the identity and the grouping.
--
-- 2. An owner can now choose `identity_private`: outside their groups, their
--    name and their map pin are hidden; their tools stay searchable. The pin
--    is not optional here. Every tool in a chest sits at one stored,
--    jittered point, so a shared coordinate identifies an owner just as well
--    as a label does -- hiding the name while leaving the pin would be
--    theatre. Default off.
--
-- 3. `is_platform_admin` is no longer readable by anon. It told a
--    logged-out scraper exactly which accounts are worth attacking.
--
-- Enforcement note: this is a row-level rule, not a column one, because
-- whether a name may be read depends on the *pair* of people involved. So it
-- lives in the profiles SELECT policy, where every query -- PostgREST embed,
-- RPC, or hand-written -- gets it for free, rather than in each screen.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- 1. The flag
-- ============================================================
alter table profiles
  add column if not exists identity_private boolean not null default false;

comment on column profiles.identity_private is
  'Outside my approved groups (and anyone I have dealings with), hide my display name, avatar and map pin. My tools stay searchable.';

-- Both halves of the column-grant trap (CLAUDE.md): readable *and* writable
-- by the account itself, or the Settings checkbox moves and silently reverts.
-- Deliberately not granted to anon -- a logged-out visitor has no business
-- enumerating who has gone private.
grant select (identity_private) on profiles to authenticated;
grant update (identity_private) on profiles to authenticated;

-- ============================================================
-- 2. Who may see an owner's identity
-- ============================================================
-- SECURITY DEFINER for two reasons: it reads `identity_private`, which the
-- caller may not select, and it is called from the profiles SELECT policy --
-- an invoker-rights function reading profiles from inside a profiles policy
-- would recurse (0055 was exactly that mistake on groups).
create or replace function owner_identity_visible(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    -- No account, no identity. This is change (1).
    when p_owner is null or auth.uid() is null then false
    when auth.uid() = p_owner then true
    when not coalesce((select identity_private from profiles where id = p_owner), false)
      then true
    else
      -- An approved group in common.
      exists (
        select 1
        from group_memberships mine
        join group_memberships theirs on theirs.group_id = mine.group_id
        where mine.profile_id = auth.uid() and mine.status = 'approved'
          and theirs.profile_id = p_owner and theirs.status = 'approved'
      )
      -- Or a borrow between us, either direction. Asking to borrow is itself
      -- an act of introduction: the borrower needs to know whose tool it is,
      -- and the owner needs to know who is asking in order to answer.
      or exists (
        select 1
        from borrow_requests br
        join tools t on t.id = br.tool_id
        where (br.borrower_id = auth.uid() and t.chest_id = p_owner)
           or (br.borrower_id = p_owner   and t.chest_id = auth.uid())
      )
      -- Or an open conversation, which cannot show "them" for a name.
      or exists (
        select 1 from conversations c
        where (c.participant_a_id = auth.uid() and c.participant_b_id = p_owner)
           or (c.participant_a_id = p_owner   and c.participant_b_id = auth.uid())
      )
  end;
$fn$;

-- Called from an RLS policy, so the roles the policy runs as need EXECUTE.
-- anon is granted it only so the anon policy can evaluate; it always
-- answers false there.
revoke execute on function owner_identity_visible(uuid) from public;
grant execute on function owner_identity_visible(uuid) to anon, authenticated;

-- ============================================================
-- 3. The row policies
-- ============================================================
-- A private owner's profile row simply is not there for a stranger. That is
-- what makes the rule hold in every query at once: a PostgREST embed returns
-- null, a chest page finds nobody, and search_tools' join finds no owner --
-- which is why that join becomes a LEFT JOIN below, so the *tools* survive.
drop policy if exists profiles_select_all on profiles;
create policy profiles_select_all on profiles for select to authenticated
using (
  id = auth.uid()
  -- The common case, and cheap: almost nobody turns this on.
  or not identity_private
  or owner_identity_visible(id)
);

drop policy if exists profiles_select_anon on profiles;
create policy profiles_select_anon on profiles for select to anon
using (not identity_private);

-- Identity columns, now signed-in only. The table-level SELECT was already
-- revoked in 0006 and an explicit list granted, so a column-level revoke
-- genuinely bites here (CLAUDE.md: it would be a no-op if anon held the
-- whole table).
revoke select (display_name, avatar_url, is_platform_admin) on profiles from anon;

-- The join key. Without it a logged-out visitor sees tools, and no way to
-- tell which of them belong together.
revoke select (chest_id) on tools from anon;

-- ============================================================
-- 4. Search, which is the one thing anon must keep
-- ============================================================
-- Now SECURITY DEFINER, reversing the note in 0042. It has to be: the
-- function joins tools to profiles on chest_id and reads display_name, and
-- anon may no longer select either. Running as the owner means the column
-- grants no longer stand behind this function, so the visibility rules are
-- spelled out in the body instead, and the self-check at the bottom -- which
-- already existed to catch a protected column creeping into the return type
-- -- is what guards the difference.
create or replace function search_tools(
  p_query text default null,
  p_lat   numeric default null,
  p_lng   numeric default null,
  p_limit integer default 60
)
returns table (
  id uuid,
  name text,
  category text,
  subcategory text,
  condition text,
  brand text,
  description text,
  status tool_status,
  monetize boolean,
  price numeric,
  price_duration_unit price_duration_unit,
  for_sale boolean,
  due_at timestamptz,
  chest_id uuid,
  photos text[],
  owner_display_name text,
  owner_approx_lat numeric,
  owner_approx_lng numeric,
  owner_map_pin_hidden boolean,
  distance_miles numeric
)
language sql
stable
security definer
set search_path = public
as $fn$
  with visible as (
    select
      t.id, t.name, t.category, t.subcategory, t.condition, t.brand,
      t.description, t.status, t.monetize, t.price, t.price_duration_unit,
      t.for_sale, t.due_at, t.chest_id, t.photos, t.paused, t.search_vector,
      t.created_at,
      p.display_name   as p_display_name,
      p.approx_lat     as p_approx_lat,
      p.approx_lng     as p_approx_lng,
      p.map_pin_hidden as p_map_pin_hidden,
      owner_identity_visible(t.chest_id) as owner_visible
    from tools t
    -- LEFT so a private owner's tools stay in the results with the owner
    -- blanked out, rather than dropping out of search entirely.
    left join profiles p on p.id = t.chest_id
  )
  select
    v.id, v.name, v.category, v.subcategory, v.condition, v.brand, v.description,
    v.status, v.monetize, v.price, v.price_duration_unit, v.for_sale, v.due_at,
    -- The join key, only for someone who could have followed it anyway.
    case when v.owner_visible then v.chest_id end,
    v.photos,
    case when v.owner_visible then v.p_display_name end,
    -- Name and pin travel together. A chest's tools all sit on one jittered
    -- point, so leaving the pin behind would re-identify the owner by
    -- coordinate and make the whole option meaningless.
    case when v.owner_visible then v.p_approx_lat end,
    case when v.owner_visible then v.p_approx_lng end,
    v.p_map_pin_hidden,
    case
      when p_lat is null or p_lng is null
        or not v.owner_visible
        or v.p_approx_lat is null or v.p_approx_lng is null then null
      else 3958.8 * 2 * asin(least(1, sqrt(
             sin(radians(v.p_approx_lat - p_lat) / 2) ^ 2
             + cos(radians(p_lat)) * cos(radians(v.p_approx_lat))
               * sin(radians(v.p_approx_lng - p_lng) / 2) ^ 2
           )))
    end as distance_miles
  from visible v
  where v.paused = false
    and (
      p_query is null or trim(p_query) = ''
      or v.search_vector @@ websearch_to_tsquery('english', p_query)
    )
  order by
    (case
       when p_lat is null or p_lng is null
         or not v.owner_visible
         or v.p_approx_lat is null or v.p_approx_lng is null then 1 else 0
     end),
    (case
       when p_lat is null or p_lng is null
         or not v.owner_visible
         or v.p_approx_lat is null or v.p_approx_lng is null then null
       else 3958.8 * 2 * asin(least(1, sqrt(
              sin(radians(v.p_approx_lat - p_lat) / 2) ^ 2
              + cos(radians(p_lat)) * cos(radians(v.p_approx_lat))
                * sin(radians(v.p_approx_lng - p_lng) / 2) ^ 2
            )))
     end) asc,
    v.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$fn$;

revoke execute on function search_tools(text, numeric, numeric, integer) from public;
grant execute on function search_tools(text, numeric, numeric, integer) to anon, authenticated;

-- ============================================================
-- 5. The owner card on a tool page
-- ============================================================
-- ToolDetail used to reach chest_id and a profiles(...) embed straight off
-- the row. Neither is available to anon any more, and neither would respect
-- identity_private on its own, so the whole owner block comes from here.
create or replace function tool_owner_card(p_tool_id uuid)
returns table (
  chest_id uuid,
  display_name text,
  approx_lat numeric,
  approx_lng numeric,
  map_pin_hidden boolean,
  chest_public boolean
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    case when owner_identity_visible(t.chest_id) then t.chest_id end,
    case when owner_identity_visible(t.chest_id) then p.display_name end,
    case when owner_identity_visible(t.chest_id) then p.approx_lat end,
    case when owner_identity_visible(t.chest_id) then p.approx_lng end,
    p.map_pin_hidden,
    -- No chest link for someone who cannot see whose chest it is.
    coalesce(p.chest_public, false) and owner_identity_visible(t.chest_id)
  from tools t
  join profiles p on p.id = t.chest_id
  where t.id = p_tool_id;
$fn$;

revoke execute on function tool_owner_card(uuid) from public;
grant execute on function tool_owner_card(uuid) to anon, authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
declare
  v_count integer;
  v_leak  text;
begin
  -- Still runs, still returns the shape the client destructures.
  select count(*) into v_count from search_tools(null, null, null, 5);

  if exists (
    select 1
    from information_schema.routines r
    join information_schema.parameters pa on pa.specific_name = r.specific_name
    where r.routine_name in ('search_tools', 'tool_owner_card')
      and pa.parameter_name in ('pickup_location', 'home_lat', 'home_lng', 'asking_price')
  ) then
    raise exception 'a search RPC returns a protected column';
  end if;

  -- The revokes actually bit. A column-level revoke is a no-op while a
  -- table-level grant stands, and that has cost this project six incidents.
  select string_agg(c, ', ') into v_leak from (
    select 'profiles.' || c as c
    from unnest(array['display_name', 'avatar_url', 'is_platform_admin', 'identity_private']) c
    where has_column_privilege('anon', 'profiles', c, 'SELECT')
    union all
    select 'tools.chest_id' where has_column_privilege('anon', 'tools', 'chest_id', 'SELECT')
  ) leaks;
  if v_leak is not null then
    raise exception 'anon can still read %', v_leak;
  end if;

  -- And the columns the app still needs did not get caught in the blast.
  if not has_column_privilege('authenticated', 'profiles', 'identity_private', 'SELECT')
     or not has_column_privilege('authenticated', 'profiles', 'identity_private', 'UPDATE')
     or not has_column_privilege('anon', 'profiles', 'approx_lat', 'SELECT')
     or not has_column_privilege('authenticated', 'tools', 'chest_id', 'SELECT')
  then
    raise exception 'a grant that should have survived did not';
  end if;
end;
$chk$;
