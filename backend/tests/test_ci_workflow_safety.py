"""Workflow safety invariants for the CI definition itself.

The release-preflight job carries a comment claiming it is "secret-free by
construction". Nothing checked that the claim stayed true. These tests read
`.github/workflows/*.yml` as text and assert the properties a reviewer would
otherwise have to re-verify by eye on every workflow edit:

* CI never reads a repository secret and never runs untrusted code with a
  writable token.
* Every job is bounded, so a hung step fails in minutes instead of holding a
  runner for the six hour default.
* Every action is pinned to a ref that cannot be moved under us.
* The checkout token is not left behind in `.git/config` for later steps.

Parsing is deliberately dependency-free: the workflow is authored in this
repository, so a small indentation reader is enough and CI gains no new
package to install.
"""

import re
import unittest
from pathlib import Path

# Derived from this file rather than from `main`, so the guard needs no
# backend dependency installed to run.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = BACKEND_ROOT.parent
WORKFLOW_DIRECTORY = REPOSITORY_ROOT / ".github" / "workflows"

# Long enough for a cold npm install and a Vite build, short enough that a
# wedged step is a fast failure rather than an idle runner.
MAXIMUM_JOB_MINUTES = 30

# `owner/repo@v4` or a full commit SHA. A branch ref such as `@main` moves
# under us and is how a compromised action arrives.
PINNED_ACTION = re.compile(
    r"^[\w.-]+/[\w.-]+(?:/[\w.-]+)*@(?:v\d+(?:\.\d+)*|[0-9a-f]{40})$"
)
SECRET_REFERENCE = re.compile(r"\$\{\{\s*secrets\.")


def _blocks(lines, indent):
    """Yield `(key, body_lines)` for each `key:` at exactly `indent` columns.

    `body_lines` includes the `key:` line and everything nested beneath it.
    Blank lines and comments are dropped so a comment cannot be mistaken for
    a declared value.
    """
    header = re.compile(rf"^ {{{indent}}}([A-Za-z_][\w-]*):")
    key = None
    body = []
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = header.match(line)
        if match:
            if key is not None:
                yield key, body
            key, body = match.group(1), [line]
        elif key is not None:
            body.append(line)
    if key is not None:
        yield key, body


def _steps(job_body):
    """Yield the lines belonging to each `- ...` step in a job body."""
    step = None
    for line in job_body:
        if re.match(r"^ +- ", line):
            if step is not None:
                yield step
            step = [line]
        elif step is not None:
            step.append(line)
    if step is not None:
        yield step


class Workflow:
    """A workflow file, read as text rather than as parsed YAML."""

    def __init__(self, path):
        self.path = path
        self.name = path.relative_to(REPOSITORY_ROOT).as_posix()
        self.text = path.read_text(encoding="utf-8")
        self.lines = self.text.splitlines()
        self.top_level = dict(_blocks(self.lines, 0))
        self.jobs_region = self.top_level.get("jobs", [])[1:]
        self.jobs = dict(_blocks(self.jobs_region, 2))

    def setting(self, body, key):
        """Return the scalar value of `key:` anywhere inside `body`."""
        for line in body:
            match = re.match(rf"^\s*{re.escape(key)}:\s*(.*?)\s*$", line)
            if match:
                return match.group(1)
        return None


def discovered_workflows():
    return sorted(WORKFLOW_DIRECTORY.glob("*.yml")) + sorted(
        WORKFLOW_DIRECTORY.glob("*.yaml")
    )


WORKFLOWS = [Workflow(path) for path in discovered_workflows()]


def ci_workflow():
    return next(
        workflow for workflow in WORKFLOWS if workflow.name.endswith("/ci.yml")
    )


class WorkflowDiscoveryTests(unittest.TestCase):
    """Guard the reader, so a parser regression cannot fake a green run."""

    def test_the_ci_workflow_is_present_and_parsed(self):
        self.assertTrue(WORKFLOWS, "no workflow found under .github/workflows")
        self.assertIn(".github/workflows/ci.yml", {w.name for w in WORKFLOWS})
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                self.assertTrue(workflow.jobs, "no jobs parsed")
                self.assertIn("on", workflow.top_level)

    def test_the_reader_finds_exactly_the_declared_jobs(self):
        for workflow in WORKFLOWS:
            declared = {
                line.strip().rstrip(":")
                for line in workflow.jobs_region
                if re.match(r"^  [A-Za-z_][\w-]*:$", line)
            }
            with self.subTest(workflow=workflow.name):
                self.assertEqual(set(workflow.jobs), declared)

    def test_each_job_body_stops_at_the_next_job(self):
        for workflow in WORKFLOWS:
            for name, body in workflow.jobs.items():
                with self.subTest(workflow=workflow.name, job=name):
                    self.assertTrue(body[0].startswith(f"  {name}:"))
                    others = set(workflow.jobs) - {name}
                    for line in body[1:]:
                        self.assertNotIn(line.strip().rstrip(":"), others)


