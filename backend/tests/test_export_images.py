"""Images in a report survive the Word export, and the fetcher stays inside public HTTP.

Pandoc fetches image URLs itself; a host that blocks it had its refusal page embedded
in the .docx as word/media/rId23.txt. The export now downloads images server-side and
hands Pandoc local files, and the same guarded fetch backs /api/fetch-image so an image
copied from a web page can be pasted (the browser's own fetch is blocked by CORS).
"""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import main

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


class ExportImageLocalisationTests(unittest.TestCase):
    def test_a_remote_image_becomes_a_local_file_pandoc_can_embed(self):
        markdown = "# 報告\n\n![圖一](https://example.com/a.png)\n"
        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp)
            with patch.object(main, "_fetch_remote_image", return_value=(PNG, "image/png")):
                out = main._process_markdown_for_file_export(markdown, assets)
            written = list(assets.glob("export-image-*.png"))
            self.assertEqual(len(written), 1)
            self.assertIn(written[0].name, out)
            self.assertNotIn("https://example.com/a.png", out)
            self.assertEqual(written[0].read_bytes(), PNG)

    def test_an_image_that_cannot_be_fetched_is_not_embedded_as_an_error_page(self):
        markdown = "![圖一](https://blocked.example.com/a.png)"
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(main, "_fetch_remote_image", return_value=None):
                out = main._process_markdown_for_file_export(markdown, Path(tmp))
        self.assertEqual(out, main.EXPORT_IMAGE_UNAVAILABLE)
        self.assertNotIn("blocked.example.com", out)

    def test_data_uris_and_local_paths_are_left_alone(self):
        markdown = "![a](data:image/png;base64,AAAA)\n\n![b](report.png)"
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(main, "_fetch_remote_image", side_effect=AssertionError("must not fetch")):
                out = main._process_markdown_for_file_export(markdown, Path(tmp))
        self.assertEqual(out, markdown)

    def test_an_html_image_tag_is_localised_too(self):
        markdown = '<img src="https://example.com/a.png" alt="x">'
        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp)
            with patch.object(main, "_fetch_remote_image", return_value=(PNG, "image/png")):
                out = main._process_markdown_for_file_export(markdown, assets)
        self.assertNotIn("https://example.com/a.png", out)
        self.assertIn("export-image-", out)

    def test_the_same_url_is_downloaded_once(self):
        markdown = "![a](https://example.com/a.png) ![again](https://example.com/a.png)"
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(main, "_fetch_remote_image", return_value=(PNG, "image/png")) as fetch:
                main._process_markdown_for_file_export(markdown, Path(tmp))
        self.assertEqual(fetch.call_count, 1)


class ImageFetchSafetyTests(unittest.TestCase):
    def test_only_public_http_addresses_are_fetched(self):
        for blocked in (
            "file:///etc/passwd",
            "supabase-image://reports/a.png",
            "http://localhost:8000/a.png",
            "http://127.0.0.1/a.png",
            "http://169.254.169.254/latest/meta-data",
            "http://192.168.1.10/a.png",
            "http://[::1]/a.png",
        ):
            with self.subTest(blocked=blocked):
                with self.assertRaises(ValueError):
                    main._assert_public_http_url(blocked)

    def test_a_public_address_is_accepted(self):
        with patch.object(main.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 443))]):
            self.assertEqual(
                main._assert_public_http_url("https://example.com/a.png"),
                "https://example.com/a.png",
            )

    def test_a_non_image_response_is_refused(self):
        class FakeResponse:
            headers = {"Content-Type": "text/html; charset=utf-8"}

            def read(self, _size):
                return b"<html>Please set a user-agent</html>"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with patch.object(main, "_assert_public_http_url", side_effect=lambda url: url):
            with patch.object(main.urllib.request, "build_opener") as build:
                build.return_value.open.return_value = FakeResponse()
                self.assertIsNone(main._fetch_remote_image("https://example.com/a.png"))

    def test_an_oversized_image_is_refused(self):
        class FakeResponse:
            headers = {"Content-Type": "image/png"}

            def read(self, size):
                return b"0" * size

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with patch.object(main, "_assert_public_http_url", side_effect=lambda url: url):
            with patch.object(main.urllib.request, "build_opener") as build:
                build.return_value.open.return_value = FakeResponse()
                self.assertIsNone(main._fetch_remote_image("https://example.com/big.png"))

    def test_the_paste_endpoint_returns_a_data_uri(self):
        route = [r for r in main.app.routes if getattr(r, "path", None) == "/api/fetch-image"]
        self.assertEqual(len(route), 1)
        self.assertEqual(route[0].methods, {"POST"})
        with patch.object(main, "_fetch_remote_image", return_value=(PNG, "image/png")):
            response = main.fetch_image(main.ImageFetchRequest(url="https://example.com/a.png"))
        self.assertTrue(response.data_url.startswith("data:image/png;base64,"))

    def test_the_paste_endpoint_reports_a_failure_instead_of_returning_nothing(self):
        with patch.object(main, "_fetch_remote_image", return_value=None):
            with self.assertRaises(main.HTTPException) as raised:
                main.fetch_image(main.ImageFetchRequest(url="https://example.com/a.png"))
        self.assertEqual(raised.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
