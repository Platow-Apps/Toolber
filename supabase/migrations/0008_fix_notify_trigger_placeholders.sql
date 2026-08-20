-- 0001_init.sql's trigger_notify_edge_function() was scaffolded with
-- placeholder values (YOUR_PROJECT_REF, YOUR_SERVICE_ROLE_OR_ANON_KEY) that
-- were never filled in, so no notification insert has ever actually reached
-- the notify Edge Function. This replaces it with the real project ref and
-- anon key (the anon key is fine here -- it's already shipped client-side
-- in the app bundle; it's not more sensitive embedded in a trigger body).
-- Safe to re-run -- CREATE OR REPLACE, no drop needed.

create or replace function trigger_notify_edge_function()
returns trigger
language plpgsql
security definer
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
