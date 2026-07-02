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
