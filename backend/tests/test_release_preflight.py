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
VITE_CONFIG = FRONTEND_DIR / "vite.config.ts"

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
