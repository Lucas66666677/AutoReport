import { describe, expect, it } from 'vitest'
import {
  BUILD_ARTIFACT_NAME,
  BUILD_REVISION_PATH,
  REVISION_ENV_VAR,
  VERCEL_ENVIRONMENT_ENV_VAR,
  VERCEL_FLAG_ENV_VAR,
  buildRevisionDocument,
  commitShaOrNull,
  describeBuildRevisionProblem,
  readBuildRevision,
  resolveBuildRevision,
} from './buildRevision'

/** A real 40-character SHA-1, in the shape Vercel injects. */
const A_COMMIT_SHA = 'b10ee82f4c73a190d5e28b6c41fa07d93e5b8c24'

/**
 * The app shell, as the deployed site actually returns it for an unknown path.
 *
 * This is the response a probe gets from any deployment built before
 * `version.json` existed, because `vercel.json` rewrites `/(.*)` to
 * `/index.html` -- with status 200, not 404. Verified against the live site.
 */
const SPA_FALLBACK_HTML = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <title>AutoLabReport</title>
    <script type="module" crossorigin src="/assets/index-Do_8bRY5.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

/**
 * What a build-time variable holds when it is not a commit SHA.
 *
 * Every one is truthy, so a presence check would publish all of them. The
 * Supabase pair is this repository's own configuration, and the branch name and
 * commit message are the neighbouring `VERCEL_GIT_*` variables -- the ones most
 * likely to be reached for by mistake, and the reason only the SHA is read.
 */
const NOT_A_COMMIT_SHA = [
  'https://xddzdpmjgptvvpprnchp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.9f7Qn0',
  'your-supabase-anon-key',
  'VERCEL_GIT_COMMIT_SHA=b10ee82',
  'refs/heads/main',
  'main',
  'fix(frontend): bump the icons vendor chunk',
  'auto-report-one.vercel.app',
  'v0.1.0',
  'unknown',
  '',
  '   ',
]

describe('commitShaOrNull', () => {
  it('accepts a full commit SHA', () => {
    // Guards the guard: without this, a parser that returned null for every
    // input would satisfy every rejection below.
    expect(commitShaOrNull(A_COMMIT_SHA)).toBe(A_COMMIT_SHA)
  })

  it('accepts an abbreviated SHA at git’s own floor', () => {
    expect(commitShaOrNull(A_COMMIT_SHA.slice(0, 7))).toBe(A_COMMIT_SHA.slice(0, 7))
  })

  it('normalizes case and surrounding whitespace to one published form', () => {
    // Two probes of one deployment must not be able to disagree.
    expect(commitShaOrNull(`  ${A_COMMIT_SHA.toUpperCase()}\n`)).toBe(A_COMMIT_SHA)
  })

  it.each(NOT_A_COMMIT_SHA)('refuses to publish %j', (value) => {
    expect(commitShaOrNull(value)).toBeNull()
  })

  it.each([
    ['too short', A_COMMIT_SHA.slice(0, 6)],
    ['too long', `${A_COMMIT_SHA}0`],
    ['a non-hex character', `${A_COMMIT_SHA.slice(0, -1)}g`],
    ['an embedded space', `${A_COMMIT_SHA.slice(0, 20)} ${A_COMMIT_SHA.slice(21)}`],
  ])('rejects a near miss: %s', (_label, value) => {
    // "too long" is the case that matters: an unanchored pattern matches the
    // leading 40 characters and publishes a value the platform never set.
    expect(commitShaOrNull(value)).toBeNull()
  })

  it.each([undefined, null])('treats %s as no revision', (value) => {
    expect(commitShaOrNull(value)).toBeNull()
  })
})

describe('describeBuildRevisionProblem', () => {
  it('reports no problem for a real SHA', () => {
    expect(describeBuildRevisionProblem(A_COMMIT_SHA)).toBeNull()
  })

  it('names the variable an operator has to look at', () => {
    expect(describeBuildRevisionProblem(undefined)).toContain(REVISION_ENV_VAR)
  })

  it.each(NOT_A_COMMIT_SHA.filter((value) => value.trim()))(
    'never repeats the rejected value %j',
    (value) => {
      // The message reaches build logs. A variable holding the wrong thing may
      // be holding a secret, so the shape is reported and the value is not.
      const problem = describeBuildRevisionProblem(value)
      expect(problem).not.toBeNull()
      expect(problem).not.toContain(value)
    },
  )

  it('reports length rather than content for a non-SHA', () => {
    expect(describeBuildRevisionProblem('refs/heads/main')).toContain('15 characters')
  })
})

