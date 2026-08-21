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

Readiness requires Supabase, ENCRYPTION_KEY and Pandoc. It reports whether built-in AI is configured but does not make AI a hard infrastructure check.

## 6. Canary

- Owner account acceptance.
- Two students for one school day.
- Review monitoring and support channel.
- Five students.
- Twenty students only if no P0 incident remains open.

Never turn on billing, GitHub sync, Drive, recording or realtime collaboration merely by setting one frontend flag. Each optional feature requires both server configuration and a new acceptance pass.
