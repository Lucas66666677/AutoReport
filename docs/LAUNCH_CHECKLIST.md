# AutoLabReport Closed Beta Launch Checklist

Use this only after reading docs/product/RELEASE_READINESS.md and docs/OWNER_ACTIONS.md.

## P0

- [ ] Apply the full schema and every dated Supabase migration in clean staging.
- [ ] Run owner／viewer／editor／anonymous permission matrix.
- [ ] Confirm report_images and report_recordings are private.
- [ ] Configure Email and／or Google Auth on the final domains.
- [ ] Configure Vercel and Render without localhost fallbacks.
- [ ] Confirm backend /api/readiness is 200.
- [ ] Complete one built-in AI outline and one rewrite.
- [ ] Verify number-changing AI output is rejected.
- [ ] Download and inspect standard Word and PDF exports.
- [ ] Configure monitoring and a student feedback destination.

## Closed Beta flags

- [ ] Billing off.
- [ ] GitHub auth and sync off.
- [ ] Google Drive off.
- [ ] Screen recording off.
- [ ] Realtime collaboration off in frontend and server.
- [ ] Browser extension off.
- [ ] Ownership transfer email off.
- [ ] Python execution absent from render and export.

## Canary

- [ ] Owner-only staging acceptance completed.
- [ ] Two students invited.
- [ ] One school day with no P0 incident.
- [ ] Five students invited.
- [ ] Review monitoring, save failures, OAuth failures and exports.
- [ ] Twenty students invited only after owner sign-off.

## Local command

~~~powershell
cd D:\AutoLabReport
npm run check:deploy
~~~

The command is a preflight, not a substitute for Supabase and browser acceptance.