class CiRunsWithoutCredentialsTests(unittest.TestCase):
    def test_no_workflow_reads_a_repository_secret(self):
        # Keeping CI secret-free is what makes it safe to run on any pull
        # request, and it is the claim the release-preflight job advertises.
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                match = SECRET_REFERENCE.search(workflow.text)
                self.assertIsNone(
                    match,
                    f"{workflow.name} reads a secret: {match.group(0) if match else ''}",
                )

    def test_no_job_declares_a_deployment_environment(self):
        # An `environment:` is how secrets and deploy approvals reach a job.
        for workflow in WORKFLOWS:
            for name, body in workflow.jobs.items():
                with self.subTest(workflow=workflow.name, job=name):
                    self.assertIsNone(workflow.setting(body, "environment"))

    def test_no_workflow_runs_untrusted_code_with_a_writable_token(self):
        # `pull_request_target` runs with a writable token while checking out
        # a fork's code -- the classic CI takeover.
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                triggers = "\n".join(workflow.top_level.get("on", []))
                self.assertNotIn("pull_request_target", triggers)

    def test_the_workflow_token_is_read_only(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                permissions = workflow.top_level.get("permissions")
                self.assertIsNotNone(
                    permissions, f"{workflow.name} must declare `permissions:`"
                )
                granted = [line.strip() for line in permissions[1:] if line.strip()]
                self.assertEqual(granted, ["contents: read"])

    def test_no_job_widens_the_token_beyond_the_workflow_default(self):
        for workflow in WORKFLOWS:
            for name, body in workflow.jobs.items():
                with self.subTest(workflow=workflow.name, job=name):
                    scoped = dict(_blocks([line[2:] for line in body[1:]], 2))
                    for line in scoped.get("permissions", []):
                        self.assertNotIn("write", line)


class EveryJobIsBoundedTests(unittest.TestCase):
    def test_every_job_declares_a_timeout(self):
        for workflow in WORKFLOWS:
            for name, body in workflow.jobs.items():
                with self.subTest(workflow=workflow.name, job=name):
                    declared = workflow.setting(body, "timeout-minutes")
                    self.assertIsNotNone(
                        declared,
                        f"job `{name}` has no timeout-minutes, so a hung step "
                        "holds a runner for the six hour default",
                    )
                    minutes = int(declared)
                    self.assertGreater(minutes, 0)
                    self.assertLessEqual(minutes, MAXIMUM_JOB_MINUTES)

    def test_superseded_runs_are_cancelled_per_ref(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                concurrency = workflow.top_level.get("concurrency")
                self.assertIsNotNone(
                    concurrency, f"{workflow.name} must declare `concurrency:`"
                )
                group = workflow.setting(concurrency, "group")
                self.assertIsNotNone(group, "concurrency needs a `group:`")
                # Scoped per ref: one branch's pushes must not cancel another's.
                self.assertIn("github.ref", group)
                self.assertEqual(
                    workflow.setting(concurrency, "cancel-in-progress"), "true"
                )


class ActionsArePinnedTests(unittest.TestCase):
    def used_actions(self):
        for workflow in WORKFLOWS:
            for name, body in workflow.jobs.items():
                for line in body:
                    match = re.match(r"^\s*-?\s*uses:\s*(\S+)", line)
                    if match:
                        yield workflow.name, name, match.group(1)

    def test_every_action_is_pinned_to_an_immutable_ref(self):
        seen = 0
        for workflow_name, job_name, reference in self.used_actions():
            seen += 1
            with self.subTest(workflow=workflow_name, job=job_name, uses=reference):
                self.assertRegex(reference, PINNED_ACTION)
        self.assertGreater(seen, 0, "no `uses:` step found -- reader regression")

    def test_the_pin_pattern_rejects_a_moving_ref(self):
        for moving in (
            "actions/checkout@main",
            "actions/checkout@master",
            "actions/checkout",
            "actions/checkout@v4-beta",
        ):
            with self.subTest(uses=moving):
                self.assertNotRegex(moving, PINNED_ACTION)
        for pinned in ("actions/checkout@v4", "actions/setup-node@v4.1.0"):
            with self.subTest(uses=pinned):
                self.assertRegex(pinned, PINNED_ACTION)

    def test_checkout_does_not_leave_the_job_token_in_the_git_config(self):
        # Without this, every later step in the job can push with the token.
        checkouts = 0
        for workflow in WORKFLOWS:
            for name, body in workflow.jobs.items():
                for step in _steps(body):
                    text = "\n".join(step)
                    if "uses: actions/checkout@" not in text:
                        continue
                    checkouts += 1
                    with self.subTest(workflow=workflow.name, job=name):
                        self.assertIn("persist-credentials: false", text)
        self.assertGreater(checkouts, 0, "no checkout step found -- reader regression")


class SafetyGuardsRunInCiTests(unittest.TestCase):
    def test_this_module_is_executed_by_the_backend_job(self):
        # These invariants are only worth something if CI runs them. The
        # backend job discovers `backend/tests`, where this module lives.
        backend = "\n".join(ci_workflow().jobs["backend"])
        self.assertIn("python -m unittest discover -s tests", backend)
        self.assertIn("working-directory: backend", backend)
        self.assertEqual(Path(__file__).resolve().parent.name, "tests")
        self.assertEqual(BACKEND_ROOT, REPOSITORY_ROOT / "backend")
        # Confirms the derived root is the repository and not a parent of it.
        self.assertTrue((BACKEND_ROOT / "main.py").is_file())

    def test_the_release_preflight_job_still_runs_the_preflight_suite(self):
        ci = ci_workflow()
        self.assertIn("release-preflight", ci.jobs)
        self.assertIn(
            "python -m unittest tests.test_release_preflight",
            "\n".join(ci.jobs["release-preflight"]),
        )


if __name__ == "__main__":
    unittest.main()
