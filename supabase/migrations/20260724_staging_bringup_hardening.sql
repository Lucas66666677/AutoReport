-- Staging bring-up hardening.
-- Keep this migration additive so existing checkpoint migrations remain immutable.

-- Profiles are created by the auth trigger. Allowing arbitrary client inserts would
-- let a user choose protected billing and quota fields if their profile were absent.
drop policy if exists "profiles_insert_own" on public.profiles;

-- Remove PostgreSQL's default PUBLIC execute grant from security-sensitive helpers.
-- RLS helpers retain only the roles that must evaluate them.
revoke create on schema public from public, anon, authenticated;

revoke all on function public.handle_new_user_profile() from public;
revoke all on function public.is_document_owner(uuid, uuid) from public;
revoke all on function public.is_document_collaborator(uuid, text, text) from public;
revoke all on function public.increment_document_view_count(uuid) from public;
revoke all on function public.prevent_workspace_creator_change() from public;
revoke all on function public.protect_document_security_fields() from public;
revoke all on function public.protect_profile_service_fields() from public;

grant execute on function public.is_document_owner(uuid, uuid) to anon, authenticated;
grant execute on function public.is_document_collaborator(uuid, text, text) to anon, authenticated;
grant execute on function public.increment_document_view_count(uuid) to anon, authenticated;

-- Keep report images private and enforce server-side upload limits. SVG is omitted
-- intentionally because these files are rendered in browser-facing reports.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'report_images',
  'report_images',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- An editor uploads under their own user folder. Re-check current document access
-- on later replacements and deletions so revoked editors cannot mutate old objects.
drop policy if exists "report_images_authenticated_update_own_folder" on storage.objects;
create policy "report_images_authenticated_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.can_edit_document(
    case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[2])::uuid
      else null
    end
  )
)
with check (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.can_edit_document(
    case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[2])::uuid
      else null
    end
  )
);

drop policy if exists "report_images_authenticated_delete_own_folder" on storage.objects;
create policy "report_images_authenticated_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.can_edit_document(
    case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[2])::uuid
      else null
    end
  )
);

-- Recording is outside Closed Beta. Preserve private reads for legacy objects but
-- remove all client write paths until the feature is explicitly brought back.
drop policy if exists "report_recordings_insert_own_folder" on storage.objects;
drop policy if exists "report_recordings_update_own_folder" on storage.objects;
drop policy if exists "report_recordings_delete_own_folder" on storage.objects;

