"""Secret-free release preflight.

Runs in CI with no credentials, no Supabase project and no deployment. It
answers the questions below before a release is allowed to proceed:

1. Does `/api/readiness` fail closed when required production configuration
   is absent, malformed or unprobeable?
2. Is that required configuration documented where an owner will actually
   look, and does the documentation still match the code?
3. Is the repository free of anything that looks like a real credential?
4. Does the deployment health gate probe the liveness endpoint rather than
   the dependency-sensitive readiness endpoint, is that route still
   declared, and does it still answer a bare HTTP probe?
5. Is the Supabase migration chain a valid upgrade path: an unambiguous
    apply order, still pinned by the release documentation and the deploy
    check, and re-appliable onto a database that already holds part of it?
6. Does the frontend host still fall back to the app shell, so the deep
   links the product hands out survive a cold load?
7. Does the release still refuse to build the frontend with the site's own
   public origin as its API origin, and does that origin still agree with
   the one the API allows through CORS?

Every value used here is a placeholder or generated for the duration of the
test run. Nothing in this module reads ambient environment variables.
"""

import contextlib
import json
import re
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

import main

REPOSITORY_ROOT = Path(main.__file__).resolve().parents[1]
ENV_EXAMPLE = REPOSITORY_ROOT / ".env.example"
DEPLOYMENT_DOC = REPOSITORY_ROOT / "docs" / "DEPLOYMENT.md"
OWNER_ACTIONS_DOC = REPOSITORY_ROOT / "docs" / "OWNER_ACTIONS.md"
DEPLOY_CHECK_SCRIPT = REPOSITORY_ROOT / "scripts" / "deploy-check.ps1"
MIGRATIONS_DIR = REPOSITORY_ROOT / "supabase" / "migrations"
FRONTEND_DIR = REPOSITORY_ROOT / "frontend"
VERCEL_CONFIG = FRONTEND_DIR / "vercel.json"
SPA_SHELL = FRONTEND_DIR / "index.html"
FRONTEND_APP_SOURCE = FRONTEND_DIR / "src" / "App.tsx"
FRONTEND_API_CONFIG = FRONTEND_DIR / "src" / "apiConfig.ts"
FRONTEND_SUPABASE_CONFIG = FRONTEND_DIR / "src" / "supabaseConfig.ts"
VITE_CONFIG = FRONTEND_DIR / "vite.config.ts"
FRONTEND_BUILD_REVISION = FRONTEND_DIR / "src" / "buildRevision.ts"

# The host health gate probes liveness; readiness is for the preflight and
# for monitoring, both of which can read a 503 instead of acting on it.
LIVENESS_PATH = "/api/health"
READINESS_PATH = "/api/readiness"

# Disposable stand-ins. The Fernet key is generated per run and never leaves
# this process; the others are unroutable placeholders.
DISPOSABLE_FERNET_KEY = Fernet.generate_key().decode("utf-8")
DISPOSABLE_SUPABASE_URL = "https://preflight.invalid"
DISPOSABLE_SERVICE_ROLE = "preflight-placeholder-not-a-service-role"


def _env_example_values() -> dict[str, str]:
    """The `NAME=value` pairs declared in `.env.example`.

    Read from the file rather than hard-coded, so a reworded placeholder keeps
    the placeholder-rejection test honest instead of stale.
    """
    values: dict[str, str] = {}
    for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        values[name.strip()] = value.strip()
    return values


@contextlib.contextmanager
def readiness_environment(supabase=True, encryption=True, pandoc=True, built_in_ai=False):
    """Pin every readiness input so the result never depends on the host."""
    with (
        patch.object(
            main,
            "SUPABASE_URL",
            DISPOSABLE_SUPABASE_URL if supabase else None,
        ),
        patch.object(
            main,
            "SUPABASE_SERVICE_ROLE_KEY",
            DISPOSABLE_SERVICE_ROLE if supabase else None,
        ),
        patch.object(
            main,
            "ENCRYPTION_KEY",
            DISPOSABLE_FERNET_KEY if encryption else None,
        ),
        patch.object(
            main.pypandoc,
            "get_pandoc_path",
            return_value="/usr/bin/pandoc" if pandoc else "",
        ),
        patch.object(main, "groq_client", object() if built_in_ai else None),
        patch.object(main, "gemini_client", None),
    ):
        yield


