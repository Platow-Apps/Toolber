-- Toolber initial schema
-- Source of truth: docs/technical-design.md — keep this file in sync with that doc.
-- Run against a Supabase project via `supabase db push` or the SQL editor.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_net;     -- outbound HTTP calls from triggers (notify -> Edge Function)

-- ============================================================
-- Enums
-- ============================================================
create type pin_placement_mode as enum ('auto_jitter', 'manual');
create type theme_preference as enum ('light', 'dark', 'system');
create type membership_status as enum ('pending', 'approved', 'denied');
create type tool_kind as enum ('single', 'set');
create type price_duration_unit as enum ('half_day', 'day', 'week', 'month');
create type tool_status as enum ('available', 'requested', 'borrowed', 'unavailable_malfunction');
create type borrow_request_status as enum ('pending', 'approved', 'denied', 'completed', 'cancelled');

-- ============================================================
-- profiles  (1:1 with auth.users; also the "crib" owner record)
-- ============================================================
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  -- private — never granted to clients directly, only via get_pickup_location-style protection
  home_lat numeric,
  home_lng numeric,
  -- public map pin
  approx_lat numeric,
  approx_lng numeric,
  pin_radius_meters numeric,
  pin_placement_mode pin_placement_mode,
  map_pin_hidden boolean not null default false,
  profile_complete boolean not null default false,
  tos_accepted_at timestamptz,
  tos_version text,
  auto_approve_vetted_borrowers boolean not null default false,
  has_payment_method_on_file boolean not null default false,
  is_platform_admin boolean not null default false,
  theme_preference theme_preference not null default 'system',
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- groups
-- ============================================================
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  neighborhood_label text,
  city text,
  zip_code text,
  invite_code text not null unique,
  admin_id uuid not null references profiles (id),
  default_exchange_location text,
  approx_lat numeric,
  approx_lng numeric,
  created_at timestamptz not null default now()
);

create table group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  status membership_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (group_id, profile_id)
);

-- ============================================================
-- tools
-- ============================================================
create table tools (
  id uuid primary key default gen_random_uuid(),
  crib_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  category text,
  kind tool_kind not null default 'single',
  description text,
  photos text[] not null default '{}',
  portable boolean not null default true,
  supervised_required boolean not null default false,
  monetize boolean not null default false,
  price numeric,
  price_duration_unit price_duration_unit,
  status tool_status not null default 'available',
  -- most sensitive column in the schema — see column-level GRANTs below
  pickup_location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photos_max_three check (array_length(photos, 1) is null or array_length(photos, 1) <= 3)
);

-- Full-text search: name (A) + description (B) + category (C, low weight, optional)
alter table tools add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'C')
  ) stored;

create index tools_search_idx on tools using gin (search_vector);
create index tools_crib_idx on tools (crib_id);
create index tools_status_idx on tools (status);

-- ============================================================
-- favorites
-- ============================================================
create table favorites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  tool_id uuid not null references tools (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, tool_id)
);

