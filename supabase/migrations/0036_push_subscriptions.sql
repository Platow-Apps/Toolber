-- Web push subscriptions.
--
-- Email is the only way Toolber reaches someone who does not have the app
-- open, and email is slow for the things that are actually time-sensitive
-- here: a borrower standing outside waiting for a pickup spot, an owner who
-- could approve a request in five seconds.
--
-- A subscription is per browser, not per person -- the same neighbor on a
-- phone and a laptop has two rows, and both should ring. The endpoint URL is
-- the identity: the push service issues it, and it is unique per browser per
-- site, so it is the natural primary key for "have we seen this device".
--
-- Nothing here is secret in the way a pickup address is. The endpoint and keys
-- let a holder send a notification to that browser, which is a nuisance rather
-- than a disclosure, but they are still nobody else's business -- RLS scopes
-- every row to its owner and there is no public read path at all.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- Table
-- ============================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  -- The push service's URL for this browser. Unique across the table: a
  -- browser that re-subscribes must update its row rather than accumulate
  -- duplicates that would each deliver the same notification.
  endpoint text not null unique,
  -- The browser's public key and auth secret, needed to encrypt a payload
  -- to it. Base64url, straight from PushSubscription.getKey().
  p256dh text not null,
  auth text not null,
  -- Purely so a person can tell their devices apart when revoking one.
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when the push service says this subscription is gone (404/410). Kept
  -- rather than deleted so a device that goes quiet can be told apart from
  -- one that was never registered.
  expired_at timestamptz
);

create index if not exists push_subscriptions_profile_idx
  on push_subscriptions (profile_id) where expired_at is null;

alter table push_subscriptions enable row level security;

-- ============================================================
-- RLS -- your own devices, and nobody else's
-- ============================================================

drop policy if exists push_subscriptions_select_own on push_subscriptions;
create policy push_subscriptions_select_own on push_subscriptions
  for select using (profile_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on push_subscriptions;
create policy push_subscriptions_insert_own on push_subscriptions
  for insert with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_update_own on push_subscriptions;
create policy push_subscriptions_update_own on push_subscriptions
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on push_subscriptions;
create policy push_subscriptions_delete_own on push_subscriptions
  for delete using (profile_id = auth.uid());

grant select, insert, update, delete on push_subscriptions to authenticated;
revoke all on push_subscriptions from anon;

-- ============================================================
-- register_push_subscription -- upsert by endpoint
-- ============================================================
-- A plain client upsert would need the caller to guess whether the endpoint
-- already exists, and re-subscribing on a browser that had been registered to
-- a *different* account (a shared family laptop) has to move the row rather
-- than fail on the unique constraint.

create or replace function register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if coalesce(trim(p_endpoint), '') = ''
     or coalesce(trim(p_p256dh), '') = ''
     or coalesce(trim(p_auth), '') = '' then
    raise exception 'Incomplete push subscription';
  end if;

  insert into push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, nullif(trim(p_user_agent), ''))
  on conflict (endpoint) do update
    set profile_id   = auth.uid(),
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = coalesce(excluded.user_agent, push_subscriptions.user_agent),
        last_seen_at = now(),
        -- A browser that re-subscribes is alive again by definition.
        expired_at   = null;
end;
$fn$;

revoke execute on function register_push_subscription(text, text, text, text) from public;
grant execute on function register_push_subscription(text, text, text, text) to authenticated;

-- ============================================================
-- unregister_push_subscription
-- ============================================================

create or replace function unregister_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  delete from push_subscriptions
   where endpoint = p_endpoint and profile_id = auth.uid();
end;
$fn$;

revoke execute on function unregister_push_subscription(text) from public;
grant execute on function unregister_push_subscription(text) to authenticated;

-- ============================================================
-- Account deletion has to take the devices with it
-- ============================================================
-- delete_my_account() scrubs rather than deletes (0032), so the ON DELETE
-- CASCADE above never fires for it. Without this, a deleted account's phone
-- would keep receiving notifications.

create or replace function delete_my_push_subscriptions()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  delete from push_subscriptions where profile_id = auth.uid();
end;
$fn$;

revoke execute on function delete_my_push_subscriptions() from public;
grant execute on function delete_my_push_subscriptions() to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if has_table_privilege('anon', 'push_subscriptions', 'select') then
    raise exception 'push_subscriptions is readable by anon';
  end if;
  if not has_table_privilege('authenticated', 'push_subscriptions', 'select') then
    raise exception 'push_subscriptions is not readable by authenticated -- Settings cannot list devices';
  end if;
end;
$chk$;
