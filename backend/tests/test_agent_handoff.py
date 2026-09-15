"""An answer from an AI this server never calls must be held to the same rules as built-in AI.

The student copies the prompt into ChatGPT, Claude, Gemini, DeepSeek or Kimi -- on the
web or in a desktop app -- or a signed-in terminal CLI runs it, and the answer comes back
through /api/agent/import. If that route parsed differently, or skipped the numeric
guard, an outside AI would become the way to change a report's data unchecked.
"""

from __future__ import annotations

import inspect
import json
import unittest
from unittest.mock import patch

import main

DOC = "# 報告\n\n## 實驗目的\n量測 RC 電路。\n\n## 數據\n| 電壓 | 電流 |\n|---|---|\n| 12 V | 3 mA |\n"


def _import(reply: str, mode: str = "review", document: str = DOC):
    return main.import_agent_reply(
        main.AgentImportRequest(mode=mode, document_markdown=document, reply=reply)
    )


class AgentPromptTests(unittest.TestCase):
    def test_the_prompt_is_the_one_built_in_ai_sends(self):
        request = main.AgentPromptRequest(mode="review", goal="檢查結論", document_markdown=DOC)
        built_in = main._build_agent_prompt(
            main.AgentRunRequest(provider="built_in", mode="review", goal="檢查結論", document_markdown=DOC)
        )
        self.assertEqual(main.build_agent_prompt(request).prompt, built_in)

    def test_every_mode_has_a_prompt(self):
        for mode in ("review", "complete_section", "format", "chart", "final_check", "multi_step"):
            with self.subTest(mode=mode):
                prompt = main.build_agent_prompt(
                    main.AgentPromptRequest(mode=mode, document_markdown=DOC)
                ).prompt
                self.assertIn(DOC.strip(), prompt)

    def test_an_empty_report_is_refused_with_the_same_message_as_built_in(self):
        with self.assertRaises(main.HTTPException) as raised:
            main.build_agent_prompt(main.AgentPromptRequest(mode="review", document_markdown="  \n"))
        self.assertEqual(raised.exception.status_code, 400)


class AgentImportTests(unittest.TestCase):
    def test_a_reply_copied_from_a_chat_site_is_parsed(self):
        # Copying an answer from ChatGPT or Claude brings the fence and the chatter with it.
        payload = {"title": "審閱", "findings": ["結論太短"], "checklist": [{"label": "結論", "status": "warn", "note": "太短"}]}
        reply = "好的，以下是審閱結果：\n\n```json\n" + json.dumps(payload, ensure_ascii=False) + "\n```\n\n希望有幫助！"

        response = _import(reply)

        self.assertIn("結論太短", response.findings)
        self.assertEqual(response.checklist[0].label, "結論")
        self.assertIsNone(response.model)
        self.assertIsNone(response.remaining_quota)

    def test_an_edit_that_changes_the_data_is_withheld_exactly_as_for_built_in_ai(self):
        reply = json.dumps(
            {"findings": ["單位寫法不一致"], "proposed_markdown": DOC.replace("12 V", "15 V")},
            ensure_ascii=False,
        )

        response = _import(reply)

        self.assertIsNone(response.proposed_markdown)
        self.assertEqual(response.findings[0], main.AGENT_EDIT_WITHHELD_NOTE)
        self.assertIn("單位寫法不一致", response.findings)

    def test_a_safe_edit_is_kept(self):
        reply = json.dumps({"proposed_markdown": DOC + "\n## 結論\n完成量測。\n"}, ensure_ascii=False)
        self.assertIn("## 結論", _import(reply, mode="format").proposed_markdown or "")

    def test_a_reply_that_is_not_the_agent_format_says_so_and_still_reviews(self):
        response = _import("抱歉，我不太確定你要什麼格式。")

        self.assertEqual(response.findings[0], main.AGENT_IMPORT_UNPARSEABLE_NOTE)
        self.assertTrue(response.checklist, "the rule-based review should still be there")

    def test_an_empty_paste_is_refused(self):
        with self.assertRaises(main.HTTPException) as raised:
            _import("   \n")
        self.assertEqual(raised.exception.status_code, 400)

    def test_the_route_calls_no_model_and_spends_no_quota(self):
        with patch.object(main, "_run_ai_provider") as provider, \
                patch.object(main, "_reserve_ai_quota") as reserve:
            _import(json.dumps({"findings": ["ok"]}))
        provider.assert_not_called()
        reserve.assert_not_called()

    def test_no_account_is_needed_on_either_end(self):
        # A guest has no quota to spend and nothing an account protects here.
        for endpoint in (main.build_agent_prompt, main.import_agent_reply, main.check_ai_integrity):
            with self.subTest(endpoint=endpoint.__name__):
                self.assertNotIn("authorization", inspect.signature(endpoint).parameters)


class BuiltInAgentStillGuardedTests(unittest.TestCase):
    """The guard moved into a shared helper; built-in AI must not have lost it on the way."""

    USER = {"id": "11111111-1111-4111-8111-111111111111", "email": "owner@example.com"}

    def test_built_in_agent_still_withholds_a_data_changing_edit(self):
        reply = json.dumps({"findings": ["x"], "proposed_markdown": DOC.replace("3 mA", "30 mA")}, ensure_ascii=False)
        body = main.AgentRunRequest(provider="built_in", mode="review", document_markdown=DOC)
        with patch.object(main, "_get_user_from_authorization", return_value=self.USER), \
                patch.object(main, "_reserve_ai_quota", return_value={"remaining": 2, "limit": 3}), \
                patch.object(main, "_refund_ai_quota"), \
                patch.object(main, "groq_client", object()), \
                patch.object(main, "_run_ai_provider", return_value=(reply, "test-model")):
            response = main.run_agent(body, authorization="Bearer test")

        self.assertIsNone(response.proposed_markdown)
        self.assertEqual(response.findings[0], main.AGENT_EDIT_WITHHELD_NOTE)


class AiIntegrityTests(unittest.TestCase):
    def test_an_answer_that_keeps_every_number_passes(self):
        result = main.check_ai_integrity(
            main.AiIntegrityRequest(source="電壓 12 V，電流 3 mA。", candidate="量得電壓為 12 V，電流為 3 mA。")
        )
        self.assertEqual((result.ok, result.missing, result.added), (True, 0, 0))

    def test_an_answer_that_changes_a_number_is_reported_with_counts(self):
        result = main.check_ai_integrity(
            main.AiIntegrityRequest(source="電壓 12 V。", candidate="電壓 15 V。")
        )
        self.assertFalse(result.ok)
        self.assertEqual((result.missing, result.added), (1, 1))


if __name__ == "__main__":
    unittest.main()
