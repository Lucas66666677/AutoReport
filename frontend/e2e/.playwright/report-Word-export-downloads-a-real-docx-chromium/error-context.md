# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: report.spec.ts >> Word export downloads a real .docx
- Location: e2e\report.spec.ts:96:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5174/
Call log:
  - navigating to "http://127.0.0.1:5174/", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test'
  2   | import { mkdir, open, stat } from 'node:fs/promises'
  3   | import { fileURLToPath } from 'node:url'
  4   | import path from 'node:path'
  5   | 
  6   | // The journey RELEASE_READINESS records as manual: enter as a guest, write a report
  7   | // with formulas, a table and a diagram, and download both exports. The PDF it saves
  8   | // is the artifact BETA_BACKLOG asked for -- scripts/inspect-pdf.py reads it back.
  9   | 
  10  | // Saving downloads under frontend/ would trip Vite's file watcher and reload the
  11  | // page in the middle of the next test.
  12  | export const ARTIFACTS = fileURLToPath(new URL('../../.playwright-output/artifacts/', import.meta.url))
  13  | 
  14  | const REPORT = [
  15  |   '# 電子學實驗報告',
  16  |   '',
  17  |   '時間常數 $\\tau = RC$，電阻 $R_{1} = 10\\ \\mathrm{k\\Omega}$。',
  18  |   '',
  19  |   '$$\\tau = \\frac{L}{R}$$',
  20  |   '',
  21  |   '| 量測項目 | 數值 |',
  22  |   '| --- | --- |',
  23  |   '| 上升時間 | 10.2 μs |',
  24  |   '| 電壓 | 5 V |',
  25  |   '| 溫度 | 25 °C |',
  26  |   '',
  27  |   '```mermaid',
  28  |   'graph TD;',
  29  |   '  A[輸入] --> B[輸出];',
  30  |   '```',
  31  |   '',
  32  | ].join('\n')
  33  | 
  34  | async function firstBytes(file: string, count: number): Promise<string> {
  35  |   const handle = await open(file, 'r')
  36  |   try {
  37  |     const buffer = Buffer.alloc(count)
  38  |     await handle.read(buffer, 0, count, 0)
  39  |     return buffer.toString('latin1')
  40  |   } finally {
  41  |     await handle.close()
  42  |   }
  43  | }
> 44  | 
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5174/
  45  | async function openBlankReport(page: Page) {
  46  |   await page.goto('/')
  47  |   await page.getByRole('button', { name: '先以訪客模式試用' }).click()
  48  |   await page.getByRole('button', { name: '建立新報告' }).first().click()
  49  |   // The quick-start cards carry their label as text rather than an accessible name,
  50  |   // and the dialog animates in, so wait for the card itself before clicking it.
  51  |   const blankCard = page.locator('button', { hasText: '從空白報告開始' }).first()
  52  |   await expect(blankCard).toBeVisible()
  53  |   await blankCard.click()
  54  |   await expect(page.getByRole('button', { name: 'Split 模式' })).toBeVisible()
  55  | }
  56  | 
  57  | async function writeReport(page: Page, markdown: string) {
  58  |   // Typing into Monaco would let auto-closing brackets rewrite $...$ and the table.
  59  |   await page.waitForFunction(() => window.monaco?.editor?.getModels?.().length === 1)
  60  |   await page.evaluate((text) => {
  61  |     window.monaco.editor.getModels()[0].setValue(text)
  62  |   }, markdown)
  63  | }
  64  | 
  65  | async function openMoreActions(page: Page) {
  66  |   await page.getByRole('button', { name: '更多操作' }).click()
  67  | }
  68  | 
  69  | test.beforeAll(async () => {
  70  |   await mkdir(ARTIFACTS, { recursive: true })
  71  | })
  72  | 
  73  | test('a guest can write a report and see formulas, tables and diagrams rendered', async ({ page }) => {
  74  |   await openBlankReport(page)
  75  |   await writeReport(page, REPORT)
  76  | 
  77  |   await page.getByRole('button', { name: 'Preview 模式' }).click()
  78  | 
  79  |   // KaTeX renders the maths; a bare $ on screen would mean it did not.
  80  |   await expect(page.locator('.katex').first()).toBeVisible()
  81  |   await expect(page.getByText('10.2 μs')).toBeVisible()
  82  |   await expect(page.getByText('25 °C')).toBeVisible()
  83  |   await expect(page.locator('.markdown-mermaid svg')).toBeVisible({ timeout: 30_000 })
  84  |   await expect(page.locator('body')).not.toContainText('$\\tau')
  85  | })
  86  | 
  87  | test('the draft survives a reload', async ({ page }) => {
  88  |   await openBlankReport(page)
  89  |   await writeReport(page, REPORT)
  90  |   await expect(page.getByRole('button', { name: 'Preview 模式' })).toBeVisible()
  91  | 
  92  |   await page.waitForTimeout(1500) // let the local autosave land
  93  |   await page.reload()
  94  | 
  95  |   await expect(page.getByRole('button', { name: 'Preview 模式' })).toBeVisible()
  96  |   const survived = await page.evaluate(() => window.monaco?.editor?.getModels?.()[0]?.getValue() ?? '')
  97  |   expect(survived).toContain('電子學實驗報告')
  98  |   expect(survived).toContain('10.2 μs')
  99  | })
  100 | 
  101 | test('Word export downloads a real .docx', async ({ page }) => {
  102 |   test.setTimeout(180_000)
  103 |   await openBlankReport(page)
  104 |   await writeReport(page, REPORT)
  105 |   await openMoreActions(page)
  106 | 
  107 |   const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
  108 |   await page.getByRole('button', { name: '匯出 Word' }).click()
  109 |   const download = await downloadPromise
  110 | 
  111 |   const saved = path.join(ARTIFACTS, 'report.docx')
  112 |   await download.saveAs(saved)
  113 |   const { size } = await stat(saved)
  114 |   expect(size).toBeGreaterThan(5_000)
  115 |   // Every .docx is a zip; anything else means the server sent an error body.
  116 |   expect(await firstBytes(saved, 2)).toBe('PK')
  117 | })
  118 | 
  119 | test('PDF export downloads a real .pdf', async ({ page }) => {
  120 |   test.setTimeout(180_000)
  121 |   await openBlankReport(page)
  122 |   await writeReport(page, REPORT)
  123 | 
  124 |   // html2pdf photographs the preview, so the preview has to have rendered first.
  125 |   await page.getByRole('button', { name: 'Preview 模式' }).click()
  126 |   await expect(page.locator('.katex').first()).toBeVisible()
  127 |   await expect(page.locator('.markdown-mermaid svg')).toBeVisible({ timeout: 30_000 })
  128 | 
  129 |   await openMoreActions(page)
  130 |   const downloadPromise = page.waitForEvent('download', { timeout: 150_000 })
  131 |   await page.getByRole('button', { name: '匯出 PDF（圖片版）' }).click()
  132 |   const download = await downloadPromise
  133 | 
  134 |   const saved = path.join(ARTIFACTS, 'report.pdf')
  135 |   await download.saveAs(saved)
  136 |   const { size } = await stat(saved)
  137 |   expect(size).toBeGreaterThan(10_000)
  138 |   expect(await firstBytes(saved, 5)).toBe('%PDF-')
  139 | })
  140 | 
```