import { defineConfig, devices } from '@playwright/test'

// The browser journey nobody was running: RELEASE_READINESS records the guest flow
// and the PDF as manual steps, so a regression in either was only ever found by hand.
// This starts the real frontend against the real backend -- the export needs Pandoc,
// not a mock -- and drives Chromium against them.

const PORT = Number(process.env.E2E_PORT ?? 5174)
const API_PORT = Number(process.env.E2E_API_PORT ?? 8012)
const PYTHON = process.env.E2E_PYTHON ?? 'python'

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
      command: `${PYTHON} -m uvicorn main:app --host 127.0.0.1 --port ${API_PORT}`,
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
