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
  await expect(page.locator('.markdown-mermaid svg')).toBeVisible({ timeout: 30_000 })
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
  await expect(page.locator('.markdown-mermaid svg')).toBeVisible({ timeout: 30_000 })

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

// Monaco used to publish an AMD loader on the page; mermaid's UMD dependencies called
// into it and it rejected their anonymous define(), so no diagram ever rendered and the
// Mermaid-to-picture Word export silently fell back to source. The editor now loads the
// local ESM build (src/monacoSetup.ts), so no loader is installed. This test is what
// proved the fix: it was marked expected-to-fail, and Playwright raised an error the
// moment it started passing.
test('a Mermaid diagram renders in the preview', async ({ page }) => {
  await openBlankReport(page)
  await writeReport(page, REPORT)
  await page.getByRole('button', { name: 'Preview 模式' }).click()
  await expect(page.locator('.markdown-mermaid svg')).toBeVisible({ timeout: 30_000 })
})

// Monaco owns the paste event. Since 0.55 it replaced its hidden textarea with a
// NativeEditContext and now intercepts `paste` with a CAPTURE listener on `document`
// that stops propagation, so nothing below that point -- not the editor's own DOM
// node, where this app's listener used to sit, not even the element the paste
// targeted -- ever sees it. Every conversion the editor does on paste (images,
// HTML tables, TSV) quietly stopped running, and for an image that means nothing at
// all appears.
//
// The unit tests kept passing throughout: they cover the converters, and the
// converters were never broken. Only the wiring was. That is what this pins.
test('pasting an image into the editor inserts image markdown', async ({ page }) => {
  await openBlankReport(page)
  await page.waitForFunction(() => window.monaco?.editor?.getModels?.().length === 1)

  const inserted = await page.evaluate(async () => {
    const model = window.monaco.editor.getModels()[0]
    model.setValue('')

    // Monaco's input surface: a NativeEditContext div since 0.55, a hidden textarea
    // before it. Accept either so a version bump fails loudly here rather than
    // silently skipping the assertion.
    const target = document
      .querySelector('.monaco-editor')
      ?.querySelector<HTMLElement>('.native-edit-context, textarea.inputarea')
    if (!target) throw new Error('no Monaco input surface found')
    target.focus()

    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
      (character) => character.charCodeAt(0),
    )
    const data = new DataTransfer()
    data.items.add(new File([png], 'screenshot.png', { type: 'image/png' }))
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )

    await new Promise((resolve) => setTimeout(resolve, 2_000))
    return model.getValue()
  })

  // A guest has no cloud storage, so the upload falls back to an inline data URL.
  expect(inserted).toMatch(/^!\[pasted-image\]\(data:image\/png;base64,/)
})

// A student pasting an answer from Gemini or ChatGPT got the table and lost the
// report. The paste handler extracted the first thing it recognised -- a table, or an
// image, and AI sites put icons in their markup -- inserted that, and discarded
// everything around it. Measured: 147 characters of answer became 62 of table.
//
// It only surfaced when the paste listener started being reached again: these
// branches had been unreachable while Monaco swallowed the event, so they ran against
// real AI clipboard payloads for the first time in a long while.
//
// A converter may now claim a paste only when it accounts for essentially all of it.
test('pasting an AI answer keeps the whole answer, not just its table', async ({ page }) => {
  await openBlankReport(page)
  await page.waitForFunction(() => window.monaco?.editor?.getModels?.().length === 1)

  const pasted = await page.evaluate(async () => {
    const model = window.monaco.editor.getModels()[0]
    model.setValue('')

    const target = document
      .querySelector('.monaco-editor')
      ?.querySelector<HTMLElement>('.native-edit-context, textarea.inputarea')
    if (!target) throw new Error('no Monaco input surface found')
    target.focus()

    // Both flavours an AI chat puts on the clipboard: rich HTML, and a plain-text
    // twin that is already good Markdown. The HTML carries an icon as well as a
    // table, because each used to be enough on its own to discard the answer.
    const plain = [
      '## RC 電路分析',
      '',
      '時間常數決定電容充放電的速率。',
      '',
      '| t (ms) | V (V) |',
      '| --- | --- |',
      '| 0.0 | 5.00 |',
      '',
      '希望這些對你的報告有幫助。',
    ].join('\n')

    const html =
      '<div><img src="https://cdn.example.test/logo.png" width="16">' +
      '<h2>RC 電路分析</h2><p>時間常數決定電容充放電的速率。</p>' +
      '<table><thead><tr><th>t (ms)</th><th>V (V)</th></tr></thead>' +
      '<tbody><tr><td>0.0</td><td>5.00</td></tr></tbody></table>' +
      '<p>希望這些對你的報告有幫助。</p></div>'

    const data = new DataTransfer()
    data.setData('text/html', html)
    data.setData('text/plain', plain)
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )

    await new Promise((resolve) => setTimeout(resolve, 2_000))
    return model.getValue()
  })

  expect(pasted).toContain('RC 電路分析')
  expect(pasted).toContain('時間常數決定電容充放電的速率。')
  expect(pasted).toContain('| t (ms) | V (V) |')
  expect(pasted).toContain('希望這些對你的報告有幫助。')
})

