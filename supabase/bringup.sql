-- AutoLabReport: every migration, in order, for a brand-new Supabase project.
--
-- GENERATED FILE -- do not edit by hand. Regenerate with:
--     python scripts/generate_supabase_bringup.py
-- backend/tests/test_supabase_bringup.py fails when this drifts from
-- supabase/migrations/.
--
-- A fresh project needs all 9 migrations, applied in the order the
-- Supabase CLI applies them (filename order). supabase/schema_and_rls.sql is
-- byte-identical to the FIRST migration alone; a project brought up from that
-- file is missing every later one.
--
-- Paste this whole file into the Supabase SQL Editor once, on a new project,
-- after enabling the Auth providers. It is not written for a project that
-- already has some of these applied: several statements are not idempotent.
--
-- Contains no secret: schema, policies and functions only.
--
-- Applied in this order:
--   1. 20260626_initial_schema_and_rls.sql
--   2. 20260627_workspaces_and_rls.sql
--   3. 20260701_community_templates.sql
--   4. 20260701_report_ownership_transfers.sql
--   5. 20260701_report_recordings_storage.sql
--   6. 20260701_yjs_collaboration_persistence.sql
--   7. 20260702_profiles_preferences.sql
--   8. 20260723_closed_beta_security.sql
--   9. 20260724_staging_bringup_hardening.sql


-- ==========================================================================
-- 1/9  20260626_initial_schema_and_rls.sql
-- ==========================================================================

-- AutoLabReport Supabase schema and RLS policies.
-- Run this in Supabase SQL Editor after enabling Auth providers.

create extension if not exists "pgcrypto";

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  preferences jsonb not null default '{}'::jsonb,
  integrations jsonb not null default '{}'::jsonb,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  ai_daily_used integer not null default 0,
  ai_daily_reset_at timestamptz not null default now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  subscription_status text not null default 'inactive',
  subscription_current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null default '未命名報告',
  content text not null default '',
  type text not null default 'file' check (type in ('file', 'folder')),
  parent_id uuid references public.documents(id) on delete set null,
  is_favorite boolean not null default false,
  is_trashed boolean not null default false,
  share_setting text not null default 'private' check (share_setting in ('private', 'view', 'edit')),
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_collaborators (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_email text not null,
  role text not null default 'view' check (role in ('view', 'edit')),
  created_at timestamptz not null default now(),
  unique (document_id, user_email)
);

create table if not exists public.user_ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_provider text not null default 'built_in' check (preferred_provider in ('built_in', 'extension', 'user_api_key')),
  api_provider text not null default 'none' check (api_provider in ('none', 'openai', 'gemini', 'anthropic', 'deepseek')),
  api_key_encrypted text,
  default_model text,
  rewrite_prompt text,
  expand_prompt text,
  outline_prompt text,
  summarize_prompt text,
  custom_prompt text,
  prompt_library jsonb not null default '[]'::jsonb,
  extension_auto_return boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text not null default '',
  category text not null default '實驗報告',
  content text not null default '',
  author_name text not null default 'Anonymous',
  author_avatar_url text,
  visibility text not null default 'private' check (visibility in ('private', 'community')),
  source text not null default 'user' check (source in ('system', 'user')),
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  action text not null,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  status text not null default 'success',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists integrations jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists ai_daily_used integer not null default 0;
alter table public.profiles add column if not exists ai_daily_reset_at timestamptz not null default now();
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists stripe_price_id text;
alter table public.profiles add column if not exists subscription_status text not null default 'inactive';
alter table public.profiles add column if not exists subscription_current_period_end timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'ai_quota_used'
  ) then
    update public.profiles
    set ai_daily_used = coalesce(ai_daily_used, ai_quota_used)
    where ai_quota_used is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'ai_quota_reset_at'
  ) then
    update public.profiles
    set ai_daily_reset_at = coalesce(ai_daily_reset_at, ai_quota_reset_at)
    where ai_quota_reset_at is not null;
  end if;
end $$;

alter table public.documents add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.documents add column if not exists content text not null default '';
alter table public.documents add column if not exists type text not null default 'file';
alter table public.documents add column if not exists parent_id uuid references public.documents(id) on delete set null;
alter table public.documents add column if not exists is_favorite boolean not null default false;
alter table public.documents add column if not exists is_trashed boolean not null default false;
alter table public.documents add column if not exists share_setting text not null default 'private';
alter table public.documents add column if not exists view_count integer not null default 0;
alter table public.documents add column if not exists updated_at timestamptz not null default now();

