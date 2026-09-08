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
// build time, from its own record of the commit. That is the value published
// here, and it is the only one this module reads.
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

/** Vercel sets this per deployment, from its own commit record. The only variable read. */
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
