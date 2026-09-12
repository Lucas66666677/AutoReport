// The owner/viewer/editor/anonymous permission matrix, run against the real schema.
//
// docs/product/BETA_BACKLOG.md lists "validate permission matrix with three real
// accounts" as a P0 that had never been done, and docs/product/PRODUCT_SPEC.md lines
// 60-63 state what the answer should be. This runs the whole of supabase/bringup.sql
// inside PGlite -- real PostgreSQL, real row-level security -- seeds four actors and
// four documents, and asserts every cell of that table.
//
// The assertions go through ordinary SELECT/UPDATE/DELETE as each role rather than
// calling can_read_document() directly, because the policies are what a browser
// actually meets. A function can be correct while the policy that uses it is not.
//
// What this cannot cover: GoTrue, Storage and PostgREST are stubbed, so this proves
// the policies are right, not that the whole stack enforces them. A real-account run
// is still worth doing once.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Default to the committed bringup file so `npm run test:rls:matrix` needs no argument.
const BRINGUP = process.argv[2] ?? fileURLToPath(new URL('../../supabase/bringup.sql', import.meta.url));

const STUBS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- These must read what PostgREST sets, or identity-dependent policies would
-- evaluate to null and pass for the wrong reason.
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;

create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text)
$fn$;

create or replace function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$fn$;

create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, path_tokens text[], version text, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);

create or replace function storage.foldername(name text) returns text[] language sql immutable as $fn$
  select string_to_array(name, '/')
$fn$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to service_role;

-- Supabase's bootstrap grants the client roles table privileges before any migration
-- runs, and bringup.sql assumes that has already happened: it revokes and re-grants
-- from that baseline rather than establishing it.
--
-- Leaving this out is worse than useless. Every table access fails with "permission
-- denied" instead of being evaluated, so every deny-case passes for entirely the
-- wrong reason and the matrix reports safety it has not tested.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const OWNER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const VIEWER = { id: '22222222-2222-4222-8222-222222222222', email: 'viewer@example.com' };
const EDITOR = { id: '33333333-3333-4333-8333-333333333333', email: 'editor@example.com' };
const OUTSIDER = { id: '44444444-4444-4444-8444-444444444444', email: 'outsider@example.com' };

const DOCS = {
  private: 'aaaaaaaa-0000-4000-8000-000000000001',
  trashed: 'aaaaaaaa-0000-4000-8000-000000000002',
  sharedView: 'aaaaaaaa-0000-4000-8000-000000000003',
  legacyEdit: 'aaaaaaaa-0000-4000-8000-000000000004',
  trashedShared: 'aaaaaaaa-0000-4000-8000-000000000005',
};

const db = new PGlite();
const results = [];

/** Run one statement as an actor, inside a transaction that is always rolled back. */
async function asActor(actor, statement) {
  await db.exec('begin');
  try {
    if (actor === null) {
      await db.exec("set local role anon; select set_config('request.jwt.claims', '', true);");
    } else {
      const claims = JSON.stringify({ sub: actor.id, email: actor.email, role: 'authenticated' });
      await db.exec(
        `set local role authenticated;
         select set_config('request.jwt.claim.sub', '${actor.id}', true);
         select set_config('request.jwt.claims', '${claims}', true);`,
      );
    }
    const result = await db.query(statement);
    return { ok: true, rows: result.rows ?? [], affected: result.affectedRows ?? 0 };
  } catch (error) {
    return { ok: false, error: String(error.message).replace(/\s+/g, ' ').slice(0, 90) };
  } finally {
    await db.exec('rollback');
  }
}

function check(actorName, capability, expected, actual, note) {
  const pass = expected === actual;
  results.push({ actorName, capability, expected, actual, pass, note });
}

async function canRead(actor, documentId) {
  const outcome = await asActor(actor, `select id from public.documents where id = '${documentId}'`);
  return outcome.ok && outcome.rows.length === 1;
}

async function canUpdate(actor, documentId) {
  const outcome = await asActor(
    actor,
    `update public.documents set content = 'changed by test' where id = '${documentId}' returning id`,
  );
  return outcome.ok && outcome.rows.length === 1;
}

async function canDelete(actor, documentId) {
  const outcome = await asActor(
    actor,
    `delete from public.documents where id = '${documentId}' returning id`,
  );
  return outcome.ok && outcome.rows.length === 1;
}

