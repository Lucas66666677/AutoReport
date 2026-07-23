import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import main


class NumericIntegrityTests(unittest.TestCase):
    def test_preserves_equivalent_numeric_facts_and_units(self):
        source = "電壓為 12.0 V，電流為 3.20 mA，誤差 2%。"
        candidate = "量測得到 12 V、3.2 mA，誤差為 2.0%。"

        valid, differences = main.validate_numeric_integrity(source, candidate)

        self.assertTrue(valid)
        self.assertEqual(differences, {"missing": 0, "added": 0})

    def test_rejects_changed_value(self):
        valid, differences = main.validate_numeric_integrity(
            "電壓為 12 V。",
            "電壓為 13 V。",
        )

        self.assertFalse(valid)
        self.assertEqual(differences, {"missing": 1, "added": 1})

    def test_rejects_unit_conversion_even_when_value_is_equivalent(self):
        valid, differences = main.validate_numeric_integrity(
            "電流為 0.5 A。",
            "電流為 500 mA。",
        )

        self.assertFalse(valid)
        self.assertGreater(differences["missing"], 0)
        self.assertGreater(differences["added"], 0)

    def test_ignores_markdown_ordered_list_numbers(self):
        source = "1. 量測電壓 5 V\n2. 記錄結果"
        candidate = "1. 記錄結果\n2. 量測電壓 5.0 V"

        valid, _ = main.validate_numeric_integrity(source, candidate)

        self.assertTrue(valid)


class ClosedBetaTransportTests(unittest.TestCase):
    def test_markdown_render_never_executes_python_in_closed_beta(self):
        markdown = "```python\nraise RuntimeError('must not run')\n```"
        self.assertEqual(main.render_markdown(markdown), markdown)
        self.assertFalse(hasattr(main, "_run_python_code"))

    def test_word_preprocessing_never_executes_python_in_closed_beta(self):
        markdown = "```python\nopen('sentinel', 'w').write('bad')\n```"
        with TemporaryDirectory() as temporary_directory:
            self.assertEqual(
                main._process_markdown_for_file_export(markdown, Path(temporary_directory)),
                markdown,
            )

    def test_backend_source_contains_no_dynamic_python_executor(self):
        source = Path(main.__file__).read_text(encoding="utf-8")
        self.assertNotIn("exec(", source)

    def test_drive_file_token_is_only_accepted_by_post_route(self):
        drive_routes = [
            route
            for route in main.app.routes
            if getattr(route, "path", None) == "/api/drive/files"
        ]

        self.assertEqual(len(drive_routes), 1)
        self.assertEqual(drive_routes[0].methods, {"POST"})

    def test_cors_does_not_use_wildcard_origin_with_credentials(self):
        self.assertNotIn("*", main.ALLOWED_ORIGINS)

    def test_unconfigured_transfer_mailer_never_outputs_a_token(self):
        with self.assertRaises(RuntimeError):
            main._send_transfer_confirmation_email(
                "student@example.com",
                "Report",
                "https://example.com/confirm?token=secret",
                main.datetime.now(main.UTC),
            )


class ClosedBetaMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        migration_path = (
            Path(__file__).resolve().parents[2]
            / "supabase"
            / "migrations"
            / "20260723_closed_beta_security.sql"
        )
        cls.sql = migration_path.read_text(encoding="utf-8").lower()

    def test_public_links_are_not_edit_policy_inputs(self):
        edit_policy = self.sql.split('create policy "documents_update_closed_beta_editor"', 1)[1]
        edit_policy = edit_policy.split('create policy', 1)[0]
        self.assertNotIn("share_setting", edit_policy)
        self.assertIn("can_edit_document", edit_policy)

    def test_report_images_bucket_is_private(self):
        self.assertIn("set public = false", self.sql)
        self.assertIn('drop policy if exists "report_images_public_read"', self.sql)

    def test_report_recordings_are_no_longer_public(self):
        self.assertIn('drop policy if exists "report_recordings_public_read"', self.sql)
        self.assertIn('create policy "report_recordings_closed_beta_read"', self.sql)


if __name__ == "__main__":
    unittest.main()