class ReadinessFailsClosedTests(unittest.TestCase):
    def test_reports_ready_only_when_every_required_check_passes(self):
        with readiness_environment():
            payload = main.readiness()

        self.assertEqual(payload["status"], "ready")
        for name in main.READINESS_REQUIRED_CHECKS:
            self.assertTrue(payload["checks"][name], name)

    def test_each_required_check_alone_blocks_readiness(self):
        for name in main.READINESS_REQUIRED_CHECKS:
            with self.subTest(check=name):
                with readiness_environment(**{name: False}):
                    with self.assertRaises(main.HTTPException) as raised:
                        main.readiness()

                self.assertEqual(raised.exception.status_code, 503)
                detail = raised.exception.detail
                self.assertEqual(detail["status"], "not_ready")
                self.assertFalse(detail["checks"][name])
                self.assertEqual(detail["missing"], [name])

    def test_every_missing_required_check_is_named(self):
        with readiness_environment(supabase=False, encryption=False, pandoc=False):
            with self.assertRaises(main.HTTPException) as raised:
                main.readiness()

        self.assertEqual(
            raised.exception.detail["missing"],
            list(main.READINESS_REQUIRED_CHECKS),
        )

    def test_present_but_unusable_encryption_key_is_not_ready(self):
        # A non-empty ENCRYPTION_KEY is not evidence that encryption works.
        # Truncated, quoted and re-wrapped keys all reach production this way.
        for broken in ("not-a-fernet-key", DISPOSABLE_FERNET_KEY[:-4], " "):
            with self.subTest(key=broken[:12]):
                with readiness_environment():
                    with patch.object(main, "ENCRYPTION_KEY", broken):
                        with self.assertRaises(main.HTTPException) as raised:
                            main.readiness()

                self.assertEqual(raised.exception.status_code, 503)
                self.assertIn("encryption", raised.exception.detail["missing"])

    def test_pandoc_probe_failure_is_not_ready_rather_than_a_crash(self):
        for error in (OSError("pandoc missing"), RuntimeError("probe exploded")):
            with self.subTest(error=type(error).__name__):
                with readiness_environment():
                    with patch.object(
                        main.pypandoc, "get_pandoc_path", side_effect=error
                    ):
                        with self.assertRaises(main.HTTPException) as raised:
                            main.readiness()

                self.assertEqual(raised.exception.status_code, 503)
                self.assertIn("pandoc", raised.exception.detail["missing"])

    def test_optional_checks_never_block_readiness(self):
        with readiness_environment(built_in_ai=False):
            payload = main.readiness()

        self.assertEqual(payload["status"], "ready")
        for name in main.READINESS_OPTIONAL_CHECKS:
            self.assertIn(name, payload["checks"])
        self.assertFalse(payload["checks"]["built_in_ai"])

    def test_optional_and_required_checks_do_not_overlap(self):
        self.assertEqual(
            set(main.READINESS_REQUIRED_CHECKS) & set(main.READINESS_OPTIONAL_CHECKS),
            set(),
        )

    def test_supabase_needs_both_url_and_service_role_key(self):
        partial_configurations = (
            (DISPOSABLE_SUPABASE_URL, None),
            (DISPOSABLE_SUPABASE_URL, ""),
            (None, DISPOSABLE_SERVICE_ROLE),
            ("", DISPOSABLE_SERVICE_ROLE),
        )
        for url, key in partial_configurations:
            with self.subTest(has_url=bool(url), has_key=bool(key)):
                with (
                    patch.object(main, "SUPABASE_URL", url),
                    patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", key),
                ):
                    self.assertFalse(main._supabase_configured())

    def test_the_env_example_placeholders_never_read_as_configured(self):
        """A deploy that copies `.env.example` verbatim is not configured.

        Both placeholder values are non-empty strings, so a presence-only
        check passed them and `/api/readiness` would have reported `supabase:
        true` over credentials that authenticate nothing. This is the same
        failure `_encryption_ready` already refuses for a malformed key.

        The placeholders are read from `.env.example` itself, not repeated
        here, so this stays true if the documented example is ever reworded.
        """
        example = _env_example_values()
        url_placeholder = example["SUPABASE_URL"]
        role_placeholder = example["SUPABASE_SERVICE_ROLE_KEY"]

        # Guard the guard: if the example stops using a placeholder shape, this
        # test is asserting nothing -- fail loudly rather than pass vacuously.
        self.assertTrue(url_placeholder and role_placeholder)

        with (
            patch.object(main, "SUPABASE_URL", url_placeholder),
            patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", DISPOSABLE_SERVICE_ROLE),
        ):
            self.assertFalse(main._supabase_configured())

        with (
            patch.object(main, "SUPABASE_URL", DISPOSABLE_SUPABASE_URL),
            patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", role_placeholder),
        ):
            self.assertFalse(main._supabase_configured())

    def test_a_non_https_supabase_url_is_not_configured(self):
        """An `http://` or host-less value is a misconfiguration, not readiness."""
        for url in (
            "http://project.example",
            "project.example",
            "https://",
            "ftp://project.example",
            "",
        ):
            with self.subTest(url=url):
                with (
                    patch.object(main, "SUPABASE_URL", url),
                    patch.object(
                        main, "SUPABASE_SERVICE_ROLE_KEY", DISPOSABLE_SERVICE_ROLE
                    ),
                ):
                    self.assertFalse(main._supabase_configured())

    def test_a_real_shaped_https_service_role_still_reads_as_configured(self):
        """Guards the guard: the tightening must not reject a valid config.

        The disposable placeholders this suite uses everywhere else are an
        `https://` host and a non-placeholder key, so they must still pass --
        otherwise every other readiness test here would be asserting on a
        `_supabase_configured` that can never be true.
        """
        with (
            patch.object(main, "SUPABASE_URL", DISPOSABLE_SUPABASE_URL),
            patch.object(main, "SUPABASE_SERVICE_ROLE_KEY", DISPOSABLE_SERVICE_ROLE),
        ):
            self.assertTrue(main._supabase_configured())

    def test_not_ready_response_never_echoes_a_configured_value(self):
        with readiness_environment(supabase=False):
            with self.assertRaises(main.HTTPException) as raised:
                main.readiness()

        detail = raised.exception.detail
        rendered = repr(detail)
        for value in (
            DISPOSABLE_FERNET_KEY,
            DISPOSABLE_SERVICE_ROLE,
            DISPOSABLE_SUPABASE_URL,
        ):
            self.assertNotIn(value, rendered)
        for name, value in detail["checks"].items():
            self.assertIsInstance(value, bool, name)


class RequiredProductionConfigurationIsDocumentedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.deployment = DEPLOYMENT_DOC.read_text(encoding="utf-8")
        cls.env_example = ENV_EXAMPLE.read_text(encoding="utf-8")
        cls.owner_actions = OWNER_ACTIONS_DOC.read_text(encoding="utf-8")
        cls.deploy_check = DEPLOY_CHECK_SCRIPT.read_text(encoding="utf-8")
        cls.backend_source = Path(main.__file__).read_text(encoding="utf-8")

    def documented_list(self, label):
        match = re.search(rf"^{re.escape(label)}:(.+)$", self.deployment, re.MULTILINE)
        self.assertIsNotNone(match, f"docs/DEPLOYMENT.md must declare a '{label}:' line")
        return [item.strip() for item in match.group(1).split(",") if item.strip()]

    def test_documented_readiness_contract_matches_the_code(self):
        # Adding a required check without documenting it fails the release.
        self.assertEqual(
            self.documented_list("readiness required"),
            list(main.READINESS_REQUIRED_CHECKS),
        )
        self.assertEqual(
            self.documented_list("readiness optional"),
            list(main.READINESS_OPTIONAL_CHECKS),
        )

    def test_readiness_reports_monitoring_without_revealing_the_dsn(self):
        """Setting SENTRY_DSN on the host is otherwise invisible until something breaks.

        The value must never appear in the payload: readiness is a public endpoint, and
        a DSN lets anyone post events into the project.
        """
        import json
        import os

        dsn = "https://publickey123@o999.ingest.us.sentry.io/456789"
        with readiness_environment():
            with patch.dict(os.environ, {"SENTRY_DSN": dsn}):
                payload = main.readiness()

        self.assertTrue(payload["checks"]["error_monitoring"])
        serialised = json.dumps(payload)
        self.assertNotIn("publickey123", serialised)
        self.assertNotIn("ingest.us.sentry.io", serialised)
        self.assertNotIn(dsn, serialised)

    def test_monitoring_never_blocks_readiness(self):
        """Reporting is optional; a service with no DSN is still ready to serve."""
        import os

        with readiness_environment():
            environment = dict(os.environ)
            environment.pop("SENTRY_DSN", None)
            with patch.dict(os.environ, environment, clear=True):
                payload = main.readiness()

        self.assertEqual(payload["status"], "ready")
        self.assertFalse(payload["checks"]["error_monitoring"])
        self.assertIn("error_monitoring", main.READINESS_OPTIONAL_CHECKS)
        self.assertNotIn("error_monitoring", main.READINESS_REQUIRED_CHECKS)

    def test_readiness_required_checks_are_the_ones_the_endpoint_enforces(self):
        enforced = []
        for name in ("supabase", "encryption", "pandoc"):
            with readiness_environment(**{name: False}):
                try:
                    main.readiness()
                except main.HTTPException:
                    enforced.append(name)
        self.assertEqual(enforced, list(main.READINESS_REQUIRED_CHECKS))

    def test_required_backend_configuration_is_documented_end_to_end(self):
        required = self.documented_list("required backend env")
        self.assertLessEqual(
            {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ENCRYPTION_KEY"},
            set(required),
            "the readiness gate depends on these, so they are required",
        )
        for name in required:
            with self.subTest(variable=name):
                self.assertRegex(self.env_example, rf"(?m)^{re.escape(name)}=")
                self.assertIn(name, self.deploy_check)
                self.assertIn(name, self.backend_source)

    def test_required_frontend_configuration_is_documented_end_to_end(self):
        for name in self.documented_list("required frontend env"):
            with self.subTest(variable=name):
                self.assertRegex(self.env_example, rf"(?m)^{re.escape(name)}=")
                self.assertIn(name, self.deploy_check)

    def test_deployment_guidance_forbids_committing_configuration_values(self):
        self.assertIn(
            "Never resolve a readiness 503 by committing a value",
            self.deployment,
        )
        self.assertIn("不要把真实 Secret 写入本文件", self.owner_actions)

    def test_closed_beta_flag_block_matches_the_env_example(self):
        block = re.search(
            r"## Closed Beta flags\s*\n+~~~text\n(.*?)\n~~~",
            self.owner_actions,
            re.DOTALL,
        )
        self.assertIsNotNone(
            block, "docs/OWNER_ACTIONS.md must list the Closed Beta flags"
        )

        flags = [line.strip() for line in block.group(1).splitlines() if "=" in line]
        self.assertGreater(len(flags), 0)
        for flag in flags:
            with self.subTest(flag=flag):
                self.assertTrue(flag.endswith("=false"), "unverified features ship off")
                self.assertRegex(self.env_example, rf"(?m)^{re.escape(flag)}$")

    def test_server_feature_flags_require_an_exact_true_opt_in(self):
        # A truthy-but-not-"true" value must leave an unaccepted feature off.
        for flag in (
            "STRIPE_BILLING_ENABLED",
            "GITHUB_SYNC_ENABLED",
            "GOOGLE_DRIVE_ENABLED",
            "OWNERSHIP_TRANSFER_EMAIL_CONFIGURED",
        ):
            with self.subTest(flag=flag):
                self.assertIn(
                    f'{flag} = os.getenv("{flag}") == "true"',
                    self.backend_source,
                )


class DeploymentHealthGateProbesLivenessTests(unittest.TestCase):
    """The health gate that keeps the service up must not depend on config.

    `/api/readiness` fails closed by design. Wiring it to the host health
    gate turns a missing `ENCRYPTION_KEY` or an absent Pandoc into a failed
    deploy and a restarting instance, which takes away the endpoint the owner
    needs in order to see which check is missing.
    """

    @classmethod
    def setUpClass(cls):
        cls.deployment = DEPLOYMENT_DOC.read_text(encoding="utf-8")
        cls.deploy_check = DEPLOY_CHECK_SCRIPT.read_text(encoding="utf-8")

    def documented_health_gate(self):
        match = re.search(
            r"^deployment health gate:(.+)$", self.deployment, re.MULTILINE
        )
        self.assertIsNotNone(
            match, "docs/DEPLOYMENT.md must declare a 'deployment health gate:' line"
        )
        return match.group(1).strip()

    def test_documented_health_gate_is_the_liveness_path(self):
        gate = self.documented_health_gate()
        self.assertEqual(gate, LIVENESS_PATH)
        self.assertNotEqual(
            gate,
            READINESS_PATH,
            "readiness returns 503 on a configuration gap and must not gate the host",
        )

    def test_liveness_route_stays_declared(self):
        methods = {}
        for route in main.app.routes:
            methods.setdefault(getattr(route, "path", None), set()).update(
                getattr(route, "methods", set())
            )

        self.assertIn(
            LIVENESS_PATH, methods, "the documented health gate must have a route"
        )
        self.assertIn("GET", methods[LIVENESS_PATH])
        # The gate is only meaningful while the two endpoints stay distinct.
        self.assertIn(READINESS_PATH, methods)

    def test_liveness_answers_while_every_required_check_is_missing(self):
        with readiness_environment(supabase=False, encryption=False, pandoc=False):
            payload = main.health()

            with self.assertRaises(main.HTTPException) as raised:
                main.readiness()

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(raised.exception.status_code, 503)

    def test_deploy_check_probes_the_documented_health_gate(self):
        self.assertIn(self.documented_health_gate(), self.deploy_check)

    def test_liveness_accepts_the_bare_probe_the_host_actually_sends(self):
        """A health gate sends `GET /api/health` and nothing else.

        Calling `main.health()` from a test proves the handler answers, not
        that the route does. Giving liveness a required header, query value or
        route dependency leaves it declared and still returning `ok` here,
        while the host's credential-free probe starts getting 401/422 -- the
        instance drops out of rotation with no check reporting it.
        """
        route = next(
            candidate
            for candidate in main.app.routes
            if getattr(candidate, "path", None) == LIVENESS_PATH
        )
        dependant = route.dependant

        self.assertEqual(route.dependencies, [])
        self.assertEqual(main.app.router.dependencies, [])
        self.assertEqual(dependant.dependencies, [])
        for kind in ("header_params", "query_params", "body_params", "cookie_params"):
            with self.subTest(parameters=kind):
                self.assertEqual([param.name for param in getattr(dependant, kind)], [])


class LivenessGateAnswersTheHostProbeTests(unittest.TestCase):
    """The platform probes the gate over HTTP, not by calling the function.

    The assertions above call `main.health()` directly, so they stay green
    for any change that leaves the function intact but makes the path
    unreachable: a dependency added to the route, an auth or rate-limit
    middleware placed in front of the API surface, a stricter host or origin
    check. The health checker sends a bare GET -- no credentials, no cookie
    and no `Origin` header -- and reads only the status code, so that change
    would fail the deploy and restart a healthy instance.
    """

    def test_bare_get_on_the_liveness_path_answers_200(self):
        # Worst case for the gate: every required readiness check missing.
        # Liveness must still answer, and readiness must still fail closed,
        # over the same transport the platform uses.
        with readiness_environment(supabase=False, encryption=False, pandoc=False):
            with TestClient(main.app) as client:
                liveness = client.get(LIVENESS_PATH)
                readiness = client.get(READINESS_PATH)

        self.assertEqual(liveness.status_code, 200)
        self.assertEqual(liveness.json()["status"], "ok")
        self.assertEqual(readiness.status_code, 503)


class NoCredentialLooksCommittedTests(unittest.TestCase):
    SECRET_PATTERNS = (
        (
            "JSON Web Token",
            re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
        ),
        ("Stripe API key", re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{16,}")),
        ("Stripe webhook secret", re.compile(r"\bwhsec_[A-Za-z0-9]{16,}")),
        ("Groq API key", re.compile(r"\bgsk_[A-Za-z0-9]{20,}")),
        ("Google API key", re.compile(r"\bAIza[A-Za-z0-9_-]{30,}")),
        (
            "Supabase API key",
            re.compile(r"\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}"),
        ),
        (
            "Fernet key",
            re.compile(r"(?<![A-Za-z0-9_/+-])[A-Za-z0-9_-]{43}=(?![A-Za-z0-9=])"),
        ),
    )

    def reviewed_files(self):
        yield ENV_EXAMPLE
        yield from sorted(REPOSITORY_ROOT.glob("*.md"))
        yield from sorted(REPOSITORY_ROOT.glob("docs/**/*.md"))
        yield from sorted(REPOSITORY_ROOT.glob("scripts/*.ps1"))

    def test_documentation_and_env_example_contain_only_placeholders(self):
        reviewed = 0
        for path in self.reviewed_files():
            reviewed += 1
            content = path.read_text(encoding="utf-8")
            relative = path.relative_to(REPOSITORY_ROOT).as_posix()
            for label, pattern in self.SECRET_PATTERNS:
                with self.subTest(path=relative, secret=label):
                    self.assertIsNone(
                        pattern.search(content),
                        f"{relative} looks like it contains a real {label}",
                    )
        self.assertGreater(reviewed, 1)

    def test_env_example_secret_slots_hold_placeholders_only(self):
        for line in ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            if not name.endswith(("_KEY", "_SECRET")):
                continue
            with self.subTest(variable=name):
                self.assertRegex(
                    value,
                    r"your-|generate-",
                    "secret slots must read as placeholders",
                )

    def test_gitignore_keeps_environment_files_out_of_the_repository(self):
        rules = [
            rule.strip()
            for rule in (REPOSITORY_ROOT / ".gitignore")
            .read_text(encoding="utf-8")
            .splitlines()
        ]
        for rule in (".env", ".env.*", "**/.env", "**/.env.*"):
            self.assertIn(rule, rules)
        self.assertIn("!.env.example", rules)


class ServerSecretsNeverReachTheBrowserTests(unittest.TestCase):
    """The service-role key and the Fernet key must never reach the browser.

    Vite inlines every ``VITE_``-prefixed variable into the client bundle, and
    it ships every string literal in the bundled source. So a server secret
    handed a ``VITE_`` name, or a server-secret env name referenced from bundled
    source, is served to every visitor. The two secrets this guards are the two
    worst to expose: ``SUPABASE_SERVICE_ROLE_KEY`` bypasses every RLS policy, and
    ``ENCRYPTION_KEY`` decrypts every stored user API key.

    Readiness cannot catch this. The deployment is "ready" *because* the secrets
    are configured; the fault is that a copy of one also went to the browser.
    The window this matters most is the one the launch is in right now -- an
    owner pasting the real Supabase and encryption values into hosting env vars,
    one ``VITE_`` typo away from publishing the service-role key.

    All checks read files only -- no secret value, no network, no running build.
    """

    #: Server-only. Neither may ever cross into client-shipped configuration.
    SERVER_ONLY_SECRETS = ("SUPABASE_SERVICE_ROLE_KEY", "ENCRYPTION_KEY")
    #: The substrings that mark a variable name as one of the above, so a rename
    #: like ``SUPABASE_SERVICE_ROLE_TOKEN`` is still caught.
    SERVER_SECRET_MARKERS = ("SERVICE_ROLE", "ENCRYPTION")

    #: What Vite compiles into what the browser downloads. ``frontend/scripts``
    #: runs in Node at setup time and is never bundled, so a service-role key it
    #: reads from its own environment is not a browser leak and is out of scope.
    BUNDLED_SOURCE_ROOT = FRONTEND_DIR / "src"
    BUNDLED_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html")

    @classmethod
    def _vite_names_exposing_a_server_secret(cls, env_text):
        """``VITE_`` names in ``env_text`` that carry a server-secret marker."""
        offenders = []
        for line in env_text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or "=" not in stripped:
                continue
            name = stripped.split("=", 1)[0].strip()
            if name.startswith("VITE_") and any(
                marker in name for marker in cls.SERVER_SECRET_MARKERS
            ):
                offenders.append(name)
        return offenders

    @classmethod
    def _server_secrets_named_in(cls, source_text):
        """Server-only secret names (or their ``VITE_`` form) present in source."""
        found = []
        for secret in cls.SERVER_ONLY_SECRETS:
            if secret in source_text:
                found.append(secret)
        return found

    def test_no_vite_variable_carries_a_server_secret(self):
        offenders = self._vite_names_exposing_a_server_secret(
            ENV_EXAMPLE.read_text(encoding="utf-8")
        )
        self.assertEqual(
            offenders,
            [],
            f"these VITE_ variables would inline a server secret into the "
            f"browser bundle: {offenders}",
        )

    def test_the_vite_detector_catches_a_planted_leak(self):
        """Guards the guard: the check above can actually fail."""
        planted = (
            "VITE_API_URL=http://localhost:8000\n"
            "VITE_SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key\n"
            "VITE_ENCRYPTION_KEY=generate-with-python-cryptography-fernet\n"
        )
        self.assertEqual(
            self._vite_names_exposing_a_server_secret(planted),
            ["VITE_SUPABASE_SERVICE_ROLE_KEY", "VITE_ENCRYPTION_KEY"],
        )

    def test_server_secrets_are_declared_only_as_server_variables(self):
        values = _env_example_values()
        for secret in self.SERVER_ONLY_SECRETS:
            with self.subTest(secret=secret):
                self.assertIn(
                    secret,
                    values,
                    f"{secret} must stay a documented server-only variable",
                )
                self.assertNotIn(
                    f"VITE_{secret}",
                    values,
                    f"VITE_{secret} would ship {secret} to the browser",
                )

    def _bundled_sources(self):
        if not self.BUNDLED_SOURCE_ROOT.is_dir():
            return
        for path in sorted(self.BUNDLED_SOURCE_ROOT.rglob("*")):
            if path.is_file() and path.suffix in self.BUNDLED_SUFFIXES:
                yield path

    def test_no_bundled_source_names_a_server_secret(self):
        scanned = 0
        for path in self._bundled_sources():
            scanned += 1
            relative = path.relative_to(REPOSITORY_ROOT).as_posix()
            found = self._server_secrets_named_in(
                path.read_text(encoding="utf-8")
            )
            with self.subTest(path=relative):
                self.assertEqual(
                    found,
                    [],
                    f"{relative} is compiled into the browser bundle and names "
                    f"the server-only secret(s) {found}",
                )
        self.assertGreater(
            scanned,
            0,
            "no bundled frontend source was scanned; the guard would pass "
            "vacuously if frontend/src moved",
        )

    def test_the_source_detector_catches_a_planted_leak(self):
        """Guards the guard: prove the source scan can fail, not just pass."""
        self.assertEqual(
            self._server_secrets_named_in(
                "const k = import.meta.env.VITE_ENCRYPTION_KEY"
            ),
            ["ENCRYPTION_KEY"],
        )
        self.assertEqual(
            self._server_secrets_named_in("const url = import.meta.env.VITE_API_URL"),
            [],
        )


class MigrationChainIsAValidUpgradePathTests(unittest.TestCase):
    """A release may not call migrations ready on the strength of a file listing.

    `docs/DEPLOYMENT.md` tells the owner to apply every file in
    `supabase/migrations` in filename order, by hand, in the Supabase SQL
    editor. Nothing records which files a project has already seen, so the
    chain has to survive being replayed over a database that already holds
    part of it. A statement that aborts on the second pass stops the script
    midway and leaves the schema half-upgraded, with every hardening
    statement below the failure silently unapplied.

    These checks read SQL text only. They open no connection, create no
    database and run no migration.
    """

    # PostgreSQL has no IF NOT EXISTS for CREATE POLICY, CREATE TRIGGER or
    # CREATE TYPE, so the chain guards those by name instead.
    POLICY = re.compile(
        r'(?:drop\s+policy\s+if\s+exists\s+"(?P<dropped>[^"]+)")'
        r'|(?:create\s+policy\s+"(?P<created>[^"]+)")',
        re.IGNORECASE,
    )
    CREATE_TRIGGER = re.compile(r"create\s+trigger\s+(\w+)", re.IGNORECASE)
    DROP_TRIGGER = re.compile(r"drop\s+trigger\s+if\s+exists\s+(\w+)", re.IGNORECASE)
    CREATE_TYPE = re.compile(r"create\s+type\s", re.IGNORECASE)

    # Statements that abort a replay unless they carry their own guard.
    UNGUARDED_STATEMENTS = (
        ("create table", re.compile(r"create\s+table\s+(?!if\s+not\s+exists)", re.I)),
        (
            "create index",
            re.compile(
                r"create\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists)", re.I
            ),
        ),
        ("create sequence", re.compile(r"create\s+sequence\s+(?!if\s+not\s+exists)", re.I)),
        ("create function", re.compile(r"create\s+function\s", re.I)),
        ("add column", re.compile(r"add\s+column\s+(?!if\s+not\s+exists)", re.I)),
    )

    FILENAME = re.compile(r"^(?P<stamp>\d{8})_[a-z0-9_]+\.sql$")

    @classmethod
    def setUpClass(cls):
        cls.chain = sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda path: path.name)
        cls.sql = {path.name: path.read_text(encoding="utf-8") for path in cls.chain}
        cls.deployment = DEPLOYMENT_DOC.read_text(encoding="utf-8")
        cls.deploy_check = DEPLOY_CHECK_SCRIPT.read_text(encoding="utf-8")

    def test_the_chain_exists(self):
        # Every assertion below is vacuous if the directory is empty or moved.
        self.assertGreater(len(self.chain), 1, MIGRATIONS_DIR.as_posix())

    def test_every_filename_declares_an_unambiguous_place_in_the_chain(self):
        for name in self.sql:
            with self.subTest(migration=name):
                match = self.FILENAME.match(name)
                self.assertIsNotNone(
                    match, "expected a YYYYMMDD_lower_snake_case.sql migration name"
                )
                stamp = match.group("stamp")
                # A stamp that sorts but is not a real date makes the apply
                # order look deliberate when it is not.
                date(int(stamp[:4]), int(stamp[4:6]), int(stamp[6:]))

    def test_filename_order_is_also_chronological_order(self):
        stamps = [self.FILENAME.match(name).group("stamp") for name in self.sql]
        self.assertEqual(
            stamps,
            sorted(stamps),
            "the apply order is filename order, so a migration may not carry a "
            "datestamp older than the file before it",
        )

    def test_the_documented_apply_order_is_still_filename_order(self):
        # The replay checks below assume this process. If the guide ever
        # describes a tool that records applied migrations instead, revisit
        # these tests rather than leaving them quietly passing.
        self.assertIn("in filename order", self.deployment)

    def test_deployment_doc_pins_the_last_link_in_the_chain(self):
        block = re.search(
            r"final Closed Beta hardening migration is:\s*\n+~~~text\n(.*?)\n~~~",
            self.deployment,
            re.DOTALL,
        )
        self.assertIsNotNone(
            block, "docs/DEPLOYMENT.md must name the final hardening migration"
        )
        self.assertEqual(
            block.group(1).strip(),
            f"supabase/migrations/{self.chain[-1].name}",
            "a migration was added without re-pointing docs/DEPLOYMENT.md, so an "
            "owner following the guide would stop short of the real end",
        )

    def test_deploy_check_pins_the_first_and_last_links_in_the_chain(self):
        pinned = {
            label: filename
            for filename, label in re.findall(
                r'supabase\\migrations\\([\w.-]+\.sql)"\)\s+"([^"]+)"',
                self.deploy_check,
            )
        }
        self.assertEqual(pinned.get("Supabase bootstrap migration"), self.chain[0].name)
        self.assertEqual(
            pinned.get("Supabase final hardening migration"), self.chain[-1].name
        )
        for label, filename in pinned.items():
            with self.subTest(check=label):
                self.assertIn(filename, self.sql, "deploy-check pins a missing file")

    def test_no_migration_uses_a_statement_that_aborts_on_a_replay(self):
        for name, sql in self.sql.items():
            for label, pattern in self.UNGUARDED_STATEMENTS:
                with self.subTest(migration=name, statement=label):
                    self.assertIsNone(
                        pattern.search(sql),
                        f"{label} needs an IF NOT EXISTS or OR REPLACE guard to "
                        "survive a replay over an already-upgraded database",
                    )

    def test_every_created_policy_is_dropped_first_in_the_same_migration(self):
        # The Closed Beta migration dropped the policy names it superseded but
        # not the names it created, so a replay aborted at the first CREATE
        # POLICY, above the private-bucket and storage hardening in the same
        # file.
        for name, sql in self.sql.items():
            dropped = set()
            for match in self.POLICY.finditer(sql):
                if match.group("dropped"):
                    dropped.add(match.group("dropped"))
                    continue
                with self.subTest(migration=name, policy=match.group("created")):
                    self.assertIn(
                        match.group("created"),
                        dropped,
                        "a replay raises 42710 duplicate_object here",
                    )

    def test_every_created_trigger_is_dropped_first_in_the_same_migration(self):
        for name, sql in self.sql.items():
            dropped = set(self.DROP_TRIGGER.findall(sql))
            for trigger in self.CREATE_TRIGGER.findall(sql):
                with self.subTest(migration=name, trigger=trigger):
                    self.assertIn(trigger, dropped)

    def test_every_created_type_tolerates_already_existing(self):
        for name, sql in self.sql.items():
            if not self.CREATE_TYPE.search(sql):
                continue
            with self.subTest(migration=name):
                # The chain wraps CREATE TYPE in a DO block that swallows the
                # duplicate_object raised by the second pass.
                self.assertIn("duplicate_object", sql)


def vercel_source_to_pattern(source):
    """Compile a Vercel rewrite `source` into an anchored regular expression.

    Vercel matches `source` with path-to-regexp: a parenthesised group is a
    raw regular expression, `:name` is one path segment, and a trailing `*`,
    `+` or `?` widens it. Everything else is a literal. Syntax outside that
    vocabulary raises instead of being guessed at, so an unfamiliar rewrite
    fails the release rather than quietly matching nothing.
    """
    parameter = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)([*+?]?)")
    widened = {"*": "(?:.*)", "+": "(?:.+)", "?": "(?:[^/]*)", "": "(?:[^/]+)"}
    parts = []
    index = 0
    while index < len(source):
        character = source[index]
        if character == "(":
            depth = 0
            end = index
            while end < len(source):
                if source[end] == "(":
                    depth += 1
                elif source[end] == ")":
                    depth -= 1
                    if depth == 0:
                        break
                end += 1
            if depth != 0:
                raise ValueError(f"unbalanced group in rewrite source {source!r}")
            parts.append(source[index : end + 1])
            index = end + 1
        elif character == ":":
            match = parameter.match(source, index)
            if match is None:
                raise ValueError(f"unreadable parameter in rewrite source {source!r}")
            parts.append(widened[match.group(2)])
            index = match.end()
        elif character in "[]{}?+*^$|\\":
            raise ValueError(f"unsupported syntax in rewrite source {source!r}")
        else:
            parts.append(re.escape(character))
            index += 1
    return re.compile("^" + "".join(parts) + "$")


