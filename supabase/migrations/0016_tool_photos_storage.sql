-- Wires up the Storage bucket for tool photos. `tools.photos text[]` (max 3)
-- has existed since 0001_init.sql and is already selected everywhere --
-- nothing ever created the bucket or its policies, so ListTool has shown
-- "Photo upload isn't wired up yet" the whole time.
--
-- Stores Storage *paths*, not full public URLs (matches
-- docs/technical-design.md's "Supabase Storage paths" column description) --
-- the frontend calls storage.from('tool-photos').getPublicUrl(path) to
-- render one. Path convention is `{crib_id}/{random}.{ext}`, with no tool id
-- in it: a listing's photos are uploaded before the tools row exists (there's
-- no tool id yet at that point), so ownership is enforced by the crib_id
-- segment alone, not by which tool the photo ends up on.
--
-- storage.objects already has row level security enabled by default on every
-- Supabase project -- this migration only adds policies, it doesn't need to
-- (and, running as a non-owner role via the SQL editor, generally can't)
-- toggle RLS on that table itself.
--
-- Safe to paste and re-run from the top (see 0014's header comment for why
-- that matters): the bucket insert is already ON CONFLICT DO NOTHING, and
-- each policy is dropped first since CREATE POLICY has no IF NOT EXISTS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tool-photos', 'tool-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Public read -- tool photos are shown on public Search/Tool Detail, same
-- trust level as the rest of a tool's row (everything except pickup_location).
drop policy if exists tool_photos_public_read on storage.objects;
create policy tool_photos_public_read on storage.objects for select
  using (bucket_id = 'tool-photos');

-- Owner-only write, scoped by the first path segment (the uploader's own
-- auth.uid()) -- the standard Supabase "per-user folder" storage pattern.
drop policy if exists tool_photos_owner_insert on storage.objects;
create policy tool_photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tool-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists tool_photos_owner_update on storage.objects;
create policy tool_photos_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'tool-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists tool_photos_owner_delete on storage.objects;
create policy tool_photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tool-photos' and (storage.foldername(name))[1] = auth.uid()::text);
