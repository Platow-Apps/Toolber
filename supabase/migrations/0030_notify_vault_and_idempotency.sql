-- Closes SEC-1's remainder and SEC-4.
--
-- SEC-1 — trigger_notify_edge_function() carried its Authorization token as a
-- string literal in the function body. Function bodies are readable by any
-- logged-in user through pg_proc, so that is a credential in public view. It
-- is a *publishable* key, so the practical severity is low, but "low" is not
-- "none" and the fix is cheap. Both the token and the new shared secret now
-- come from Vault at call time; the body carries only their names.
--
-- SEC-4 — the function endpoint had no way to tell a real trigger from
-- anyone else who knew the URL and held the publishable key, and nothing
-- stopped the same notification being delivered twice if net.http_post
-- retried. A shared secret header authenticates the caller, and
-- notification_deliveries makes delivery idempotent.
--
-- SETUP REQUIRED — this migration alone does not finish the job. See the
-- block at the bottom for the two Vault secrets and the one function secret
-- you have to create yourself. Until they exist the trigger logs a warning
-- and skips dispatch, which means no emails but a fully working app.
--
-- Safe to paste and re-run from the top.

-- ============================================================
-- SEC-4 (idempotency)
-- ============================================================
-- One row per notification actually handed to Resend. The Edge Function
-- claims a notification here before sending, so a duplicate trigger fire or
-- an http retry is a no-op rather than a second email.

create table if not exists notification_deliveries (
  notification_id uuid primary key references notifications (id) on delete cascade,
  delivered_at timestamptz not null default now()
);

alter table notification_deliveries enable row level security;

-- No policies on purpose: nothing but the Edge Function's service role (which
-- bypasses RLS) has any business reading or writing this.
revoke all on notification_deliveries from anon, authenticated;

-- ============================================================
-- SEC-1 — secrets out of the function body, into Vault
-- ============================================================

create or replace function trigger_notify_edge_function()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth text;
  v_secret text;
begin
  -- Fully schema-qualified because search_path is pinned to public above.
  select decrypted_secret into v_auth
  from vault.decrypted_secrets where name = 'notify_function_auth' limit 1;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'notify_shared_secret' limit 1;

  -- Warn and carry on rather than raising. This trigger runs inside the
  -- transaction that inserted the notification, which is itself inside a
  -- borrow request or a group decision -- raising here would fail that whole
  -- user action because email happens to be misconfigured. In-app
  -- notifications keep working either way; only the email is skipped.
  if v_auth is null or v_secret is null then
    raise warning 'notify: vault secrets notify_function_auth / notify_shared_secret missing, skipping email dispatch for notification %', new.id;
    return new;
  end if;

  perform net.http_post(
    url := 'https://qwucgftrgkkkcwdbvlaa.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_auth,
      -- Proves the call came from this database, not merely from someone
      -- holding the publishable key (SEC-4).
      'x-toolber-signature', v_secret
    ),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
end;
$$;

-- ============================================================
-- SETUP — run these yourself, with your own values
-- ============================================================
-- Not in this file, because they contain secrets and this file is in git.
--
-- 1. Generate a shared secret (any long random string), e.g. in a terminal:
--
--      openssl rand -hex 32
--
-- 2. Store both secrets in Vault, in the SQL editor. The first value is the
--    publishable key the trigger previously carried inline; the second is
--    what you generated in step 1:
--
--      select vault.create_secret('sb_publishable_...', 'notify_function_auth',
--                                 'Authorization bearer token for the notify Edge Function');
--      select vault.create_secret('<your-random-secret>', 'notify_shared_secret',
--                                 'Shared secret proving a notify call came from this database');
--
--    To rotate later, use vault.update_secret(id, new_value) rather than
--    creating a second secret with the same name.
--
-- 3. Give the Edge Function the same shared secret, from a terminal:
--
--      npx supabase secrets set NOTIFY_SHARED_SECRET=<your-random-secret>
--
-- 4. Redeploy so the function picks it up:
--
--      npm run supabase:functions:deploy
--
-- Order matters: the function rejects unsigned calls once deployed, so set
-- the secrets before redeploying or notifications stop being emailed until
-- you do.
