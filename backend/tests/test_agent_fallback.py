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


if __name__ == "__main__":
    unittest.main()
