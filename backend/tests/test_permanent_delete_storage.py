"""Permanent delete really empties both buckets, for every uploader.

BETA_BACKLOG asked for this to be run against real multi-account staging data. The
part that needs real accounts is the credentials, not the logic: what actually has
to hold is that the cleanup walks *every* uploader folder (a collaborator's upload
sits under their own id, not the owner's), descends into nested folders, covers both
buckets, batches its deletes, and refuses someone else's document before deleting
anything. Those are pinned here against a fake Storage; scripts/verify-storage-cleanup.py
runs the same expectations against a real project when credentials are supplied.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import main

OWNER = {"id": "11111111-1111-4111-8111-111111111111", "email": "owner@example.com"}
OTHER_USER_ID = "22222222-2222-4222-8222-222222222222"
REPORT_ID = "33333333-3333-4333-8333-333333333333"


def folder(name: str) -> dict:
    """Storage marks a folder by having no id and no metadata."""
    return {"name": name, "id": None, "metadata": None}


def file_entry(name: str) -> dict:
    return {"name": name, "id": f"id-{name}", "metadata": {"size": 10}}


class FakeStorage:
    """Routes the calls main.py makes, and records what was deleted."""

    def __init__(self, tree: dict[str, dict[str, list[dict]]], documents: list[dict] | None = None):
        self.tree = tree
        self.documents = documents if documents is not None else [{"id": REPORT_ID, "user_id": OWNER["id"]}]
        self.deleted: dict[str, list[str]] = {}
        self.delete_calls: list[tuple[str, int]] = []
        self.documents_deleted = False

    def __call__(self, path, method="GET", payload=None, extra_headers=None):
        if path.startswith("/rest/v1/documents"):
            if method == "DELETE":
                self.documents_deleted = True
                return list(self.documents)
            return list(self.documents)

        if path.startswith("/storage/v1/object/list/"):
            bucket = path.rsplit("/", 1)[-1]
            prefix = (payload or {}).get("prefix", "")
            return list(self.tree.get(bucket, {}).get(prefix, []))

        if path.startswith("/storage/v1/object/"):
            bucket = path.rsplit("/", 1)[-1]
            prefixes = (payload or {}).get("prefixes", [])
            self.deleted.setdefault(bucket, []).extend(prefixes)
            self.delete_calls.append((bucket, len(prefixes)))
            return []

        raise AssertionError(f"unexpected Supabase call: {method} {path}")

    def run(self):
        with patch.object(main, "_require_user", return_value=OWNER):
            with patch.object(main, "_supabase_request", side_effect=self):
                return main.permanently_delete_reports(
                    main.PermanentDeleteRequest(report_ids=[REPORT_ID]),
                    authorization="Bearer test",
                )


def two_uploader_tree(bucket_names=("report_images", "report_recordings")) -> dict:
    """The owner and a collaborator each uploaded a file to the same report."""
    tree = {}
    for bucket in bucket_names:
        tree[bucket] = {
            "": [folder(OWNER["id"]), folder(OTHER_USER_ID)],
            f"{OWNER['id']}/{REPORT_ID}": [file_entry("owner.png")],
            f"{OTHER_USER_ID}/{REPORT_ID}": [file_entry("collaborator.png")],
        }
    return tree


class PermanentDeleteStorageTests(unittest.TestCase):
    def test_every_uploader_folder_is_cleaned_not_only_the_owners(self):
        storage = FakeStorage(two_uploader_tree())
        response = storage.run()

        for bucket in ("report_images", "report_recordings"):
            self.assertEqual(
                sorted(storage.deleted[bucket]),
                sorted(
                    [
                        f"{OWNER['id']}/{REPORT_ID}/owner.png",
                        f"{OTHER_USER_ID}/{REPORT_ID}/collaborator.png",
                    ]
                ),
                f"{bucket} kept a file belonging to another uploader",
            )
        self.assertEqual(response.deleted_storage_objects, 4)
        self.assertTrue(response.ok)

    def test_both_buckets_are_cleaned(self):
        storage = FakeStorage(two_uploader_tree())
        storage.run()
        self.assertEqual(set(storage.deleted), {"report_images", "report_recordings"})

    def test_nested_folders_are_walked(self):
        tree = {
            "report_images": {
                "": [folder(OWNER["id"])],
                f"{OWNER['id']}/{REPORT_ID}": [folder("figures"), file_entry("cover.png")],
                f"{OWNER['id']}/{REPORT_ID}/figures": [file_entry("fig1.png")],
            },
            "report_recordings": {"": []},
        }
        storage = FakeStorage(tree)
        response = storage.run()
        self.assertEqual(
            sorted(storage.deleted["report_images"]),
            sorted(
                [
                    f"{OWNER['id']}/{REPORT_ID}/cover.png",
                    f"{OWNER['id']}/{REPORT_ID}/figures/fig1.png",
                ]
            ),
        )
        self.assertEqual(response.deleted_storage_objects, 2)

    def test_deletes_are_batched(self):
        names = [file_entry(f"shot-{index:03d}.png") for index in range(250)]
        tree = {
            "report_images": {
                "": [folder(OWNER["id"])],
                f"{OWNER['id']}/{REPORT_ID}": names,
            },
            "report_recordings": {"": []},
        }
        storage = FakeStorage(tree)
        response = storage.run()
        image_calls = [size for bucket, size in storage.delete_calls if bucket == "report_images"]
        self.assertEqual(image_calls, [100, 100, 50])
        self.assertEqual(response.deleted_storage_objects, 250)

    def test_someone_elses_document_is_refused_before_anything_is_deleted(self):
        storage = FakeStorage(
            two_uploader_tree(),
            documents=[{"id": REPORT_ID, "user_id": OTHER_USER_ID}],
        )
        with self.assertRaises(main.HTTPException) as raised:
            storage.run()
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(storage.deleted, {})
        self.assertFalse(storage.documents_deleted)

    def test_a_missing_document_is_refused_before_anything_is_deleted(self):
        storage = FakeStorage(two_uploader_tree(), documents=[])
        with self.assertRaises(main.HTTPException) as raised:
            storage.run()
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(storage.deleted, {})
        self.assertFalse(storage.documents_deleted)

    def test_storage_is_emptied_before_the_rows_go(self):
        """A row deleted first would orphan its files with nothing left pointing at them."""
        order: list[str] = []
        storage = FakeStorage(two_uploader_tree())

        original = storage.__call__

        def record(path, method="GET", payload=None, extra_headers=None):
            if path.startswith("/storage/v1/object/") and not path.startswith("/storage/v1/object/list/"):
                order.append("storage")
            if path.startswith("/rest/v1/documents") and method == "DELETE":
                order.append("rows")
            return original(path, method=method, payload=payload, extra_headers=extra_headers)

        with patch.object(main, "_require_user", return_value=OWNER):
            with patch.object(main, "_supabase_request", side_effect=record):
                main.permanently_delete_reports(
                    main.PermanentDeleteRequest(report_ids=[REPORT_ID]),
                    authorization="Bearer test",
                )

        self.assertEqual(order[-1], "rows")
        self.assertIn("storage", order)


if __name__ == "__main__":
    unittest.main()