-- ============================================================
-- borrow_requests
-- ============================================================
create table borrow_requests (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tools (id) on delete cascade,
  borrower_id uuid not null references profiles (id),
  lender_id uuid not null references profiles (id),
  status borrow_request_status not null default 'pending',
  wants_instruction boolean not null default false,
  auto_approved boolean not null default false,
  pickup_location_revealed_at timestamptz,
  -- reserved placeholder only — no logic attached yet (group-admin-facilitator idea, backlog)
  delegated_approver_id uuid references profiles (id),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

create index borrow_requests_tool_idx on borrow_requests (tool_id);
create index borrow_requests_borrower_idx on borrow_requests (borrower_id);
create index borrow_requests_lender_idx on borrow_requests (lender_id);

-- ============================================================
-- tool_malfunction_reports
-- ============================================================
create table tool_malfunction_reports (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tools (id) on delete cascade,
  reported_by uuid not null references profiles (id),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ============================================================
-- tool_authorizations  (standing per tool+borrower access-logistics state)
-- ============================================================
create table tool_authorizations (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references tools (id) on delete cascade,
  borrower_id uuid not null references profiles (id) on delete cascade,
  supervision_required boolean not null,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tool_id, borrower_id)
);

-- ============================================================
-- events  (internal analytics — no third-party vendor)
-- ============================================================
create table events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles (id) on delete set null,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index events_type_idx on events (event_type);
create index events_created_idx on events (created_at);

-- ============================================================
-- feedback
-- ============================================================
create table feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles (id) on delete set null,
  message text not null,
  page_context text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- notification_preferences  (1:1 with profiles)
-- ============================================================
create table notification_preferences (
  profile_id uuid primary key references profiles (id) on delete cascade,
  -- tool activity: in-app + email together per toggle
  tool_availability boolean not null default true,
  tool_status_change boolean not null default true,
  tool_malfunctioning boolean not null default true,
  borrower_reminders boolean not null default true,
  meeting_reminders boolean not null default true,
  -- toolber updates: email-only, platform-level
  functional boolean not null default true,
  community boolean not null default false,
  marketing boolean not null default false
);

create function handle_new_profile_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (profile_id) values (new.id);
  return new;
end;
$$;

create trigger on_profile_created_prefs
  after insert on profiles
  for each row execute function handle_new_profile_prefs();

-- ============================================================
-- notifications  (in-app feed, Realtime-subscribed)
-- ============================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_idx on notifications (profile_id, read_at);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_memberships enable row level security;
alter table tools enable row level security;
alter table favorites enable row level security;
alter table borrow_requests enable row level security;
alter table tool_malfunction_reports enable row level security;
alter table tool_authorizations enable row level security;
alter table events enable row level security;
alter table feedback enable row level security;
alter table notification_preferences enable row level security;
alter table notifications enable row level security;

-- profiles: anyone authenticated can read (column grants below restrict which columns);
-- only the owner can update their own row.
create policy profiles_select_all on profiles for select to authenticated using (true);
create policy profiles_update_own on profiles for update to authenticated using (auth.uid() = id);

-- groups: browsable by anyone authenticated; created by any authenticated user (they become admin);
-- only the admin can update.
create policy groups_select_all on groups for select to authenticated using (true);
create policy groups_insert_self_admin on groups for insert to authenticated with check (admin_id = auth.uid());
create policy groups_update_admin_only on groups for update to authenticated using (admin_id = auth.uid());

-- group_memberships: see your own memberships, or any membership for a group you administer.
-- Row creation goes through join_group(); admin decisions go through direct UPDATE (RLS-gated) below.
create policy memberships_select on group_memberships for select to authenticated using (
  profile_id = auth.uid()
  or exists (select 1 from groups g where g.id = group_memberships.group_id and g.admin_id = auth.uid())
);
create policy memberships_admin_update on group_memberships for update to authenticated using (
  exists (select 1 from groups g where g.id = group_memberships.group_id and g.admin_id = auth.uid())
);

-- tools: globally readable at the row level (column grants below exclude pickup_location);
-- only the owning crib can insert/update/delete their own tools.
create policy tools_select_all on tools for select to authenticated using (true);
create policy tools_insert_own on tools for insert to authenticated with check (crib_id = auth.uid());
create policy tools_update_own on tools for update to authenticated using (crib_id = auth.uid());
create policy tools_delete_own on tools for delete to authenticated using (crib_id = auth.uid());

-- favorites: fully owner-scoped.
create policy favorites_all_own on favorites for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- borrow_requests: readable by the borrower or lender. All writes go through RPCs (no direct grants below).
create policy borrow_requests_select on borrow_requests for select to authenticated using (
  borrower_id = auth.uid() or lender_id = auth.uid()
);

-- tool_malfunction_reports: readable by the reporter or the tool's owner. Writes via RPC only.
create policy malfunction_select on tool_malfunction_reports for select to authenticated using (
  reported_by = auth.uid()
  or exists (select 1 from tools t where t.id = tool_malfunction_reports.tool_id and t.crib_id = auth.uid())
);

-- tool_authorizations: readable by the borrower or the tool's owner. Writes via RPC only.
create policy authorizations_select on tool_authorizations for select to authenticated using (
  borrower_id = auth.uid()
  or exists (select 1 from tools t where t.id = tool_authorizations.tool_id and t.crib_id = auth.uid())
);

-- events: owner can insert their own events (client-side analytics logging);
-- only platform admins can read.
create policy events_insert_own on events for insert to authenticated with check (profile_id = auth.uid());
create policy events_select_admin on events for select to authenticated using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin)
);

-- feedback: any authenticated user can submit; only platform admins can read.
create policy feedback_insert_own on feedback for insert to authenticated with check (profile_id = auth.uid());
create policy feedback_select_admin on feedback for select to authenticated using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin)
);

-- notification_preferences: fully owner-scoped.
create policy prefs_all_own on notification_preferences for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- notifications: readable/markable-read by the recipient only. Insert happens server-side (RPCs), no client insert grant.
create policy notifications_select_own on notifications for select to authenticated using (profile_id = auth.uid());
create policy notifications_update_own on notifications for update to authenticated using (profile_id = auth.uid());

