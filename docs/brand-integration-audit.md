# AutoLabReport brand integration audit

Date: 2026-07-23

## Approved source

- Requested canonical path: `brand-source/autolabreport-logo-v2.png`
- The canonical path was absent at the start of this task.
- The only supplied file, `brand-source/exec-ea906770-a110-47ea-a4e2-bf472240eb17.png`, was copied byte-for-byte to the canonical path before generation.
- Both source files and `frontend/public/brand/autolabreport-logo.png` have SHA-256 `FDD59C63E875F346ED8B10176EDBE35B27A03D3899E686700F3740F289CF02A0`.

## Previous brand locations

- `frontend/public/favicon.svg`: temporary purple Vite-style lightning mark used by `frontend/index.html`.
- Expanded workspace sidebar: indigo/violet/fuchsia gradient tile containing a `FileText` icon.
- Collapsed sidebar: no brand mark; the first visual was the expand control.
- Landing navigation: glowing white dot plus plain `AutoLabReport` text and `Prism workspace` label.
- Landing hero: product name as text with no approved logo asset.
- Editor header: no product brand asset.
- Public report: dynamic title/description/Open Graph type, but no product lockup or Open Graph image.
- No web manifest, Apple touch icon, PNG favicon set, maskable icons, or static social image existed.
- `frontend/src/assets/react.svg`, `frontend/src/assets/vite.svg`, and `frontend/public/icons.svg` are not referenced as product branding and were left untouched.

## Current integration

- `frontend/src/Brand.tsx` owns `BrandMark` and `BrandLockup`.
- The components support compact/default/large sizes and light/dark surfaces.
- Lockups use real HTML text; their image is decorative to avoid duplicate screen-reader output.
- Standalone marks use `alt="AutoLabReport"`, explicit dimensions, WebP `srcset`, and a PNG fallback.
- Expanded sidebar uses `BrandLockup`; collapsed sidebar uses one standalone `BrandMark` while navigation retains Lucide icons.
- Landing navigation uses the compact dark lockup and hides its text on narrow screens. The hero uses a 96px decorative mark beside the existing product heading.
- Editor uses one compact standalone mark in its main header.
- Dashboard, projects, templates, settings, prompts, trash, and billing inherit the single sidebar brand position.
- Public report uses a subdued compact lockup above the report title.
- Authentication/loading state uses a standalone mark.

## Generated assets

Run `scripts/generate-brand-assets.py` with the bundled Python/Pillow runtime to reproduce them.

- Full logo: PNG 1254x1254, WebP 1254x1254.
- Optimized mark: PNG and WebP at 64, 128, and 256.
- Favicons: PNG at 16, 32, and 48.
- Apple touch icon: PNG at 180.
- PWA icons: PNG at 192 and 512.
- Maskable PWA icons: PNG at 192 and 512 with a 72% source-only safe zone.
- Open Graph image: PNG at 1200x630.

## Browser QA evidence

Screenshots are stored in `docs/brand-screenshots/`:

- `landing-login-1440.png`
- `landing-login-390.png`
- `dashboard-1440-expanded.png`
- `dashboard-1440-collapsed.png`
- `dashboard-1024.png`
- `editor-1440.png`
- `editor-390.png`
- `billing-1440.png`
- `public-report-1440.png`

Dashboard/editor/public-report screenshots used a development-only in-memory fixture through the actual production components because the browser had no authenticated session. The fixture was removed before final tests and build. A fresh browser tab covering dashboard, editor, and public-report fixture states reported no console warnings or errors.

## Follow-up work

- Confirm that the supplied `exec-...png` and the intended missing `autolabreport-logo-v2.png` were meant to be the same approved artwork.
- Replace relative static Open Graph URLs with the final absolute production URL when the canonical domain is known. Public-report runtime metadata already resolves the image to an absolute origin URL.
- A manifest is configured, but the project still has no service worker/offline install lifecycle.
- The Chrome extension currently has no product icon entries; extension branding can be handled as a separate checkpoint if desired.
