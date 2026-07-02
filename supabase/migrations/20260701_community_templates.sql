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
