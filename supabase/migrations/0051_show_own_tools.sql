-- ============================================================
-- 0051 — "show my own tools" follows the account
-- ============================================================
-- It shipped in localStorage, which made it a per-device setting: turn your
-- own pins off on a phone and they are still there on a laptop. That is the
-- wrong shape for something people set once and expect to hold, so it moves
-- onto the profile.
--
-- Only ever changes what its owner sees. Nobody else's view is affected, and
-- a tool stays listed and findable by everyone either way — this is not a
-- sharing control despite sitting near one in Settings.
--
-- Default true, matching the localStorage default: someone who has never
-- thought about it sees everything.

alter table profiles
  add column if not exists show_own_tools boolean not null default true;

comment on column profiles.show_own_tools is
  'Whether the owner sees their own tools in their own search results and map. Affects nobody else''s view.';

-- ============================================================
-- Both halves of the column-grant trap (CLAUDE.md)
-- ============================================================
-- profiles has an explicit SELECT column list (0001) *and* an explicit UPDATE
-- column list (0009). A new column is unreadable until named in the first and
-- silently unwritable until named in the second — and the UPDATE half is the
-- one that presents as a stuck checkbox rather than an error, which is how it
-- bit share_email_on_approval, share_phone_on_approval and chest_public
-- before it.
--
-- SELECT to authenticated only. anon has no use for a preference belonging to
-- a signed-in person, and the public search path never reads it.

grant select (show_own_tools) on profiles to authenticated;
grant update (show_own_tools) on profiles to authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not has_column_privilege('authenticated', 'profiles', 'show_own_tools', 'SELECT') then
    raise exception 'show_own_tools is not readable -- see the column-grant trap in CLAUDE.md';
  end if;

  -- The half that fails silently: without this the checkbox moves, the write
  -- is refused, and it moves back.
  if not has_column_privilege('authenticated', 'profiles', 'show_own_tools', 'UPDATE') then
    raise exception 'show_own_tools is not writable -- the UPDATE half of the column-grant trap';
  end if;

  -- Still nobody's business but their own.
  if has_column_privilege('anon', 'profiles', 'show_own_tools', 'SELECT') then
    raise exception 'show_own_tools should not be readable by anon';
  end if;
end;
$chk$;
