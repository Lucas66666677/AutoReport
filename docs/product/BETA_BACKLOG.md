# Closed Beta Backlog

Updated: 2026-08-06

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
| Complete workflow screenshots at 390／768／1024／1440 | Editor overflow passed all widths and 390 px was visually checked; the full auth／dashboard／export journey was not captured at every width | Run the entire journey at the listed widths in Chrome DevTools before invitations |
| Storage cleanup on permanent document delete | Every uploader prefix, nested folders, both buckets, batching and refusal-before-deletion are pinned in backend/tests/test_permanent_delete_storage.py | Run scripts/verify-storage-cleanup.py once against staging with two real accounts |
| Clean database reset automation | Local Supabase CLI is unavailable | Add CI with supabase db reset against an ephemeral project |
| Error monitoring | Implemented for frontend and backend against Sentry's envelope endpoint, with no new dependency; completely inert until a DSN is set | Create the Sentry project, then set SENTRY_DSN and VITE_SENTRY_DSN (see docs/DEPLOYMENT.md) |
| Bundle size | Initial entry fell from 1.24 MB to about 402 kB; Monaco／Markdown／PDF remain large but lazy-loaded | Track real-user loading and continue splitting only where browser validation proves execution order is safe |
| Public report and collaborator E2E | The guest journey, Word download and PDF download now run in Chromium via frontend/e2e; the signed-in half is written but skips without credentials | Supply E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_EMAIL and E2E_PASSWORD, then npm run test:e2e |
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

- Mermaid diagrams render in the editor again. @monaco-editor/react was loading
  Monaco's AMD loader from the jsDelivr CDN; mermaid's UMD dependencies called its
  define() and it rejected the anonymous module, which also silently disabled the
  Mermaid-to-picture Word export. The editor now loads the locally installed ESM
  build, so no AMD loader reaches the page and the CDN is no longer a runtime
  dependency. Initial bundle entry is unchanged; Monaco stays in a lazy chunk.

- A maintained Word reference document (A4, 2.5 cm margins, CJK body and heading
  faces, bordered tables) is committed and passed to Pandoc, with a fallback when the
  asset is missing. Rebuild it with backend/tools/build_reference_docx.py.
- The browser journey runs in Chromium: guest entry, KaTeX formulas, tables, and both
  the Word and PDF downloads, against the real backend rather than a mock.
- The exported PDF is inspected page by page by scripts/inspect-pdf.py, which knows
  that 匯出 PDF（圖片版）carries an image and no text layer.

- Mermaid diagrams are rendered in the browser and sent to Word as a picture;
  a diagram that fails to render still falls back to its source.
- Report images survive the Word export: the app embeds its own private images
  and the server downloads remote ones, instead of Pandoc fetching URLs itself
  and embedding a refusal page when a host blocked it.
- An image copied from a web page can be pasted; the server downloads it when
  the browser is not allowed to.

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
- Added owner-verified permanent deletion that clears private image／recording
  objects, queued saves, local versions and Yjs memory before removing UI state.
- Added authenticated Drive proxy calls, a 25 MB import cap and generic upstream
  errors that do not echo provider internals.
- Added a tested application error boundary so render failures provide a recovery
  action instead of leaving a blank page.
