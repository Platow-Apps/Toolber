-- Lets a user report another user's bad behavior straight to Toolber admins.
-- Same shape as `feedback` (0001_init.sql): a plain owner-scoped insert, no
-- RPC needed since there's no trust-sensitive decision being made, and
-- select is restricted to platform admins. No admin UI page exists for this
-- yet -- same as `feedback`/`events`, read via the Supabase dashboard.
--
-- context_request_id / context_tool_id are both optional and independent:
-- a report can come from a chat thread, an approved request, a tool
-- listing, or nowhere in particular. Neither is required to file a report.
--
-- Safe to paste and re-run from the top (see 0014's header comment for why
-- that matters): CREATE TABLE/INDEX use IF NOT EXISTS, and each policy is
-- dropped first since CREATE POLICY has no IF NOT EXISTS in Postgres.

create table if not exists user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles (id) on delete cascade,
  reported_id uuid not null references profiles (id) on delete cascade,
  reason text not null,
  context_request_id uuid references borrow_requests (id) on delete set null,
  context_tool_id uuid references tools (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint user_reports_not_self check (reporter_id != reported_id)
);

create index if not exists user_reports_reported_idx on user_reports (reported_id);
create index if not exists user_reports_reporter_idx on user_reports (reporter_id);

alter table user_reports enable row level security;

drop policy if exists user_reports_insert_own on user_reports;
create policy user_reports_insert_own on user_reports for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists user_reports_select_admin on user_reports;
create policy user_reports_select_admin on user_reports for select to authenticated using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin)
);

-- Lets an admin clear a report once handled, same "review, don't auto-act"
-- posture as malfunction reports (resolve_malfunction is owner-only there;
-- here it's admin-only).
drop policy if exists user_reports_update_admin on user_reports;
create policy user_reports_update_admin on user_reports for update to authenticated using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.is_platform_admin)
);
