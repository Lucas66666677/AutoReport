-- 模板臨摹 presets: which sections of a template or past report stay, are
-- rewritten from new material, or are adapted to it.
-- Run after 20260911_document_versions.sql.
--
-- One row per user and source, so the next report made from the same template
-- starts with the choices the user made last time. Private to its owner.

create table if not exists public.template_imitation_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('template', 'document')),
  source_id text not null check (char_length(source_id) between 1 and 200),
  section_modes jsonb not null default '{}'::jsonb,
  instructions text not null default '' check (char_length(instructions) <= 10000),
  updated_at timestamptz not null default now(),
  constraint template_imitation_presets_one_per_source unique (user_id, source_kind, source_id)
);

alter table public.template_imitation_presets enable row level security;

drop policy if exists "template_imitation_presets_owner_select" on public.template_imitation_presets;
create policy "template_imitation_presets_owner_select"
on public.template_imitation_presets for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "template_imitation_presets_owner_insert" on public.template_imitation_presets;
create policy "template_imitation_presets_owner_insert"
on public.template_imitation_presets for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "template_imitation_presets_owner_update" on public.template_imitation_presets;
create policy "template_imitation_presets_owner_update"
on public.template_imitation_presets for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "template_imitation_presets_owner_delete" on public.template_imitation_presets;
create policy "template_imitation_presets_owner_delete"
on public.template_imitation_presets for delete
to authenticated
using (auth.uid() = user_id);

-- Supabase's default privileges grant anon and authenticated everything on new
-- public tables, including TRUNCATE, which RLS does not cover.
revoke all on public.template_imitation_presets from anon, authenticated;
grant select, insert, update, delete on public.template_imitation_presets to authenticated;