class SpaFallbackServesEveryDeepLinkTests(unittest.TestCase):
    """The frontend host must answer a path no build artifact occupies.

    The product hands out deep links. A share link leaves the app as
    `https://<frontend>/p/<document id>` and is opened by someone who has
    never loaded the site, and a signed-in session rewrites its own URL to
    `/dashboard/projects` and its siblings, so any refresh is a cold load
    too. Vercel resolves those against the built files first and finds
    nothing; only the rewrite in `frontend/vercel.json` turns them into the
    app shell.

    Nothing else in the release catches a narrowed or dropped rewrite. CI
    never runs `scripts/deploy-check.ps1`, and that script only checks that
    the file exists -- a `vercel.json` holding headers and no rewrite passes
    it. The build, the deploy and the health gate all stay green while every
    share link 404s.

    These checks read repository files only. They start no server and make
    no request.
    """

    #: One representative path per deep link the app hands out. The ids are
    #: arbitrary; only their shape matters to the rewrite.
    DEEP_LINKS = (
        "/",
        "/p/1f3b8c40-52f7-4a1b-9c6d-0e7a5b2d84c9",
        "/editor/1f3b8c40-52f7-4a1b-9c6d-0e7a5b2d84c9",
        "/dashboard",
        "/dashboard/home",
        "/dashboard/projects",
        "/dashboard/settings",
        "/dashboard/templates",
        "/dashboard/prompts",
        "/dashboard/trash",
    )

    #: What the app source must still contain for DEEP_LINKS to be current.
    ROUTE_MARKERS = (
        # App() reads the public share id straight off the pathname.
        r"/^\/p\/([^/]+)/",
        # The editor accepts a shared document the same way.
        r"/^\/editor\/([^/]+)/",
        # A share link is built from the visitor-facing origin and handed out.
        "${window.location.origin}/p/${",
    )

    @classmethod
    def setUpClass(cls):
        cls.config = json.loads(VERCEL_CONFIG.read_text(encoding="utf-8"))
        cls.rewrites = cls.config.get("rewrites", [])
        cls.app_source = FRONTEND_APP_SOURCE.read_text(encoding="utf-8")
        cls.deployment = DEPLOYMENT_DOC.read_text(encoding="utf-8")
        cls.deploy_check = DEPLOY_CHECK_SCRIPT.read_text(encoding="utf-8")

    def destination_for(self, path):
        """The destination Vercel would serve for `path`, or None for a 404."""
        for rewrite in self.rewrites:
            if vercel_source_to_pattern(rewrite["source"]).match(path):
                return rewrite["destination"]
        return None

    def documented_fallback(self):
        match = re.search(r"^spa fallback:(.+)$", self.deployment, re.MULTILINE)
        self.assertIsNotNone(
            match, "docs/DEPLOYMENT.md must declare a 'spa fallback:' line"
        )
        return match.group(1).strip()

    def test_the_source_reader_rejects_the_shapes_it_must_catch(self):
        # A catch-all covers a share link; a narrowed rewrite does not, and
        # that difference is the whole point of the check below it.
        self.assertTrue(vercel_source_to_pattern("/(.*)").match("/p/abc"))
        self.assertIsNone(vercel_source_to_pattern("/dashboard/(.*)").match("/p/abc"))
        self.assertIsNone(vercel_source_to_pattern("/p").match("/p/abc"))
        # A single-segment parameter stops at the slash.
        self.assertTrue(vercel_source_to_pattern("/p/:id").match("/p/abc"))
        self.assertIsNone(vercel_source_to_pattern("/p/:id").match("/p/abc/def"))
        # Unreadable syntax fails loudly instead of matching nothing.
        with self.assertRaises(ValueError):
            vercel_source_to_pattern("/(unbalanced")
        with self.assertRaises(ValueError):
            vercel_source_to_pattern("/dashboard*")

    def test_the_frontend_host_configuration_declares_a_rewrite(self):
        self.assertTrue(
            self.rewrites,
            "frontend/vercel.json must keep the SPA fallback rewrite",
        )
        for rewrite in self.rewrites:
            with self.subTest(rewrite=rewrite):
                self.assertIn("source", rewrite)
                self.assertIn("destination", rewrite)

    def test_every_deep_link_the_app_hands_out_reaches_the_app_shell(self):
        fallback = self.documented_fallback()
        for path in self.DEEP_LINKS:
            with self.subTest(path=path):
                self.assertEqual(
                    self.destination_for(path),
                    fallback,
                    f"a cold load of {path} would 404 instead of loading the app",
                )

    def test_the_deep_link_list_still_matches_the_routes_the_app_declares(self):
        # Keeps DEEP_LINKS from decaying into paths the app has stopped
        # using, which would leave this class passing and empty.
        for marker in self.ROUTE_MARKERS:
            with self.subTest(marker=marker):
                self.assertIn(marker, self.app_source)
        for path in self.DEEP_LINKS:
            if path.startswith("/dashboard/"):
                with self.subTest(path=path):
                    self.assertIn(f"'{path}'", self.app_source)

    def test_the_fallback_destination_is_the_shell_the_build_produces(self):
        fallback = self.documented_fallback()
        self.assertTrue(fallback.startswith("/"), "the destination is site-absolute")
        shell = FRONTEND_DIR / fallback.lstrip("/")
        self.assertEqual(shell, SPA_SHELL)
        self.assertTrue(shell.is_file(), f"{fallback} must exist to be served")
        # Vite rewrites this entry into the hashed bundle at build time; an
        # index.html without it would deploy as a blank page.
        self.assertIn("/src/main.tsx", shell.read_text(encoding="utf-8"))

    def test_the_local_deploy_check_still_names_the_host_configuration(self):
        self.assertIn("vercel.json", self.deploy_check)


