# AutoLabReport Post-Beta Roadmap

The Closed Beta baseline and current gaps are tracked in docs/product/REQUIREMENTS_MATRIX.md and docs/product/BETA_BACKLOG.md. This file records work that should not be mixed into the first 20-student release.

## Next reliability work

1. Run every migration in ephemeral Supabase CI.
2. Add authenticated browser E2E for CRUD, RLS, collaborator roles and private Storage.
3. Add browser offline／online autosave tests.
4. Add normal-browser PDF artifact regression and visual diff.
5. Run the permanent-delete Storage cleanup against real multi-account staging data.
6. Add monitoring, release identifiers and incident playbook.

## Export improvements

1. Render Mermaid to a deterministic image for Word.
2. Add a maintained Word reference document with A4 page size and academic styles.
3. Add page-break fixtures for wide tables and multiple images.
4. Add citation formatting options.

## Optional product expansions

Each item requires a separate threat model and release gate:

- Realtime collaboration with one authoritative persistence path.
- Stripe billing.
- Google Drive import with separate minimal consent.
- GitHub auth and repo sync.
- Browser extension distribution.
- Screen recording retention and deletion.
- Ownership transfer.

Do not make report_images or report_recordings public as a shortcut. Do not restore Python execution inside the FastAPI process.