describe('buildRevisionDocument', () => {
  it('publishes the revision and the artifact name, and nothing else', () => {
    // The key set is pinned because this file is public: the next
    // useful-sounding addition -- the branch, the deploy URL, the environment
    // -- would be configuration served to anyone who asks.
    expect(JSON.parse(buildRevisionDocument(A_COMMIT_SHA))).toEqual({
      artifact: BUILD_ARTIFACT_NAME,
      revision: A_COMMIT_SHA,
    })
  })

  it('emits stable bytes', () => {
    expect(buildRevisionDocument(A_COMMIT_SHA)).toBe(
      `{"artifact":"${BUILD_ARTIFACT_NAME}","revision":"${A_COMMIT_SHA}"}\n`,
    )
  })

  it('publishes a null revision rather than omitting the field', () => {
    // CI, previews and local builds land here. The document still exists and
    // still names the artifact, so a probe can tell "this build publishes a
    // revision and has none" apart from "this build predates the file".
    expect(JSON.parse(buildRevisionDocument(null))).toEqual({
      artifact: BUILD_ARTIFACT_NAME,
      revision: null,
    })
  })

  it.each(NOT_A_COMMIT_SHA)('cannot be made to publish %j', (value) => {
    expect(JSON.parse(buildRevisionDocument(value)).revision).toBeNull()
  })
})

describe('resolveBuildRevision', () => {
  // The rule this file exists to pin down. It was previously split between a
  // plugin hook and a paragraph of prose that disagreed with it: the prose said
  // previews publish null, while the code published the SHA on any build that
  // had one. Vercel sets the SHA on previews, so previews published it.

  describe('publishing is not gated on the environment', () => {
    it.each([
      ['a production deployment', { VERCEL: '1', VERCEL_ENV: 'production' }],
      ['a preview deployment', { VERCEL: '1', VERCEL_ENV: 'preview' }],
      ['a development deployment', { VERCEL: '1', VERCEL_ENV: 'development' }],
      ['a build outside Vercel with the SHA supplied', {}],
    ])('publishes the commit on %s', (_label, env) => {
      expect(resolveBuildRevision({ ...env, VERCEL_GIT_COMMIT_SHA: A_COMMIT_SHA })).toEqual({
        revision: A_COMMIT_SHA,
        problem: null,
      })
    })

    it('publishes the commit on a preview, which is what the runbook now says', () => {
      // The exact case an independent build caught the documentation getting
      // wrong. A preview is where knowing which commit you are looking at is
      // most useful, and this project's previews are behind deployment
      // protection, so there is nothing to withhold.
      const decision = resolveBuildRevision({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_SHA: A_COMMIT_SHA,
      })
      expect(decision.revision).toBe(A_COMMIT_SHA)
      expect(decision.problem).toBeNull()
    })

    it.each(NOT_A_COMMIT_SHA)('refuses to publish %j even on a preview', (value) => {
      const decision = resolveBuildRevision({
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_SHA: value,
      })
      expect(decision.revision).toBeNull()
      // A preview must not fail on it either: strictness is production-only.
      expect(decision.problem).toBeNull()
    })
  })

  describe('strictness is scoped to production', () => {
    it('fails a production deployment that cannot name its commit', () => {
      const decision = resolveBuildRevision({ VERCEL: '1', VERCEL_ENV: 'production' })
      expect(decision.revision).toBeNull()
      expect(decision.problem).toContain(REVISION_ENV_VAR)
    })

    it('fails a production deployment whose SHA is a branch name', () => {
      const decision = resolveBuildRevision({
        VERCEL: '1',
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_SHA: 'refs/heads/main',
      })
      expect(decision.problem).toContain('not a commit SHA')
      expect(decision.problem).not.toContain('refs/heads/main')
    })

    it.each([
      ['a preview', 'preview'],
      ['a development deployment', 'development'],
      ['a custom environment', 'staging'],
    ])('does not fail %s with no SHA', (_label, environment) => {
      expect(resolveBuildRevision({ VERCEL: '1', VERCEL_ENV: environment })).toEqual({
        revision: null,
        problem: null,
      })
    })

    it('does not fail CI or a local build', () => {
      // No system variables at all: the ordinary case for `npm run build`, and
      // for the CI job that builds against deliberately fake origins.
      expect(resolveBuildRevision({})).toEqual({ revision: null, problem: null })
    })
  })

  describe('the limit of the gate', () => {
    it('cannot fail a production build when system variables are not exposed', () => {
      // Vercel's system environment variables are opt-in, and `VERCEL=1` is
      // documented as the indicator that they were exposed. With the setting
      // off, a production build looks exactly like a local one, so the strict
      // branch cannot fire. Asserted rather than left implicit, because it is
      // the one state where this gate does not hold -- and `docs/DEPLOYMENT.md`
      // names the symptom an operator would see instead.
      expect(resolveBuildRevision({ VERCEL_ENV: 'production' })).toEqual({
        revision: null,
        problem: null,
      })
    })

    it('fails when the system flag is exposed without an environment', () => {
      // The one partial exposure that is detectable. Both variables come from
      // the same setting, so this should not occur -- and treating it as safe
      // would be assuming the environment is not production.
      const decision = resolveBuildRevision({ VERCEL: '1' })
      expect(decision.problem).toContain(VERCEL_ENVIRONMENT_ENV_VAR)
    })

    it('fails when the environment is present but blank', () => {
      expect(resolveBuildRevision({ VERCEL: '1', VERCEL_ENV: '   ' }).problem).toContain(
        VERCEL_ENVIRONMENT_ENV_VAR,
      )
    })

    it('names the setting to check, not just the variable', () => {
      // An operator hitting this needs to know it may be a checkbox, not a
      // broken deploy. The plugin message carries that; this pins the variable
      // names the message is built from.
      expect(VERCEL_FLAG_ENV_VAR).toBe('VERCEL')
      expect(VERCEL_ENVIRONMENT_ENV_VAR).toBe('VERCEL_ENV')
    })
  })
})