EXPORTED_LINE = re.compile(r"^export (?:const|function|type) ", re.MULTILINE)


def ts_exported_string(source, name, source_label):
    """Read a single `export const NAME = '...'` out of a TypeScript module."""
    found = re.findall(
        rf"^export const {re.escape(name)} = '([^']*)'$", source, re.MULTILINE
    )
    if len(found) != 1:
        raise AssertionError(
            f"{source_label} must declare `export const {name}` exactly once,"
            f" found {len(found)}"
        )
    return found[0]


def ts_function_body(source, name, source_label):
    """Read one exported function, ending where the next export begins.

    Brace matching would have to understand the template literals these
    functions return, so the region is delimited by the exports around it.
    """
    opening = re.search(
        rf"^export function {re.escape(name)}\(", source, re.MULTILINE
    )
    if opening is None:
        raise AssertionError(f"{source_label} no longer exports `{name}`")
    following = EXPORTED_LINE.search(source, opening.end())
    end = following.start() if following else len(source)
    return source[opening.start():end]


class ApiOriginIsNeverTheSiteOwnOriginTests(unittest.TestCase):
    """The API origin a release is built with must not be the site's own origin.

    `VITE_API_URL` is inlined at build time, so a wrong value is not
    recoverable at runtime -- and the one wrong value that passes every other
    check is the public origin the site is served from. It is absolute,
    public and HTTPS, so it has to be rejected for what it is rather than for
    its shape.

    It then fails silently past both guards this module already keeps. CORS
    never runs, because same-origin requests are not cross-origin ones, so
    the allowlist is not the mechanism in play at all; and the catch-all
    rewrite proven by `SpaFallbackServesEveryDeepLinkTests` covers `/api/...`
    as readily as a share link, so those calls answer 200 with the app shell.
    `res.ok` is true, and the HTML surfaces later as a JSON parse error that
    points at the backend rather than at the setting that is wrong.

    Nothing compares the two literals: `frontend/src/apiConfig.ts` names the
    site origin to refuse it, `backend/main.py` names the same origin to
    allow it through CORS. This class is what keeps them one origin.

    Reads repository files only. It starts no server and makes no request.
    """

    @classmethod
    def setUpClass(cls):
        cls.api_config = FRONTEND_API_CONFIG.read_text(encoding="utf-8")
        cls.vite_config = VITE_CONFIG.read_text(encoding="utf-8")

    def test_the_frontend_and_the_api_name_the_same_public_origin(self):
        self.assertEqual(
            ts_exported_string(
                self.api_config, "PUBLIC_SITE_ORIGIN", "frontend/src/apiConfig.ts"
            ),
            main.PRODUCTION_ORIGIN,
        )

    def test_the_api_origin_check_still_reads_the_site_origin(self):
        # A constant the check has stopped consulting is dead text, and the
        # frontend suite would go on passing against a stale literal.
        self.assertIn(
            "PUBLIC_SITE_ORIGIN",
            ts_function_body(
                self.api_config,
                "describeApiBaseUrlProblem",
                "frontend/src/apiConfig.ts",
            ),
        )

    def test_the_production_build_still_runs_the_api_origin_check(self):
        # Unwired, the check is a library function no release ever calls and
        # an unusable origin ships as a green build.
        self.assertIn("describeApiBaseUrlProblem", self.vite_config)
        self.assertIn("VITE_API_URL", self.vite_config)

    def test_the_source_readers_reject_the_shapes_they_must_catch(self):
        probe = (
            "export const PUBLIC_SITE_ORIGIN = 'https://example.invalid'\n"
            "export function describeApiBaseUrlProblem(value: string) {\n"
            "  return value === PUBLIC_SITE_ORIGIN ? 'no' : null\n"
            "}\n"
            "export function resolveApiBaseUrl() {\n"
            "  return OTHER_CONSTANT\n"
            "}\n"
        )
        self.assertEqual(
            ts_exported_string(probe, "PUBLIC_SITE_ORIGIN", "probe"),
            "https://example.invalid",
        )
        for absent in ("", "const PUBLIC_SITE_ORIGIN = 'x'\n", probe + probe):
            with self.subTest(source=absent[:24]):
                with self.assertRaises(AssertionError):
                    ts_exported_string(absent, "PUBLIC_SITE_ORIGIN", "probe")
        # The body must stop at the next export, or every constant named
        # anywhere later in the module would satisfy the check above.
        self.assertIn(
            "PUBLIC_SITE_ORIGIN",
            ts_function_body(probe, "describeApiBaseUrlProblem", "probe"),
        )
        self.assertNotIn(
            "PUBLIC_SITE_ORIGIN",
            ts_function_body(probe, "resolveApiBaseUrl", "probe"),
        )
        with self.assertRaises(AssertionError):
            ts_function_body(probe, "missingFunction", "probe")


