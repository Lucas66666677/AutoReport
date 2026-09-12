# AutoLabReport Closed Beta Launch Checklist

Use this only after reading docs/product/RELEASE_READINESS.md and docs/OWNER_ACTIONS.md.

## P0

- [ ] Apply every dated Supabase migration through `20260912_template_imitation_presets.sql` in clean staging.
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

## Verification commands

~~~powershell
cd D:\AutoLabReport
npm run check:local
npm run audit:prod

# Staging／production preflight（需完整環境變數與可連線後端）
npm run check:deploy
~~~

瀏覽器旅程（會自行啟動前後端，需要本機 Pandoc）：

~~~powershell
cd frontend
npm run test:e2e:install   # 只有第一次需要，下載 Chromium
npm run test:e2e
python ..\scripts\inspect-pdf.py ..\.playwright-output\artifacts\report.pdf --expect-image
~~~

登入後的流程需要測試帳號，未提供 E2E_SUPABASE_URL／E2E_SUPABASE_ANON_KEY／E2E_EMAIL／
E2E_PASSWORD 時會自動跳過。

These commands are not a substitute for Supabase and browser acceptance.
