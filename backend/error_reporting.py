"""Send server errors to Sentry, when a DSN is configured.

Runtime errors were only ever written to the Render log, where nobody was looking.
This posts to Sentry's envelope endpoint with urllib rather than adding sentry-sdk:
CI installs exactly what requirements.txt lists, and a new transitive dependency has
broken this backend's test imports before. The payload is small and the parts worth
trusting -- reading the DSN, building the event -- are unit-tested.

Set SENTRY_DSN to turn it on. With no DSN every call here is a no-op.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("autolabreport.errors")

SEND_TIMEOUT_SECONDS = 5


def parse_sentry_dsn(dsn: str | None) -> dict[str, str] | None:
    """Turn a DSN into the envelope URL, or None when it is absent or unusable."""
    if not dsn or not dsn.strip():
        return None
    try:
        parts = urllib.parse.urlsplit(dsn.strip())
    except ValueError:
        return None

    public_key = parts.username
    project_id = parts.path.lstrip("/")
    if parts.scheme not in {"http", "https"} or not public_key or not project_id.isdigit():
        return None
    if not parts.hostname:
        return None

    host = parts.hostname if parts.port is None else f"{parts.hostname}:{parts.port}"
    return {
        "envelope_url": (
            f"{parts.scheme}://{host}/api/{project_id}/envelope/"
            f"?sentry_key={public_key}&sentry_version=7"
        ),
        "public_key": public_key,
        "project_id": project_id,
    }


def build_error_envelope(
    error: BaseException,
    context: dict[str, Any] | None = None,
    *,
    event_id: str | None = None,
    sent_at: str | None = None,
    release: str | None = None,
    environment: str | None = None,
) -> str:
    """Sentry envelopes are newline-delimited JSON: header, item header, event."""
    event_id = event_id or uuid.uuid4().hex
    sent_at = sent_at or datetime.now(UTC).isoformat()
    frames = traceback.format_exception(type(error), error, error.__traceback__)

    event = {
        "event_id": event_id,
        "timestamp": sent_at,
        "platform": "python",
        "level": "error",
        "logger": "autolabreport",
        "server_name": None,
        "release": release,
        "environment": environment,
        "exception": {
            "values": [
                {
                    "type": type(error).__name__,
                    "value": str(error),
                    "stacktrace": {"frames": [{"filename": "".join(frames)[-4000:]}]},
                }
            ]
        },
        "extra": context or {},
    }
    header = json.dumps({"event_id": event_id, "sent_at": sent_at})
    item_header = json.dumps({"type": "event"})
    return f"{header}\n{item_header}\n{json.dumps(event, default=str)}"


def _post_envelope(url: str, body: str) -> None:
    request = urllib.request.Request(
        url,
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/x-sentry-envelope"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=SEND_TIMEOUT_SECONDS):
            return
    except (urllib.error.URLError, OSError, ValueError):
        # Reporting an error must never become a second error.
        logger.debug("Could not deliver error report.")


def report_exception(error: BaseException, context: dict[str, Any] | None = None) -> bool:
    """Report in the background. Returns whether a report was actually sent."""
    dsn = parse_sentry_dsn(os.getenv("SENTRY_DSN"))
    if dsn is None:
        return False

    body = build_error_envelope(
        error,
        context,
        release=os.getenv("RELEASE_SHA"),
        environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
    )
    thread = threading.Thread(
        target=_post_envelope,
        args=(dsn["envelope_url"], body),
        name="sentry-report",
        daemon=True,
    )
    thread.start()
    return True


def error_reporting_configured() -> bool:
    return parse_sentry_dsn(os.getenv("SENTRY_DSN")) is not None