if __name__ == "__main__":
    unittest.main()


class SupabaseProjectIsGatedAtBuildTimeTests(unittest.TestCase):
    """A bundle is only as good as the Supabase project it names.

    `VITE_SUPABASE_URL` is inlined at build time, so a project that no longer
    exists cannot be corrected at runtime: `supabaseClient.ts` builds a client
    against whatever host was baked in, and `signInWithOAuth` hard-redirects the
    page to `${url}/auth/v1/authorize`. When that host stops resolving the
    visitor lands on a dead navigation and there is nothing left to catch it.

    The deployed bundle is in precisely that state: it names a Supabase project
    that has since been deleted, so sign-in has been broken for every visitor
    while the build, the deploy and this suite all stayed green.
    `frontend/vite.config.ts` now refuses to produce such a bundle.

    Nothing else compares the placeholder that gate rejects with the one
    `.env.example` tells an operator to copy -- the same job
    `ApiOriginIsNeverTheSiteOwnOriginTests` does for the site origin.

    Reads repository files only. It starts no build and makes no request.
    """

    @classmethod
    def setUpClass(cls):
        cls.supabase_config = FRONTEND_SUPABASE_CONFIG.read_text(encoding="utf-8")
        cls.vite_config = VITE_CONFIG.read_text(encoding="utf-8")

    def _declared(self, name):
        match = re.search(rf"export const {name} = '([^']*)'", self.supabase_config)
        self.assertIsNotNone(
            match, f"{name} is no longer declared in frontend/src/supabaseConfig.ts"
        )
        return match.group(1)

    def test_the_rejected_placeholders_are_the_documented_ones(self):
        """Reword `.env.example` and the gate must still reject what it hands out."""
        example = _env_example_values()
        self.assertEqual(
            self._declared("PLACEHOLDER_SUPABASE_URL"),
            example["VITE_SUPABASE_URL"],
        )
        self.assertEqual(
            self._declared("PLACEHOLDER_SUPABASE_ANON_KEY"),
            example["VITE_SUPABASE_ANON_KEY"],
        )

    def test_the_production_build_still_runs_the_supabase_gate(self):
        """The plugin is the whole mechanism; dropping it restores the old failure."""
        self.assertIn("assertUsableSupabaseProject()", self.vite_config)
        for helper in (
            "describeSupabaseUrlProblem",
            "describeSupabaseAnonKeyProblem",
            "probeProjectResponds",
        ):
            with self.subTest(helper=helper):
                self.assertIn(helper, self.vite_config)

    def test_the_reachability_probe_is_scoped_to_a_real_production_deploy(self):
        """CI builds against a fake origin and must not need a live project.

        The probe is the only rule here that touches the network, so it is
        gated on Vercel's own production signal rather than on Vite's mode.
        """
        self.assertIn("VERCEL_ENV", self.vite_config)


