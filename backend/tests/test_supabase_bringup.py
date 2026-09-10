"""The one-shot bring-up script must stay in step with the migrations.

`supabase/bringup.sql` exists so a brand-new Supabase project can be brought up
from the SQL Editor in a single paste. That is only safe while it really is every
migration: a migration added later and not folded in would leave the generated
file looking authoritative while quietly setting up an incomplete project -- the
same failure `schema_and_rls.sql` already caused, since that file is byte-identical
to the first migration alone.

So these tests regenerate the script from `supabase/migrations/` and compare. They
read files only; nothing here touches a database or a secret.
"""

from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
BRINGUP = REPO_ROOT / "supabase" / "bringup.sql"
SCHEMA_AND_RLS = REPO_ROOT / "supabase" / "schema_and_rls.sql"
GENERATOR = REPO_ROOT / "scripts" / "generate_supabase_bringup.py"


def _generator():
    spec = importlib.util.spec_from_file_location("_autolabreport_bringup", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def _statements(path: Path) -> str:
    """The file with its leading comment block removed, so headers can differ."""
    lines = _text(path).split("\n")
    index = 0
    while index < len(lines) and (
        lines[index].startswith("--") or not lines[index].strip()
    ):
        index += 1
    return "\n".join(lines[index:]).strip("\n")


class SupabaseBringupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.generator = _generator()
        self.migrations = self.generator.migration_paths(MIGRATIONS_DIR)

    def test_the_committed_script_matches_the_migrations(self) -> None:
        """Regenerating must produce exactly what is committed."""
        expected = self.generator.render(self.migrations)
        self.assertEqual(
            _text(BRINGUP),
            expected,
            "supabase/bringup.sql has drifted from supabase/migrations/. "
            "Run: python scripts/generate_supabase_bringup.py",
        )

    def test_every_migration_body_is_present(self) -> None:
        """Independent of the generator: each migration's own text appears."""
        script = _text(BRINGUP)
        for path in self.migrations:
            body = _text(path).strip("\n")
            self.assertIn(
                body,
                script,
                f"{path.name} is missing from supabase/bringup.sql",
            )

    def test_the_order_is_the_order_the_cli_applies(self) -> None:
        """Later migrations depend on earlier ones, so position is not cosmetic."""
        script = _text(BRINGUP)
        positions = [script.index(_text(path).strip("\n")) for path in self.migrations]
        self.assertEqual(
            positions,
            sorted(positions),
            "supabase/bringup.sql applies migrations out of filename order",
        )

    def test_the_partial_file_does_not_read_as_a_complete_setup(self) -> None:
        """`schema_and_rls.sql` is one migration, and must say so.

        It is byte-identical to the first migration and its header used to read
        as an instruction to run it against a new project. Anyone who did got a
        project missing eight migrations.
        """
        self.assertEqual(
            _statements(SCHEMA_AND_RLS),
            _statements(self.migrations[0]),
            "schema_and_rls.sql is no longer the first migration verbatim; "
            "update this test with whatever it is now",
        )
        partial = _text(SCHEMA_AND_RLS)
        self.assertIn(
            "bringup.sql",
            partial,
            "schema_and_rls.sql is only the first of "
            f"{len(self.migrations)} migrations and must point at the complete script",
        )

    def test_the_script_carries_no_credential_shaped_value(self) -> None:
        """Schema only. A pasted key would end up in git and in the SQL Editor.

        Variable *names* are fine and do appear -- one migration explains that the
        collaboration server reads the table with `SUPABASE_SERVICE_ROLE_KEY`.
        What must never appear is a value, so these match value shapes.
        """
        script = _text(BRINGUP)
        value_shapes = {
            "a JWT (anon or service-role key)": r"eyJ[A-Za-z0-9_-]{20,}",
            "a Supabase secret key": r"sb_secret_[A-Za-z0-9_-]{10,}",
            "a Supabase access token": r"sbp_[A-Za-z0-9]{20,}",
            "a Postgres URL carrying a password": r"postgres(?:ql)?://[^\s:]+:[^\s@]+@",
        }
        for description, pattern in value_shapes.items():
            match = re.search(pattern, script)
            self.assertIsNone(
                match,
                f"supabase/bringup.sql appears to contain {description}",
            )


if __name__ == "__main__":
    unittest.main()
