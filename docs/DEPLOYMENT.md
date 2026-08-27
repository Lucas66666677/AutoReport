# AutoLabReport Closed Beta Deployment

Deployment is an owner action. This repository task does not deploy or modify production services.

## 1. Supabase staging first

Create an isolated staging project. Apply every file in `supabase/migrations` in filename order. Do not apply `supabase/schema_and_rls.sql` first: it is the canonical schema snapshot and is already mirrored by the initial bootstrap migration. The final Closed Beta hardening migration is:

~~~text
supabase/migrations/20260724_staging_bringup_hardening.sql
~~~

Do not continue if the migration fails. Run the full permission matrix in docs/OWNER_ACTIONS.md before using a production project.

## 2. Frontend on Vercel

Required:

~~~text
VITE_API_URL=https://your-render-backend.example
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
~~~

Closed Beta defaults:

~~~text
VITE_ENABLE_BILLING=false
VITE_ENABLE_GITHUB_AUTH=false
VITE_ENABLE_GITHUB_SYNC=false
VITE_ENABLE_GOOGLE_DRIVE=false
VITE_ENABLE_SCREEN_RECORDING=false
VITE_ENABLE_REALTIME_COLLABORATION=false
VITE_ENABLE_BROWSER_EXTENSION=false
~~~

VITE_API_URL must be HTTPS and must not point to localhost. The SPA fallback is defined in frontend/vercel.json.

## 3. Backend on Render

Required:

~~~text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-side-secret
ENCRYPTION_KEY=stable-fernet-key
FRONTEND_URL=https://your-vercel-domain.example
BACKEND_URL=https://your-render-backend.example
CORS_ALLOWED_ORIGINS=https://your-vercel-domain.example,https://your-staging-domain.example
~~~

AI: configure at least one of GROQ_API_KEY or GEMINI_API_KEY and its permitted model. Keep FREE_DAILY_AI_QUOTA conservative for the canary.

Closed Beta defaults:

~~~text
STRIPE_BILLING_ENABLED=false
GITHUB_SYNC_ENABLED=false
GOOGLE_DRIVE_ENABLED=false
OWNERSHIP_TRANSFER_EMAIL_CONFIGURED=false
UVICORN_RELOAD=false
~~~

Install Pandoc in the Render image or build step. Keep SUPABASE_SERVICE_ROLE_KEY and ENCRYPTION_KEY server-side only.

Generate a Fernet key once and keep it stable:

~~~powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
~~~

Changing ENCRYPTION_KEY later makes existing encrypted user API keys unreadable.

## 4. Auth

Configure Supabase Auth Site URL and redirect allowlist for staging and production. Enable Email Magic Link and／or Google.

Google login uses only identity scopes in this Beta. Google Drive is a separate disabled feature and must not be added to the login consent scope.

## 5. Preflight

From the repository root:

~~~powershell
npm run check:deploy
~~~

Then verify:

~~~text
GET https://backend.example/api/health      -> 200
GET https://backend.example/api/readiness   -> 200
~~~

### Machine-checked release contract

`backend/tests/test_release_preflight.py` runs in CI without any secret and
fails the build when the lines below stop matching the code, `.env.example`
and `scripts/deploy-check.ps1`. Edit these lists and the code together.

~~~text
readiness required: supabase, encryption, pandoc
readiness optional: built_in_ai
required backend env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, FRONTEND_URL, BACKEND_URL, CORS_ALLOWED_ORIGINS
required frontend env: VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
~~~

Readiness reports whether built-in AI is configured but does not make AI a
hard infrastructure check, so a Groq or Gemini outage cannot take the writer
offline.

### Readiness fails closed

A missing required check returns 503 with `status: not_ready` and a `missing`
list of check names. The response carries booleans and names only; it never
echoes a URL, key or any other configured value.

`encryption` requires a Fernet key that actually loads, not merely a non-empty
variable. A truncated or re-wrapped `ENCRYPTION_KEY` is reported as not ready
instead of failing later, at the first student who saves an API key.

`pandoc` is a probe: any probe failure counts as not ready rather than
propagating, so the endpoint answers 503 instead of 500.

### Reading a 503

A 503 naming `supabase` or `encryption` is a host configuration gap, not a code
defect. Fix it in the Render service environment:

| missing | what to set | where |
|---|---|---|
| `supabase` | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` | Render → Service → Environment |
| `encryption` | `ENCRYPTION_KEY`, a stable `Fernet.generate_key()` value | Render → Service → Environment |
| `pandoc` | Pandoc in the image or build step | Render build configuration |

Never resolve a readiness 503 by committing a value to this repository, by
pasting one into chat or a screenshot, or by relaxing the required list. The
required list shrinks only when the product stops depending on that
capability.

## 6. Canary

- Owner account acceptance.
- Two students for one school day.
- Review monitoring and support channel.
- Five students.
- Twenty students only if no P0 incident remains open.

Never turn on billing, GitHub sync, Drive, recording or realtime collaboration merely by setting one frontend flag. Each optional feature requires both server configuration and a new acceptance pass.
