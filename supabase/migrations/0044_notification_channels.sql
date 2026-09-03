-- ============================================================
-- 0044 — email and push become separate channels
-- ============================================================
-- Until now one preference per category gated both channels at once: turning
-- off "borrow reminders" stopped the email *and* the push, and there was no way
-- to say "buzz my phone but stop filling my inbox". Getting both for every
-- event is a lot of noise for what is usually one piece of news.
--
-- Two channel switches sit *above* the existing per-category rows rather than
-- doubling them. The alternative -- an email column and a push column for each
-- of the nine categories -- is eighteen toggles to express a preference almost
-- everyone holds at the channel level ("email is too much"), so the axis people
-- actually care about is the one that gets its own control.
--
-- Both default true, which is what everyone already gets today.

alter table notification_preferences
  add column if not exists email_enabled boolean not null default true,
  add column if not exists push_enabled boolean not null default true;

comment on column notification_preferences.email_enabled is
  'Master switch for notification email. Account and security mail from Supabase Auth (password reset, address confirmation) is not routed through notifications and is unaffected.';
comment on column notification_preferences.push_enabled is
  'Master switch for web push, across every device. A single device is switched off by removing its push_subscriptions row instead.';

-- Column grants. notification_preferences never had its table-level grant
-- revoked, so a new column is readable and writable as soon as it exists --
-- unlike profiles, where 0009's explicit column list makes every addition
-- silently unwritable until it is named (see CLAUDE.md). Asserted rather than
-- assumed, so that if the table is ever narrowed to a column list this
-- migration fails loudly instead of shipping two dead toggles.
do $$
begin
  if not has_column_privilege('authenticated', 'notification_preferences', 'email_enabled', 'UPDATE')
     or not has_column_privilege('authenticated', 'notification_preferences', 'push_enabled', 'UPDATE') then
    raise exception
      'notification_preferences is column-granted; add email_enabled and push_enabled to the grant list';
  end if;
end;
$$;
