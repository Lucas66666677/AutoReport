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


    def test_version_history_is_backed_by_the_cloud_when_signed_in(self):
        """Snapshots lived only in localStorage; a new device or cleared storage lost them."""
        source = _text(APP)
        self.assertIn(".from('document_versions')", source)
        self.assertIn("versionToRow(", source)
        self.assertIn("cloudBacked={shouldUseSupabaseDocuments}", source)
        migration = (SRC.parents[1] / "supabase" / "migrations" / "20260911_document_versions.sql").read_text(encoding="utf-8")
        self.assertIn("enable row level security", migration)
        self.assertIn("public.can_edit_document(document_id)", migration)

    def test_save_as_template_is_not_a_placeholder(self):
        """存為範本 only showed a toast about a future templates table."""
        source = _text(APP)
        self.assertNotIn("已保留為範本入口", source)
        self.assertIn("void saveActiveDocumentAsTemplate()", source)
        self.assertIn(".from('report_templates')", source)


    def test_ownership_transfer_is_not_a_placeholder(self):
        """轉移筆記擁有權 only toasted that a backend flow was missing."""
        source = _text(APP)
        self.assertNotIn("轉移筆記擁有權需要後端權限流程", source)
        self.assertIn("/transfer/request`", source)
        self.assertIn("/api/reports/transfer/incoming", source)
        self.assertIn("/api/reports/transfer/${requestId}/${decision}", source)


    def test_projects_row_menu_cannot_open_off_screen(self):
        """The row menu opened below the last rows inside a clipped, scrolling panel; 刪除 was unreachable."""
        source = _text(APP)
        self.assertNotIn('className="absolute right-0 top-full z-20 mt-2 w-48', source)
        self.assertIn("style={menuPosition ?? undefined}", source)
        self.assertIn("window.innerHeight - rect.bottom < PROJECT_MENU_HEIGHT + 16", source)

    def test_browser_back_and_refresh_keep_the_user_in_the_app(self):
        """Every navigation used replaceState and nothing listened to popstate, so Back left the app."""
        source = _text(APP)
        self.assertIn("window.history.pushState(null, '', nextPath)", source)
        self.assertIn("window.addEventListener('popstate', onPopState)", source)
        self.assertIn("`/editor/${encodeURIComponent(activeDocumentId)}`", source)

    def test_row_actions_are_reachable_without_a_mouse_hover(self):
        """Sidebar rename/delete were opacity-0 until hover: invisible on touch screens and to keyboard focus."""
        for line in _text(APP).splitlines():
            if "opacity-0" in line and "group-hover:opacity-100" in line:
                with self.subTest(line=line.strip()[:80]):
                    self.assertIn("focus-visible:opacity-100", line)
                    self.assertIn("[@media(hover:none)]:opacity-100", line)

    def test_rename_and_open_explain_why_nothing_happened(self):
        source = _text(APP)
        body = _function_body(source, "async function renameDocument(", 200)
        self.assertRegex(body, r"if \(databaseLoading\) \{\s*setBridgeToast\(")
        self.assertIn("找不到這份文件，可能已被移到垃圾桶", source)


    def test_app_written_editor_urls_do_not_reopen_the_report(self):
        """The deep-link effect would re-apply the open report on any dependency change, discarding typing."""
        source = _text(APP)
        self.assertIn("if (pendingDeepLink && !hasSyncedInitialRouteRef.current) return", source)
        handler = source[source.index("handleHistoryNavigationRef.current = () => {"):][:200]
        self.assertIn("hasOpenedSharedDocRef.current = true", handler)
        self.assertGreater(
            source.index("const handleHistoryNavigationRef"),
            source.index("function loadDocument(document: Document)"),
        )


    def test_escape_closes_dialogs_and_drawers(self):
        """No dialog handled Escape; a mis-opened dialog needed its own close button."""
        source = _text(APP)
        self.assertIn("if (event.key !== 'Escape' || event.defaultPrevented) return", source)
        self.assertIn("setIsCreateModalOpen(false)", source)

    def test_no_sync_guard_returns_silently(self):
        """移動 / title edit / 收藏 did nothing while syncing, with no message."""
        self.assertNotRegex(_text(APP), r"if \(databaseLoading\) return\b")


    def test_back_does_not_erase_forward_history(self):
        """Back landed on a mismatched path; the sync pushed a new entry and Forward stopped working."""
        source = _text(APP)
        self.assertIn("if (hasSyncedInitialRouteRef.current && !isRestoringFromHistoryRef.current) {", source)
        handler = source[source.index("handleHistoryNavigationRef.current = () => {"):][:400]
        self.assertIn("isRestoringFromHistoryRef.current = true", handler)


    def test_opening_a_report_does_not_strand_the_sidebar_as_a_rail(self):
        """After the first report, home and 項目 showed a 64px rail without 垃圾桶 / 設定."""
        source = _text(APP)
        self.assertNotIn("setIsSidebarCollapsed(true)", source)
        self.assertIn("window.matchMedia('(max-width: 767px)').matches", source)
        branch = source[source.index("  if (isCollapsed) {"):]
        branch = branch[: branch.index("\n  return (", 20)]
        self.assertIn("[...pinnedItems, ...moreItems].map(", branch)


    def test_trash_and_restore_confirm_success(self):
        """Moving to the trash and 復原 were silent; only 永久刪除 said anything."""
        source = _text(APP)
        delete_body = _function_body(source, "async function deleteDocument(", 5000)
        self.assertGreaterEqual(delete_body.count("setBridgeToast(trashedMessage)"), 2)
        restore_body = _function_body(source, "async function restoreDocument(", 2500)
        self.assertIn("已復原「", restore_body)


    def test_word_format_cannot_corrupt_the_report(self):
        """smartFormat glued sentences to headings, deleted English in parentheses and made numbers into lists."""
        source = _text(APP)
        self.assertNotIn(r"\s*([。，！？；：])\s*", source)
        self.assertNotIn("function removeConsecutiveDuplicateContent", source)
        self.assertIn("import { smartFormat } from './smartFormat'", source)
        body = _function_body(source, "function handleSmartFormat(", 900)
        self.assertIn("mode: 'replace-document'", body)
        self.assertIn("格式已經整齊", body)

    def test_phone_header_hides_unavailable_split(self):
        """On a 375px phone 更多操作 was pushed past the right edge by a disabled Split button."""
        self.assertIn("if (isEditorWorkspaceCompact && mode === 'split') return null", _text(APP))


    def test_template_imitation_is_reachable_and_keeps_the_source(self):
        """模板臨摹: template cards and the editor menu open it; results become a new report."""
        source = _text(APP)
        self.assertIn("AI 臨摹", source)
        self.assertIn("AI 臨摹成新報告", source)
        self.assertIn("`${API_BASE_URL}/api/templates/imitate`", source)
        self.assertIn(".from('template_imitation_presets')", source)
        self.assertIn("await createDocumentFromTemplate(template)", source)
        dialog = _text(SRC / "TemplateImitationDialog.tsx")
        self.assertIn("buildImitationRequest(", dialog)
        self.assertIn("這些數字不在你提供的資料中", dialog)


    def test_imitation_warns_before_the_work_when_quota_is_gone(self):
        """With 0 built-in calls left the dialog let users fill everything, then failed."""
        source = _text(APP)
        self.assertIn("blockedReason={imitationBlockedReason}", source)
        self.assertIn("今日內建 AI 額度已用完（每天台灣時間早上 8 點重置）", source)
        dialog = _text(SRC / "TemplateImitationDialog.tsx")
        self.assertIn("disabled={busy || Boolean(blockedReason)}", dialog)

    def test_guests_are_not_shown_an_endless_quota_loading_state(self):
        source = _text(APP)
        self.assertIn("{!user ? '登入後可用' : quotaLoading", source)
        self.assertIn("status: !isSignedIn ? '登入後可用'", source)
        self.assertIn("isSignedIn={Boolean(user)}", source)


    def test_header_search_actually_searches(self):
        """The 「搜尋報告、模板或設定...」 input had no handler; typing did nothing."""
        source = _text(APP)
        self.assertIn("<GlobalSearch", source)
        self.assertIn("onOpenDocument={selectDocument}", source)
        search = _text(SRC / "GlobalSearch.tsx")
        self.assertIn("onChange={(event) => {", search)
        self.assertIn("searchEverything(query, documents, templates)", search)


    def test_user_templates_and_versions_can_be_removed(self):
        """我的模板 had no delete at all, and 版本歷史 only offered 還原."""
        source = _text(APP)
        self.assertIn("void deleteUserTemplate(template)", source)
        self.assertIn(".from('report_templates').delete()", source)
        self.assertIn("onDeleteVersion={(version) => void deleteDocumentVersion(version)}", source)
        self.assertIn(".from('document_versions').delete()", source)
        for body, label in (
            (_function_body(source, "async function deleteUserTemplate(", 400), "template"),
            (_function_body(source, "async function deleteDocumentVersion(", 400), "version"),
        ):
            with self.subTest(delete=label):
                self.assertIn("window.confirm(", body)
                self.assertIn("此操作無法復原", body)


    def test_export_embeds_images_so_they_survive_word(self):
        """Pandoc cannot fetch supabase-image:// (the image vanished) and blocked hosts became error pages."""
        source = _text(APP)
        self.assertIn("embedImagesForExport(exportMarkdown)", source)
        self.assertIn("JSON.stringify({ markdown: exportReady })", source)
        self.assertIn("createSignedUrl(storagePath, 600)", source)
        helpers = _text(SRC / "exportImages.ts")
        self.assertIn("export function collectMarkdownImageUrls", helpers)
        self.assertIn("export function replaceMarkdownImageUrls", helpers)


    def test_images_copied_from_a_web_page_can_be_pasted(self):
        """Only a clipboard image *file* worked; an <img> fragment or an image address did not."""
        source = _text(APP)
        self.assertIn("collectHtmlImageSources(pastedHtml)", source)
        self.assertIn("collectImageUrlsFromText(pastedText)", source)
        body = _function_body(source, "async function importImagesFromUrls(", 1200)
        self.assertIn("uploadPastedImage(await fetchPastedImageFile(url))", body)
        self.assertIn("無法下載", body)
        helpers = _text(SRC / "pastedImages.ts")
        self.assertIn("export function collectHtmlImageSources", helpers)
        self.assertIn("export function collectImageUrlsFromText", helpers)


    def test_a_pasted_image_falls_back_to_the_server_when_cors_blocks_it(self):
        """A cross-origin image download is blocked in the browser, which is the common case."""
        source = _text(APP)
        body = _function_body(source, "async function fetchPastedImageFile(", 900)
        self.assertIn("/api/fetch-image", body)
        self.assertIn("data_url", body)
        self.assertIn("fetchPastedImageFile(url)", source)


if __name__ == "__main__":
    unittest.main()
