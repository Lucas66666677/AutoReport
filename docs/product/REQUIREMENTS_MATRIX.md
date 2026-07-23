# Closed Beta Requirements Matrix

Updated: 2026-07-23

Status vocabulary is intentionally limited to: Verified, Implemented but unverified, Partially implemented, Missing, Deliberately out of Closed Beta.

| Area | Requirement | Evidence | Status |
| --- | --- | --- | --- |
| Guest | Enter without an account and see a local-only warning | Browser journey | Verified |
| Guest | Draft and guest session survive reload | Browser journey after regression fix | Verified |
| Auth | Email Magic Link | Supabase Auth implementation; external delivery not exercised | Implemented but unverified |
| Auth | Google OAuth without Drive scope | Supabase OAuth implementation; owner configuration required | Implemented but unverified |
| Auth | GitHub login | Hidden unless explicitly enabled | Deliberately out of Closed Beta |
| Documents | Create, open, rename, favorite and move cloud files | Supabase CRUD code | Implemented but unverified |
| Documents | Folder create and subtree trash | Supabase CRUD code | Implemented but unverified |
| Documents | Restore and permanent delete | Supabase CRUD code; Storage cleanup not included | Implemented but unverified |
| Save | Immediate local state plus serialized remote autosave | App save queue and visible state | Verified |
| Save | Durable per-account outbox and stale-completion guard | Vitest documentSaveOutbox suite | Verified |
| Isolation | Guest, auth, outbox and Yjs namespaces do not cross accounts | Vitest and scoped keys | Verified |
| Editor | Monaco edit, split and preview modes | Browser journey | Verified |
| Preview | GFM tables, KaTeX, Mermaid, image and code | Standard fixture in browser | Verified |
| Images | Authenticated uploads use private marker and signed URL | Unit tests and migration | Implemented but unverified |
| Images | Legacy public image URLs remain readable through signed resolution | Unit tests | Verified |
| Outline | Structured experiment brief and preview-before-apply | UI and API implementation | Implemented but unverified |
| AI | Rewrite／expand／format proposal before apply | UI implementation | Implemented but unverified |
| AI | Numeric and unit integrity rejection | 4 backend safety tests | Verified |
| AI | Atomic quota reserve and refund | service-role RPC and backend integration | Implemented but unverified |
| Quality | Purpose, theory, procedure, data, analysis, visuals and conclusion | Unit tests and browser panel | Verified |
| Quality | Units, captions, references, placeholders, empty sections and evidence checks | Unit tests and browser panel with locations | Verified |
| Sharing | Public report is read-only | Public component and RLS migration | Implemented but unverified |
| Sharing | Legacy public edit cannot write | Static migration safety test | Verified |
| Collaboration | Explicit Email view/edit collaborator | UI and RLS migration | Implemented but unverified |
| Collaboration | Realtime Yjs editing | Feature disabled in frontend and server | Deliberately out of Closed Beta |
| Export | DOCX generated through Pandoc | Live API export, Word open, 4-page visual inspection | Verified |
| Export | DOCX keeps Chinese／English, table, image, formula and long code readable | Rendered page inspection | Verified |
| Export | Mermaid rendered as a diagram in DOCX | Current export preserves source text only | Partially implemented |
| Export | Browser PDF generation | UI invocation completed without visible error; artifact capture pending | Implemented but unverified |
| Public report | Invalid／unavailable data shows a generic error | Component implementation | Implemented but unverified |
| Responsive | Brand screenshots at 390, 1024 and 1440 | docs/brand-screenshots | Verified |
| Responsive | Current Closed Beta workflow at 390, 768, 1024 and 1440 | Current in-app browser fixed at 1280 | Partially implemented |
| Security | Markdown Python never executes | Live API plus backend tests | Verified |
| Security | CORS rejects an unapproved origin | Live preflight probe and unit test | Verified |
| Security | Profiles cannot self-edit plan, quota or integration fields | Migration | Implemented but unverified |
| Security | Report image and recording buckets are private | Migration tests | Verified |
| Security | API errors omit provider responses, tokens and stack traces | Code audit and tests | Verified |
| Deploy | Health and readiness are separate | Live local probes | Verified |
| Deploy | Clean staging database can apply every migration | Supabase CLI／staging unavailable locally | Implemented but unverified |
| Deploy | Production configuration has no localhost fallback | Frontend and deployment check | Verified |
| Operations | Error monitoring and alert routing | No monitoring provider integrated | Missing |
| Operations | Student feedback channel | Product has feedback entry but no owner destination verified | Partially implemented |
| Billing | Stripe checkout, portal and webhook | Hidden and backend-disabled | Deliberately out of Closed Beta |
| Integrations | Google Drive, GitHub sync, extension and recording | Hidden and backend-disabled | Deliberately out of Closed Beta |
