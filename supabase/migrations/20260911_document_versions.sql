-- Cloud-backed report version history.
-- Run after 20260724_staging_bringup_hardening.sql.
--
-- Versions used to live only in the browser (localStorage), so a snapshot taken
-- before an AI rewrite was gone on another device or after clearing site data.
-- Rows are append-only: there are no client UPDATE policies, and only the report
-- owner can delete a snapshot.

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint document_versions_content_size check (char_length(content) <= 500000),
  constraint document_versions_title_size check (char_length(title) <= 500),
  constraint document_versions_note_size check (char_length(note) <= 200)
);

create index if not exists document_versions_document_created_idx
  on public.document_versions (document_id, created_at desc);

alter table public.document_versions enable row level security;

drop policy if exists "document_versions_select_readers" on public.document_versions;
create policy "document_versions_select_readers"
on public.document_versions for select
to authenticated
using (public.can_read_document(document_id));

drop policy if exists "document_versions_insert_editors" on public.document_versions;
create policy "document_versions_insert_editors"
on public.document_versions for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.can_edit_document(document_id)
);

drop policy if exists "document_versions_delete_owner" on public.document_versions;
create policy "document_versions_delete_owner"
on public.document_versions for delete
to authenticated
using (public.is_document_owner(document_id, auth.uid()));

-- Supabase's default privileges grant anon and authenticated everything on new
-- public tables, including TRUNCATE, which RLS does not cover. Keep only what
-- the app uses.
revoke all on public.document_versions from anon, authenticated;
grant select, insert, delete on public.document_versions to authenticated;
