# Closed Beta Release Readiness

Updated: 2026-08-06

## Verdict

**READY WITH OWNER ACTIONS**

The local release candidate has no known open P0 code defect. It is not authorized for immediate public production use: Supabase staging migration, real-account permissions, OAuth, production environment variables, AI provider, normal-browser PDF capture and operational ownership remain external gates.

## Evidence completed locally

- Frontend TypeScript: pass.
- Frontend ESLint: pass.
- Frontend Vitest: 8 files, 31 tests passed.
- Backend unittest: 27 safety tests passed.
- Supabase migration chain: nine ordered migrations; the bootstrap migration is
  regression-checked against the canonical schema.
- PostgreSQL parse check: canonical schema and all nine migrations passed with
  `pglast`; this does not replace a clean database initialization.
- Staging RLS integration runner: target/project-ref/production-denylist guards,
  in-memory test credentials, exact-prefix cleanup, and non-zero failures added.
- Backend py_compile: pass.
- Collaboration server syntax check: pass.
- Production frontend build: pass.
- Production initial entry reduced from about 1.24 MB to about 402 kB; Markdown,
  Monaco and PDF remain isolated lazy feature chunks.
- Browser guest dashboard and Edit／Split／Preview passed after the lazy-loading
  changes; KaTeX, tables, private-image fallback and Mermaid rendered.
- Editor viewport checks at 390／768／1024／1440 reported no page-level horizontal
  overflow. The 390 px editor was also visually inspected.
- Invalid public-report route reached the generic, non-crashing error state.
- A tested application error boundary now replaces render-time white screens with
  a reload path and an explicit local-draft retention message.
- Live API health: 200.
- Local readiness: correctly 503 because Supabase, encryption and AI secrets were intentionally not supplied; Pandoc passed.
- Evil-origin CORS preflight: no Access-Control-Allow-Origin.
- Disabled Google Drive route: 503.
- Render safety: Python source preserved, sentinel not executed.
- Word export: 1,018,391-byte DOCX generated.
- Microsoft Word opened the DOCX and exported a 4-page PDF.
- Four Word-rendered pages inspected: no clipping in bilingual text, table, image, formula or long code.
- Browser guest journey: enter, create, edit, preview, quality check and reload persistence passed at 1280 × 720.
- Browser landing, dashboard, split editor and preview screenshots saved.
- Git diff check: pass at the time of the code gate; rerun before final checkpoint.

## Known limitations

- DOCX preserves Mermaid source rather than rendering a diagram.
- The editor passed page-overflow checks at 390／768／1024／1440 and the 390 px
  preview was visually inspected, but the complete auth／dashboard／export journey
  still needs a manual pass at every width.
- Browser PDF export was invoked and returned to a normal saved state without a visible UI error, but the in-app browser did not expose its download artifact.
- Supabase CLI runtime and an isolated staging database were not available. The
  previously missing clean-database bootstrap migration is now present and SQL
  parses, but no real database reset or catalog dependency test has run yet.
- No real Google／Email login, multi-account RLS or AI-provider request was executed because that would require external configuration and potentially production services.
- Permanent delete now owner-checks and removes private image／recording objects
  across uploader prefixes before deleting document rows; real staging cleanup
  remains unverified.
- No centralized error-monitoring provider is configured.
- Vite still reports large lazy-loaded Monaco／Markdown／PDF chunks; the initial
  application entry is below 500 kB, so this remains a measured performance P1
  rather than a data-integrity blocker for 20 users.

## Invitation decision

Invite students only after every P0 row in BETA_BACKLOG and every blocking row in OWNER_ACTIONS is complete in staging.

Recommended rollout:

1. Owner-only staging acceptance.
2. Two-student canary for one school day.
3. Review save, auth, AI and export errors.
4. Expand to five students.
5. Expand to twenty only if there is no unresolved data-loss, permission or numeric-integrity incident.

## Rollback triggers

Immediately pause invitations if any of the following occurs:

- Cross-account or anonymous access to a private report.
- A save is reported successful but the latest content is lost.
- AI changes a measured number or unit and the app allows it to apply.
- Login loops affect more than one canary user.
- Word and PDF both fail for the standard fixture.
- Readiness changes from 200 to 503.

Feature flags allow optional integrations to remain off while the core writer continues operating.
