-- 0001_init.sql's trigger_notify_edge_function() was scaffolded with
-- placeholder values (YOUR_PROJECT_REF, YOUR_SERVICE_ROLE_OR_ANON_KEY) that
-- were never filled in, so no notification insert has ever actually reached
-- the notify Edge Function. This replaces it with the real project ref and
-- the anon key -- NOT the service-role key. Function bodies live in
-- pg_proc.prosrc, readable by any authenticated role, so a service-role key
-- pasted here would hand full database access to every logged-in user (see
-- docs/audit-2026-08-20.md SEC-1). The anon key carries no such risk -- it's
-- already shipped client-side in the app bundle.
--
-- This is still not the audit's fully-recommended fix (SEC-1 wants the token
-- moved into Supabase Vault plus a shared secret the Edge Function verifies,
-- so a stolen anon key alone can't trigger sends) -- that needs a Vault
-- secret created via the dashboard/CLI and an Edge Function update, both
-- separate from a plain SQL migration. Flagged to the user rather than
-- built silently. This migration only fixes "the trigger does nothing at
-- all" and the missing search_path (below), not the full SEC-1 recommendation.
--
-- Also fixes: this was the only SECURITY DEFINER function in the schema
-- missing `set search_path = public` (every other one has it -- compare
-- get_pickup_location, join_group, etc.). Without a pinned search_path, a
-- SECURITY DEFINER function can be hijacked by a caller-controlled schema.
--
-- Safe to re-run -- CREATE OR REPLACE, no drop needed.

create or replace function trigger_notify_edge_function()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://qwucgftrgkkkcwdbvlaa.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_QSr3S5yAJTtoS2bFp1gqXQ_A2xOeLdk'
    ),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
end;
$$;
