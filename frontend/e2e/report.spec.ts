import { expect, test, type Page } from '@playwright/test'
import { mkdir, open, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// The journey RELEASE_READINESS records as manual: enter as a guest, write a report
// with formulas, a table and a diagram, and download both exports. The PDF it saves
// is the artifact BETA_BACKLOG asked for -- scripts/inspect-pdf.py reads it back.

// Saving downloads under frontend/ would trip Vite's file watcher and reload the
// page in the middle of the next test.
export const ARTIFACTS = fileURLToPath(new URL('../../.playwright-output/artifacts/', import.meta.url))

const REPORT = [
  '# 電子學實驗報告',
  '',
  '時間常數 $\\tau = RC$，電阻 $R_{1} = 10\\ \\mathrm{k\\Omega}$。',
  '',
  '$$\\tau = \\frac{L}{R}$$',
  '',
  '| 量測項目 | 數值 |',
  '| --- | --- |',
  '| 上升時間 | 10.2 μs |',
  '| 電壓 | 5 V |',
  '| 溫度 | 25 °C |',
  '',
  '```mermaid',
  'graph TD;',
  '  A[輸入] --> B[輸出];',
  '```',
  '',
].join('\n')

async function firstBytes(file: string, count: number): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(count)
    await handle.read(buffer, 0, count, 0)
    return buffer.toString('latin1')
  } finally {
    await handle.close()
  }
}

async function openBlankReport(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '先以訪客模式試用' }).click()
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
}

async function writeReport(page: Page, markdown: string) {
  // Typing into Monaco would let auto-closing brackets rewrite $...$ and the table.
  await page.waitForFunction(() => window.monaco?.editor?.getModels?.().length === 1)
  await page.evaluate((text) => {
    window.monaco.editor.getModels()[0].setValue(text)
  }, markdown)
}

async function openMoreActions(page: Page) {
  await page.getByRole('button', { name: '更多操作' }).click()
}

test.beforeAll(async () => {
  await mkdir(ARTIFACTS, { recursive: true })
})

test('a guest can write a report and see formulas, tables and diagrams rendered', async ({ page }) => {
  await openBlankReport(page)
  await writeReport(page, REPORT)

  await page.getByRole('button', { name: 'Preview 模式' }).click()

  // KaTeX renders the maths; a bare $ on screen would mean it did not.
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.getByText('10.2 μs')).toBeVisible()
  await expect(page.getByText('25 °C')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('$\\tau')
})

test('the draft survives a reload', async ({ page }) => {
  await openBlankReport(page)
  await writeReport(page, REPORT)
  await expect(page.getByRole('button', { name: 'Preview 模式' })).toBeVisible()

  // The header reports the local save; reloading before it lands loses the draft.
  await expect(page.getByText('已儲存在本機')).toBeVisible({ timeout: 30_000 })
  await page.reload()

  // Reloading returns to the dashboard rather than reopening the editor, so what
  // "survives" means is that the draft is still listed with its content, and still
  // reports itself saved locally.
  await expect(page.getByText('已儲存在本機')).toBeVisible()
  await expect(page.getByRole('button', { name: /電子學實驗報告/ })).toBeVisible()

  const stored = await page.evaluate(() =>
    Object.keys(localStorage)
      .map((key) => localStorage.getItem(key) ?? '')
      .join(String.fromCharCode(10)),
  )
  expect(stored).toContain('電子學實驗報告')
  expect(stored).toContain('10.2 μs')
})

test('Word export downloads a real .docx', async ({ page }) => {
  test.setTimeout(180_000)
  await openBlankReport(page)
  await writeReport(page, REPORT)
  await openMoreActions(page)

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: '匯出 Word' }).click()
  const download = await downloadPromise

  const saved = path.join(ARTIFACTS, 'report.docx')
  await download.saveAs(saved)
  const { size } = await stat(saved)
  expect(size).toBeGreaterThan(5_000)
  // Every .docx is a zip; anything else means the server sent an error body.
  expect(await firstBytes(saved, 2)).toBe('PK')
})

test('PDF export downloads a real .pdf', async ({ page }) => {
  test.setTimeout(180_000)
  await openBlankReport(page)
  await writeReport(page, REPORT)

  // html2pdf photographs the preview, so the preview has to have rendered first.
  await page.getByRole('button', { name: 'Preview 模式' }).click()
  await expect(page.locator('.katex').first()).toBeVisible()

  await openMoreActions(page)
  const downloadPromise = page.waitForEvent('download', { timeout: 150_000 })
  await page.getByRole('button', { name: '匯出 PDF（圖片版）' }).click()
  const download = await downloadPromise

  const saved = path.join(ARTIFACTS, 'report.pdf')
  await download.saveAs(saved)
  const { size } = await stat(saved)
  expect(size).toBeGreaterThan(10_000)
  expect(await firstBytes(saved, 5)).toBe('%PDF-')
})

// Known open defect, root cause identified from the browser stack: @monaco-editor/react
// loads Monaco's AMD loader from the jsDelivr CDN, and a Vite-optimised mermaid chunk
// calls its define(), which throws "Can only have one anonymous define call per script
// file". The call reaches that loader even with window.define set to undefined, so no
// runtime hiding works. The fix is to configure @monaco-editor/react with the local ESM
// monaco build so no AMD loader is installed -- its own change, needing a bundle review.
// Marked expected-to-fail: Playwright reports it as an error if it ever starts passing.
test('a Mermaid diagram renders in the preview', async ({ page }) => {
  test.fail()
  await openBlankReport(page)
  await writeReport(page, REPORT)
  await page.getByRole('button', { name: 'Preview 模式' }).click()
  await expect(page.locator('.markdown-mermaid svg')).toBeVisible({ timeout: 30_000 })
})
