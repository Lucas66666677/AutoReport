# Owner Actions

Updated: 2026-07-23

Do not paste secret values into this file, chat, screenshots or Git. Enter them directly in each platform's encrypted environment-variable UI.

## Blocking actions

| Platform | Console location | Required value / change | Why needed | How to verify | Blocks Beta? |
| --- | --- | --- | --- | --- | --- |
| Supabase | SQL Editor / Migrations | Apply schema and every dated migration, ending with 20260723_closed_beta_security.sql | Enforces ownership, collaborator permissions, protected profiles, atomic quota and private Storage | Run the permission matrix below in a clean staging project | Yes |
| Supabase | Authentication → URL Configuration | Final Vercel Site URL plus allowed redirect URLs for production and staging | OAuth and Magic Link must return to the correct app | Login from both domains; no redirect loop | Yes |
| Supabase | Authentication → Providers → Email | Enable Email / Magic Link and set sender template | Provides fallback login if Google is unavailable | Send a link to a Beta mailbox and complete login | Yes, unless Google-only is an explicit decision |
| Supabase | Authentication → Providers → Google | Enable provider; enter Google client ID and secret | Enables the intended social login | Login, logout and login again from final domain | Yes, unless Email-only is an explicit decision |
| Google Cloud | APIs & Services → OAuth consent screen | External app, product name, support email, developer contact, authorized domains; request only openid, email and profile for login | Prevents the 403 access_denied testing-screen problem | A non-owner test account can complete consent | Yes if Google login is offered |
| Google Cloud | APIs & Services → Credentials → OAuth 2.0 Client | Supabase callback URI and approved web origins | Links Google to Supabase safely | Callback reaches Supabase and then the app | Yes if Google login is offered |
| Google Cloud | Billing | No billing account is normally required merely to use OAuth consent. Attach billing only if a separately enabled Google API or quota explicitly requires it | Avoids treating an unrelated console warning as an OAuth blocker | Basic Google login works with Drive disabled | No for basic login |
| Vercel | Project → Settings → Environment Variables | VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and all VITE_ENABLE flags set to false except explicitly accepted Beta features | Connects frontend to staging／production without localhost fallbacks | Inspect deployed network calls and landing feature visibility | Yes |
| Render | Service → Environment | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, stable ENCRYPTION_KEY, FRONTEND_URL, BACKEND_URL, CORS_ALLOWED_ORIGINS and at least one AI provider | Enables authenticated server operations, encrypted BYOK and correct CORS | GET /api/readiness returns 200; evil-origin preflight is denied | Yes |
| Render | Service → Build / Runtime | Pandoc installed and available in PATH | Word export depends on Pandoc | readiness pandoc=true and standard DOCX export opens | Yes |
| Groq or Gemini | Provider console | One active server-side API key and an allowed model | Enables built-in AI for the Beta | One outline and one rewrite complete; quota decrements once | Yes if built-in AI is promised |
| Monitoring | Sentry or equivalent | Frontend and backend projects, release tag, alert recipient, PII review | Owner needs visibility before students report silent failures | Send a staging test event and receive an alert | Yes |
| Operations | Owner-selected channel | Support Email or form, response owner and expected response window | Students need a known path for blocked save, auth or export | Link is visible and a test message reaches the owner | Yes |

## Supabase permission matrix

Use three disposable staging accounts and one signed-out browser.

| Scenario | Expected |
| --- | --- |
| Owner creates, edits, trashes, restores and deletes own report | Allowed |
| Account B opens owner's private report without invitation | Denied |
| Account B is invited view | Read allowed, write denied |
| Account C is invited edit | Content update allowed; title, owner, share, trash and permissions denied |
| Owner enables public view | Signed-out reader can read |
| Owner selects legacy edit setting | Signed-out reader remains read-only |
| Owner trashes shared report | Collaborator and public reader lose access |
| Browser updates profile plan or AI quota directly | Denied or protected values remain unchanged |
| Browser reads report_images without a signed authorized request | Denied |

## Environment policy for Closed Beta

Frontend flags:

~~~text
VITE_ENABLE_BILLING=false
VITE_ENABLE_GITHUB_AUTH=false
VITE_ENABLE_GITHUB_SYNC=false
VITE_ENABLE_GOOGLE_DRIVE=false
VITE_ENABLE_SCREEN_RECORDING=false
VITE_ENABLE_REALTIME_COLLABORATION=false
VITE_ENABLE_BROWSER_EXTENSION=false
~~~

Backend flags:

~~~text
STRIPE_BILLING_ENABLED=false
GITHUB_SYNC_ENABLED=false
GOOGLE_DRIVE_ENABLED=false
OWNERSHIP_TRANSFER_EMAIL_CONFIGURED=false
~~~

Collaboration server:

~~~text
COLLABORATION_ENABLED=false
~~~

Do not deploy the collaboration server for this Beta unless the realtime collaboration scope is separately reopened and re-audited.

## Manual browser acceptance

Run in normal Chrome or Edge after staging deployment:

1. Test landing and login at 390, 768, 1024 and 1440 pixels.
2. Enter guest mode, create and edit a report, reload, and confirm the report remains listed.
3. Sign in as the owner and repeat create, rename, folder, favorite, trash, restore and delete.
4. Simulate offline mode while typing, return online, press retry and confirm the latest text wins.
5. Run structured outline and AI rewrite; reject one proposal, then apply one and restore the previous version.
6. Ask AI to change 1.00 ms to 2.00 ms and confirm application is rejected.
7. Upload an image, reload and verify the signed image still renders.
8. Run the public／viewer／editor matrix.
9. Export the standard fixture to Word and PDF, open both, and inspect every page.
10. Confirm DevTools Console has no new warning or error and Network contains no localhost, token query string or failed hidden-feature request.

## Optional systems that do not block this Beta

| Platform | Current decision | Reopen criteria |
| --- | --- | --- |
| Stripe | Disabled | Test checkout, portal, webhook signatures, replay and subscription authorization |
| GitHub Auth / Sync | Disabled | Configure separate OAuth app and complete state／redirect security review |
| Google Drive | Disabled | Add separate Drive consent, minimal scope and token-handling E2E |
| Realtime collaboration | Disabled | Establish one authoritative persistence path and conflict tests |
| Browser extension | Disabled | Security review, versioned release and store／manual installation instructions |
| Screen recording | Disabled | Consent, private retention, deletion and access-control review |
