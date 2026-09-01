-- An owner's tools can be seen together, on one page, at their option.
--
-- Toolber has always published tools individually: every one is searchable,
-- every one carries its owner's display name and their chest's fuzzed pin.
-- What it has never done is let you see them *together*, which meant the only
-- way to find out that a neighbor lends twelve things was to type their name
-- into search twelve times.
--
-- That gap was defended as a theft precaution, and it does not survive
-- scrutiny. A chest page publishes no new fact -- it removes the friction of
-- searching for facts already published. Protection that only inconveniences
-- honest users is not protection.
--
-- What it does add is worth having: a chest of a dozen well-described tools
-- reads as a serious neighbor in a way twelve isolated listings do not, and
-- someone who needs a saw usually also needs the sawhorses.
--
-- BE CLEAR ABOUT WHAT THIS FLAG IS. It is a display preference, not access
-- control. Tools stay individually public and individually searchable
-- whatever it is set to, and any client can still filter tools by chest_id --
-- Group Detail legitimately does. Switching it off means "do not advertise my
-- tools as a collection", and that is the honest description. Anyone who
-- wants a tool genuinely hidden should pause it (0023) instead.
--
-- Safe to paste and re-run from the top.

alter table profiles
  add column if not exists chest_public boolean not null default true;

comment on column profiles.chest_public is
  'Whether this owner''s tools are offered together on a chest page. A display preference, NOT access control -- tools stay individually public regardless. Pause a tool (0023) to actually withdraw it.';

-- 0001 revoked SELECT on profiles at table level and granted an explicit
-- column list, so a new column is unreadable until it is named here. Forgetting
-- this is the mistake that took two migrations to find on tools.search_vector.
grant select (chest_public) on profiles to anon, authenticated;

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not has_column_privilege('authenticated', 'profiles', 'chest_public', 'select') then
    raise exception 'profiles.chest_public is not selectable -- the chest link cannot be rendered';
  end if;
end;
$chk$;
