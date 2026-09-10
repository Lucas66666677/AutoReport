"""Build `supabase/bringup.sql` from `supabase/migrations/*.sql`.

Bringing up a brand-new Supabase project needs every migration, applied in the
order the Supabase CLI applies them, which is filename order. `schema_and_rls.sql`
is byte-identical to the first migration alone, so a project set up from that file
is missing eight later ones -- workspaces, community templates, ownership
transfers, recording storage, Yjs persistence, profile preferences, the
closed-beta security rules and the bring-up hardening.

This concatenates them once, in that order, so the whole schema can be applied
from the SQL Editor without linking the CLI. `backend/tests/test_supabase_bringup.py`
regenerates the file and fails when the committed copy has drifted.

Usage:  python scripts/generate_supabase_bringup.py
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
TARGET = REPO_ROOT / "supabase" / "bringup.sql"

RULE = "-- " + "=" * 74


def migration_paths(migrations_dir: Path = MIGRATIONS_DIR) -> list[Path]:
    """Every migration, in the order the Supabase CLI applies them."""
    return sorted(migrations_dir.glob("*.sql"), key=lambda path: path.name)


def render(paths: list[Path]) -> str:
    """The full bring-up script for `paths`, as text."""
    if not paths:
        raise ValueError("no migrations found")

    lines = [
        "-- AutoLabReport: every migration, in order, for a brand-new Supabase project.",
        "--",
        "-- GENERATED FILE -- do not edit by hand. Regenerate with:",
        "--     python scripts/generate_supabase_bringup.py",
        "-- backend/tests/test_supabase_bringup.py fails when this drifts from",
        "-- supabase/migrations/.",
        "--",
        f"-- A fresh project needs all {len(paths)} migrations, applied in the order the",
        "-- Supabase CLI applies them (filename order). supabase/schema_and_rls.sql is",
        "-- byte-identical to the FIRST migration alone; a project brought up from that",
        "-- file is missing every later one.",
        "--",
        "-- Paste this whole file into the Supabase SQL Editor once, on a new project,",
        "-- after enabling the Auth providers. It is not written for a project that",
        "-- already has some of these applied: several statements are not idempotent.",
        "--",
        "-- Contains no secret: schema, policies and functions only.",
        "--",
        "-- Applied in this order:",
    ]
    lines += [f"--   {index}. {path.name}" for index, path in enumerate(paths, start=1)]
    lines += ["", ""]

    for index, path in enumerate(paths, start=1):
        body = path.read_text(encoding="utf-8").replace("\r\n", "\n").strip("\n")
        lines += [RULE, f"-- {index}/{len(paths)}  {path.name}", RULE, "", body, "", ""]

    return "\n".join(lines).rstrip("\n") + "\n"


def main() -> None:
    paths = migration_paths()
    TARGET.write_text(render(paths), encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.relative_to(REPO_ROOT)} from {len(paths)} migrations")


if __name__ == "__main__":
    main()
