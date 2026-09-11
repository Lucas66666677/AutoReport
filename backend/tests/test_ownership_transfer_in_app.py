"""In-app ownership transfer: request without a mailer, then accept or decline.

Before this, the request route returned 503 unless an email provider was
configured, and none is, so 轉移筆記擁有權 could never complete. The recipient now
accepts while signed in as themselves; acceptance still goes through
confirm_report_ownership_transfer, which re-checks recipient, status, expiry and
current ownership under a row lock.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch
from uuid import UUID

import main

OWNER = "11111111-1111-4111-8111-111111111111"
RECIPIENT = "22222222-2222-4222-8222-222222222222"
STRANGER = "33333333-3333-4333-8333-333333333333"
REPORT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REQUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
HASH = "a" * 64
FAR_FUTURE = "2099-01-01T00:00:00+00:00"


class FakeSupabase:
    """Records every PostgREST call and answers the ones the transfer flow makes."""

    def __init__(self, transfer_status="pending", to_user=RECIPIENT, rpc_result=None):
        self.calls: list[tuple[str, str, object]] = []
        self.transfer_status = transfer_status
        self.to_user = to_user
        self.rpc_result = rpc_result if rpc_result is not None else {
            "ok": True,
            "report_id": REPORT,
            "from_user": OWNER,
            "to_user": RECIPIENT,
        }

    def __call__(self, path, method="GET", payload=None, extra_headers=None):
        self.calls.append((method, path, payload))
        if path.startswith("/rest/v1/documents?id=eq."):
            return [{"id": REPORT, "user_id": OWNER, "title": "Lab"}]
        if path.startswith("/rest/v1/documents?id=in."):
            return [{"id": REPORT, "title": "Lab"}]
        if path.startswith("/rest/v1/profiles?id="):
            return [{"id": OWNER, "email": "owner@example.com"}]
        if path == "/rest/v1/rpc/resolve_transfer_recipient":
            return {"id": RECIPIENT, "email": "recipient@example.com"}
        if path == "/rest/v1/rpc/confirm_report_ownership_transfer":
            return self.rpc_result
        if path == "/rest/v1/transfer_requests" and method == "POST":
            return [{"id": REQUEST}]
        if path.startswith("/rest/v1/transfer_requests?id=eq.") and method == "GET":
            return [{
                "id": REQUEST,
                "report_id": REPORT,
                "from_user": OWNER,
                "to_user": self.to_user,
                "token_hash": HASH,
                "status": self.transfer_status,
                "expires_at": FAR_FUTURE,
            }]
        if path.startswith("/rest/v1/transfer_requests?to_user=eq.") and method == "GET":
            return [{"id": REQUEST, "report_id": REPORT, "from_user": OWNER, "expires_at": FAR_FUTURE}]
        return []

    def paths(self, method=None):
        return [path for m, path, _ in self.calls if method is None or m == method]

    def payloads(self, method, path):
        return [payload for m, p, payload in self.calls if m == method and p == path]


def _as(user_id, email):
    return patch.object(main, "_require_user", return_value={"id": user_id, "email": email})


def _dump(model):
    return (getattr(model, "model_dump", None) or model.dict)()


class RequestWithoutMailerTests(unittest.TestCase):
    def _request(self, fake, email_configured):
        with patch.object(main, "OWNERSHIP_TRANSFER_EMAIL_CONFIGURED", email_configured), \
                patch.object(main, "_supabase_request", side_effect=fake), \
                _as(OWNER, "owner@example.com"), \
                patch.object(main, "_send_transfer_confirmation_email") as mailer:
            response = main.request_report_ownership_transfer(
                UUID(REPORT),
                main.OwnershipTransferRequest(recipient_email="recipient@example.com"),
                authorization="Bearer test",
            )
        return response, mailer

    def test_request_is_created_without_attempting_mail(self):
        fake = FakeSupabase()
        response, mailer = self._request(fake, email_configured=False)

        mailer.assert_not_called()
        self.assertTrue(response.ok)
        self.assertIn("首頁接受", response.message)
        created = fake.payloads("POST", "/rest/v1/transfer_requests")
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["to_user"], RECIPIENT)
        self.assertEqual(created[0]["status"], "pending")
        self.assertRegex(created[0]["token_hash"], r"^[0-9a-f]{64}$")
        self.assertEqual(set(_dump(response)), {"ok", "transfer_request_id", "expires_at", "message"})

    def test_with_a_mailer_the_emailed_link_flow_is_unchanged(self):
        response, mailer = self._request(FakeSupabase(), email_configured=True)

        mailer.assert_called_once()
        self.assertIn("確認信", response.message)


class IncomingTransferListTests(unittest.TestCase):
    def test_lists_only_pending_unexpired_requests_for_the_signed_in_recipient(self):
        fake = FakeSupabase()
        with patch.object(main, "_supabase_request", side_effect=fake), _as(RECIPIENT, "recipient@example.com"):
            items = main.list_incoming_report_transfers(authorization="Bearer test")

        self.assertEqual(len(items), 1)
        self.assertEqual(str(items[0].id), REQUEST)
        self.assertEqual(items[0].report_title, "Lab")
        self.assertEqual(items[0].from_email, "owner@example.com")
        listing = [p for p in fake.paths("GET") if p.startswith("/rest/v1/transfer_requests?")][0]
        self.assertIn(f"to_user=eq.{RECIPIENT}", listing)
        self.assertIn("status=eq.pending", listing)
        self.assertIn("expires_at=gt.", listing)
        self.assertNotIn("token_hash", listing)


class AcceptAndDeclineTests(unittest.TestCase):
    def _call(self, fn, fake, user_id, email):
        with patch.object(main, "_supabase_request", side_effect=fake), _as(user_id, email):
            return fn(UUID(REQUEST), authorization="Bearer test")

    def test_accept_confirms_with_the_stored_hash_as_the_recipient(self):
        fake = FakeSupabase()
        response = self._call(main.accept_incoming_report_transfer, fake, RECIPIENT, "recipient@example.com")

        self.assertEqual(response.status, "accepted")
        self.assertEqual(str(response.report_id), REPORT)
        self.assertEqual(
            fake.payloads("POST", "/rest/v1/rpc/confirm_report_ownership_transfer"),
            [{"p_token_hash": HASH, "p_recipient_user_id": RECIPIENT}],
        )

    def test_someone_else_cannot_accept(self):
        fake = FakeSupabase()
        with self.assertRaises(main.HTTPException) as caught:
            self._call(main.accept_incoming_report_transfer, fake, STRANGER, "stranger@example.com")

        self.assertEqual(caught.exception.status_code, 403)
        self.assertNotIn("/rest/v1/rpc/confirm_report_ownership_transfer", fake.paths())

    def test_a_processed_request_is_refused_before_the_rpc(self):
        fake = FakeSupabase(transfer_status="accepted")
        with self.assertRaises(main.HTTPException) as caught:
            self._call(main.accept_incoming_report_transfer, fake, RECIPIENT, "recipient@example.com")

        self.assertEqual(caught.exception.status_code, 409)
        self.assertNotIn("/rest/v1/rpc/confirm_report_ownership_transfer", fake.paths())

    def test_an_expired_request_reports_gone(self):
        fake = FakeSupabase(rpc_result={"ok": False, "code": "expired"})
        with self.assertRaises(main.HTTPException) as caught:
            self._call(main.accept_incoming_report_transfer, fake, RECIPIENT, "recipient@example.com")

        self.assertEqual(caught.exception.status_code, 410)

    def test_decline_marks_the_request_rejected_for_this_recipient_only(self):
        fake = FakeSupabase()
        response = self._call(main.decline_incoming_report_transfer, fake, RECIPIENT, "recipient@example.com")

        self.assertEqual(response.status, "rejected")
        patches = [(path, payload) for m, path, payload in fake.calls if m == "PATCH"]
        self.assertEqual(len(patches), 1)
        self.assertIn(f"to_user=eq.{RECIPIENT}", patches[0][0])
        self.assertIn("status=eq.pending", patches[0][0])
        self.assertEqual(patches[0][1]["status"], "rejected")
        self.assertNotIn("/rest/v1/rpc/confirm_report_ownership_transfer", fake.paths())

    def test_someone_else_cannot_decline(self):
        fake = FakeSupabase()
        with self.assertRaises(main.HTTPException) as caught:
            self._call(main.decline_incoming_report_transfer, fake, STRANGER, "stranger@example.com")

        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual([m for m, _, _ in fake.calls if m == "PATCH"], [])


if __name__ == "__main__":
    unittest.main()
