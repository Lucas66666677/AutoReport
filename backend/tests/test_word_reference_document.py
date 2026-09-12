"""The Word export uses the committed reference document, and survives without it.

Pandoc's built-in reference document leaves the page size unset, so Word fell back to
US Letter, used theme fonts with no CJK face pinned, and drew tables with no borders.
The fix is a reference document shipped in the repository -- which only works if the
file is actually committed and actually passed to Pandoc, and which must not take the
export down if it ever goes missing on a deployed host.
"""

from __future__ import annotations

import re
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import main

A4_WIDTH_TWENTIETHS = "11906"
A4_HEIGHT_TWENTIETHS = "16838"


class ReferenceDocumentShipsTests(unittest.TestCase):
    def test_the_reference_document_is_committed_next_to_the_app(self):
        self.assertTrue(
            main.REFERENCE_DOCX.is_file(),
            f"{main.REFERENCE_DOCX} is missing; the deployed service has no reference document",
        )

    def test_it_is_a_real_docx(self):
        with zipfile.ZipFile(main.REFERENCE_DOCX) as archive:
            names = archive.namelist()
        self.assertIn("word/document.xml", names)
        self.assertIn("word/styles.xml", names)

    def test_the_pages_are_a4_with_margins(self):
        with zipfile.ZipFile(main.REFERENCE_DOCX) as archive:
            document = archive.read("word/document.xml").decode("utf-8")
        section = re.search(r"<w:sectPr>.*?</w:sectPr>", document, re.S)
        self.assertIsNotNone(section, "the reference document declares no section properties")
        self.assertIn(f'w:w="{A4_WIDTH_TWENTIETHS}"', section.group(0))
        self.assertIn(f'w:h="{A4_HEIGHT_TWENTIETHS}"', section.group(0))
        self.assertIn("<w:pgMar", section.group(0))

    def test_the_styles_pin_a_cjk_face_and_give_tables_borders(self):
        with zipfile.ZipFile(main.REFERENCE_DOCX) as archive:
            styles = archive.read("word/styles.xml").decode("utf-8")
        # Without an explicit eastAsia face, Word substitutes per machine.
        self.assertIn("PMingLiU", styles)
        self.assertIn("Times New Roman", styles)
        self.assertIn("tblBorders", styles)

    def test_the_builder_is_kept_so_the_document_can_be_regenerated(self):
        builder = Path(main.__file__).resolve().parent / "tools" / "build_reference_docx.py"
        self.assertTrue(builder.is_file(), "no way to rebuild the reference document after a Pandoc upgrade")


class ReferenceDocumentWiringTests(unittest.TestCase):
    def test_pandoc_is_told_to_use_it(self):
        args = main._docx_export_args()
        self.assertEqual(args[0], "--reference-doc")
        self.assertEqual(Path(args[1]), main.REFERENCE_DOCX)

    def test_a_missing_reference_document_falls_back_instead_of_failing_the_export(self):
        missing = main.REFERENCE_DOCX.parent / "definitely-not-here.docx"
        with patch.object(main, "REFERENCE_DOCX", missing):
            self.assertEqual(main._docx_export_args(), [])


if __name__ == "__main__":
    unittest.main()
