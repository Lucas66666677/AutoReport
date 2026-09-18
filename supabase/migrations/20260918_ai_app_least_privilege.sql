-- AI apps get only what the MCP tools need.
-- Run after 20260912_template_imitation_presets.sql.
--
-- An AI app signed in through Supabase Auth's OAuth 2.1 server -- ChatGPT on the web,
-- through backend/mcp_remote.py -- holds an access token with a client_id claim. A
-- student's own sign-in never has one. Until now such a token could do everything the
-- student can. The tools only read reports, create them, change their content and keep
-- version backups, so that is all it may do now: deleting, trashing, moving, renaming
-- or re-sharing a report, and every other table and stored file, are refused.
--
-- The rules are RESTRICTIVE policies, so they only ever take permission away, and they
-- apply only where client_id is set: direct sign-ins behave exactly as before.

create or replace function public.is_ai_app_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') <> ''
$$;

revoke all on function public.is_ai_app_session() from public;
grant execute on function public.is_ai_app_session() to anon, authenticated, service_role;

-- Reports: read, create privately at the top level, and change content -- nothing else.

drop policy if exists "documents_ai_apps_never_delete" on public.documents;
create policy "documents_ai_apps_never_delete"
on public.documents as restrictive for delete
to authenticated
using (not public.is_ai_app_session());

drop policy if exists "documents_ai_apps_create_private_only" on public.documents;
create policy "documents_ai_apps_create_private_only"
on public.documents as restrictive for insert
to authenticated
with check (
  not public.is_ai_app_session()
  or (share_setting = 'private' and type = 'file' and parent_id is null and workspace_id is null)
);

create or replace function public.limit_ai_app_document_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_ai_app_session() and (
    new.title is distinct from old.title
    or new.type is distinct from old.type
    or new.parent_id is distinct from old.parent_id
    or new.is_favorite is distinct from old.is_favorite
    or new.is_trashed is distinct from old.is_trashed
    or new.share_setting is distinct from old.share_setting
  ) then
    raise exception 'AI apps may only change a report''s content';
  end if;
  return new;
end;
$$;

revoke all on function public.limit_ai_app_document_changes() from public;

drop trigger if exists limit_ai_app_document_changes_trigger on public.documents;
create trigger limit_ai_app_document_changes_trigger
before update on public.documents
for each row execute function public.limit_ai_app_document_changes();

-- Version history: an AI app may add backups, never remove one.

drop policy if exists "document_versions_ai_apps_never_delete" on public.document_versions;
create policy "document_versions_ai_apps_never_delete"
on public.document_versions as restrictive for delete
to authenticated
using (not public.is_ai_app_session());

-- Everything else is the student's alone.

drop policy if exists "profiles_no_ai_apps" on public.profiles;
create policy "profiles_no_ai_apps"
on public.profiles as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "user_ai_settings_no_ai_apps" on public.user_ai_settings;
create policy "user_ai_settings_no_ai_apps"
on public.user_ai_settings as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "document_collaborators_no_ai_apps" on public.document_collaborators;
create policy "document_collaborators_no_ai_apps"
on public.document_collaborators as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "collaboration_documents_no_ai_apps" on public.collaboration_documents;
create policy "collaboration_documents_no_ai_apps"
on public.collaboration_documents as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "report_templates_no_ai_apps" on public.report_templates;
create policy "report_templates_no_ai_apps"
on public.report_templates as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "template_imitation_presets_no_ai_apps" on public.template_imitation_presets;
create policy "template_imitation_presets_no_ai_apps"
on public.template_imitation_presets as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "transfer_requests_no_ai_apps" on public.transfer_requests;
create policy "transfer_requests_no_ai_apps"
on public.transfer_requests as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "workspaces_no_ai_apps" on public.workspaces;
create policy "workspaces_no_ai_apps"
on public.workspaces as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "workspace_members_no_ai_apps" on public.workspace_members;
create policy "workspace_members_no_ai_apps"
on public.workspace_members as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "ai_usage_logs_no_ai_apps" on public.ai_usage_logs;
create policy "ai_usage_logs_no_ai_apps"
on public.ai_usage_logs as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

drop policy if exists "audit_logs_no_ai_apps" on public.audit_logs;
create policy "audit_logs_no_ai_apps"
on public.audit_logs as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());

-- Report images and recordings.

drop policy if exists "storage_no_ai_apps" on storage.objects;
create policy "storage_no_ai_apps"
on storage.objects as restrictive for all
to authenticated
using (not public.is_ai_app_session())
with check (not public.is_ai_app_session());