-- ============================================================
-- Column-level grants — the actual pickup_location / home_lat/lng protection.
-- RLS is row-level only; Postgres column-level GRANT/REVOKE is what keeps these
-- columns out of a general `select *` even when the row itself is visible.
-- ============================================================
revoke select on tools from authenticated;
grant select (
  id, crib_id, name, category, kind, description, photos, portable,
  supervised_required, monetize, price, price_duration_unit, status,
  search_vector, created_at, updated_at
) on tools to authenticated;
-- pickup_location intentionally NOT granted — only reachable via get_pickup_location()

revoke select on profiles from authenticated;
grant select (
  id, display_name, avatar_url, approx_lat, approx_lng, map_pin_hidden,
  profile_complete, is_platform_admin, theme_preference, created_at
) on profiles to authenticated;
-- home_lat/home_lng intentionally NOT granted — private, exists only to derive approx_lat/lng

-- ============================================================
-- RPC functions
-- ============================================================

-- Returns the tool's pickup location, but only if the caller has an approved
-- borrow_requests row for it. This is the ONLY path to that column.
create function get_pickup_location(p_tool_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location text;
begin
  if not exists (
    select 1 from borrow_requests
    where tool_id = p_tool_id
      and borrower_id = auth.uid()
      and status = 'approved'
  ) then
    raise exception 'No approved request for this tool';
  end if;

  select pickup_location into v_location from tools where id = p_tool_id;
  return v_location;
end;
$$;

-- Creates a borrow request, auto-approving if the borrower is "vetted" and the
-- lender has opted in to auto-approve.
create function request_borrow(p_tool_id uuid, p_wants_instruction boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lender_id uuid;
  v_auto_approve boolean;
  v_vetted boolean;
  v_status borrow_request_status := 'pending';
  v_auto_approved boolean := false;
  v_request_id uuid;
begin
  select crib_id into v_lender_id from tools where id = p_tool_id;
  if v_lender_id is null then
    raise exception 'Tool not found';
  end if;
  if v_lender_id = auth.uid() then
    raise exception 'Cannot request your own tool';
  end if;

  select auto_approve_vetted_borrowers into v_auto_approve from profiles where id = v_lender_id;

  -- vetted = shares an approved group with the lender, or has a payment method on file
  select exists (
    select 1
    from group_memberships gm1
    join group_memberships gm2 on gm1.group_id = gm2.group_id
    where gm1.profile_id = auth.uid() and gm1.status = 'approved'
      and gm2.profile_id = v_lender_id and gm2.status = 'approved'
  ) or exists (
    select 1 from profiles where id = auth.uid() and has_payment_method_on_file
  ) into v_vetted;

  if v_vetted and coalesce(v_auto_approve, false) then
    v_status := 'approved';
    v_auto_approved := true;
  end if;

  insert into borrow_requests (tool_id, borrower_id, lender_id, status, wants_instruction, auto_approved, decided_at, pickup_location_revealed_at)
  values (
    p_tool_id, auth.uid(), v_lender_id, v_status, p_wants_instruction, v_auto_approved,
    case when v_status = 'approved' then now() else null end,
    case when v_status = 'approved' then now() else null end
  )
  returning id into v_request_id;

  if v_status = 'approved' then
    update tools set status = 'borrowed', updated_at = now() where id = p_tool_id;
  else
    update tools set status = 'requested', updated_at = now() where id = p_tool_id;
  end if;

  insert into notifications (profile_id, type, payload)
  values (v_lender_id, 'borrow_requested', jsonb_build_object('request_id', v_request_id, 'tool_id', p_tool_id, 'auto_approved', v_auto_approved));

  return v_request_id;
end;
$$;

-- Lender approves a pending request. This IS the pickup-location reveal event.
create function approve_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool_id uuid;
  v_lender_id uuid;
  v_borrower_id uuid;
begin
  select tool_id, lender_id, borrower_id into v_tool_id, v_lender_id, v_borrower_id
  from borrow_requests where id = p_request_id;

  if v_lender_id != auth.uid() then
    raise exception 'Only the lender can approve this request';
  end if;

  update borrow_requests
  set status = 'approved', decided_at = now(), pickup_location_revealed_at = now()
  where id = p_request_id;

  update tools set status = 'borrowed', updated_at = now() where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_borrower_id, 'borrow_approved', jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id));
end;
$$;

create function deny_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool_id uuid;
  v_lender_id uuid;
  v_borrower_id uuid;