describe('readBuildRevision', () => {
  it('round-trips a document this build produced', () => {
    expect(readBuildRevision(buildRevisionDocument(A_COMMIT_SHA))).toBe(A_COMMIT_SHA)
  })

  it('returns null for the SPA fallback that an old deployment serves', () => {
    // The reason the document names itself. `vercel.json` rewrites every
    // unknown path to the app shell *with status 200*, so a probe of
    // `/version.json` against a build made before this file existed succeeds at
    // the HTTP level and returns HTML. Status is not evidence here; this is.
    expect(readBuildRevision(SPA_FALLBACK_HTML)).toBeNull()
  })

  it('returns null for another artifact’s document', () => {
    // The six services in this program publish the same {"revision": ...}
    // shape. Reading one of those as if it described this bundle would be a
    // confident wrong answer.
    expect(
      readBuildRevision(JSON.stringify({ artifact: 'autoreport-api', revision: A_COMMIT_SHA })),
    ).toBeNull()
  })

  it('returns null for a document with no artifact name', () => {
    expect(readBuildRevision(JSON.stringify({ revision: A_COMMIT_SHA }))).toBeNull()
  })

  it.each(['', 'null', '[]', '"a string"', '{"artifact":', 'not json at all'])(
    'returns null for %j',
    (body) => {
      expect(readBuildRevision(body)).toBeNull()
    },
  )

  it('returns null when the document names a revision that is not a SHA', () => {
    // A reader must not relay whatever a document claims: the same whitelist
    // applies on the way out and on the way in.
    expect(
      readBuildRevision(
        JSON.stringify({ artifact: BUILD_ARTIFACT_NAME, revision: 'refs/heads/main' }),
      ),
    ).toBeNull()
  })
})

describe('the published path', () => {
  it('is a plain file at the site root', () => {
    // Served by Vercel's filesystem check, which runs before the rewrite, so
    // the document is reachable despite the catch-all. A leading slash would
    // make Rollup emit it outside the output directory.
    expect(BUILD_REVISION_PATH).toBe('version.json')
  })
})