alter table public.user_ai_settings add column if not exists preferred_provider text not null default 'built_in';
alter table public.user_ai_settings add column if not exists api_provider text not null default 'none';
alter table public.user_ai_settings add column if not exists api_key_encrypted text;
alter table public.user_ai_settings add column if not exists default_model text;
alter table public.user_ai_settings add column if not exists rewrite_prompt text;
alter table public.user_ai_settings add column if not exists expand_prompt text;
alter table public.user_ai_settings add column if not exists outline_prompt text;
alter table public.user_ai_settings add column if not exists summarize_prompt text;
alter table public.user_ai_settings add column if not exists custom_prompt text;
alter table public.user_ai_settings add column if not exists prompt_library jsonb not null default '[]'::jsonb;
alter table public.user_ai_settings add column if not exists extension_auto_return boolean not null default false;
alter table public.user_ai_settings add column if not exists updated_at timestamptz not null default now();

alter table public.report_templates add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.report_templates add column if not exists description text not null default '';
alter table public.report_templates add column if not exists category text not null default '實驗報告';
alter table public.report_templates add column if not exists content text not null default '';
alter table public.report_templates add column if not exists author_name text not null default 'Anonymous';
alter table public.report_templates add column if not exists author_avatar_url text;
alter table public.report_templates add column if not exists visibility text not null default 'private';
alter table public.report_templates add column if not exists source text not null default 'user';
alter table public.report_templates add column if not exists use_count integer not null default 0;
alter table public.report_templates add column if not exists updated_at timestamptz not null default now();

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user_profile();

create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_share_setting_idx on public.documents(share_setting);
create index if not exists document_collaborators_document_id_idx on public.document_collaborators(document_id);
create index if not exists document_collaborators_user_email_idx on public.document_collaborators(lower(user_email));
create index if not exists documents_public_view_idx on public.documents(id, share_setting, is_trashed);
create index if not exists ai_usage_logs_user_id_created_at_idx on public.ai_usage_logs(user_id, created_at desc);
create index if not exists report_templates_user_id_idx on public.report_templates(user_id);
create index if not exists report_templates_visibility_category_idx on public.report_templates(visibility, category);
create index if not exists profiles_stripe_customer_id_idx on public.profiles(stripe_customer_id);
create index if not exists profiles_stripe_subscription_id_idx on public.profiles(stripe_subscription_id);

insert into storage.buckets (id, name, public)
values ('report_images', 'report_images', false)
on conflict (id) do update
set public = false;

create or replace function public.is_document_owner(
  p_document_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.user_id = p_user_id
  );
$$;

create or replace function public.is_document_collaborator(
  p_document_id uuid,
  p_user_email text,
  p_required_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_collaborators dc
    where dc.document_id = p_document_id
      and lower(dc.user_email) = lower(coalesce(p_user_email, ''))
      and (
        p_required_role is null
        or dc.role = p_required_role
      )
  );
$$;

grant execute on function public.is_document_owner(uuid, uuid) to anon, authenticated;
grant execute on function public.is_document_collaborator(uuid, text, text) to anon, authenticated;

