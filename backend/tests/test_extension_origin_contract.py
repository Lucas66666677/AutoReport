"""The public-origin contract shared by the extension and the API.

AutoLabReport trusts exactly one public origin. That single fact is written
down in four places that no compiler or bundler ever compares:

* `backend/main.py` names it as `PRODUCTION_ORIGIN` and lets the browser talk
  to the API from it (`DEFAULT_ALLOWED_ORIGINS`, with `allow_credentials`).
* `extension/manifest.json` grants the extension host access to it and runs a
  content script there.
* `extension/background.js` uses it to decide which tab is allowed to ask the
  extension to drive an AI page (`SEND_TO_CHATGPT`).
* `extension/popup.js` restores it when the user presses Reset.

Drift between them fails in two directions. Widening one -- an earlier
manifest shipped `*://*.vercel.app/*`, which handed every deployment on a
shared host the trust meant for one origin -- is a security regression.
Narrowing one is an outage: this module was written after finding that Reset
in the popup wrote a localhost-only list over the background default,
silently revoking the deployed site's own bridge.

Secret-free by construction: every value here is read from files already in
the repository. Nothing reads an environment variable, opens a socket or
needs a credential.
"""

import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlsplit

import main

REPOSITORY_ROOT = Path(main.__file__).resolve().parents[1]
EXTENSION = REPOSITORY_ROOT / "extension"
MANIFEST = EXTENSION / "manifest.json"
BACKGROUND = EXTENSION / "background.js"
POPUP = EXTENSION / "popup.js"

LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

# https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
MATCH_PATTERN = re.compile(
    r"^(?P<scheme>\*|https?|file|ftp)://(?P<host>[^/]*)(?P<path>/.*)$"
)


def is_loopback(hostname):
    return bool(hostname) and (
        hostname in LOOPBACK_HOSTS or hostname.endswith(".localhost")
    )


def js_string_arrays(source, key, source_label, after, until):
    """Read every `key: ["a", "b"]` in one region of a JavaScript source file.

    The arrays this reads hold string literals only, so each closing bracket is
    unambiguous -- unlike the surrounding object, whose prompt templates embed
    `{{text}}` and defeat naive brace matching.
    """
    start = source.find(after)
    if start < 0:
        raise AssertionError(f"{source_label} no longer contains `{after}`")

    end = source.find(until, start + len(after))
    if end < 0:
        raise AssertionError(f"{source_label} no longer closes `{after}` with `{until}`")

    found = []
    opening = re.compile(rf"(?<![A-Za-z]){re.escape(key)}:\s*\[")
    for match in opening.finditer(source, start, end):
        closing = source.find("]", match.end())
        if closing < 0 or closing > end:
            raise AssertionError(f"{source_label} has an unterminated `{key}` array")
        found += re.findall(r'"([^"]*)"', source[match.end():closing])

    if not found:
        raise AssertionError(f"{source_label} no longer declares `{key}`")
    return found


class ExtensionSources:
    """Loaded once; every test below reads the repository, not the network."""

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    background = BACKGROUND.read_text(encoding="utf-8")
    popup = POPUP.read_text(encoding="utf-8")

    background_targets = js_string_arrays(
        background,
        "targetUrlPatterns",
        "extension/background.js",
        after="const DEFAULT_SETTINGS = {",
        until="\n};",
    )
    popup_targets = js_string_arrays(
        popup,
        "targetUrlPatterns",
        "extension/popup.js",
        after="const DEFAULT_SETTINGS = {",
        until="\n};",
    )
    # Third-party chat sites the extension reads from. They are not trusted to
    # command the extension, but they are legitimately in the manifest, so the
    # manifest audit has to tell them apart from an unowned host.
    ai_provider_hosts = js_string_arrays(
        background,
        "patterns",
        "extension/background.js",
        after="const AI_TARGET_PATTERNS = [",
        until="\n];",
    )

    @classmethod
    def manifest_patterns(cls):
        """Every match pattern in the manifest, tagged with where it came from."""
        found = [
            ("host_permissions", value)
            for value in cls.manifest["host_permissions"]
        ]
        for index, entry in enumerate(cls.manifest["content_scripts"]):
            found += [
                (f"content_scripts[{index}]", value) for value in entry["matches"]
            ]
        return found


def parsed(pattern):
    match = MATCH_PATTERN.match(pattern)
    assert match is not None, pattern
    return match


class TrustedOriginsAreOneOwnedOriginTests(unittest.TestCase):
    """`targetUrlPatterns` is the list a tab must match to command the extension."""

    def test_both_default_lists_were_actually_read(self):
        # Guards every assertion below: a refactor that defeats the reader must
        # fail loudly here rather than let empty lists satisfy the contract.
        self.assertGreater(len(ExtensionSources.background_targets), 1)
        self.assertGreater(len(ExtensionSources.popup_targets), 1)
        self.assertGreater(len(ExtensionSources.ai_provider_hosts), 1)

    def test_every_trusted_origin_is_a_bare_explicit_origin(self):
        for origin in ExtensionSources.background_targets:
            with self.subTest(origin=origin):
                self.assertNotIn("*", origin, "a trusted origin is never a pattern")
                parts = urlsplit(origin)
                self.assertIn(parts.scheme, ("http", "https"))
                self.assertTrue(parts.hostname)
                # background.js compares `candidate.origin`, so anything past
                # the origin is dead text that reads as a narrower grant.
                self.assertEqual(parts.path, "")
                self.assertEqual(parts.query, "")
                self.assertEqual(parts.fragment, "")

    def test_the_only_public_trusted_origin_is_the_backend_production_origin(self):
        public = [
            origin
            for origin in ExtensionSources.background_targets
            if not is_loopback(urlsplit(origin).hostname)
        ]
        self.assertEqual(public, [main.PRODUCTION_ORIGIN])
        self.assertEqual(urlsplit(main.PRODUCTION_ORIGIN).scheme, "https")

    def test_popup_reset_restores_the_same_trust_the_background_grants(self):
        # Reset writes the popup's own defaults straight into chrome.storage,
        # so a list that disagrees with background.js is a live trust change
        # one click away -- in whichever direction the two happen to differ.
        self.assertEqual(
            ExtensionSources.popup_targets,
            ExtensionSources.background_targets,
        )


