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
-- Two of these live in Vault, on the database side, and one lives in the Edge
-- Function's own separate secret store. The shared secret goes in BOTH, which
-- is the whole mechanism: the trigger sends it, the function compares it.
-- Mixing up which store is which is the usual way this ends up half-done.
--
-- 0. Log in, if you have not on this machine. Steps 3 and 4 are Management API
--    calls and fail with an auth error without a token, unlike `db push`:
--
--      ./node_modules/.bin/supabase login
--
-- 1. Generate a shared secret (any long random string), e.g. in a terminal:
--
--      openssl rand -hex 32
--
-- 2. Store both secrets in Vault, in the SQL editor. The first value is the
--    publishable key the trigger previously carried inline -- the same one
--    that ships in the browser bundle, NOT the service-role key, since a
--    readable function body holding one of those is the whole reason SEC-1
--    exists. The second is what you generated in step 1:
--
--      select vault.create_secret('sb_publishable_...', 'notify_function_auth',
--                                 'Authorization bearer token for the notify Edge Function');
--      select vault.create_secret('<your-random-secret>', 'notify_shared_secret',
--                                 'Shared secret proving a notify call came from this database');
--
--    To rotate later, use vault.update_secret(id, new_value) rather than
--    creating a second secret with the same name. The function reads
--    NOTIFY_SHARED_SECRET_PREVIOUS during a rotation; the sequence is in the
--    header of supabase/functions/notify/index.ts.
--
-- 3. Give the Edge Function the same shared secret, from a terminal:
--
--      ./node_modules/.bin/supabase secrets set NOTIFY_SHARED_SECRET=<your-random-secret>
--
--    The local binary, not `npx supabase`. npx re-resolves the CLI from the
--    registry every run, and 2.115.0 shipped a bundler bug that failed
--    `functions deploy` with no message and no stack. The CLI is a pinned
--    devDependency precisely so this step cannot pick up whatever is newest;
--    see CLAUDE.md.
--
--    While you are there, confirm RESEND_API_KEY is set, or the signature will
--    verify and the send will still fail:
--
--      ./node_modules/.bin/supabase secrets list
--
-- 4. Redeploy so the function picks it up:
--
--      npm run supabase:functions:deploy
--
-- Order matters, and the failure is asymmetric. index.ts refuses EVERY request
-- when NOTIFY_SHARED_SECRET is unset -- deploy before setting it and there are
-- no emails at all until you notice. Set the secrets first and the worst case
-- is a few more minutes of the warning below.
--
-- To confirm it took: every notification insert currently logs "notify: vault
-- secrets ... missing, skipping email dispatch". Once both Vault secrets
-- exist that warning stops, so trigger any notification and look for a real
-- invocation in the function logs instead of the warning in the Postgres logs.
