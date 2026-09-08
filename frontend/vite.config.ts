import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { describeApiBaseUrlProblem } from './src/apiConfig'
import {
  describeSupabaseAnonKeyProblem,
  describeSupabaseUrlProblem,
  probeProjectResponds,
} from './src/supabaseConfig'
import {
  BUILD_REVISION_META_NAME,
  BUILD_REVISION_PATH,
  buildRevisionDocument,
  resolveBuildRevision,
} from './src/buildRevision'

// VITE_API_URL is inlined at build time. A production bundle built without it
// (or with a leftover localhost value) still builds and deploys fine, and only
// fails once a real visitor loads it. Fail the build instead.
function assertUsableApiBaseUrl(): Plugin {
  return {
    name: 'autoreport:assert-api-base-url',
    config(_config, { command, mode }) {
      if (command !== 'build' || mode !== 'production') {
        return
      }
      const env = loadEnv(mode, process.cwd(), 'VITE_')
      const problem = describeApiBaseUrlProblem(env.VITE_API_URL)
      if (problem) {
        throw new Error(
          [
            `VITE_API_URL is unusable for a production build: ${problem}.`,
            'Set VITE_API_URL to the public HTTPS origin of the backend (see docs/DEPLOYMENT.md).',
          ].join('\n'),
        )
      }
    },
  }
}

// VITE_SUPABASE_URL is inlined the same way, and a wrong value fails even more
// quietly: sign-in hard-redirects the page to `${url}/auth/v1/authorize`, so a
// project that no longer exists produces a dead navigation with nothing to catch.
// The structural checks run on every production build. The reachability probe --
// the one that catches a well-formed URL naming a deleted project, which is what
// actually shipped -- runs only when Vercel is building a production deployment,
// so CI and previews never depend on a live third party.
function assertUsableSupabaseProject(): Plugin {
  let supabaseUrl = ''
  return {
    name: 'autoreport:assert-supabase-project',
    config(_config, { command, mode }) {
      if (command !== 'build' || mode !== 'production') {
        return
      }
      const env = loadEnv(mode, process.cwd(), 'VITE_')
      const urlProblem = describeSupabaseUrlProblem(env.VITE_SUPABASE_URL)
      if (urlProblem) {
        throw new Error(
          [
            `VITE_SUPABASE_URL is unusable for a production build: ${urlProblem}.`,
            'Set it to the project URL from Supabase > Project Settings > API (see docs/DEPLOYMENT.md).',
          ].join('\n'),
        )
      }
      const keyProblem = describeSupabaseAnonKeyProblem(env.VITE_SUPABASE_ANON_KEY)
      if (keyProblem) {
        throw new Error(
          [
            `VITE_SUPABASE_ANON_KEY is unusable for a production build: ${keyProblem}.`,
            'Use the project\'s anon/publishable key -- never the service-role key.',
          ].join('\n'),
        )
      }
      supabaseUrl = (env.VITE_SUPABASE_URL ?? '').trim()
    },
    async buildStart() {
      // Only a real production deploy. CI builds against a deliberately fake
      // origin to exercise the structural gate above, and must not be made to
      // depend on a live Supabase project.
      if (!supabaseUrl || process.env.VERCEL_ENV !== 'production') {
        return
      }
      const outcome = await probeProjectResponds(supabaseUrl)
      if (!outcome.responded) {
        throw new Error(
          [
            `VITE_SUPABASE_URL names a Supabase project that did not respond: ${supabaseUrl}`,
            `(${outcome.reason})`,
            'A bundle is only as good as the project it names: this value is inlined and',
            'cannot be corrected at runtime, so shipping it would break sign-in for every',
            'visitor. Check the project still exists in the Supabase dashboard and that',
            'VITE_SUPABASE_URL in the Vercel project settings points at it.',
          ].join('\n'),
        )
      }
    },
  }
}

// Nothing on the deployed frontend says which commit produced it. The bundle
// filename and the etag are content hashes -- they answer "did the bytes
// change?", not "which commit is this?" -- and two commits compiling to the
// same output are indistinguishable. This publishes Vercel's own record of the
// commit, in two places for one reason each:
//
//   - `version.json`, so a probe can read it without parsing HTML;
//   - a `<meta>` in `index.html`, because `vercel.json` rewrites every unknown
//     path to the app shell, so the shell is what a probe of *any* path
//     actually receives. Putting the revision in the shell means every response
//     the site can give identifies its own build.
//
// Any build that has a commit SHA publishes it -- production, preview, CI or
// local. Only *strictness* is scoped to production: a production deployment
// that cannot name its commit fails, while nothing else may be broken by an
// observability field. `resolveBuildRevision` states that rule once, so this
// hook holds no policy of its own and the rule stays testable without a build.
function publishBuildRevision(): Plugin {
  let revision: string | null = null
  return {
    name: 'autoreport:publish-build-revision',
    configResolved() {
      const decision = resolveBuildRevision(process.env)
      revision = decision.revision
      if (!decision.problem) {
        return
      }
      throw new Error(
        [
          `A production deployment cannot be traced to a commit: ${decision.problem}.`,
          'Vercel sets this itself on every git-connected deployment, so an',
          'unset value means this build did not come from one -- and the',
          'bundle it produces could never be tied back to a revision.',
          'System environment variables are opt-in: if this fires unexpectedly,',
          'check "Enable access to System Environment Variables" in the project',
          'settings. See docs/DEPLOYMENT.md, "Which build is deployed".',
        ].join('\n'),
      )
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: BUILD_REVISION_PATH,
        source: buildRevisionDocument(revision),
      })
    },
    transformIndexHtml() {
      if (!revision) {
        return []
      }
      return [
        {
          tag: 'meta',
          attrs: { name: BUILD_REVISION_META_NAME, content: revision },
          injectTo: 'head',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    assertUsableApiBaseUrl(),
    assertUsableSupabaseProject(),
    publishBuildRevision(),
    react(),
    tailwindcss(),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'supabase-vendor',
              test: /node_modules[\\/]@supabase[\\/]/,
            },
            {
              name: 'icons-vendor',
              test: /node_modules[\\/]lucide-react[\\/]/,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      html2canvas: 'html2canvas-pro',
    },
  },
})
