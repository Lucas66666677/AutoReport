# Closed Beta Release Readiness

Updated: 2026-07-23

## Verdict

**READY WITH OWNER ACTIONS**

The local release candidate has no known open P0 code defect. It is not authorized for immediate public production use: Supabase staging migration, real-account permissions, OAuth, production environment variables, AI provider, normal-browser PDF capture and operational ownership remain external gates.

## Evidence completed locally

- Frontend TypeScript: pass.
- Frontend ESLint: pass.
- Frontend Vitest: 7 files, 29 tests passed.
- Backend unittest: 13 safety tests passed.
- Backend py_compile: pass.
- Collaboration server syntax check: pass.
- Production frontend build: pass.
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
- The in-app browser had a fixed 1280 × 720 viewport. Existing brand screenshots cover 390, 1024 and 1440, but the complete current workflow still needs a manual 390／768／1024／1440 pass.
- Browser PDF export was invoked and returned to a normal saved state without a visible UI error, but the in-app browser did not expose its download artifact.
- Supabase CLI and an isolated staging database were not available; SQL was reviewed and migration invariants have static tests, not a real database reset.
- No real Google／Email login, multi-account RLS or AI-provider request was executed because that would require external configuration and potentially production services.
- Permanent delete does not yet remove orphaned private Storage objects.
- No centralized error-monitoring provider is configured.
- Vite reports large lazy-loaded chunks; this is a performance P1, not a data-integrity blocker for 20 users.

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
