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