// Students reported the AI features as "doing nothing". Every AI request needs an
// account, and on production a guest was told so only after the fact: AI Assist showed a
// green 「內建 AI」 status, its option chips were buttons with no click handler, the
// Agent's run button was silently disabled on an empty report, and with content a click
// waited up to 20 s for the server to answer 401 in a toast that faded.
//
// A guest must now see the reason before starting, with a way to sign in, and the page
// must not send a request it already knows will be refused. Tasks that run in the
// browser stay available to guests.
test('a guest is told AI needs sign-in before starting, and no doomed request is sent', async ({ page }) => {
  const aiRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/ai/') || request.url().includes('/api/agent/')) aiRequests.push(request.url())
  })

  await openBlankReport(page)

  // AI Agent: the reason is in the header, visible on open, and the run button is off.
  await page.getByRole('button', { name: 'AI Agent', exact: true }).click()
  const agent = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'AI Agent' }) })
  await expect(agent.locator('header').getByRole('status')).toContainText('內建 AI 需要登入後使用')
  await expect(agent.locator('header').getByRole('button', { name: '登入' })).toBeVisible()
  await expect(agent.getByText('無法執行：內建 AI 需要登入後使用')).toBeVisible()
  await page.getByRole('button', { name: '關閉 AI Agent' }).click()

  // AI Assist: no green light for a guest.
  await page.getByRole('button', { name: 'AI Assist', exact: true }).click()
  const assist = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'AI Assist' }) })
  await expect(assist).toContainText('內建 AI 需要登入後使用')
  await expect(assist.locator('.bg-emerald-500')).toHaveCount(0)

  // A task that calls built-in AI straight away says why it cannot start, and its
  // choices are not dead buttons.
  await assist.getByRole('button', { name: /^整理內容/ }).click()
  await expect(assist.getByRole('button', { name: '開始處理' })).toBeDisabled()
  await expect(assist.getByRole('status')).toContainText('內建 AI 需要登入後使用')
  await expect(assist.getByRole('button', { name: '正式結報' })).toHaveCount(0)

  // A task that runs in the browser still works for a guest.
  await assist.getByRole('button', { name: '← 返回任務' }).click()
  await assist.getByRole('button', { name: /^檢查問題/ }).click()
  await expect(assist.getByRole('button', { name: '開始處理' })).toBeEnabled()

  expect(aiRequests).toEqual([])
})

// Use your own AI: the student carries the prompt to ChatGPT, Claude, Gemini and the
// rest -- web or desktop -- and the answer back. It needs no account, so it is how a
// guest uses AI at all, and an outside answer must meet the same rules as built-in AI:
// the Agent's answer goes through the server's parser and numeric guard, and a rewrite
// that changes a number is refused.

const HANDOFF_REPORT = '# RC 電路實驗\n\n## 數據\n\n| 電壓 | 電流 |\n|---|---|\n| 12 V | 3 mA |\n'