create or replace function public.increment_document_view_count(
  p_document_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.documents
  set view_count = coalesce(view_count, 0) + 1
  where id = p_document_id
    and is_trashed = false
    and share_setting in ('view', 'edit');
$$;

grant execute on function public.increment_document_view_count(uuid) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_collaborators enable row level security;
alter table public.user_ai_settings enable row level security;
alter table public.ai_usage_logs enable row level security;
alter table public.report_templates enable row level security;

drop policy if exists "report_images_public_read" on storage.objects;

drop policy if exists "report_images_authenticated_insert_own_folder" on storage.objects;
create policy "report_images_authenticated_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "report_images_authenticated_update_own_folder" on storage.objects;
create policy "report_images_authenticated_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "report_images_authenticated_delete_own_folder" on storage.objects;
create policy "report_images_authenticated_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "documents_select_owner_collaborator_public" on public.documents;
create policy "documents_select_owner_collaborator_public"
on public.documents for select
to anon, authenticated
using (
  share_setting in ('view', 'edit')
  or auth.uid() = user_id
  or public.is_document_collaborator(documents.id, auth.jwt() ->> 'email')
);

drop policy if exists "documents_insert_owner" on public.documents;
create policy "documents_insert_owner"
on public.documents for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "documents_update_owner_or_editor" on public.documents;
create policy "documents_update_owner_or_editor"
on public.documents for update
to authenticated
using (
  auth.uid() = user_id
  or share_setting = 'edit'
  or public.is_document_collaborator(documents.id, auth.jwt() ->> 'email', 'edit')
)
with check (
  auth.uid() = user_id
  or share_setting = 'edit'
  or public.is_document_collaborator(documents.id, auth.jwt() ->> 'email', 'edit')
);

drop policy if exists "documents_delete_owner" on public.documents;
create policy "documents_delete_owner"
on public.documents for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "collaborators_select_related" on public.document_collaborators;
create policy "collaborators_select_related"
on public.document_collaborators for select
to authenticated
using (
  lower(user_email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  or public.is_document_owner(document_collaborators.document_id, auth.uid())
);

drop policy if exists "collaborators_owner_manage" on public.document_collaborators;
create policy "collaborators_owner_manage"
on public.document_collaborators for all
to authenticated
using (
  public.is_document_owner(document_collaborators.document_id, auth.uid())
)
with check (
  public.is_document_owner(document_collaborators.document_id, auth.uid())
);

drop policy if exists "ai_settings_owner_all" on public.user_ai_settings;
create policy "ai_settings_owner_all"
on public.user_ai_settings for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "report_templates_select_owner_or_community" on public.report_templates;
create policy "report_templates_select_owner_or_community"
on public.report_templates for select
to anon, authenticated
using (
  visibility = 'community'
  or source = 'system'
  or auth.uid() = user_id
);

drop policy if exists "report_templates_insert_own" on public.report_templates;
create policy "report_templates_insert_own"
on public.report_templates for insert
to authenticated
with check (
  auth.uid() = user_id
  and source = 'user'
);

drop policy if exists "report_templates_update_own" on public.report_templates;
create policy "report_templates_update_own"
on public.report_templates for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and source = 'user'
);

drop policy if exists "report_templates_delete_own" on public.report_templates;
create policy "report_templates_delete_own"
on public.report_templates for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "ai_usage_logs_select_own" on public.ai_usage_logs;
create policy "ai_usage_logs_select_own"
on public.ai_usage_logs for select
to authenticated
using (auth.uid() = user_id);

-- Writes to ai_usage_logs are performed by the backend with the service role key.


-- ==========================================================================
-- 2/9  20260627_workspaces_and_rls.sql
-- ==========================================================================

-- AutoLabReport workspace migration.
-- Run this file in the Supabase SQL Editor with an administrator account.

create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid not null references public.profiles(id) on delete restrict,
  billing_plan text not null default 'free'
    check (billing_plan in ('free', 'pro', 'team')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.documents
  add column if not exists workspace_id uuid
  references public.workspaces(id) on delete cascade;

create index if not exists workspaces_created_by_idx
  on public.workspaces(created_by);
create index if not exists workspace_members_user_id_idx
  on public.workspace_members(user_id);
create index if not exists workspace_members_workspace_role_idx
  on public.workspace_members(workspace_id, role);
create index if not exists documents_workspace_id_idx
  on public.documents(workspace_id);

-- Some older accounts may own documents without having a profiles row yet.
insert into public.profiles (id, email)
select users.id, users.email
from auth.users as users
where exists (
  select 1
  from public.documents as documents
  where documents.user_id = users.id
)
on conflict (id) do nothing;

-- Backfill existing personal documents. The loop only processes documents that
-- are not assigned, so rerunning this migration does not create duplicates.
do $$
declare
  owner_id uuid;
  personal_workspace_id uuid;
begin
  for owner_id in
    select distinct user_id
    from public.documents
    where workspace_id is null
      and user_id is not null
  loop
    insert into public.workspaces (name, created_by, billing_plan)
    values ('Personal Workspace', owner_id, 'free')
    returning id into personal_workspace_id;

    insert into public.workspace_members (
      workspace_id,
      user_id,
      role,
      invited_by
    )
    values (
      personal_workspace_id,
      owner_id,
      'owner',
      owner_id
    )
    on conflict (workspace_id, user_id) do update
      set role = 'owner',
          updated_at = now();

    update public.documents
    set workspace_id = personal_workspace_id
    where workspace_id is null
      and user_id = owner_id;
  end loop;
end $$;

-- SECURITY DEFINER helpers avoid recursive RLS evaluation on workspace_members.
create or replace function public.is_workspace_member(
  target_workspace_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.workspace_members
      where workspace_id = target_workspace_id
        and user_id = target_user_id
    );
$$;

create or replace function public.workspace_has_role(
  target_workspace_id uuid,
  allowed_roles text[],
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.workspace_members
      where workspace_id = target_workspace_id
        and user_id = target_user_id
        and role = any(allowed_roles)
    );
$$;

create or replace function public.is_workspace_creator(
  target_workspace_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.workspaces
      where id = target_workspace_id
        and created_by = target_user_id
    );
$$;

create or replace function public.prevent_workspace_creator_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'workspace created_by cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.is_workspace_member(uuid, uuid) from public;
revoke all on function public.workspace_has_role(uuid, text[], uuid) from public;
revoke all on function public.is_workspace_creator(uuid, uuid) from public;
grant execute on function public.is_workspace_member(uuid, uuid)
  to anon, authenticated;
grant execute on function public.workspace_has_role(uuid, text[], uuid)
  to anon, authenticated;
grant execute on function public.is_workspace_creator(uuid, uuid)
  to authenticated;

drop trigger if exists prevent_workspace_creator_change
  on public.workspaces;
create trigger prevent_workspace_creator_change
before update of created_by on public.workspaces
for each row execute function public.prevent_workspace_creator_change();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.documents enable row level security;

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

drop policy if exists "workspaces_insert_creator" on public.workspaces;
create policy "workspaces_insert_creator"
on public.workspaces for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner"
on public.workspaces for update
to authenticated
using (public.workspace_has_role(id, array['owner']))
with check (public.workspace_has_role(id, array['owner']));

drop policy if exists "workspaces_delete_owner" on public.workspaces;
create policy "workspaces_delete_owner"
on public.workspaces for delete
to authenticated
using (public.workspace_has_role(id, array['owner']));

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_insert_owner" on public.workspace_members;
create policy "workspace_members_insert_owner"
on public.workspace_members for insert
to authenticated
with check (
  public.workspace_has_role(workspace_id, array['owner'])
  or (
    user_id = auth.uid()
    and role = 'owner'
    and public.is_workspace_creator(workspace_id)
  )
);

drop policy if exists "workspace_members_update_owner" on public.workspace_members;
create policy "workspace_members_update_owner"
on public.workspace_members for update
to authenticated
using (public.workspace_has_role(workspace_id, array['owner']))
with check (public.workspace_has_role(workspace_id, array['owner']));

drop policy if exists "workspace_members_delete_owner" on public.workspace_members;
create policy "workspace_members_delete_owner"
on public.workspace_members for delete
to authenticated
using (public.workspace_has_role(workspace_id, array['owner']));

-- Replace legacy owner/collaborator policies. Permissive PostgreSQL policies are
-- OR-combined, so leaving them in place would bypass workspace role checks.
drop policy if exists "documents_select_owner_collaborator_public"
  on public.documents;
drop policy if exists "documents_insert_owner" on public.documents;
drop policy if exists "documents_update_owner_or_editor" on public.documents;
drop policy if exists "documents_delete_owner" on public.documents;

drop policy if exists "documents_select_workspace_or_public"
  on public.documents;
create policy "documents_select_workspace_or_public"
on public.documents for select
to anon, authenticated
using (
  (
    is_trashed = false
    and share_setting in ('view', 'edit')
  )
  or public.is_workspace_member(workspace_id)
);

drop policy if exists "documents_insert_workspace_editor"
  on public.documents;
create policy "documents_insert_workspace_editor"
on public.documents for insert
to authenticated
with check (
  workspace_id is not null
  and public.workspace_has_role(workspace_id, array['owner', 'editor'])
);

drop policy if exists "documents_update_workspace_editor"
  on public.documents;
create policy "documents_update_workspace_editor"
on public.documents for update
to authenticated
using (
  public.workspace_has_role(workspace_id, array['owner', 'editor'])
)
with check (
  workspace_id is not null
  and public.workspace_has_role(workspace_id, array['owner', 'editor'])
);

drop policy if exists "documents_delete_workspace_editor"
  on public.documents;
create policy "documents_delete_workspace_editor"
on public.documents for delete
to authenticated
using (
  public.workspace_has_role(workspace_id, array['owner', 'editor'])
);

-- Keep workspace_id nullable during the frontend rollout. Once every document
-- creation path sends workspace_id and the query below returns zero, enforce it:
-- select count(*) from public.documents where workspace_id is null;
-- alter table public.documents alter column workspace_id set not null;


-- ==========================================================================
-- 3/9  20260701_community_templates.sql
-- ==========================================================================

-- Community template review and usage tracking.
-- Run this migration in the Supabase SQL Editor as an administrator.

do $$
begin
  create type public.template_review_status as enum (
    'draft',
    'pending',
    'approved',
    'rejected'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.report_templates
  add column if not exists is_public boolean not null default false,
  add column if not exists review_status public.template_review_status not null default 'draft',
  add column if not exists usage_count integer not null default 0;

alter table public.report_templates
  drop constraint if exists report_templates_usage_count_nonnegative;
alter table public.report_templates
  add constraint report_templates_usage_count_nonnegative
  check (usage_count >= 0);

-- Preserve templates that were already published under the legacy schema.
update public.report_templates
set is_public = true,
    review_status = 'approved',
    usage_count = greatest(usage_count, use_count)
where visibility = 'community';

create index if not exists report_templates_community_order_idx
  on public.report_templates (usage_count desc, created_at desc)
  where is_public = true and review_status = 'approved';

-- Atomic increment prevents lost updates when multiple users apply a template
-- at the same time. The legacy use_count is kept in sync during migration.
create or replace function public.increment_template_usage(
  p_template_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_usage_count integer;
begin
  update public.report_templates
  set usage_count = usage_count + 1,
      use_count = use_count + 1,
      updated_at = now()
  where id = p_template_id
    and is_public = true
    and review_status = 'approved'
  returning usage_count into next_usage_count;

  return next_usage_count;
end;
$$;

revoke all on function public.increment_template_usage(uuid) from public;
grant execute on function public.increment_template_usage(uuid)
  to anon, authenticated, service_role;

alter table public.report_templates enable row level security;

drop policy if exists "report_templates_select_owner_or_community"
  on public.report_templates;
create policy "report_templates_select_owner_or_community"
on public.report_templates for select
to anon, authenticated
using (
  (is_public = true and review_status = 'approved')
  or source = 'system'
  or auth.uid() = user_id
);

drop policy if exists "report_templates_insert_own"
  on public.report_templates;
create policy "report_templates_insert_own"
on public.report_templates for insert
to authenticated
with check (
  auth.uid() = user_id
  and source = 'user'
  and is_public = false
  and review_status in ('draft', 'pending')
);

drop policy if exists "report_templates_update_own"
  on public.report_templates;
create policy "report_templates_update_own"
on public.report_templates for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and source = 'user'
  and is_public = false
  and review_status in ('draft', 'pending')
);

drop policy if exists "report_templates_delete_own"
  on public.report_templates;
create policy "report_templates_delete_own"
on public.report_templates for delete
to authenticated
using (auth.uid() = user_id);

-- Administrator batch approval example:
-- update public.report_templates
-- set review_status = 'approved',
--     is_public = true,
--     visibility = 'community',
--     updated_at = now()
-- where review_status = 'pending';


-- ==========================================================================
-- 4/9  20260701_report_ownership_transfers.sql
-- ==========================================================================

-- Secure, double-confirmed report ownership transfers.
-- Run after 20260627_workspaces_and_rls.sql.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  report_id uuid references public.documents(id) on delete set null,
  from_user uuid references public.profiles(id) on delete set null,
  to_user uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  "timestamp" timestamptz not null default now()
);

create table if not exists public.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.documents(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  -- Store only the SHA-256 digest. A database leak must not expose usable tokens.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

create unique index if not exists transfer_requests_one_pending_per_report_idx
  on public.transfer_requests(report_id)
  where status = 'pending';
create index if not exists transfer_requests_recipient_status_idx
  on public.transfer_requests(to_user, status, expires_at);
create index if not exists audit_logs_report_timestamp_idx
  on public.audit_logs(report_id, "timestamp" desc);

alter table public.audit_logs enable row level security;
alter table public.transfer_requests enable row level security;

drop policy if exists "audit_logs_participants_read" on public.audit_logs;
create policy "audit_logs_participants_read"
on public.audit_logs for select
to authenticated
using (auth.uid() = from_user or auth.uid() = to_user);

drop policy if exists "transfer_requests_participants_read"
  on public.transfer_requests;
create policy "transfer_requests_participants_read"
on public.transfer_requests for select
to authenticated
using (auth.uid() = from_user or auth.uid() = to_user);

-- There are intentionally no client INSERT/UPDATE/DELETE policies. Creation and
-- confirmation are performed by the backend service role.

create or replace function public.resolve_transfer_recipient(
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id uuid;
  canonical_email text;
begin
  select id, email
  into recipient_id, canonical_email
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;

  if not found then
    return null;
  end if;

  insert into public.profiles (id, email)
  values (recipient_id, canonical_email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  return jsonb_build_object(
    'id', recipient_id,
    'email', canonical_email
  );
end;
$$;

revoke all on function public.resolve_transfer_recipient(text) from public;
grant execute on function public.resolve_transfer_recipient(text)
  to service_role;

create or replace function public.confirm_report_ownership_transfer(
  p_token_hash text,
  p_recipient_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer_row public.transfer_requests%rowtype;
  current_owner uuid;
  document_workspace_id uuid;
begin
  select *
  into transfer_row
  from public.transfer_requests
  where token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if transfer_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_processed');
  end if;

  if transfer_row.to_user <> p_recipient_user_id then
    return jsonb_build_object('ok', false, 'code', 'wrong_recipient');
  end if;

  if transfer_row.expires_at <= now() then
    update public.transfer_requests
    set status = 'expired',
        cancelled_at = now()
    where id = transfer_row.id;
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  select user_id, workspace_id
  into current_owner, document_workspace_id
  from public.documents
  where id = transfer_row.report_id
  for update;

  if not found then
    update public.transfer_requests
    set status = 'cancelled',
        cancelled_at = now()
    where id = transfer_row.id;
    return jsonb_build_object('ok', false, 'code', 'report_missing');
  end if;

  if current_owner is distinct from transfer_row.from_user then
    update public.transfer_requests
    set status = 'cancelled',
        cancelled_at = now()
    where id = transfer_row.id;
    return jsonb_build_object('ok', false, 'code', 'owner_changed');
  end if;

  update public.documents
  set user_id = transfer_row.to_user,
      updated_at = now()
  where id = transfer_row.report_id;

  -- A transferred workspace document must remain accessible to its new report
  -- owner. This does not transfer ownership of the entire workspace.
  if document_workspace_id is not null then
    insert into public.workspace_members (
      workspace_id,
      user_id,
      role,
      invited_by
    )
    values (
      document_workspace_id,
      transfer_row.to_user,
      'editor',
      transfer_row.from_user
    )
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update public.transfer_requests
  set status = 'accepted',
      confirmed_at = now()
  where id = transfer_row.id;

  insert into public.audit_logs (
    action,
    report_id,
    from_user,
    to_user,
    metadata
  )
  values (
    'transfer_ownership',
    transfer_row.report_id,
    transfer_row.from_user,
    transfer_row.to_user,
    jsonb_build_object('transfer_request_id', transfer_row.id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'accepted',
    'report_id', transfer_row.report_id,
    'from_user', transfer_row.from_user,
    'to_user', transfer_row.to_user
  );
end;
$$;

revoke all on function public.confirm_report_ownership_transfer(text, uuid)
  from public;
grant execute on function public.confirm_report_ownership_transfer(text, uuid)
  to service_role;


-- ==========================================================================
-- 5/9  20260701_report_recordings_storage.sql
-- ==========================================================================

-- Private recording bucket. Closed Beta keeps the UI disabled; the later
-- security migration adds document-aware signed-read access.

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
  false,
  524288000,
  array['video/webm']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "report_recordings_public_read" on storage.objects;

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


-- ==========================================================================
-- 6/9  20260701_yjs_collaboration_persistence.sql
-- ==========================================================================

-- Primary Yjs state storage. The service role owns all writes.

create table if not exists public.collaboration_documents (
  document_id uuid primary key references public.documents(id) on delete cascade,
  ydoc_state bytea not null,
  updated_at timestamptz not null default now()
);

create index if not exists collaboration_documents_updated_at_idx
  on public.collaboration_documents(updated_at desc);

alter table public.collaboration_documents enable row level security;

-- No anon/authenticated policies are intentional. The collaboration server
-- accesses this table with SUPABASE_SERVICE_ROLE_KEY after validating JWT and
-- document edit permissions.
revoke all on table public.collaboration_documents from anon, authenticated;


-- ==========================================================================
-- 7/9  20260702_profiles_preferences.sql
-- ==========================================================================

-- Ensure every authenticated user has a profile and cloud preferences.

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    avatar_url
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user_profile();

-- Backfill accounts created before this trigger existed.
insert into public.profiles (
  id,
  email,
  full_name,
  avatar_url
)
select
  users.id,
  users.email,
  coalesce(
    users.raw_user_meta_data ->> 'full_name',
    users.raw_user_meta_data ->> 'name'
  ),
  users.raw_user_meta_data ->> 'avatar_url'
from auth.users as users
on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      updated_at = now();

alter table public.profiles enable row level security;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);


-- ==========================================================================
-- 8/9  20260723_closed_beta_security.sql
-- ==========================================================================

-- Closed Beta security baseline.
-- The Beta uses document ownership plus explicit email collaborators. Public links are read-only.

create or replace function public.can_read_document(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = target_document_id
      and (
        d.user_id = auth.uid()
        or (
          d.is_trashed = false
          and (
            d.share_setting in ('view', 'edit')
            or exists (
              select 1
              from public.document_collaborators dc
              where dc.document_id = d.id
                and lower(dc.user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
            )
          )
        )
      )
  );
$$;

create or replace function public.can_edit_document(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.documents d
    where d.id = target_document_id
      and (
        d.user_id = auth.uid()
        or (
          d.is_trashed = false
          and exists (
            select 1
            from public.document_collaborators dc
            where dc.document_id = d.id
              and lower(dc.user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
              and dc.role = 'edit'
          )
        )
      )
  );
$$;

revoke all on function public.can_read_document(uuid) from public;
revoke all on function public.can_edit_document(uuid) from public;
grant execute on function public.can_read_document(uuid) to anon, authenticated;
grant execute on function public.can_edit_document(uuid) to authenticated;

alter table public.documents enable row level security;
alter table public.document_collaborators enable row level security;

drop policy if exists "documents_select_owner_collaborator_public" on public.documents;
drop policy if exists "documents_insert_owner" on public.documents;
drop policy if exists "documents_update_owner_or_editor" on public.documents;
drop policy if exists "documents_delete_owner" on public.documents;
drop policy if exists "documents_select_workspace_or_public" on public.documents;
drop policy if exists "documents_insert_workspace_editor" on public.documents;
drop policy if exists "documents_update_workspace_editor" on public.documents;
drop policy if exists "documents_delete_workspace_editor" on public.documents;
drop policy if exists "documents_select_closed_beta" on public.documents;
drop policy if exists "documents_insert_closed_beta_owner" on public.documents;
drop policy if exists "documents_update_closed_beta_editor" on public.documents;
drop policy if exists "documents_delete_closed_beta_owner" on public.documents;

create policy "documents_select_closed_beta"
on public.documents for select
to anon, authenticated
using (public.can_read_document(id));

create policy "documents_insert_closed_beta_owner"
on public.documents for insert
to authenticated
with check (user_id = auth.uid());

create policy "documents_update_closed_beta_editor"
on public.documents for update
to authenticated
using (public.can_edit_document(id))
with check (public.can_edit_document(id));

create policy "documents_delete_closed_beta_owner"
on public.documents for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.protect_document_security_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service-role maintenance remains possible. Client sessions cannot transfer ownership directly.
  if current_user not in ('anon', 'authenticated') or auth.role() = 'service_role' then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.workspace_id is distinct from old.workspace_id
     or new.view_count is distinct from old.view_count then
    raise exception 'protected document fields cannot be changed directly';
  end if;

  if old.user_id is distinct from auth.uid() and (
    new.title is distinct from old.title
    or new.type is distinct from old.type
    or new.parent_id is distinct from old.parent_id
    or new.is_favorite is distinct from old.is_favorite
    or new.is_trashed is distinct from old.is_trashed
    or new.share_setting is distinct from old.share_setting
  ) then
    raise exception 'collaborators may only update document content';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_document_security_fields_trigger on public.documents;
create trigger protect_document_security_fields_trigger
before update on public.documents
for each row execute function public.protect_document_security_fields();

drop policy if exists "collaborators_select_related" on public.document_collaborators;
drop policy if exists "collaborators_owner_manage" on public.document_collaborators;
drop policy if exists "collaborators_select_closed_beta" on public.document_collaborators;
drop policy if exists "collaborators_owner_manage_closed_beta" on public.document_collaborators;

create policy "collaborators_select_closed_beta"
on public.document_collaborators for select
to authenticated
using (
  public.is_document_owner(document_id, auth.uid())
  or lower(user_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create policy "collaborators_owner_manage_closed_beta"
on public.document_collaborators for all
to authenticated
using (public.is_document_owner(document_id, auth.uid()))
with check (public.is_document_owner(document_id, auth.uid()));

-- Authenticated users may edit their own display preferences, but never billing,
-- integrations, plan, or AI quota counters through the public REST API.
create or replace function public.protect_profile_service_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or auth.role() = 'service_role' then
    return new;
  end if;

  if new.integrations is distinct from old.integrations
     or new.plan is distinct from old.plan
     or new.ai_daily_used is distinct from old.ai_daily_used
     or new.ai_daily_reset_at is distinct from old.ai_daily_reset_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.stripe_price_id is distinct from old.stripe_price_id
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_current_period_end is distinct from old.subscription_current_period_end then
    raise exception 'service-managed profile fields cannot be changed by clients';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_service_fields_trigger on public.profiles;
create trigger protect_profile_service_fields_trigger
before update on public.profiles
for each row execute function public.protect_profile_service_fields();

create or replace function public.reserve_ai_quota(
  p_user_id uuid,
  p_free_limit integer,
  p_pro_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles%rowtype;
  quota_limit integer;
  current_used integer;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'service role required';
  end if;
  if p_free_limit < 1 or p_free_limit > 1000 or p_pro_limit < 1 or p_pro_limit > 10000 then
    raise exception 'invalid quota limit';
  end if;

  select * into profile_row
  from public.profiles
  where id = p_user_id
  for update;
  if not found then
    raise exception 'profile not found';
  end if;

  quota_limit := case when profile_row.plan = 'pro' then p_pro_limit else p_free_limit end;
  current_used := case
    when profile_row.ai_daily_reset_at::date = now()::date then profile_row.ai_daily_used
    else 0
  end;
  if current_used >= quota_limit then
    return jsonb_build_object('reserved', false, 'plan', profile_row.plan, 'used', current_used, 'limit', quota_limit, 'remaining', 0);
  end if;

  current_used := current_used + 1;
  update public.profiles
  set ai_daily_used = current_used,
      ai_daily_reset_at = case
        when profile_row.ai_daily_reset_at::date = now()::date then profile_row.ai_daily_reset_at
        else now()
      end,
      updated_at = now()
  where id = p_user_id;

  return jsonb_build_object(
    'reserved', true,
    'plan', profile_row.plan,
    'used', current_used,
    'limit', quota_limit,
    'remaining', greatest(quota_limit - current_used, 0)
  );
end;
$$;

create or replace function public.refund_ai_quota(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'service role required';
  end if;
  update public.profiles
  set ai_daily_used = greatest(ai_daily_used - 1, 0),
      updated_at = now()
  where id = p_user_id and ai_daily_reset_at::date = now()::date;
end;
$$;

revoke all on function public.reserve_ai_quota(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.refund_ai_quota(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_quota(uuid, integer, integer) to service_role;
grant execute on function public.refund_ai_quota(uuid) to service_role;

-- Report images must never be served from a public bucket.
update storage.buckets
set public = false
where id = 'report_images';

drop policy if exists "report_images_public_read" on storage.objects;
drop policy if exists "report_images_closed_beta_read" on storage.objects;
create policy "report_images_closed_beta_read"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'report_images'
  and public.can_read_document(
    case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[2])::uuid
      else null
    end
  )
);

drop policy if exists "report_images_authenticated_insert_own_folder" on storage.objects;
create policy "report_images_authenticated_insert_own_folder"
on storage.objects for insert
to authenticated
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

drop policy if exists "report_images_authenticated_update_own_folder" on storage.objects;
create policy "report_images_authenticated_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "report_images_authenticated_delete_own_folder" on storage.objects;
create policy "report_images_authenticated_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report_images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Screen recording is outside the Closed Beta UI, but existing objects must not remain public.
update storage.buckets
set public = false
where id = 'report_recordings';

drop policy if exists "report_recordings_public_read" on storage.objects;
drop policy if exists "report_recordings_closed_beta_read" on storage.objects;
create policy "report_recordings_closed_beta_read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'report_recordings'
  and public.can_read_document(
    case
      when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[2])::uuid
      else null
    end
  )
);


-- ==========================================================================
-- 9/9  20260724_staging_bringup_hardening.sql
-- ==========================================================================

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
