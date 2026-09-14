import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The browser journey nobody was running: RELEASE_READINESS records the guest flow
// and the PDF as manual steps, so a regression in either was only ever found by hand.
// This starts the real frontend against the real backend -- the export needs Pandoc,
// not a mock -- and drives Chromium against them.

const PORT = Number(process.env.E2E_PORT ?? 5174)
const API_PORT = Number(process.env.E2E_API_PORT ?? 8012)
// These tests start the REAL backend, so they need a Python that has the backend's
// dependencies installed. A local checkout puts them in backend/.venv (.gitignore
// already names that path); CI installs requirements.txt onto the system Python and
// creates no venv, so the plain `python` fallback is what runs there. Without this,
// a local run started the system Python, uvicorn was missing, the API never came up,
// and only the export tests failed -- which reads like a broken export rather than a
// missing environment.
const VENV_PYTHON = fileURLToPath(
  new URL(
    process.platform === 'win32'
      ? '../backend/.venv/Scripts/python.exe'
      : '../backend/.venv/bin/python',
    import.meta.url,
  ),
)
const PYTHON = process.env.E2E_PYTHON ?? (existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python')

export default defineConfig({
  testDir: './e2e',
  outputDir: '../.playwright-output/traces',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Quoted: the venv path is absolute and a home directory may contain spaces.
      command: `"${PYTHON}" -m uvicorn main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // CORS_ALLOWED_ORIGINS replaces the default list, which only covers ports
      // 5173/4173 -- without this the export preflight is answered 400 and the
      // browser reports "Failed to fetch".
      env: { CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${PORT}` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `npm run dev -- --port ${PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { VITE_API_URL: `http://127.0.0.1:${API_PORT}` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
