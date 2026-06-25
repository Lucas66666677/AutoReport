-- AutoLabReport Supabase schema and RLS policies.
-- Run this in Supabase SQL Editor after enabling Auth providers.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  ai_quota_used integer not null default 0,
  ai_quota_reset_at timestamptz not null default now(),
  stripe_customer_id text,
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
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles add column if not exists ai_quota_used integer not null default 0;
alter table public.profiles add column if not exists ai_quota_reset_at timestamptz not null default now();
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.documents add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.documents add column if not exists content text not null default '';
alter table public.documents add column if not exists type text not null default 'file';
alter table public.documents add column if not exists parent_id uuid references public.documents(id) on delete set null;
alter table public.documents add column if not exists is_favorite boolean not null default false;
alter table public.documents add column if not exists is_trashed boolean not null default false;
alter table public.documents add column if not exists share_setting text not null default 'private';
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

create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_share_setting_idx on public.documents(share_setting);
create index if not exists document_collaborators_document_id_idx on public.document_collaborators(document_id);
create index if not exists document_collaborators_user_email_idx on public.document_collaborators(lower(user_email));
create index if not exists ai_usage_logs_user_id_created_at_idx on public.ai_usage_logs(user_id, created_at desc);
create index if not exists report_templates_user_id_idx on public.report_templates(user_id);
create index if not exists report_templates_visibility_category_idx on public.report_templates(visibility, category);

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

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_collaborators enable row level security;
alter table public.user_ai_settings enable row level security;
alter table public.ai_usage_logs enable row level security;
alter table public.report_templates enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

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