test('a guest can run the Agent through their own AI, and a data-changing answer is withheld', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await openBlankReport(page)
  await writeReport(page, HANDOFF_REPORT)

  await page.getByRole('button', { name: 'AI Agent', exact: true }).click()
  const agent = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'AI Agent' }) })
  const panel = agent.getByRole('region', { name: '用你自己的 AI' })

  await panel.getByRole('button', { name: 'ChatGPT', exact: true }).click()

  // The site opens as a real link in a new tab, never with the report in its URL.
  const open = panel.getByRole('link', { name: '打開 ChatGPT ↗' })
  await expect(open).toHaveAttribute('href', 'https://chatgpt.com/')
  await expect(open).toHaveAttribute('target', '_blank')

  // The copied prompt is the server's Agent prompt, carrying the report.
  await panel.getByRole('button', { name: '複製 prompt' }).click()
  await expect(panel.getByRole('button', { name: '已複製 ✓' })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('12 V')
  expect(copied).toContain('JSON')

  // What copying a ChatGPT answer really gives you: chatter around a fenced block.
  const answer =
    '好的！以下是審閱結果：\n\n```json\n' +
    JSON.stringify({ findings: ['缺少實驗目的與結論'], checklist: [{ label: '結論', status: 'fail', note: '沒有結論' }] }) +
    '\n```\n\n希望有幫助！'
  await panel.getByLabel('AI 的回答').fill(answer)
  await panel.getByRole('button', { name: '使用這個回答' }).click()
  await expect(agent).toContainText('缺少實驗目的與結論')

  // An answer that changes the data keeps its review but loses its edit.
  await panel.getByRole('button', { name: 'Claude', exact: true }).click()
  await panel
    .getByLabel('AI 的回答')
    .fill(JSON.stringify({ findings: ['單位不一致'], proposed_markdown: HANDOFF_REPORT.replace('12 V', '15 V') }))
  await panel.getByRole('button', { name: '使用這個回答' }).click()
  await expect(agent).toContainText('AI 建議的修改更動了原文的數字或單位')
})

test('a guest can generate an outline through their own AI', async ({ page }) => {
  await openBlankReport(page)

  await page.getByRole('button', { name: 'AI Assist', exact: true }).click()
  const assist = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'AI Assist' }) })
  await assist.getByRole('button', { name: /^生成報告/ }).click()
  // Starting only opens the brief form, so a guest may.
  await assist.getByRole('button', { name: '開始處理' }).click()

  const form = page.locator('div.fixed.inset-0.z-50').filter({ hasText: '生成報告大綱' })
  await expect(form.getByRole('button', { name: '產生大綱' })).toBeDisabled()
  await form.getByPlaceholder('例如：RC 電路暫態響應').fill('RC 電路暫態響應')

  const panel = form.getByRole('region', { name: '用你自己的 AI' })
  await panel.getByRole('button', { name: 'Gemini', exact: true }).click()
  await panel.getByRole('button', { name: '查看' }).click()
  await expect(panel.getByLabel('要複製的 prompt')).toHaveValue(/RC 電路暫態響應/)

  // Asked for Markdown, chat sites wrap the whole answer in a fence; it must not land as a code block.
  await panel.getByLabel('AI 的回答').fill('```markdown\n# RC 電路暫態響應\n\n## 實驗目的\n\n## 實驗數據\n```')
  await panel.getByRole('button', { name: '使用這個回答' }).click()

  const review = page.locator('div.fixed').filter({ hasText: '確認 AI 報告大綱' }).last()
  await expect(review).toContainText('實驗目的')
  await expect(review).not.toContainText('```')
})

test('a rewrite from the student\'s own AI that changes a number is refused', async ({ page }) => {
  await openBlankReport(page)
  await writeReport(page, '# RC\n\n電壓為 12 V，電流 3 mA，這段需要整理。\n')

  // Select the sentence to tidy, as a student would before opening AI Assist.
  await page.evaluate(() => {
    const editor = window.monaco.editor.getEditors()[0]
    const model = editor.getModel()!
    editor.focus()
    editor.setSelection({ startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: model.getLineMaxColumn(3) })
  })

  await page.getByRole('button', { name: 'AI Assist', exact: true }).click()
  const assist = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'AI Assist' }) })
  await assist.getByRole('button', { name: /^整理內容/ }).click()

  const panel = assist.getByRole('region', { name: '用你自己的 AI' })
  await panel.getByRole('button', { name: 'DeepSeek', exact: true }).click()

  await panel.getByLabel('AI 的回答').fill('實驗量得電壓為 15 V、電流為 3 mA。')
  await panel.getByRole('button', { name: '使用這個回答' }).click()
  await expect(panel.getByRole('alert')).toContainText('改動了原文的數字或單位')
  await expect(page.getByText('確認 AI 重寫')).toHaveCount(0)

  await panel.getByLabel('AI 的回答').fill('實驗量得電壓為 12 V、電流為 3 mA。')
  await panel.getByRole('button', { name: '使用這個回答' }).click()
  await expect(page.getByText('確認 AI 重寫')).toBeVisible()
})
