"""The rule-based Agent (used when no LLM key is configured) must be readable."""

from __future__ import annotations

import unittest

import main


class FallbackAgentFindingsTests(unittest.TestCase):
    def test_findings_name_the_section_they_are_about(self):
        body = main.AgentRunRequest(provider="built_in", mode="review", document_markdown="# 報告\n\n內容\n")
        response = main._fallback_agent_response(body)
        self.assertTrue(response.findings)
        self.assertEqual(len(response.findings), len(set(response.findings)), "findings repeat the same sentence")
        for finding in response.findings:
            with self.subTest(finding=finding):
                self.assertIn("：", finding)


class AgentRobustnessTests(unittest.TestCase):
    DOC = "# 報告\n\n## 實驗目的\n量測 RC 電路。\n\n## 數據\n| 電壓 | 電流 |\n|---|---|\n| 12 V | 3 mA |\n"
    USER = {"id": "11111111-1111-4111-8111-111111111111", "email": "owner@example.com"}

    def _run(self, reply, mode="review"):
        from unittest.mock import patch

        body = main.AgentRunRequest(provider="built_in", mode=mode, document_markdown=self.DOC)
        with patch.object(main, "_get_user_from_authorization", return_value=self.USER), \
                patch.object(main, "_reserve_ai_quota", return_value={"remaining": 2, "limit": 3}), \
                patch.object(main, "_refund_ai_quota") as refund, \
                patch.object(main, "groq_client", object()), \
                patch.object(main, "_run_ai_provider", return_value=(reply, "test-model")):
            response = main.run_agent(body, authorization="Bearer test")
        return response, refund

    def test_an_edit_that_changes_numbers_is_withheld_but_the_review_survives(self):
        import json

        reply = json.dumps({
            "title": "審閱",
            "plan": ["讀全文"],
            "findings": ["結論太短"],
            "checklist": [{"label": "結論", "status": "warn", "note": "太短"}],
            "proposed_markdown": self.DOC.replace("12 V", "15 V"),
        }, ensure_ascii=False)
        response, refund = self._run(reply)

        self.assertIsNone(response.proposed_markdown)
        self.assertEqual(response.findings[0], main.AGENT_EDIT_WITHHELD_NOTE)
        self.assertIn("結論太短", response.findings)
        self.assertEqual(response.checklist[0].label, "結論")
        refund.assert_not_called()

    def test_a_safe_edit_is_kept(self):
        import json

        reply = json.dumps({"findings": [], "proposed_markdown": self.DOC + "\n## 結論\n完成。\n"}, ensure_ascii=False)
        response, _ = self._run(reply, mode="complete_section")
        self.assertIn("## 結論", response.proposed_markdown or "")

    def test_a_reply_that_is_not_json_falls_back_to_the_rule_based_review(self):
        response, refund = self._run("抱歉，我無法以 JSON 回覆。")

        self.assertEqual(response.findings[0], main.AGENT_UNPARSEABLE_NOTE)
        self.assertTrue(response.checklist)
        refund.assert_not_called()


if __name__ == "__main__":
    unittest.main()
