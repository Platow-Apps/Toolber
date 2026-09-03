-- Profile pictures.
--
-- profiles.avatar_url has existed since 0001 and has never been written to.
-- Nothing rendered it either -- every avatar in the app is the first letter of
-- a display name on a coloured circle. This adds the bucket it needs.
--
-- Modelled directly on 0016's tool-photos bucket: public read, and writes
-- scoped to a folder named after the uploader's own auth.uid(). A profile
-- picture is shown next to a display name on public Search, so it is exactly
-- as public as the name it accompanies -- no more, and no less.
--
-- 2 MB rather than tool-photos' 5 MB. An avatar is rendered at 44px and stored
-- at 256; anything approaching the limit is a phone camera original that the
-- client should have shrunk before it got here.
--
-- Safe to paste and re-run from the top.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Public read: an avatar sits beside a display name wherever that name is
-- shown, including signed-out Search.
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects for select
  using (bucket_id = 'avatars');

-- Owner-only write, scoped by the first path segment. Same per-user folder
-- pattern as tool-photos, which is what keeps one person from overwriting
-- another's picture.
drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- The column name says url and the value is a path. Renaming it would mean
-- touching the 0006 and 0009 column grants and every consumer, for no gain, so
-- the mismatch is documented instead. Storing a path rather than a URL matches
-- tools.photos and for the same reason: a stored URL bakes in the project ref
-- and breaks if the project ever moves.
comment on column profiles.avatar_url is
  'Storage path within the avatars bucket (e.g. "<uid>/abc123.jpg"), NOT a URL despite the name. Turn it into one with avatarUrl() in src/lib/avatars.js.';

-- ============================================================
-- Self-check
-- ============================================================
do $chk$
begin
  if not exists (select 1 from storage.buckets where id = 'avatars') then
    raise exception 'the avatars bucket was not created';
  end if;
  if not (select public from storage.buckets where id = 'avatars') then
    raise exception 'the avatars bucket is not public -- profile pictures would not load';
  end if;
  -- 0009 already grants UPDATE on avatar_url; without it the column is
  -- unwritable and the upload would silently revert (see 0039).
  if not has_column_privilege('authenticated', 'profiles', 'avatar_url', 'update') then
    raise exception 'profiles.avatar_url is not updatable by authenticated';
  end if;
  if not has_column_privilege('anon', 'profiles', 'avatar_url', 'select') then
    raise exception 'anon cannot read avatar_url -- avatars would vanish on signed-out Search';
  end if;
end;
$chk$;
