# Closed Beta Backlog

Updated: 2026-07-23

## P0 — must complete before invitations

These are owner／staging gates; no known P0 code defect is open in the local release candidate.

| Item | Owner | Exit criterion |
| --- | --- | --- |
| Apply all Supabase migrations to a clean staging project | Project owner | Migration completes; required tables, functions, triggers, RLS and buckets exist |
| Validate permission matrix with three real accounts | Project owner | Owner, invited viewer, invited editor and anonymous access match PRODUCT_SPEC |
| Configure Email／Google Auth and redirects | Project owner | Login and logout work from the final Vercel domain |
| Configure Render／Vercel secrets and CORS | Project owner | Backend readiness is 200 and frontend calls only HTTPS production endpoints |
| Configure one built-in AI provider | Project owner | Authenticated outline and rewrite complete; quota decrements once |
| Manual browser Word／PDF acceptance | Project owner | Both files download and open in normal Chrome／Edge with the standard fixture |
| Establish Beta feedback and incident contact | Project owner | All 20 students know where to report a blocked save or export |

If any P0 exit criterion fails, the release returns to NOT READY.

## P1 — fix or verify during canary

| Item | Why | Suggested action |
| --- | --- | --- |
| Current workflow screenshots at 390／768／1024／1440 | Current in-app browser had a fixed 1280 viewport | Run the listed widths in Chrome DevTools before invitations |
| Capture and inspect browser PDF artifact | In-app browser invoked export but did not expose the downloaded file | Download in Chrome／Edge and render every page |
| Mermaid in DOCX | Pandoc output currently preserves Mermaid source | Pre-render Mermaid to an image for DOCX or document the limitation to students |
| Storage cleanup on permanent document delete | Private image／recording objects may become orphaned | Add a service-role cleanup endpoint or scheduled cleanup |
| Clean database reset automation | Local Supabase CLI is unavailable | Add CI with supabase db reset against an ephemeral project |
| Error monitoring | Runtime errors are not centrally visible | Add Sentry or equivalent with release tags and PII review |
| Bundle size | Vite reports chunks over 500 kB | Continue lazy loading Mermaid／editor／PDF features |
| Public report and collaborator E2E | Code and RLS exist but staging accounts were unavailable | Add browser tests against isolated staging |
| Autosave network-failure browser E2E | Unit coverage exists but network interception was unavailable | Add a controlled offline／online browser scenario |

## P2 — after Closed Beta

- Realtime collaboration with authoritative persistence and conflict strategy.
- Stripe plans, webhook replay testing and billing support workflow.
- Google Drive import with separate consent and minimal scopes.
- GitHub login and repository sync with state／PKCE review.
- Browser extension security review and distribution.
- Screen recording retention, consent and deletion policy.
- Ownership-transfer email delivery and expiry flow.
- Template publishing marketplace.
- Optional sandboxed code execution as a separate isolated service; never restore in-process execution.

## Completed hardening

- Removed server-side Python execution from render and export paths.
- Replaced self-managed AI quota writes with service-role RPCs.
- Protected profile billing／quota／integration fields.
- Replaced public-edit authorization with owner plus explicit collaborator authorization.
- Made report image and recording storage private.
- Isolated guest and authenticated caches by account.
- Serialized autosave and added a durable outbox.
- Disabled realtime collaboration and external integrations by default.
- Removed Drive tokens from query strings.
- Added exact-origin redirects, CORS allowlist and generic upstream errors.
- Added numeric integrity checks and preview-before-apply AI changes.
