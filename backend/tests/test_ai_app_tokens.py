"""An AI app's grant (an OAuth token from Supabase Auth, marked by a client_id claim)
reaches the MCP tools and nothing else.

A student who connects ChatGPT gives it a token for their account. The MCP server
(mcp_remote.py) is what that token is for; the rest of the API -- built-in AI and its
quota, saved API keys, exports, report transfers -- must treat it as no sign-in at all,
so a leaked or over-trusted grant cannot spend a student's quota or read their settings.
The database side of the same rule is 20260918_ai_app_least_privilege.sql.
"""

from __future__ import annotations

import base64
import io
import json
import os
import unittest
from typing import Any
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import mcp_remote

ENV = {"SUPABASE_URL": "https://project.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "service-key-not-real"}
STUDENT = {"id": "11111111-1111-4111-8111-111111111111", "email": "student@example.edu"}


def token(claims: dict[str, Any]) -> str:
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")  # noqa: E731
    return f"{encode({'alg': 'ES256', 'typ': 'JWT'})}.{encode(claims)}.signature"


OWN_SIGN_IN = token({"sub": STUDENT["id"], "role": "authenticated"})
AI_APP_GRANT = token({"sub": STUDENT["id"], "role": "authenticated", "client_id": "chatgpt-connector"})


class Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def auth_server_accepting_everything(request, timeout=None):
    """Supabase Auth, if it were the only gate: it accepts both tokens."""
    return Answer(json.dumps(STUDENT).encode())


class AiAppGrantTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)
        # main reads these at import time; keep them in step for the test.
        self.url = patch.object(main, "SUPABASE_URL", ENV["SUPABASE_URL"])
        self.key = patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", ENV["SUPABASE_SERVICE_ROLE_KEY"])
        self.url.start()
        self.key.start()
        self.addCleanup(self.url.stop)
        self.addCleanup(self.key.stop)

    def test_recognises_the_claim_only_on_ai_app_grants(self):
        self.assertTrue(main._is_ai_app_token(AI_APP_GRANT))
        self.assertFalse(main._is_ai_app_token(OWN_SIGN_IN))
        for malformed in ("", "not-a-jwt", "a.b", "a.!!!.c", token({"client_id": ""})):
            self.assertFalse(main._is_ai_app_token(malformed), malformed)

    def test_the_api_treats_an_ai_app_grant_as_no_sign_in(self):
        with patch.object(main.urllib.request, "urlopen", auth_server_accepting_everything) as network:
            self.assertEqual(main._get_user_from_authorization(f"Bearer {OWN_SIGN_IN}"), STUDENT)
            self.assertIsNone(main._get_user_from_authorization(f"Bearer {AI_APP_GRANT}"))
        del network

    def test_refused_before_supabase_is_even_asked(self):
        # Recorded, not raised: the helper turns any network failure into None, which
        # would pass this test for the wrong reason.
        asked: list[str] = []

        def record(request, timeout=None):
            asked.append(request.full_url)
            return Answer(json.dumps(STUDENT).encode())

        with patch.object(main.urllib.request, "urlopen", record):
            self.assertIsNone(main._get_user_from_authorization(f"Bearer {AI_APP_GRANT}"))
        self.assertEqual(asked, [])

    def test_an_endpoint_answers_an_ai_app_grant_with_401(self):
        # Server errors come back as responses, so a grant that got through fails the
        # assertion rather than crashing the test.
        with (
            patch.object(main.urllib.request, "urlopen", auth_server_accepting_everything),
            TestClient(main.app, raise_server_exceptions=False) as client,
        ):
            grant = client.get("/api/ai/quota", headers={"Authorization": f"Bearer {AI_APP_GRANT}"})
            own = client.get("/api/ai/quota", headers={"Authorization": f"Bearer {OWN_SIGN_IN}"})
        self.assertEqual(grant.status_code, 401)
        # The control: the student's own sign-in gets past the sign-in check.
        self.assertNotEqual(own.status_code, 401)

    def test_the_mcp_tools_still_accept_it(self):
        mcp_remote._token_cache.clear()
        with patch.object(mcp_remote, "_fetch_user", return_value=STUDENT):
            user = mcp_remote.authenticate(f"Bearer {AI_APP_GRANT}")
        self.assertEqual(user["id"], STUDENT["id"])


if __name__ == "__main__":
    unittest.main()
