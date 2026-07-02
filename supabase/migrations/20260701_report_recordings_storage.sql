-- Public recording bucket. Objects may be read through their public URL, while
-- authenticated users can only write inside their own user-id folder.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'report_recordings',
  'report_recordings',
  true,
  524288000,
  array['video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "report_recordings_public_read" on storage.objects;
create policy "report_recordings_public_read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'report_recordings');

drop policy if exists "report_recordings_insert_own_folder" on storage.objects;
create policy "report_recordings_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'report_recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "report_recordings_update_own_folder" on storage.objects;
create policy "report_recordings_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'report_recordings'
  and owner_id = auth.uid()::text
)
with check (
  bucket_id = 'report_recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "report_recordings_delete_own_folder" on storage.objects;
create policy "report_recordings_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report_recordings'
  and owner_id = auth.uid()::text
);