class ManifestGrantsNoHostBeyondTheContractTests(unittest.TestCase):
    def test_the_manifest_is_mv3_and_declares_match_patterns(self):
        self.assertEqual(ExtensionSources.manifest["manifest_version"], 3)
        self.assertGreater(len(ExtensionSources.manifest_patterns()), 1)

    def test_no_match_pattern_uses_a_wildcard_host(self):
        # `*://*.vercel.app/*` shipped once. On a shared deployment host that
        # is every tenant's build, not this product's one origin.
        for source, pattern in ExtensionSources.manifest_patterns():
            with self.subTest(source=source, pattern=pattern):
                host = parsed(pattern).group("host")
                self.assertNotEqual(host, "*")
                self.assertFalse(
                    host.startswith("*."),
                    "a wildcard host grants every sibling name on that domain",
                )

    def test_no_match_pattern_grants_every_url(self):
        for source, pattern in ExtensionSources.manifest_patterns():
            with self.subTest(source=source, pattern=pattern):
                self.assertNotEqual(pattern, "<all_urls>")
                self.assertIsNotNone(
                    MATCH_PATTERN.match(pattern),
                    "an unreadable pattern cannot be audited",
                )

    def test_every_content_script_match_is_covered_by_host_permissions(self):
        granted = set(ExtensionSources.manifest["host_permissions"])
        for source, pattern in ExtensionSources.manifest_patterns():
            if source == "host_permissions":
                continue
            with self.subTest(source=source, pattern=pattern):
                self.assertIn(pattern, granted)

    def test_every_trusted_origin_is_reachable_through_the_manifest(self):
        for origin in ExtensionSources.background_targets:
            parts = urlsplit(origin)
            for kind in ("host_permissions", "content_scripts"):
                with self.subTest(origin=origin, kind=kind):
                    self.assertTrue(
                        any(
                            parsed(pattern).group("host") == parts.hostname
                            and parsed(pattern).group("scheme")
                            in ("*", parts.scheme)
                            for source, pattern in ExtensionSources.manifest_patterns()
                            if source.startswith(kind)
                        ),
                        f"{origin} is trusted but the manifest never reaches it",
                    )

    def test_the_manifest_names_no_public_host_the_contract_does_not(self):
        # Same suffix rule background.js uses to recognise a provider tab.
        def is_known_ai_host(hostname):
            return any(
                hostname == provider or hostname.endswith(f".{provider}")
                for provider in ExtensionSources.ai_provider_hosts
            )

        owned = {
            urlsplit(origin).hostname
            for origin in ExtensionSources.background_targets
        }

        for source, pattern in ExtensionSources.manifest_patterns():
            host = parsed(pattern).group("host")
            if is_loopback(host) or host in owned:
                continue
            with self.subTest(source=source, pattern=pattern):
                self.assertTrue(
                    is_known_ai_host(host),
                    f"{host} is neither an AI provider nor the production origin",
                )

    def test_the_match_pattern_reader_rejects_the_shapes_it_must_catch(self):
        for rejected in ("<all_urls>", "chatgpt.com/*", "*://chatgpt.com"):
            with self.subTest(pattern=rejected):
                self.assertIsNone(MATCH_PATTERN.match(rejected))
        for host, pattern in (
            ("*", "*://*/*"),
            ("*.vercel.app", "*://*.vercel.app/*"),
            ("auto-report-one.vercel.app", "https://auto-report-one.vercel.app/*"),
        ):
            with self.subTest(pattern=pattern):
                self.assertEqual(parsed(pattern).group("host"), host)


class ApiAgreesOnTheSamePublicOriginTests(unittest.TestCase):
    def test_production_origin_is_the_only_public_default_allowed_origin(self):
        public = [
            origin
            for origin in main.DEFAULT_ALLOWED_ORIGINS
            if not is_loopback(urlsplit(origin).hostname)
        ]
        self.assertEqual(public, [main.PRODUCTION_ORIGIN])

    def test_no_default_allowed_origin_is_a_wildcard(self):
        # CORS runs with allow_credentials, where a wildcard origin would hand
        # a logged-in session to any site that asks for it.
        self.assertIn(
            "allow_credentials=True",
            Path(main.__file__).read_text(encoding="utf-8"),
        )
        for origin in main.DEFAULT_ALLOWED_ORIGINS:
            with self.subTest(origin=origin):
                self.assertNotIn("*", origin)
                self.assertIn(urlsplit(origin).scheme, ("http", "https"))


if __name__ == "__main__":
    unittest.main()
