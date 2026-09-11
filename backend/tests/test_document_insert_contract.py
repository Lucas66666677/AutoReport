"""Creating a cloud document must not ask PostgREST for the inserted row back.

`documents_select_closed_beta` (supabase/migrations/20260723_closed_beta_security.sql)
authorises reads through `public.can_read_document(id)`, a STABLE SECURITY DEFINER
function that looks the row up again by id. Postgres applies SELECT policies to
the rows an INSERT ... RETURNING returns, and a STABLE function reads the calling
command's snapshot, which does not contain the row being inserted. So
`supabase.from('documents').insert(row).select()` is refused for the document's
own owner -- "new row violates row-level security policy" -- and PostgREST
answers 403.

That is not hypothetical: on 2026-09-11, with the full migration set applied to
the production project, every cloud report creation failed exactly this way
(POST /rest/v1/documents -> 403), and the app showed only a generic toast. It was
reproduced against real Postgres (PGlite) with the policy and function copied
from the migration: INSERT ... RETURNING fails, a plain INSERT passes, and a
separate SELECT by id afterwards returns the row.

`frontend/src/documentInsert.ts` inserts with a client-chosen id and no
RETURNING. This test keeps App.tsx from drifting back.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "frontend" / "src" / "App.tsx"
OPENER = ".from('documents')"


def document_inserts_followed_by_select(source: str) -> int:
    """How many `.from('documents').insert(...)` calls chain a `.select(`.

    Paren-matched over the insert's own argument list, so an insert without a
    select is never paired with an unrelated `.select(` later in the file.
    """
    found = 0
    at = source.find(OPENER)
    while at != -1:
        cursor = at + len(OPENER)
        rest = source[cursor:]
        stripped = rest.lstrip()
        if stripped.startswith(".insert("):
            cursor += (len(rest) - len(stripped)) + len(".insert(")
            depth = 1
            while cursor < len(source) and depth:
                char = source[cursor]
                if char == "(":
                    depth += 1
                elif char == ")":
                    depth -= 1
                cursor += 1
            if re.match(r"\s*\.select\(", source[cursor:]):
                found += 1
        at = source.find(OPENER, at + 1)
    return found


class CloudDocumentInsertContractTests(unittest.TestCase):
    def test_app_never_inserts_a_document_with_a_returning_select(self):
        count = document_inserts_followed_by_select(APP.read_text(encoding="utf-8"))
        self.assertEqual(
            count,
            0,
            "App.tsx chains .select() onto a documents insert. Under the closed-beta "
            "select policy that is refused with 403 for the owner; create documents "
            "through insertOwnedDocument() in frontend/src/documentInsert.ts.",
        )

    def test_the_detector_finds_the_shape_it_guards_against(self):
        planted = (
            "await supabase\n  .from('documents')\n  .insert([{ title: f(x) }])\n"
            "  .select('*')\n  .single()"
        )
        self.assertEqual(document_inserts_followed_by_select(planted), 1)

        clean = (
            "await supabase.from('documents').insert([{ a: 1 }])\n"
            "await supabase.from('documents').select('*')"
        )
        self.assertEqual(document_inserts_followed_by_select(clean), 0)

    def test_creating_from_a_template_closes_the_create_dialog_first(self):
        """The dialog's template cards call createDocumentFromTemplate directly.

        While creation always failed with 403 nobody could see that it never
        closed the dialog. Once creation worked, the new report opened behind the
        still-open dialog, the click looked like it did nothing, and a second
        click made a duplicate -- three identical reports in one minute on
        2026-09-11. The dialog must be closed before the insert is attempted.
        """
        source = APP.read_text(encoding="utf-8")
        start = source.find("async function createDocumentFromTemplate(")
        self.assertNotEqual(start, -1, "createDocumentFromTemplate not found in App.tsx")
        insert_at = source.find("insertOwnedDocument(", start)
        self.assertNotEqual(insert_at, -1, "createDocumentFromTemplate no longer creates via insertOwnedDocument")
        self.assertIn(
            "setIsCreateModalOpen(false)",
            source[start:insert_at],
            "createDocumentFromTemplate must close the create dialog before inserting",
        )


if __name__ == "__main__":
    unittest.main()
