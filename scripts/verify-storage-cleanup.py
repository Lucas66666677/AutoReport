"""Run the permanent-delete storage cleanup against a real Supabase project.

backend/tests/test_permanent_delete_storage.py pins the logic against a fake. This
script is the other half BETA_BACKLOG asked for: it uploads files as two different
uploader prefixes for one report, permanently deletes that report, and checks both
buckets are empty for every prefix afterwards.

It never runs by accident -- it needs credentials in the environment and refuses to
touch anything that is not the project you named:

    SUPABASE_URL=https://<ref>.supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=<service role key> \
    VERIFY_PROJECT_REF=<ref> \
    VERIFY_OWNER_ID=<uuid of a real account> \
    VERIFY_SECOND_UPLOADER_ID=<uuid of another real account> \
    python scripts/verify-storage-cleanup.py

Nothing is printed but counts and paths; no key is ever echoed. Every object it
creates lives under the single report id it generates, and it deletes only that.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

BUCKETS = ("report_images", "report_recordings")
ONE_PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d4944415478da63fccfc0500f0004850127a2f9d3a4"
    "0000000049454e44ae426082"
)


def require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"refusing to run: {name} is not set")
    return value


def request(url: str, key: str, method: str = "GET", body: bytes | None = None, content_type: str | None = None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode("utf-8", "replace")
        raise SystemExit(f"{method} {urllib.parse.urlsplit(url).path} failed: HTTP {exc.code} {detail}") from None


def storage_list(base: str, key: str, bucket: str, prefix: str) -> list[dict]:
    return (
        request(
            f"{base}/storage/v1/object/list/{bucket}",
            key,
            method="POST",
            body=json.dumps({"prefix": prefix, "limit": 1000, "offset": 0}).encode(),
            content_type="application/json",
        )
        or []
    )


def main() -> int:
    base = require("SUPABASE_URL").rstrip("/")
    key = require("SUPABASE_SERVICE_ROLE_KEY")
    project_ref = require("VERIFY_PROJECT_REF")
    owner_id = require("VERIFY_OWNER_ID")
    second_id = require("VERIFY_SECOND_UPLOADER_ID")

    host = urllib.parse.urlsplit(base).hostname or ""
    if not host.startswith(f"{project_ref}."):
        sys.exit(f"refusing to run: SUPABASE_URL host {host} is not project {project_ref}")

    report_id = str(uuid.uuid4())
    print(f"report id for this run: {report_id}")

    uploaded: list[tuple[str, str]] = []
    for bucket in BUCKETS:
        for uploader in (owner_id, second_id):
            path = f"{uploader}/{report_id}/verify.png"
            request(
                f"{base}/storage/v1/object/{bucket}/{path}",
                key,
                method="POST",
                body=ONE_PIXEL_PNG,
                content_type="image/png",
            )
            uploaded.append((bucket, path))
    print(f"uploaded {len(uploaded)} objects across {len(BUCKETS)} buckets and 2 uploader prefixes")

    request(
        f"{base}/rest/v1/documents",
        key,
        method="POST",
        body=json.dumps(
            {"id": report_id, "user_id": owner_id, "title": "storage cleanup verification", "content": ""}
        ).encode(),
        content_type="application/json",
    )

    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
    import main as backend  # noqa: PLC0415  -- imported here so the guards above run first

    deleted = 0
    for bucket in BUCKETS:
        paths = backend._find_document_storage_files(bucket, {report_id})
        print(f"{bucket}: cleanup found {len(paths)} objects")
        deleted += backend._delete_storage_files(bucket, paths)

    leftovers = []
    for bucket, path in uploaded:
        prefix = path.rsplit("/", 1)[0]
        for entry in storage_list(base, key, bucket, prefix):
            if entry.get("id") or entry.get("metadata") is not None:
                leftovers.append(f"{bucket}:{prefix}/{entry.get('name')}")

    request(
        f"{base}/rest/v1/documents?id=eq.{report_id}",
        key,
        method="DELETE",
    )

    print(f"deleted {deleted} storage objects; leftovers: {leftovers or 'none'}")
    if deleted != len(uploaded) or leftovers:
        print("FAIL: cleanup did not empty every uploader prefix")
        return 1
    print("PASS: both buckets empty for every uploader prefix")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
