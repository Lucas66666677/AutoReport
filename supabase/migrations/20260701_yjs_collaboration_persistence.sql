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
