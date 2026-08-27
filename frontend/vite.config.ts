import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { describeApiBaseUrlProblem } from './src/apiConfig'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [assertUsableApiBaseUrl(), react(), tailwindcss()],
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
