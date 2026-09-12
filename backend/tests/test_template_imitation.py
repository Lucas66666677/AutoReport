"""模板臨摹: kept sections survive byte-for-byte, the model only fills what changes."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import main

USER = {"id": "11111111-1111-4111-8111-111111111111", "email": "owner@example.com"}

SECTIONS = [
    {"id": "s1", "heading": "# 電子電路實驗報告", "body": "課程：電子學實驗", "mode": "keep"},
    {"id": "s2", "heading": "## 實驗目的", "body": "量測 RC 電路的時間常數。", "mode": "replace"},
    {"id": "s3", "heading": "## 實驗器材", "body": "| 器材 | 數量 |\n|---|---|\n| 示波器 | 1 |", "mode": "keep"},
    {"id": "s4", "heading": "## 數據紀錄", "body": "| 電壓 | 電流 |\n|---|---|\n| 5 V | 1 mA |", "mode": "replace"},
    {"id": "s5", "heading": "## 結論", "body": "時間常數與理論值相符。", "mode": "rewrite"},
]
MATERIAL = "這次做 RL 電路。電壓 12 V，電流 3.2 mA，電感 10 mH。"


def _request(**overrides):
    payload = {"provider": "built_in", "material": MATERIAL, "sections": SECTIONS}
    payload.update(overrides)
    return main.TemplateImitationRequest(**payload)


class FakeEngine:
    def __init__(self, reply: str, model: str = "fake-model"):
        self.reply = reply
        self.model = model
        self.prompts: list[str] = []

    def __call__(self, request, key=None, provider=None):
        self.prompts.append(request.prompt or "")
        return self.reply, self.model


def _run(body, engine):
    with patch.object(main, "_get_user_from_authorization", return_value=USER), \
            patch.object(main, "_reserve_ai_quota", return_value={"remaining": 2, "limit": 3}) as reserve, \
            patch.object(main, "_refund_ai_quota") as refund, \
            patch.object(main, "_log_ai_usage"), \
            patch.object(main, "_run_ai_provider", side_effect=engine):
        response = main.imitate_template(body, authorization="Bearer test")
    return response, reserve, refund


class TemplateImitationTests(unittest.TestCase):
    def test_kept_sections_and_headings_come_back_byte_for_byte(self):
        reply = json.dumps({"sections": {
            "s2": "量測 RL 電路的時間常數。",
            "s4": "| 電壓 | 電流 |\n|---|---|\n| 12 V | 3.2 mA |",
            "s5": "時間常數與 10 mH 的理論值相符。",
            # A model that ignores the rules must not be able to change a kept section.
            "s1": "竄改的封面",
        }}, ensure_ascii=False)
        response, _, _ = _run(_request(), FakeEngine(reply))

        self.assertIn("# 電子電路實驗報告\n\n課程：電子學實驗", response.markdown)
        self.assertIn("## 實驗器材\n\n| 器材 | 數量 |\n|---|---|\n| 示波器 | 1 |", response.markdown)
        self.assertNotIn("竄改的封面", response.markdown)
        self.assertIn("| 12 V | 3.2 mA |", response.markdown)
        headings = [line for line in response.markdown.splitlines() if line.startswith("#")]
        self.assertEqual(headings, [section["heading"] for section in SECTIONS])
        self.assertEqual(response.generated_section_ids, ["s2", "s4", "s5"])
        self.assertEqual(response.missing_section_ids, [])
        self.assertEqual(response.unverified_numbers, [])

    def test_the_prompt_asks_for_the_templates_own_formula_notation(self):
        """A real run wrote LaTeX the Markdown preview shows raw."""
        engine = FakeEngine(json.dumps({"sections": {"s2": "x", "s4": "y", "s5": "z"}}))
        _run(_request(), engine)
        self.assertIn("公式用範本原本的寫法", engine.prompts[0])

    def test_the_prompt_asks_only_for_the_sections_that_change(self):
        engine = FakeEngine(json.dumps({"sections": {"s2": "x", "s4": "y", "s5": "z"}}))
        _run(_request(), engine)
        prompt = engine.prompts[0]

        self.assertIn(MATERIAL, prompt)
        for target in ('"id": "s2"', '"id": "s4"', '"id": "s5"'):
            self.assertIn(target, prompt)
        self.assertNotIn('"id": "s1"', prompt)
        self.assertNotIn('"id": "s3"', prompt)

    def test_json_wrapped_in_prose_and_code_fences_still_parses(self):
        reply = "好的，以下是結果：\n```json\n" + json.dumps({"s2": "新目的", "s4": "新數據 12 V", "s5": "新結論"}, ensure_ascii=False) + "\n```\n希望有幫助"
        response, _, _ = _run(_request(), FakeEngine(reply))
        self.assertEqual(response.generated_section_ids, ["s2", "s4", "s5"])

    def test_a_section_the_model_skipped_keeps_its_original_with_a_pending_note(self):
        reply = json.dumps({"sections": {"s2": "新目的"}}, ensure_ascii=False)
        response, _, _ = _run(_request(), FakeEngine(reply))

        self.assertEqual(response.missing_section_ids, ["s4", "s5"])
        self.assertIn(main.IMITATION_PENDING_NOTE, response.markdown)
        self.assertIn("| 5 V | 1 mA |", response.markdown)

    def test_numbers_not_in_the_material_are_reported(self):
        reply = json.dumps({"sections": {
            "s2": "量測 RL 電路。",
            "s4": "| 電壓 | 電流 |\n|---|---|\n| 12 V | 3.2 mA |\n| 15 V | 4.8 mA |",
            "s5": "結論。",
        }}, ensure_ascii=False)
        response, _, _ = _run(_request(), FakeEngine(reply))
        self.assertEqual(sorted(response.unverified_numbers), ["15", "4.8"])

    def test_without_a_language_model_every_changing_section_is_marked_pending(self):
        response, _, _ = _run(_request(), FakeEngine("cleaned text", model="fallback-rule"))
        self.assertEqual(response.generated_section_ids, [])
        self.assertEqual(response.missing_section_ids, ["s2", "s4", "s5"])
        self.assertIn("# 電子電路實驗報告", response.markdown)

    def test_empty_material_and_all_keep_are_rejected_before_spending_quota(self):
        for body in (
            _request(material="   "),
            _request(sections=[{**section, "mode": "keep"} for section in SECTIONS]),
        ):
            with self.subTest(body=body.material[:5]):
                with self.assertRaises(main.HTTPException) as caught:
                    _run(body, FakeEngine("{}"))
                self.assertEqual(caught.exception.status_code, 400)

    def test_quota_is_refunded_when_the_model_fails(self):
        def broken(*args, **kwargs):
            raise main.HTTPException(status_code=502, detail="upstream down")

        with patch.object(main, "_get_user_from_authorization", return_value=USER), \
                patch.object(main, "_reserve_ai_quota", return_value={"remaining": 2, "limit": 3}), \
                patch.object(main, "_refund_ai_quota") as refund, \
                patch.object(main, "_log_ai_usage"), \
                patch.object(main, "_run_ai_provider", side_effect=broken):
            with self.assertRaises(main.HTTPException):
                main.imitate_template(_request(), authorization="Bearer test")
        refund.assert_called_once()

    def test_signed_out_callers_are_refused(self):
        with patch.object(main, "_get_user_from_authorization", return_value=None):
            with self.assertRaises(main.HTTPException) as caught:
                main.imitate_template(_request(), authorization=None)
        self.assertEqual(caught.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
