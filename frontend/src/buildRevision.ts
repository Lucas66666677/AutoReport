// Which commit produced the bundle a visitor is running.
//
// Today: nothing says. An audit of the deployed frontend found no commit
// metadata anywhere on it. `x-vercel-id` is a per-request routing id, `etag` is
// a content hash of `index.html`, and `/assets/index-<hash>.js` is a content
// hash of the bundle. All three answer "did the bytes change?", which is not
// the same question -- two different commits that compile to identical output
// produce identical hashes, and no hash can be mapped back to a commit without
// rebuilding candidates until one matches.
//
// That matters more here than for the API. `VITE_*` values are inlined at build
// time, so "which commit is deployed" and "which configuration is baked in" are
// the same question, and the last incident on this frontend -- a bundle pinned
// to a deleted Supabase project -- was invisible partly because there was no way
// to say which build was serving.
//
// Vercel sets `VERCEL_GIT_COMMIT_SHA` on every git-triggered deployment, at
// build time, from its own record of the commit. That is the only value
// published here; `VERCEL` and `VERCEL_ENV` are also read to decide whether a
// missing revision must fail the build.
//
// ## Why the document names itself
//
// `frontend/vercel.json` rewrites `/(.*)` to `/index.html`, so **an unknown
// path does not 404** -- it returns 200 with the app shell. A probe of
// `/version.json` against a deployment built before this file existed therefore
// answers `200 text/html`, and a check that reads only the status code would
// call that a success. (Verified against the live site: `/version.json` and
// `/definitely-not-a-real-path-xyz123` both return 200 with
// `content-disposition: inline; filename="index.html"`.)
//
// So status is not evidence and the payload has to be self-identifying.
// `readBuildRevision` accepts the document only when it names this artifact,
// which the app shell cannot do by accident. `BUILD_ARTIFACT_NAME` is a literal
// in this repository, not configuration.
//
// ## What may be published
//
// The route is public, so only a commit SHA may ever leave here: 7-40
// hexadecimal characters, anchored, lowercased. Every other `VERCEL_*` and
// `VITE_*` value is deliberately out of reach -- `VERCEL_GIT_COMMIT_MESSAGE`
// carries arbitrary text, `VERCEL_URL` names internal deployment hosts, and the
// `VITE_SUPABASE_*` pair is configuration this repository already has a
// dedicated gate for. A rejected value is never echoed in a message, because
// the reason to reject it is that it might not be a SHA.

/** Vercel sets this per deployment, from its own commit record. */
export const REVISION_ENV_VAR = 'VERCEL_GIT_COMMIT_SHA'

/** Where the emitted document is served from, relative to the site root. */
export const BUILD_REVISION_PATH = 'version.json'

/**
 * Names the artifact the document describes.
 *
 * Load-bearing rather than decorative: the SPA rewrite answers every unknown
 * path with the app shell, so "did I get the document or the fallback?" cannot
 * be read off the status code. This is what a reader checks instead.
 */
export const BUILD_ARTIFACT_NAME = 'autolabreport-frontend'

/** The `<meta name="...">` carrying the same revision inside `index.html`. */
export const BUILD_REVISION_META_NAME = 'build-revision'

/**
 * A commit SHA and nothing that is not one.
 *
 * Seven is git's own abbreviation floor; forty is a full SHA-1. Anchored at
 * both ends, because an unanchored pattern would find a SHA inside a longer
 * string and publish a value the platform never set -- a confident wrong
 * answer, which is worse than none.
 */
const COMMIT_SHA = /^[0-9a-fA-F]{7,40}$/

/** `value` as a normalized commit SHA, or `null` when it is not one. */
export function commitShaOrNull(value: string | undefined | null): string | null {
  const candidate = (value ?? '').trim()
  if (!COMMIT_SHA.test(candidate)) {
    return null
  }
  return candidate.toLowerCase()
}

/**
 * Why `value` cannot be published as this build's revision, or `null` when it can.
 *
 * The message describes the shape of the problem and never repeats the value:
 * a variable holding the wrong thing may be holding a secret, and this string
 * reaches build logs.
 */
export function describeBuildRevisionProblem(value: string | undefined | null): string | null {
  const raw = (value ?? '').trim()
  if (!raw) {
    return `${REVISION_ENV_VAR} is empty or unset`
  }
  if (!COMMIT_SHA.test(raw)) {
    return (
      `${REVISION_ENV_VAR} is not a commit SHA ` +
      `(${raw.length} characters, expected 7-40 hexadecimal)`
    )
  }
  return null
}

/** Set to `1` by Vercel *only when* system environment variables are exposed. */
export const VERCEL_FLAG_ENV_VAR = 'VERCEL'

/** `production`, `preview` or `development`. Exposed by the same setting. */
export const VERCEL_ENVIRONMENT_ENV_VAR = 'VERCEL_ENV'