begin
  select tool_id, lender_id, borrower_id into v_tool_id, v_lender_id, v_borrower_id
  from borrow_requests where id = p_request_id;

  if v_lender_id != auth.uid() then
    raise exception 'Only the lender can deny this request';
  end if;

  update borrow_requests set status = 'denied', decided_at = now() where id = p_request_id;
  update tools set status = 'available', updated_at = now() where id = v_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_borrower_id, 'borrow_denied', jsonb_build_object('request_id', p_request_id, 'tool_id', v_tool_id));
end;
$$;

-- Files a malfunction report and immediately flips the tool to unavailable.
create function report_malfunction(p_tool_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_owner_id uuid;
begin
  select crib_id into v_owner_id from tools where id = p_tool_id;

  insert into tool_malfunction_reports (tool_id, reported_by, note)
  values (p_tool_id, auth.uid(), p_note)
  returning id into v_report_id;

  update tools set status = 'unavailable_malfunction', updated_at = now() where id = p_tool_id;

  insert into notifications (profile_id, type, payload)
  values (v_owner_id, 'tool_malfunctioning', jsonb_build_object('tool_id', p_tool_id, 'report_id', v_report_id));

  return v_report_id;
end;
$$;

-- Owner resolves a malfunction report, clearing it and making the tool requestable again.
create function resolve_malfunction(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tool_id uuid;
  v_owner_id uuid;
begin
  select tool_id into v_tool_id from tool_malfunction_reports where id = p_report_id;
  select crib_id into v_owner_id from tools where id = v_tool_id;

  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can resolve this report';
  end if;

  update tool_malfunction_reports set resolved_at = now() where id = p_report_id;
  update tools set status = 'available', updated_at = now() where id = v_tool_id;
end;
$$;

-- Owner-only: set (or create) a specific borrower's supervision requirement for a stationary tool.
-- The ONLY way supervision_required ever changes — never automatic, never borrower-initiated.
create function set_borrower_supervision(p_tool_id uuid, p_borrower_id uuid, p_supervision_required boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select crib_id into v_owner_id from tools where id = p_tool_id;
  if v_owner_id != auth.uid() then
    raise exception 'Only the tool owner can set supervision requirements';
  end if;

  insert into tool_authorizations (tool_id, borrower_id, supervision_required, updated_by)
  values (p_tool_id, p_borrower_id, p_supervision_required, auth.uid())
  on conflict (tool_id, borrower_id)
  do update set supervision_required = excluded.supervision_required, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- Joins a group by invite code (creates a pending membership row).
create function join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_admin_id uuid;
  v_membership_id uuid;
begin
  select id, admin_id into v_group_id, v_admin_id from groups where invite_code = p_invite_code;
  if v_group_id is null then
    raise exception 'Invalid invite code';
  end if;

  insert into group_memberships (group_id, profile_id, status)
  values (v_group_id, auth.uid(), 'pending')
  on conflict (group_id, profile_id) do nothing
  returning id into v_membership_id;

  insert into notifications (profile_id, type, payload)
  values (v_admin_id, 'group_join_requested', jsonb_build_object('group_id', v_group_id, 'profile_id', auth.uid()));

  return v_membership_id;
end;
$$;

-- Admin approves/denies a pending membership. RLS (memberships_admin_update) already
-- restricts this to the group's admin, so this is a thin, explicit wrapper for the
-- decided_at bookkeeping rather than a raw client-side UPDATE.
create function decide_group_membership(p_membership_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_profile_id uuid;
begin
  select group_id, profile_id into v_group_id, v_profile_id from group_memberships where id = p_membership_id;

  if not exists (select 1 from groups where id = v_group_id and admin_id = auth.uid()) then
    raise exception 'Only the group admin can decide this request';
  end if;

  update group_memberships
  set status = case when p_approve then 'approved' else 'denied' end, decided_at = now()
  where id = p_membership_id;

  insert into notifications (profile_id, type, payload)
  values (v_profile_id, case when p_approve then 'group_join_approved' else 'group_join_denied' end, jsonb_build_object('group_id', v_group_id));
end;
$$;

-- ============================================================
-- notify trigger — fires the `notify` Edge Function on every new notification.
-- Replace the URL/headers below with your actual project values once the
-- Edge Function is deployed (see supabase/functions/notify).
-- ============================================================
create function trigger_notify_edge_function()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR_SERVICE_ROLE_OR_ANON_KEY'),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
end;
$$;

create trigger on_notification_created
  after insert on notifications
  for each row execute function trigger_notify_edge_function();
