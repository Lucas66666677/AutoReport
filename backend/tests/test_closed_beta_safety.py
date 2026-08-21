import unittest
import inspect
import io
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import urllib.error

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

    def test_drive_routes_require_application_authentication(self):
        for endpoint in (main.list_drive_files, main.import_drive_file):
            self.assertIn("authorization", inspect.signature(endpoint).parameters)
            self.assertIn("_require_user(authorization)", inspect.getsource(endpoint))

    def test_cors_does_not_use_wildcard_origin_with_credentials(self):
        self.assertNotIn("*", main.ALLOWED_ORIGINS)

    def test_dotenv_is_loaded_before_cors_configuration(self):
        source = Path(main.__file__).read_text(encoding="utf-8")
        self.assertLess(source.index("load_dotenv("), source.index("ALLOWED_ORIGINS ="))

    def test_billing_redirect_rejects_external_origins(self):
        self.assertEqual(
            main._safe_billing_url("https://attacker.example/phish", "/?billing=cancel"),
            f"{main.FRONTEND_URL}/?billing=cancel",
        )
        expected = f"{main.FRONTEND_URL}/?billing=success"
        self.assertEqual(main._safe_billing_url(expected, "/fallback"), expected)

    def test_supabase_errors_do_not_echo_upstream_details(self):
        upstream_error = urllib.error.HTTPError(
            "https://project.example/rest/v1/documents",
            400,
            "bad request",
            {},
            io.BytesIO(b'{"message":"secret schema detail"}'),
        )
        with (
            patch.object(main, "SUPABASE_URL", "https://project.example"),
            patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", "service-role"),
            patch("main.urllib.request.urlopen", side_effect=upstream_error),
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main._supabase_request("/rest/v1/documents")

        self.assertEqual(raised.exception.status_code, 502)
        self.assertNotIn("secret", str(raised.exception.detail).lower())

    def test_storage_cleanup_collects_nested_files_only(self):
        pages = {
            "owner/report": [
                {"name": "plot.png", "id": "file-1", "metadata": {}},
                {"name": "nested", "id": None, "metadata": None},
            ],
            "owner/report/nested": [
                {"name": "capture.webm", "id": "file-2", "metadata": {}},
            ],
        }
        with patch.object(
            main,
            "_list_storage_path",
            side_effect=lambda _bucket, prefix: pages.get(prefix, []),
        ):
            paths = main._collect_storage_files("report_images", "owner/report")

        self.assertEqual(
            sorted(paths),
            ["owner/report/nested/capture.webm", "owner/report/plot.png"],
        )

    def test_permanent_delete_route_is_available(self):
        routes = [
            route
            for route in main.app.routes
            if getattr(route, "path", None) == "/api/reports/permanent-delete"
        ]
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0].methods, {"POST"})

    def test_permanent_delete_checks_owner_and_cleans_storage(self):
        report_id = main.UUID("00000000-0000-0000-0000-000000000123")
        request = main.PermanentDeleteRequest(report_ids=[report_id])
        storage_events: list[tuple[str, tuple[str, ...]]] = []

        def fake_supabase_request(path, method="GET", payload=None, extra_headers=None):
            del payload, extra_headers
            if method == "GET":
                return [{"id": str(report_id), "user_id": "owner-id"}]
            if method == "DELETE" and path.startswith("/rest/v1/documents?"):
                storage_events.append(("document-delete", ()))
                return [{"id": str(report_id)}]
            self.fail(f"unexpected request: {method} {path}")

        def fake_find(bucket, report_ids):
            self.assertEqual(report_ids, {str(report_id)})
            return [f"uploader/{report_id}/{bucket}.bin"]

        def fake_delete(bucket, paths):
            storage_events.append((bucket, tuple(paths)))
            return len(paths)

        with (
            patch.object(main, "_require_user", return_value={"id": "owner-id"}),
            patch.object(main, "_supabase_request", side_effect=fake_supabase_request),
            patch.object(main, "_find_document_storage_files", side_effect=fake_find),
            patch.object(main, "_delete_storage_files", side_effect=fake_delete),
        ):
            response = main.permanently_delete_reports(request, "Bearer token")

        self.assertTrue(response.ok)
        self.assertEqual(response.deleted_storage_objects, 2)
        self.assertEqual(storage_events[-1][0], "document-delete")

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
        cls.repository_root = Path(__file__).resolve().parents[2]
        cls.hardening_sql = (
            cls.repository_root
            / "supabase"
            / "migrations"
            / "20260724_staging_bringup_hardening.sql"
        ).read_text(encoding="utf-8").lower()
        cls.all_migration_sql = "\n".join(
            path.read_text(encoding="utf-8").lower()
            for path in sorted(
                (cls.repository_root / "supabase" / "migrations").glob("*.sql")
            )
        )

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

    def test_clean_database_bootstrap_matches_canonical_schema(self):
        canonical = (
            self.repository_root / "supabase" / "schema_and_rls.sql"
        ).read_text(encoding="utf-8")
        bootstrap = (
            self.repository_root
            / "supabase"
            / "migrations"
            / "20260626_initial_schema_and_rls.sql"
        ).read_text(encoding="utf-8")

        self.assertEqual(bootstrap, canonical)

    def test_profile_client_insert_policy_is_removed(self):
        self.assertIn(
            'drop policy if exists "profiles_insert_own"',
            self.hardening_sql,
        )

    def test_report_image_bucket_has_server_side_limits(self):
        self.assertIn("file_size_limit", self.hardening_sql)
        self.assertIn("allowed_mime_types", self.hardening_sql)
        self.assertIn("10485760", self.hardening_sql)
        self.assertNotIn("image/svg+xml", self.hardening_sql)

    def test_report_image_mutations_recheck_document_access(self):
        update_policy = self.hardening_sql.split(
            'create policy "report_images_authenticated_update_own_folder"', 1
        )[1].split('drop policy if exists "report_images_authenticated_delete_own_folder"', 1)[0]
        delete_policy = self.hardening_sql.split(
            'create policy "report_images_authenticated_delete_own_folder"', 1
        )[1].split("-- recording is outside closed beta", 1)[0]

        self.assertIn("can_edit_document", update_policy)
        self.assertIn("can_edit_document", delete_policy)

    def test_closed_beta_removes_recording_write_policies(self):
        for operation in ("insert", "update", "delete"):
            self.assertIn(
                f'drop policy if exists "report_recordings_{operation}_own_folder"',
                self.hardening_sql,
            )

    def test_every_security_definer_has_an_explicit_search_path(self):
        definitions = self.all_migration_sql.split("\nsecurity definer\n")[1:]
        self.assertGreater(len(definitions), 0)
        for definition in definitions:
            function_options = definition.split("as $$", 1)[0]
            self.assertIn("set search_path", function_options)

    def test_security_definer_and_quota_rpc_grants_are_restricted(self):
        self.assertIn(
            "revoke create on schema public from public, anon, authenticated",
            self.hardening_sql,
        )
        self.assertIn(
            "revoke all on function public.reserve_ai_quota(uuid, integer, integer) "
            "from public, anon, authenticated",
            self.all_migration_sql,
        )
        self.assertIn(
            "grant execute on function public.reserve_ai_quota(uuid, integer, integer) "
            "to service_role",
            self.all_migration_sql,
        )


if __name__ == "__main__":
    unittest.main()
