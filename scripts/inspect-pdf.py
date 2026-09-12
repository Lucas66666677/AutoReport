"""Inspect an exported PDF page by page.

BETA_BACKLOG asks for a downloaded PDF to be rendered and inspected, because the
in-app browser could invoke the export but never produced a file to look at. The
Playwright journey now captures the real download; this reads it back and fails
loudly on the things a human would notice: no pages, a blank page, or text from the
report that did not survive.

    python scripts/inspect-pdf.py .playwright-output/artifacts/report.pdf --expect-image

The app's PDF export is 匯出 PDF（圖片版）: html2canvas photographs the preview, so a
page carries an image and no text layer at all. Use --expect-image for that one, and
keep --expect for a PDF that is meant to have selectable text.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pypdf import PdfReader

# A page carrying only whitespace is what a failed render looks like from here.
MIN_CHARS_PER_PAGE = 5


def inspect(
    path: Path,
    expected: list[str],
    allow_blank_pages: bool,
    expect_image: bool,
) -> int:
    if not path.is_file():
        print(f"FAIL: no PDF at {path}")
        return 1

    reader = PdfReader(str(path))
    pages = reader.pages
    print(f"{path.name}: {path.stat().st_size} bytes, {len(pages)} page(s)")
    if not pages:
        print("FAIL: the PDF has no pages")
        return 1

    whole_text: list[str] = []
    blank_pages: list[int] = []
    for number, page in enumerate(pages, start=1):
        text = (page.extract_text() or "").strip()
        whole_text.append(text)
        box = page.mediabox
        print(
            f"  page {number}: {len(text)} chars of text, "
            f"{float(box.width):.0f}x{float(box.height):.0f} pt"
        )
        if len(text) < MIN_CHARS_PER_PAGE:
            blank_pages.append(number)

    failures: list[str] = []
    if blank_pages and not (allow_blank_pages or expect_image):
        # An image-only page is legitimate; the caller says so with --allow-blank-pages.
        failures.append(f"page(s) with no extractable text: {blank_pages}")

    if expect_image:
        for number, page in enumerate(pages, start=1):
            try:
                xobjects = page.get("/Resources", {}).get("/XObject", {}).get_object()
            except Exception:
                xobjects = {}
            widths = []
            for name in xobjects or {}:
                try:
                    obj = xobjects[name].get_object()
                except Exception:
                    continue
                if obj.get("/Subtype") == "/Image":
                    widths.append(int(obj.get("/Width", 0)))
            if not widths:
                failures.append(f"page {number} carries no image, but this is the image export")
            else:
                print(f"  page {number}: {len(widths)} image(s), widest {max(widths)}px")
                if max(widths) < 400:
                    failures.append(f"page {number} image is only {max(widths)}px wide; the render looks broken")

    combined = "\n".join(whole_text)
    for needle in expected:
        if needle not in combined:
            failures.append(f"missing from the PDF text: {needle!r}")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("PASS: every page checked out")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument(
        "--expect",
        action="append",
        default=[],
        help="text that must appear somewhere in the PDF; repeatable",
    )
    parser.add_argument("--allow-blank-pages", action="store_true")
    parser.add_argument(
        "--expect-image",
        action="store_true",
        help="the image export: require an embedded image per page instead of text",
    )
    args = parser.parse_args()
    return inspect(args.pdf, args.expect, args.allow_blank_pages, args.expect_image)


if __name__ == "__main__":
    sys.exit(main())
