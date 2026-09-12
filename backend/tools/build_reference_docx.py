"""Build the Word reference document used by the .docx export.

Pandoc's built-in reference document has no page size (Word then falls back to US
Letter) and leaves every font to the theme, so an exported lab report came out on
the wrong paper with no CJK font pinned and borderless tables. This script starts
from Pandoc's own default -- so new Pandoc releases stay compatible -- and applies
the academic layout on top.

Regenerate after a Pandoc upgrade:

    python backend/tools/build_reference_docx.py

The result is committed as backend/assets/reference.docx because the deployed
service must not depend on Pandoc's data files being writable or even present.
"""

from __future__ import annotations

from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ElementTree
import zipfile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "reference.docx"

# A4 portrait in twentieths of a point, and 2.5 cm margins.
PAGE_WIDTH = "11906"
PAGE_HEIGHT = "16838"
MARGIN = "1418"
MARGIN_TOP_BOTTOM = "1418"

# Latin face for numbers and units, CJK face for the report text itself.
BODY_LATIN = "Times New Roman"
BODY_EAST_ASIAN = "PMingLiU"
HEADING_LATIN = "Cambria"
HEADING_EAST_ASIAN = "Microsoft JhengHei"

BODY_HALF_POINTS = "24"  # 12 pt
LINE_SPACING = "360"  # 1.5 lines
HEADING_SIZES = {"Heading1": "32", "Heading2": "28", "Heading3": "26"}  # 16/14/13 pt

SECT_PR = (
    "<w:sectPr>"
    "<w:footnotePr><w:numRestart w:val=\"eachSect\" /></w:footnotePr>"
    f"<w:pgSz w:w=\"{PAGE_WIDTH}\" w:h=\"{PAGE_HEIGHT}\" />"
    f"<w:pgMar w:top=\"{MARGIN_TOP_BOTTOM}\" w:right=\"{MARGIN}\" "
    f"w:bottom=\"{MARGIN_TOP_BOTTOM}\" w:left=\"{MARGIN}\" "
    "w:header=\"851\" w:footer=\"992\" w:gutter=\"0\" />"
    "</w:sectPr>"
)


def qn(tag: str) -> str:
    return f"{{{W}}}{tag}"


def child(parent: ElementTree.Element, tag: str, index: int = 0) -> ElementTree.Element:
    """Return parent's child, creating it at `index` when missing."""
    found = parent.find(qn(tag))
    if found is None:
        found = ElementTree.Element(qn(tag))
        parent.insert(index, found)
    return found


def set_fonts(run_properties: ElementTree.Element, latin: str, east_asian: str) -> None:
    fonts = child(run_properties, "rFonts")
    for key in ("ascii", "hAnsi", "cs"):
        fonts.set(qn(key), latin)
        fonts.attrib.pop(qn(f"{key}Theme"), None)
    fonts.set(qn("eastAsia"), east_asian)
    fonts.attrib.pop(qn("eastAsiaTheme"), None)


def set_size(run_properties: ElementTree.Element, half_points: str) -> None:
    for tag in ("sz", "szCs"):
        child(run_properties, tag).set(qn("val"), half_points)


def pandoc_default_reference(destination: Path) -> None:
    result = subprocess.run(
        ["pandoc", "--print-default-data-file", "reference.docx"],
        capture_output=True,
        check=True,
    )
    destination.write_bytes(result.stdout)


def apply_page_size(document_xml: str) -> str:
    """Give the document A4 pages; Pandoc's default leaves the size unset."""
    updated, count = re.subn(r"<w:sectPr>.*?</w:sectPr>", SECT_PR, document_xml, flags=re.S)
    if count != 1:
        raise SystemExit(f"expected exactly one sectPr in document.xml, found {count}")
    return updated


def apply_styles(styles_xml: bytes) -> bytes:
    # Keep every prefix the file declares, or Word rejects the result.
    for prefix, uri in re.findall(r'xmlns:([A-Za-z0-9]+)="([^"]+)"', styles_xml.decode("utf-8")):
        ElementTree.register_namespace(prefix, uri)

    root = ElementTree.fromstring(styles_xml)

    defaults = root.find(qn("docDefaults"))
    if defaults is None:
        raise SystemExit("styles.xml has no docDefaults")

    run_defaults = child(child(defaults, "rPrDefault"), "rPr")
    set_fonts(run_defaults, BODY_LATIN, BODY_EAST_ASIAN)
    set_size(run_defaults, BODY_HALF_POINTS)

    paragraph_defaults = child(child(defaults, "pPrDefault"), "pPr")
    spacing = child(paragraph_defaults, "spacing")
    spacing.set(qn("line"), LINE_SPACING)
    spacing.set(qn("lineRule"), "auto")
    spacing.set(qn("after"), "120")

    for style in root.findall(qn("style")):
        style_id = style.get(qn("styleId"))

        if style_id in HEADING_SIZES:
            run_properties = child(style, "rPr", index=len(list(style)))
            set_fonts(run_properties, HEADING_LATIN, HEADING_EAST_ASIAN)
            set_size(run_properties, HEADING_SIZES[style_id])
            child(run_properties, "b").set(qn("val"), "true")
            paragraph_properties = child(style, "pPr")
            # A heading alone at the foot of a page reads as a mistake.
            child(paragraph_properties, "keepNext").set(qn("val"), "true")
            heading_spacing = child(paragraph_properties, "spacing")
            heading_spacing.set(qn("before"), "240")
            heading_spacing.set(qn("after"), "120")
            heading_spacing.set(qn("line"), LINE_SPACING)
            heading_spacing.set(qn("lineRule"), "auto")

        if style_id == "Table":
            table_properties = child(style, "tblPr")
            borders = child(table_properties, "tblBorders")
            for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
                border = child(borders, edge, index=len(list(borders)))
                border.set(qn("val"), "single")
                border.set(qn("sz"), "4")
                border.set(qn("space"), "0")
                border.set(qn("color"), "000000")

        if style_id in {"Caption", "TableCaption"}:
            run_properties = child(style, "rPr", index=len(list(style)))
            set_size(run_properties, "20")  # 10 pt
            child(run_properties, "i").set(qn("val"), "true")

    return ElementTree.tostring(root, encoding="UTF-8", xml_declaration=True)


def build(output: Path = OUTPUT) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / "base.docx"
        pandoc_default_reference(base)

        source = zipfile.ZipFile(base)
        staged = output.with_suffix(".docx.tmp")
        with zipfile.ZipFile(staged, "w", zipfile.ZIP_DEFLATED) as target:
            for item in source.infolist():
                payload = source.read(item.filename)
                if item.filename == "word/document.xml":
                    payload = apply_page_size(payload.decode("utf-8")).encode("utf-8")
                elif item.filename == "word/styles.xml":
                    payload = apply_styles(payload)
                target.writestr(item, payload)
        source.close()
        shutil.move(str(staged), str(output))
    return output


if __name__ == "__main__":
    written = build()
    print(f"wrote {written} ({written.stat().st_size} bytes)", file=sys.stderr)