async function seed() {
  let sql = readFileSync(BRINGUP, 'utf8');
  sql = sql.replace(/create extension if not exists "pgcrypto";/g, '-- pgcrypto: built into PG 13+');
  await db.exec(STUBS);
  await db.exec(sql);

  for (const person of [OWNER, VIEWER, EDITOR, OUTSIDER]) {
    await db.exec(
      `insert into auth.users (id, email) values ('${person.id}', '${person.email}') on conflict do nothing;`,
    );
  }

  const rows = [
    [DOCS.private, 'Private report', false, 'private'],
    [DOCS.trashed, 'Trashed report', true, 'private'],
    [DOCS.sharedView, 'Publicly viewable', false, 'view'],
    [DOCS.legacyEdit, 'Legacy public edit link', false, 'edit'],
    [DOCS.trashedShared, 'Shared but trashed', true, 'view'],
  ];
  for (const [id, title, trashed, share] of rows) {
    await db.exec(
      `insert into public.documents (id, user_id, title, content, is_trashed, share_setting)
       values ('${id}', '${OWNER.id}', '${title}', 'body', ${trashed}, '${share}');`,
    );
  }

  // The invited pair are collaborators on the private document only.
  await db.exec(
    `insert into public.document_collaborators (document_id, user_email, role) values
       ('${DOCS.private}', '${VIEWER.email}', 'view'),
       ('${DOCS.private}', '${EDITOR.email}', 'edit'),
       ('${DOCS.trashedShared}', '${VIEWER.email}', 'view');`,
  );
}

async function main() {
  await seed();
  console.log('real bringup.sql applied; four actors and five documents seeded\n');

  // PRODUCT_SPEC:60 -- Owner: own documents including trash, write own, delete yes.
  check('owner', 'read own private', true, await canRead(OWNER, DOCS.private));
  check('owner', 'read own trashed', true, await canRead(OWNER, DOCS.trashed), 'spec says including trash');
  check('owner', 'update own', true, await canUpdate(OWNER, DOCS.private));
  check('owner', 'delete own', true, await canDelete(OWNER, DOCS.private));

  // PRODUCT_SPEC:61 -- Invited viewer: read non-trashed invited document, no write, no delete.
  check('viewer', 'read invited', true, await canRead(VIEWER, DOCS.private));
  check('viewer', 'read invited when trashed', false, await canRead(VIEWER, DOCS.trashedShared), 'trashed hides it');
  check('viewer', 'update invited', false, await canUpdate(VIEWER, DOCS.private));
  check('viewer', 'delete invited', false, await canDelete(VIEWER, DOCS.private));

  // PRODUCT_SPEC:62 -- Invited editor: read invited, content only, no delete.
  check('editor', 'read invited', true, await canRead(EDITOR, DOCS.private));
  check('editor', 'update invited content', true, await canUpdate(EDITOR, DOCS.private));
  check('editor', 'delete invited', false, await canDelete(EDITOR, DOCS.private));

  // PRODUCT_SPEC:63 -- Public/anonymous: read a non-trashed shared document only.
  check('anonymous', 'read publicly shared', true, await canRead(null, DOCS.sharedView));
  check('anonymous', 'read legacy edit link', true, await canRead(null, DOCS.legacyEdit));
  check('anonymous', 'read private', false, await canRead(null, DOCS.private));
  check('anonymous', 'read shared but trashed', false, await canRead(null, DOCS.trashedShared));
  check(
    'anonymous',
    'update via legacy edit link',
    false,
    await canUpdate(null, DOCS.legacyEdit),
    'spec: legacy public edit links are read-only',
  );
  check('anonymous', 'delete shared', false, await canDelete(null, DOCS.sharedView));

  // A signed-in stranger is not a collaborator.
  check('outsider', 'read someone elses private', false, await canRead(OUTSIDER, DOCS.private));
  check('outsider', 'read publicly shared', true, await canRead(OUTSIDER, DOCS.sharedView));
  check('outsider', 'update someone elses', false, await canUpdate(OUTSIDER, DOCS.private));

  // PRODUCT_SPEC:66 -- browser clients cannot reassign ownership.
  const reassign = await asActor(
    EDITOR,
    `update public.documents set user_id = '${EDITOR.id}' where id = '${DOCS.private}' returning id`,
  );
  check(
    'editor',
    'reassign owner via user_id',
    false,
    reassign.ok && reassign.rows.length === 1,
    'spec: clients cannot change user_id',
  );

  const width = Math.max(...results.map((row) => row.capability.length));
  let failed = 0;
  let actor = null;
  for (const row of results) {
    if (row.actorName !== actor) {
      actor = row.actorName;
      console.log(`\n${actor}`);
    }
    const mark = row.pass ? 'PASS' : 'FAIL';
    const expectation = row.expected ? 'allowed' : 'denied';
    const note = row.note ? `   (${row.note})` : '';
    console.log(`  ${mark}  ${row.capability.padEnd(width)}  expected ${expectation}${note}`);
    if (!row.pass) failed += 1;
  }

  console.log(
    `\n${results.length - failed}/${results.length} cells match docs/product/PRODUCT_SPEC.md lines 60-66`,
  );
  if (failed) {
    console.log(`RESULT: ${failed} cell(s) disagree with the spec`);
    process.exit(1);
  }
  console.log('RESULT: the permission matrix matches the spec');
}

main().catch((error) => {
  console.error('matrix crashed:', error);
  process.exit(1);
});