export type BuildEnvironment = {
  VERCEL?: string
  VERCEL_ENV?: string
  VERCEL_GIT_COMMIT_SHA?: string
}

export type RevisionDecision = {
  /** What the build should publish. */
  revision: string | null
  /** Why the build must fail instead, or `null` to proceed. */
  problem: string | null
}

/**
 * What a build should publish, and whether it may proceed without a revision.
 *
 * One function so the rule has one statement. It was previously spread between
 * a plugin hook and a paragraph of prose, and the two disagreed: the prose said
 * previews publish `null`, while the code published the SHA on any build that
 * had one -- previews included, because Vercel sets it there too.
 *
 * The rule, stated once:
 *
 * | `VERCEL` | `VERCEL_ENV` | SHA present | Result |
 * | --- | --- | --- | --- |
 * | any | any | yes | publish it |
 * | `1` | `production` | no | **fail the build** |
 * | `1` | anything else | no | publish `null` |
 * | `1` | absent | no | **fail the build** -- see below |
 * | unset | any | no | publish `null` |
 *
 * Publishing is not gated on the environment. A preview is precisely where
 * knowing which commit you are looking at is useful, the value is a commit SHA
 * of a public repository, and this project's previews are behind deployment
 * protection anyway. Only *strictness* is gated: a production deployment that
 * cannot name its commit is the failure this feature exists to prevent, while
 * CI, previews and local builds must never be broken by an observability
 * field.
 *
 * ## The limit of this gate, stated rather than assumed
 *
 * System environment variables on Vercel are **opt-in**: the dashboard carries
 * an "Automatically expose System Environment Variables" checkbox, and `VERCEL=1`
 * is documented as "an indicator to show that system environment variables have
 * been exposed to your project's Deployments".
 *
 * With that setting off, `VERCEL_ENV` is absent too -- so a *production* build
 * is indistinguishable from a local one, and the strict branch cannot fire. The
 * build then publishes `null` and succeeds. Nothing in a build can close that,
 * because with system variables hidden there is no signal that says Vercel at
 * all; what closes it is the observable symptom, which `docs/DEPLOYMENT.md`
 * names: a *production* URL answering `{"revision": null}` means either the
 * checkbox is off or the deployment did not come from a commit.
 *
 * The one partial state that *is* detectable is handled: `VERCEL` exposed while
 * `VERCEL_ENV` is not. The two are exposed by the same setting, so that
 * combination should not occur -- and if it ever did, assuming it is safe would
 * be assuming the environment is not production. It fails instead.
 */
export function resolveBuildRevision(env: BuildEnvironment): RevisionDecision {
  const revision = commitShaOrNull(env.VERCEL_GIT_COMMIT_SHA)
  if (revision) {
    return { revision, problem: null }
  }

  const systemVariablesExposed = Boolean(env.VERCEL)
  if (!systemVariablesExposed) {
    return { revision: null, problem: null }
  }

  const environment = (env.VERCEL_ENV ?? '').trim()
  if (!environment) {
    return {
      revision: null,
      problem:
        `${VERCEL_FLAG_ENV_VAR} is set but ${VERCEL_ENVIRONMENT_ENV_VAR} is not, so which ` +
        'environment this build targets cannot be determined',
    }
  }
  if (environment !== 'production') {
    return { revision: null, problem: null }
  }

  return { revision: null, problem: describeBuildRevisionProblem(env.VERCEL_GIT_COMMIT_SHA) }
}

export type BuildRevisionDocument = {
  artifact: string
  revision: string | null
}

/**
 * The exact bytes written to `version.json`.
 *
 * Serialized here rather than by the caller so the published shape is fixed in
 * one place, and so `readBuildRevision` below can be tested against precisely
 * what a deployment serves.
 */
export function buildRevisionDocument(revision: string | null): string {
  const document: BuildRevisionDocument = {
    artifact: BUILD_ARTIFACT_NAME,
    revision: commitShaOrNull(revision),
  }
  return `${JSON.stringify(document)}\n`
}

/**
 * The revision named by a fetched `version.json` body, or `null`.
 *
 * `null` covers every way a probe can fail to establish a revision, and they
 * are deliberately not told apart: the app shell served by the SPA rewrite,
 * some other artifact's document, malformed JSON, and a document whose revision
 * is absent or is not a SHA. None of them is evidence about which commit is
 * deployed, and treating any of them as a partial answer is how a wrong one
 * gets believed.
 */
export function readBuildRevision(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // The SPA fallback lands here: `index.html` is not JSON.
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const document = parsed as Partial<BuildRevisionDocument>
  if (document.artifact !== BUILD_ARTIFACT_NAME) {
    return null
  }
  return commitShaOrNull(document.revision)
}
