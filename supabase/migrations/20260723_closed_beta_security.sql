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
