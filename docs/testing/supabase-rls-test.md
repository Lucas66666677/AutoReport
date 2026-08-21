# Supabase Staging Bring-up and RLS Test

Last updated: 2026-07-24

## Scope and current status

This runbook covers only Supabase staging initialization, migrations, Email Auth,
database RLS, and Storage policies. It must not be used against production.

Current status: **local migration audit complete; real staging execution pending**.
Static checks are not evidence that a migration can initialize a real database or
that RLS works through Supabase APIs. Rows below remain pending until the staging
script has made real requests.

## Migration order

Supabase applies the files in lexical order:

1. `20260626_initial_schema_and_rls.sql`
2. `20260627_workspaces_and_rls.sql`
3. `20260701_community_templates.sql`
4. `20260701_report_ownership_transfers.sql`
5. `20260701_report_recordings_storage.sql`
6. `20260701_yjs_collaboration_persistence.sql`
7. `20260702_profiles_preferences.sql`
8. `20260723_closed_beta_security.sql`
9. `20260724_staging_bringup_hardening.sql`

The first migration is intentionally identical to `supabase/schema_and_rls.sql`.
A unit test prevents those files from drifting. Earlier repositories kept the base
schema outside the migration directory, which meant a clean `supabase db push`
would begin with migrations that referenced tables that did not exist.

The final hardening migration:

- removes client profile insertion and preserves trigger-owned profile creation;
- revokes client schema creation and default PUBLIC function execution;
- enforces a 10 MiB image limit and allows PNG, JPEG, WebP, and GIF only;
- rechecks document edit access when an existing image is updated or deleted;
- removes client writes to the Closed-Beta-disabled recording bucket.

## Secret handling and target guard

Create `D:\AutoLabReport\.env.staging.local` locally. The root `.gitignore`
matches `.env.*`, and `git check-ignore .env.staging.local` must succeed before
values are added. Never paste this file or any value from it into chat.

```dotenv
SUPABASE_STAGING_MARKER=AUTOLABREPORT_STAGING
SUPABASE_STAGING_PROJECT_REF=replace-with-random-staging-project-ref
SUPABASE_STAGING_URL=https://replace-with-random-staging-project-ref.supabase.co
SUPABASE_STAGING_ANON_KEY=store-locally-only
SUPABASE_STAGING_SERVICE_ROLE_KEY=store-locally-only
SUPABASE_STAGING_DB_PASSWORD=store-locally-only
SUPABASE_PRODUCTION_PROJECT_REFS=xddzdpmjgptvvpprnchp
```

`SUPABASE_STAGING_SERVICE_ROLE_KEY` must never use a `VITE_` prefix and must never
be copied into `frontend/.env.local`. The test refuses a URL whose host does not
exactly match the declared project ref, refuses a missing staging marker, and
refuses known production/non-staging refs. It prints only the project ref,
hostname, and test results.

## Migration procedure

Do not run these steps until the target project ref has been visually confirmed as
the staging project in Supabase Dashboard.

1. Link the CLI to the staging ref without recording the database password in Git.
2. Run `supabase db push --dry-run` (or the current CLI equivalent).
3. Compare the proposed migration list with the nine-file order above.
4. Run `supabase db push` only after the target ref and list match.
5. Record the last migration version from `supabase_migrations.schema_migrations`.
6. Inspect tables, functions, triggers, indexes, RLS flags, policies, and buckets.

If a migration fails, stop and diagnose it. Do not reset or delete staging data to
hide the failure.

## Automated real-request matrix

From `D:\AutoLabReport\frontend`:

```powershell
npm run test:staging:rls
```

The script creates unique `e2e_rls_` accounts, documents, collaborator rows, AI
settings, and Storage objects. Passwords are generated in memory and never logged.
Cleanup uses exact IDs and paths created by that run, refuses non-prefixed accounts,
and never deletes unrelated data. Any failed assertion or cleanup returns non-zero.

| Area | Real requests performed | Status |
| --- | --- | --- |
| Owner | Read, content/title/share update, trash/restore/delete, collaborator management | Pending staging |
| Editor | Shared read and content update; title/owner/share/trash/delete/role escalation denied | Pending staging |
| Viewer | Shared read; every write and delete denied | Pending staging |
| Anonymous | Public view allowed; private/unrelated/collaborator access and writes denied | Pending staging |
| Storage | Own path, wrong path, private direct read, signed URL, MIME, size, revoked-editor mutation | Pending staging |
| Profiles | Plan, quota, and Stripe field mutation denied | Pending staging |
| AI settings | Another user's encrypted setting cannot be read | Pending staging |
| Quota RPC | Client denied; service-role reservation/refund allowed | Pending staging |
| Email Auth | Password sign-in, session restore, registration endpoint, logout | Pending staging |

## Manual browser follow-up

The API script does not prove browser routing or local-state isolation. After the
matrix passes, use separate browser contexts to verify:

- Email registration or Magic Link delivery and redirect;
- guest and authenticated redirects, session restoration, and logout;
- Owner, Editor, Viewer, and Anonymous routes through the actual UI;
- switching users does not expose another user's localStorage, outbox, or Yjs data;
- private/public report behavior for valid, invalid, and guessed document IDs.

## Cleanup verification gap

The staging test cleans up objects it creates explicitly. The authenticated
permanent-delete API now removes matching image／recording
objects across uploader prefixes before deleting the document rows. This still
requires a real multi-account staging E2E before release sign-off.

