"""Server errors reach Sentry when a DSN is set, and nothing happens when it is not.

The failure mode worth guarding is not "the report is slightly wrong" -- it is the
reporter throwing, timing out, or firing in an environment that never configured it.
"""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import error_reporting

DSN = "https://abc123@o42.ingest.sentry.io/1234567"


class SentryDsnTests(unittest.TestCase):
    def test_a_dsn_becomes_the_envelope_endpoint(self):
        parsed = error_reporting.parse_sentry_dsn(DSN)
        self.assertEqual(
            parsed["envelope_url"],
            "https://o42.ingest.sentry.io/api/1234567/envelope/?sentry_key=abc123&sentry_version=7",
        )
        self.assertEqual(parsed["project_id"], "1234567")

    def test_anything_unusable_disables_reporting(self):
        for value in (
            None,
            "",
            "   ",
            "not a dsn",
            "https://o42.ingest.sentry.io/1234567",
            "https://abc123@o42.ingest.sentry.io/",
            "https://abc123@o42.ingest.sentry.io/not-a-project",
            "ftp://abc123@o42.ingest.sentry.io/1234567",
        ):
            with self.subTest(value=value):
                self.assertIsNone(error_reporting.parse_sentry_dsn(value))


class EnvelopeTests(unittest.TestCase):
    def test_the_envelope_is_three_json_lines_with_the_traceback(self):
        try:
            raise ValueError("pandoc exploded")
        except ValueError as error:
            body = error_reporting.build_error_envelope(
                error,
                {"endpoint": "/api/export"},
                event_id="a" * 32,
                sent_at="2026-09-12T02:00:00+00:00",
                release="abc1234",
                environment="production",
            )

        header, item_header, payload = body.split("\n")
        self.assertEqual(json.loads(header)["event_id"], "a" * 32)
        self.assertEqual(json.loads(item_header), {"type": "event"})

        event = json.loads(payload)
        self.assertEqual(event["level"], "error")
        self.assertEqual(event["release"], "abc1234")
        self.assertEqual(event["extra"], {"endpoint": "/api/export"})
        value = event["exception"]["values"][0]
        self.assertEqual(value["type"], "ValueError")
        self.assertEqual(value["value"], "pandoc exploded")
        self.assertIn("ValueError: pandoc exploded", value["stacktrace"]["frames"][0]["filename"])

    def test_an_error_with_no_traceback_still_builds(self):
        body = error_reporting.build_error_envelope(RuntimeError("never raised"))
        event = json.loads(body.split("\n")[2])
        self.assertEqual(event["exception"]["values"][0]["type"], "RuntimeError")


class ReportExceptionTests(unittest.TestCase):
    def test_nothing_is_sent_without_a_dsn(self):
        with patch.dict("os.environ", {}, clear=False):
            import os

            os.environ.pop("SENTRY_DSN", None)
            with patch.object(error_reporting, "_post_envelope") as post:
                self.assertFalse(error_reporting.report_exception(ValueError("x")))
            post.assert_not_called()
            self.assertFalse(error_reporting.error_reporting_configured())

    def test_a_configured_dsn_sends_the_event(self):
        sent: list[tuple[str, str]] = []
        with patch.dict("os.environ", {"SENTRY_DSN": DSN}):
            with patch.object(error_reporting, "_post_envelope", side_effect=lambda url, body: sent.append((url, body))):
                self.assertTrue(error_reporting.report_exception(ValueError("boom"), {"where": "test"}))
                for thread in __import__("threading").enumerate():
                    if thread.name == "sentry-report":
                        thread.join(timeout=5)

        self.assertEqual(len(sent), 1)
        url, body = sent[0]
        self.assertIn("/api/1234567/envelope/", url)
        self.assertIn("boom", body)

    def test_a_delivery_failure_is_swallowed(self):
        """A dead Sentry must not turn one failed request into two."""
        with patch.dict("os.environ", {"SENTRY_DSN": DSN}):
            with patch.object(error_reporting.urllib.request, "urlopen", side_effect=OSError("no network")):
                error_reporting._post_envelope("https://example.invalid/envelope/", "{}")


if __name__ == "__main__":
    unittest.main()
