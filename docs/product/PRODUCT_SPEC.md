# AutoLabReport Closed Beta Product Spec

Updated: 2026-07-23

## Objective

Let 20 university students turn experiment notes, measurements and AI-assisted drafts into a report they can safely save, review, share read-only and export. The Beta optimizes for data integrity and clear failure states, not breadth.

## Target users

- Student author: owns reports, edits content, runs checks, exports and invites peers.
- Student collaborator: can view or edit only when explicitly invited by Email.
- Public reader: can view a non-trashed report whose owner enabled a public view link.
- Project owner: configures external services, applies migrations and monitors the Beta.

## Core jobs

1. Start locally as a guest or sign in.
2. Create a report or folder and organize work.
3. Write Markdown with tables, formulas, diagrams, code and images.
4. Recover work after refresh, temporary network failure or delayed saves.
5. Ask AI for an outline or edit without silently changing measured values.
6. Check structural completeness before submission.
7. Export Word or PDF.
8. Share a read-only public link or invite a named collaborator.

## Closed Beta scope

### Included

- Email Magic Link and Google OAuth.
- Local guest workspace with an explicit local-only warning and persistent guest session.
- Authenticated cloud document and folder CRUD.
- Serialized autosave, visible saved／unsaved／saving／error state and a durable per-account save outbox.
- Markdown preview with GFM, KaTeX, Mermaid, code and private images.
- Structured outline inputs: experiment name, purpose, teacher requirements, raw data, output format and reference structure.
- AI rewrite, expand, format and agent workflows with preview-before-apply and version backup.
- Numeric and unit integrity guard for non-outline AI tasks.
- Quality checks with a reported location and remediation.
- Public read-only report, explicit Email collaborators and owner-only permission management.
- Word and PDF export.

### Deliberately out of Closed Beta

- Stripe billing and plan upgrades.
- GitHub authentication and repository synchronization.
- Google Drive import.
- Browser extension.
- Screen recording.
- Realtime Yjs collaboration.
- Ownership-transfer email.
- Server-side Python execution.

All excluded features default to disabled. Enabling one creates a separate release decision and requires its own security and end-to-end test pass.

## Data and permissions

| Actor | Read | Edit | Permissions / delete |
| --- | --- | --- | --- |
| Owner | Own documents, including trash | Own documents | Yes |
| Invited viewer | Non-trashed invited document | No | No |
| Invited editor | Non-trashed invited document | Content only | No |
| Public / anonymous | Non-trashed document with view or legacy edit share setting | No | No |
| Service role | Server operations only | Server operations only | Server operations only |

Legacy public edit links are treated as read-only. Browser clients cannot change user_id, workspace ownership, view count, plan, quota, Stripe or integration secrets.

## Reliability requirements

- Guest drafts survive reload on the same browser.
- Authenticated caches and outbox entries are namespaced by user id.
- Only one remote save is in flight at a time; stale completions cannot mark a newer edit as saved.
- A zero-row Supabase update is an error, not a successful save.
- Failed cloud writes retain the newest local outbox item and present a retry action.
- Public reports never expose raw database or provider error messages.
- Production frontend URLs never fall back to localhost.

## AI integrity requirements

- AI output is always a proposal until the user confirms.
- The current version is captured before applying AI output.
- For rewrite, expand, format, summarize and agent tasks, numbers and attached units from the source must remain present and unchanged.
- Ordered-list numbers are ignored by the integrity comparison.
- Unit conversion is rejected in the Beta even when mathematically equivalent; the student may apply it manually.
- Provider bodies, request URLs, tokens and stack traces are not returned to the browser.

## Export requirements

The standard fixture covers:

- Chinese and English paragraphs.
- Headings and multi-page content.
- GFM table.
- Local image.
- KaTeX formula.
- Mermaid block.
- Long Python code block.
- References.

Word must keep text, table, image and formula readable without clipping. Python code is displayed, never executed. Current Word export keeps Mermaid as source text; this is a documented P1 limitation.

PDF follows the browser preview and must preserve the rendered Mermaid and report image. Browser download was invoked in local QA without a visible error; a captured PDF artifact still requires a normal Chrome／Edge manual pass before invitations.

## Release gates

### Code gates

- TypeScript, ESLint, unit tests, backend safety tests and production build pass.
- API health, CORS denial, disabled-feature behavior, render safety and DOCX export smoke tests pass.
- Secret scan and git diff check pass.
- No P0 code defect remains open.

### Owner gates

- Apply and verify all Supabase migrations in a clean staging project.
- Configure Auth redirect URLs and at least Google or Email sign-in.
- Configure Vercel and Render environment variables.
- Confirm GET /api/readiness returns 200 in staging.
- Complete one owner／viewer／editor permission matrix test with real accounts.
- Complete one Word and one PDF download in a normal browser.
- Establish a feedback channel and error monitoring.

## Success criteria for the first 20 students

- No student can read or edit another student's private report without an invitation.
- No accepted save is silently lost.
- No AI operation silently changes a measured number or unit.
- At least 95% of attempted report saves and exports either succeed or show an actionable error.
- Every student knows whether work is local-only or cloud-synced.
- The owner can identify affected users and recent errors during the Beta.
