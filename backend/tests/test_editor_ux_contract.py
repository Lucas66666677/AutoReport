"""Editor UX promises that were broken on production, pinned so they stay fixed.

Found while verifying the signed-in flow on 2026-09-11. Each test names what a
user actually saw. They read source files only.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
APP = SRC / "App.tsx"

# Characters that only exist in Simplified Chinese and have a distinct
# Traditional form. Deliberately excludes characters that are also correct
# Traditional in other words (e.g. 里, 准, 据, 只, 台, 占), so the check
# cannot flag correct Taiwan copy.
SIMPLIFIED_ONLY = set(
    "开启将选设为处写这会时显报预览备节数问题评标单记双语图编号参结构调宽键"
)


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _function_body(source: str, signature: str, length: int = 400) -> str:
    start = source.find(signature)
    if start == -1:
        raise AssertionError(f"{signature!r} not found in App.tsx")
    return source[start : start + length]


class EditorUxContractTests(unittest.TestCase):
    def test_ui_copy_contains_no_simplified_only_characters(self):
        """The UI is Traditional Chinese; the outline dialog and toolbar mixed in Simplified."""
        offenders = []
        for path in sorted(SRC.rglob("*.ts*")):
            if ".test." in path.name:
                continue
            for number, line in enumerate(_text(path).splitlines(), 1):
                bad = sorted({ch for ch in line if ch in SIMPLIFIED_ONLY})
                if bad:
                    offenders.append(f"{path.name}:{number} {''.join(bad)}  {line.strip()[:60]}")
        self.assertEqual(offenders, [], "Simplified Chinese in UI source:\n" + "\n".join(offenders))

    def test_version_history_is_reachable(self):
        """Applying an AI change says the old version was backed up; the page must be openable."""
        self.assertIn("setCurrentView('history')", _text(APP))

    def test_backup_toasts_say_where_the_backup_lives(self):
        """Versions are stored in this browser only; the toast must not imply more."""
        source = _text(APP)
        self.assertNotIn("原版本已備份')", source)
        self.assertIn("原版本已備份在這台瀏覽器", source)

    def test_built_in_ai_is_not_labelled_as_free_demo(self):
        """The default provider calls /api/ai/run and spends quota."""
        source = _text(APP)
        self.assertNotIn("可先體驗流程，不消耗 AI", source)
        self.assertNotIn("'範例模式'", source)
        self.assertIn("aiSettings.preferredProvider === 'built_in'", source)

    def test_quota_widget_labels_the_number_as_remaining(self):
        """'1 / 3 次' read as one used when it meant one left; unknown must not claim 3."""
        source = _text(APP)
        self.assertNotRegex(source, r"quota\?\.remaining \?\? 3")
        self.assertIn("剩餘 ${quota.remaining} / ${quota.limit} 次", source)

    def test_rewrite_without_a_selection_explains_itself(self):
        body = _function_body(_text(APP), "async function requestAiEdit(")
        self.assertRegex(body, r"if \(!activeSelection\) \{\s*setBridgeToast\(")

    def test_loading_guards_tell_the_user_instead_of_doing_nothing(self):
        source = _text(APP)
        for signature in (
            "async function createDocumentForParent(",
            "async function createDocumentFromTemplate(",
            "async function deleteDocument(",
        ):
            with self.subTest(signature=signature):
                body = _function_body(source, signature, 200)
                self.assertRegex(body, r"if \(databaseLoading\) \{\s*setBridgeToast\(")

    def test_a_text_selectable_pdf_path_exists(self):
        """html2pdf rasterises every page; printing keeps text selectable and searchable."""
        source = _text(APP)
        self.assertIn("async function printSearchablePdf(", source)
        self.assertIn("frameWindow.print()", source)
        self.assertIn("列印／另存 PDF（文字可選取）", source)
        self.assertIn("匯出 PDF（圖片版）", source)

    def test_sidebar_folder_button_does_not_pass_the_click_event(self):
        """onClick={onCreateFolder} handed the MouseEvent to createNewFolder as parentId."""
        source = _text(APP)
        self.assertNotIn("onClick={onCreateFolder}", source)
        self.assertIn("onClick={() => onCreateFolder()}", source)

    def test_projects_view_shows_no_fabricated_records(self):
        """Every user saw the same fake import history and snippets owned by a fixed name."""
        source = _text(APP)
        for fabricated in ("光學實驗原始 Word", "數據表 PDF", "誤差分析 Python 繪圖片段", "owner: 'Lucas Shelby'"):
            with self.subTest(fabricated=fabricated):
                self.assertNotIn(fabricated, source)


    def test_templates_carry_no_invented_usage_counts(self):
        """Built-in templates showed "128 次套用" etc. with nothing counting usage."""
        source = _text(APP)
        self.assertIsNone(re.search(r"useCount: [1-9]\d*,", source), "hard-coded template usage count")
        self.assertNotIn("{template.useCount ?? 0} 次套用", source)


    def test_print_pdf_cannot_stall_on_lazy_images(self):
        """Lazy preview images never load in the hidden print frame, so print never ran."""
        source = _text(APP)
        start = source.index("async function printSearchablePdf(")
        body = source[start : source.index("async function exportPdfReport(", start)]
        self.assertIn('loading="lazy"', body, "print copy must strip lazy loading")
        self.assertIn("${printableHtml}", body)
        self.assertNotIn("${previewHtml}</div>", body)
        self.assertIn("window.setTimeout(resolve, 10_000)", body)


if __name__ == "__main__":
    unittest.main()
