import { expect, test, type Page } from '@playwright/test'

// The signed-in half of the journey: BETA_BACKLOG wants CRUD and cloud sync checked
// with a real account, which needs credentials this repository must never hold. The
// whole file skips unless they are supplied, so CI stays green without them:
//
//   E2E_SUPABASE_URL=https://<ref>.supabase.co \
//   E2E_SUPABASE_ANON_KEY=<anon key> \
//   E2E_EMAIL=<test account> \
//   E2E_PASSWORD=<its password> \
//   npm run test:e2e
//
// Use a throwaway account on staging. The password never leaves the local process:
// it is exchanged for a session once, and only the session is put in the browser.

const SUPABASE_URL = process.env.E2E_SUPABASE_URL
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

const configured = Boolean(SUPABASE_URL && ANON_KEY && EMAIL && PASSWORD)

test.skip(!configured, 'set E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_EMAIL and E2E_PASSWORD to run')

function projectRef(url: string): string {
  return new URL(url).hostname.split('.')[0]
}

async function signIn(page: Page) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY! },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!response.ok) {
    throw new Error(`sign-in failed: HTTP ${response.status}. Does the account exist with a password?`)
  }
  const session = await response.json()

  // supabase-js reads the session from this key on load.
  const storageKey = `sb-${projectRef(SUPABASE_URL!)}-auth-token`
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [storageKey, JSON.stringify(session)] as const,
  )
}

test('a signed-in owner can create a report and it reaches the cloud', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page)
  await page.goto('/')

  // Signed in, the guest prompt is gone and cloud sync is not being offered.
  await expect(page.getByRole('button', { name: '登入以啟用雲端同步' })).toHaveCount(0)

  await page.getByRole('button', { name: '建立新報告' }).first().click()
  // The card lives in the 建立新文件 dialog and is labelled 空白 Markdown. Scope the
  // search to the dialog: the dashboard behind the overlay has its own quick-start
  // cards, and an unscoped match resolves to one of those, hidden under the backdrop.
  const dialog = page.locator('div.fixed.inset-0.z-50').filter({ hasText: '建立新文件' })
  await expect(dialog).toBeVisible()
  const blankCard = dialog.locator('button', { hasText: '空白 Markdown' }).first()
  await expect(blankCard).toBeVisible()
  await blankCard.click()
  await expect(page.getByRole('button', { name: 'Split 模式' })).toBeVisible()

  const title = `E2E ${new Date().toISOString()}`
  await page.waitForFunction(() => window.monaco?.editor?.getModels?.().length === 1)
  await page.evaluate((text) => {
    window.monaco.editor.getModels()[0].setValue(text)
  }, `# ${title}\n\n量測值 10.2 μs。\n`)

  // The report must still be there after a reload, which can only come from the cloud.
  await page.waitForTimeout(3_000)
  await page.reload()
  const survived = await page.evaluate(() => window.monaco?.editor?.getModels?.()[0]?.getValue() ?? '')
  expect(survived).toContain(title)
})

test('version history is available to a signed-in owner', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)
  await page.goto('/')
  await page.getByRole('button', { name: '建立新報告' }).first().click()
  // The card lives in the 建立新文件 dialog and is labelled 空白 Markdown. Scope the
  // search to the dialog: the dashboard behind the overlay has its own quick-start
  // cards, and an unscoped match resolves to one of those, hidden under the backdrop.
  const dialog = page.locator('div.fixed.inset-0.z-50').filter({ hasText: '建立新文件' })
  await expect(dialog).toBeVisible()
  const blankCard = dialog.locator('button', { hasText: '空白 Markdown' }).first()
  await expect(blankCard).toBeVisible()
  await blankCard.click()

  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('button', { name: '版本歷史' }).click()
  await expect(page.getByText('版本')).toBeVisible()
})