class DeployedFrontendNamesItsCommitTests(unittest.TestCase):
    """Nothing on the deployed frontend said which commit produced it.

    An audit of the live site found no commit metadata at all. `x-vercel-id` is
    a per-request routing id, `etag` is a content hash of `index.html`, and
    `/assets/index-<hash>.js` is a content hash of the bundle. Every one of
    them answers "did the bytes change?", which is a different question: two
    commits compiling to identical output are indistinguishable, and no hash
    maps back to a commit without rebuilding candidates until one matches.

    That gap is worse here than on the API. `VITE_*` values are inlined at
    build time, so *which commit is deployed* and *which configuration is baked
    in* are the same question -- and the last incident on this frontend, a
    bundle pinned to a deleted Supabase project, could not even be dated
    afterwards because no deployment identified itself.

    The trap this class exists to hold shut is the SPA rewrite.
    `SpaFallbackServesEveryDeepLinkTests` above proves every unknown path
    resolves to the shell; the consequence is that `/version.json` returns
    **200 with HTML** on any deployment built before this feature. Status is
    therefore not evidence, and the published document has to name itself so a
    reader can tell it from the fallback.

    Reads repository files only. It starts no build and makes no request.
    """

    @classmethod
    def setUpClass(cls):
        cls.build_revision = FRONTEND_BUILD_REVISION.read_text(encoding="utf-8")
        cls.vite_config = VITE_CONFIG.read_text(encoding="utf-8")
        cls.deployment = DEPLOYMENT_DOC.read_text(encoding="utf-8")

    def _declared(self, name):
        match = re.search(
            rf"export const {name} = '([^']*)'", self.build_revision
        )
        self.assertIsNotNone(
            match, f"{name} is no longer declared in frontend/src/buildRevision.ts"
        )
        return match.group(1)

    def _plugin_body(self, name):
        """The source of one plugin factory, up to the next top-level `function`.

        Several plugins share this file and legitimately make different
        environment decisions, so a check written against the whole config
        cannot say which one it is talking about.
        """
        marker = f"function {name}("
        self.assertIn(marker, self.vite_config, f"{name} is no longer declared")
        body = self.vite_config.split(marker, 1)[1]
        return body.split("\nfunction ")[0].split("\nexport default")[0]

    def _registered_plugins(self):
        """Plugins actually passed to `defineConfig`, not merely defined.

        Read out of the `plugins:` array specifically. Searching the whole file
        for `publishBuildRevision()` cannot tell a registered plugin from an
        orphaned one, because the substring also occurs in the declaration
        `function publishBuildRevision(): Plugin` -- so deleting the array entry
        leaves the build publishing nothing while the check still passes. That
        is the exact vacuous pass this repository's other contract tests are
        written to avoid.
        """
        match = re.search(r"plugins:\s*\[(.*?)\]", self.vite_config, re.DOTALL)
        self.assertIsNotNone(match, "frontend/vite.config.ts declares no plugins array")
        return {name for name in re.findall(r"(\w+)\(\)", match.group(1))}

    def test_the_production_build_still_publishes_the_revision(self):
        """The plugin is the whole mechanism; dropping it restores the old silence."""
        self.assertIn("publishBuildRevision", self._registered_plugins())
        for helper in ("buildRevisionDocument", "resolveBuildRevision"):
            with self.subTest(helper=helper):
                self.assertIn(helper, self.vite_config)

    def test_the_publishing_rule_has_one_definition(self):
        """Which builds publish, and which fail, is decided in exactly one place.

        It was previously split between the plugin hook and a paragraph of
        prose, and the two disagreed: the prose said previews publish `null`,
        while the code published the SHA on any build that had one -- and Vercel
        sets the SHA on previews, so previews published it. A rule stated twice
        is a rule that drifts, so the hook now carries no policy of its own.
        """
        self.assertIn("resolveBuildRevision", self.build_revision)
        for helper in ("commitShaOrNull", "describeBuildRevisionProblem"):
            with self.subTest(helper=helper):
                self.assertIn(helper, self.build_revision)
        # Scoped to this plugin's own body. The Supabase gate legitimately
        # carries its own `VERCEL_ENV !== 'production'` guard -- a check written
        # against the whole file would read that as a violation and pressure a
        # later edit into deleting a gate this one has nothing to do with.
        self.assertNotIn("VERCEL", self._plugin_body("publishBuildRevision"))

    def test_the_supabase_gate_keeps_its_own_production_guard(self):
        """Guards the neighbour the check above had to be narrowed around.

        Its reachability probe is the only rule that touches the network, so it
        is scoped to a real production deploy; losing that guard would make CI
        and every preview depend on a live third party.
        """
        supabase = self._plugin_body("assertUsableSupabaseProject")
        self.assertIn("VERCEL_ENV", supabase)
        self.assertIn("probeProjectResponds", supabase)

    def test_the_runbook_states_the_preview_behaviour_the_build_has(self):
        """The documentation drifted from the build once; this is the anchor.

        An independent build with `VERCEL_ENV=preview` and a real SHA emitted
        both the document and the meta tag while the runbook said previews emit
        `null`. Publishing is not gated on the environment -- only strictness
        is -- and the runbook has to say so.
        """
        self.assertIn('Vercel preview', self.deployment)
        self.assertNotIn('`revision` is `null` on CI, preview', self.deployment)

    def test_the_runbook_names_the_setting_the_production_gate_depends_on(self):
        """The gate is opt-in, and a reader has to be told where it can not hold.

        Vercel's system environment variables are enabled by a project setting.
        With it off, `VERCEL_ENV` is hidden too, so a production build is
        indistinguishable from a local one and the strict branch cannot fire.
        Nothing in a build can close that; naming the symptom is what does.
        """
        self.assertIn('System Environment Variables', self.deployment)
        self.assertIn('"revision": null', self.deployment)

    def test_the_other_build_gates_are_still_registered_too(self):
        """Guards the guard, and the neighbours it shares a mechanism with.

        All three gates live or die by the same array. Asserting the set here
        means removing any one of them fails a test that says so, rather than
        only the one whose own check happens to look at the array.
        """
        self.assertEqual(
            self._registered_plugins()
            & {
                "assertUsableApiBaseUrl",
                "assertUsableSupabaseProject",
                "publishBuildRevision",
            },
            {
                "assertUsableApiBaseUrl",
                "assertUsableSupabaseProject",
                "publishBuildRevision",
            },
        )

    @staticmethod
    def _without_comments(source):
        """`source` with block and line comments removed.

        The check below is about what the build *reads*, not about what the
        files discuss: both modules name the excluded variables in prose,
        explaining why they are excluded, and that documentation is the reason
        the exclusion survives a rewrite.
        """
        source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
        return re.sub(r"//.*", "", source)

    def test_only_the_commit_sha_variable_is_read(self):
        """The neighbouring Vercel variables are the ones reached for by mistake.

        `VERCEL_GIT_COMMIT_MESSAGE` carries arbitrary text a committer wrote,
        `VERCEL_GIT_COMMIT_REF` a branch name, and `VERCEL_URL` an internal
        deployment host. The document this build publishes is public, so the
        only variable the code may touch is the SHA -- plus `VERCEL_ENV`, which
        selects the strictness and is never published.
        """
        self.assertEqual(self._declared("REVISION_ENV_VAR"), "VERCEL_GIT_COMMIT_SHA")
        code = self._without_comments(self.build_revision) + self._without_comments(
            self.vite_config
        )
        # `*_ENV_VAR` identifiers are the constants that *name* these variables,
        # not further variables being read.
        referenced = {
            name
            for name in re.findall(r"\bVERCEL[A-Z_]*\b", code)
            if not name.endswith("_ENV_VAR")
        }
        self.assertEqual(
            referenced,
            {"VERCEL_GIT_COMMIT_SHA", "VERCEL_ENV", "VERCEL"},
            "the build reads a Vercel variable beyond the commit SHA, the "
            "environment selector, and the flag saying those were exposed",
        )

    def test_the_build_only_fails_on_a_real_production_deploy(self):
        """An observability field must not be able to break CI or a preview.

        On Vercel a git-triggered production deployment always carries the SHA,
        so its absence *there* means the build did not come from a commit --
        the exact thing being made visible. Everywhere else the revision is
        null and the build proceeds.
        """
        self.assertIn("VERCEL_ENV", self.vite_config)

    def test_the_published_document_names_the_artifact_the_doc_tells_you_to_check(self):
        """The rewrite makes this the whole check, so the two must not drift.

        An operator following `docs/DEPLOYMENT.md` greps for this exact string.
        Rename it in one place and the documented probe silently starts
        reporting "the deploy has not landed" for a healthy deployment.
        """
        artifact = self._declared("BUILD_ARTIFACT_NAME")
        self.assertTrue(artifact, "the published document no longer names an artifact")
        self.assertIn(artifact, self.deployment)

    def test_the_documented_probe_does_not_trust_the_status_code(self):
        """Reading only the status is the mistake this site invites.

        Every unknown path answers 200 with the app shell, so `curl -f` alone
        succeeds against a deployment that publishes no revision at all. The
        runbook has to check the payload, and say why.
        """
        self.assertIn("version.json", self.deployment)
        self.assertIn("status code", self.deployment)

    def test_the_rollback_runbook_reads_the_revision_before_and_after(self):
        """A rollback nobody can confirm is a rollback nobody can trust.

        The site answers 200 whether or not the alias actually moved, so the
        published revision is the only signal that distinguishes a completed
        rollback from one that silently did nothing -- and recording the bad
        revision first is what makes the incident datable at all.
        """
        rollback = self.deployment.split("## 7. Rollback", 1)
        self.assertEqual(len(rollback), 2, "docs/DEPLOYMENT.md has no rollback section")
        section = rollback[1].split("\n## ", 1)[0]
        self.assertIn("version.json", section)
        self.assertIn("Instant Rollback", section)
        # Promoting an older artifact restores the configuration inlined into
        # it, which is the one way a frontend rollback surprises an operator.
        self.assertIn("VITE_SUPABASE_URL", section)
