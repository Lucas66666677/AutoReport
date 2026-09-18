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

// The terminal bridge, end to end: a real bridge process, started the way a student
// starts it, with a stand-in for Claude Code first on its PATH. The page finds it,
// pairs with the code it prints, runs the Agent through it, and gets the answer back
// through the same import and checks as copy and paste.
test('a guest can hand the Agent to a signed-in terminal CLI through the bridge', async ({ page }) => {
  const { spawn } = await import('node:child_process')
  const { chmod, mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')

  const fakeClaude = [
    "const args = process.argv.slice(2)",
    "if (args[0] === 'auth') process.exit(0)",
    "const chunks = []",
    "process.stdin.on('data', (chunk) => chunks.push(chunk))",
    "process.stdin.on('end', () => {",
    "  const toolsOff = args.slice(-2).join(' ') === '--disallowedTools *'",
    "  const modelAt = args.indexOf('--model')",
    "  const model = modelAt >= 0 ? args[modelAt + 1] : 'default'",
    // A name the stand-in does not know fails the way a real CLI's refusal does.
    "  if (model === 'nope') { process.exitCode = 1; process.stdout.write('model nope is not available'); return }",
    "  const answer = { findings: ['來自終端機的審閱', 'tools-off:' + toolsOff, 'model:' + model] }",
    // String.fromCharCode(10), not an escape: this line is source for another program.
    "  const newline = String.fromCharCode(10)",
    "  process.stdout.write('```json' + newline + JSON.stringify(answer) + newline + '```')",
    "})",
  ].join('\n')

  const bin = await mkdtemp(path.join(tmpdir(), 'bridge-e2e-bin-'))
  await writeFile(path.join(bin, 'fake-claude.cjs'), fakeClaude)
  if (process.platform === 'win32') {
    await writeFile(path.join(bin, 'claude.cmd'), '@node "%~dp0fake-claude.cjs" %*\r\n')
  } else {
    await writeFile(path.join(bin, 'claude'), `#!/usr/bin/env node\n${fakeClaude}`)
    await chmod(path.join(bin, 'claude'), 0o755)
  }

  // Windows spells it Path; setting a second PATH key would leave the child guessing.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  const port = 47711
  const script = fileURLToPath(new URL('../public/bridge/autolabreport-bridge.mjs', import.meta.url))
  const bridge = spawn(process.execPath, [script, '--port', String(port), '--allow-origin', 'http://127.0.0.1:5174'], {
    env: { ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey] ?? ''}` },
  })

  try {
    const pairingCode = await new Promise<string>((resolve, reject) => {
      let printed = ''
      const timer = setTimeout(() => reject(new Error(`bridge printed no pairing code:\n${printed}`)), 30_000)
      bridge.stdout.on('data', (chunk: Buffer) => {
        printed += chunk.toString('utf8')
        const match = printed.match(/配對碼：([A-Z0-9]{4}-[A-Z0-9]{4})/)
        if (match && printed.includes('Ctrl+C')) {
          clearTimeout(timer)
          resolve(match[1])
        }
      })
      bridge.on('exit', (code) => reject(new Error(`bridge exited (${code}):\n${printed}`)))
    })

    await openBlankReport(page)
    await writeReport(page, HANDOFF_REPORT)
    await page.evaluate((testPort) => {
      localStorage.setItem('autolabreport-terminal-bridge', JSON.stringify({ port: testPort, token: null }))
    }, port)

    await page.getByRole('button', { name: 'AI Agent', exact: true }).click()
    const agent = page.locator('aside').filter({ has: page.getByRole('heading', { name: 'AI Agent' }) })
    const panel = agent.getByRole('region', { name: '用你自己的 AI' })

    await panel.getByRole('button', { name: /^終端機 AI/ }).click()
    await panel.getByRole('button', { name: '連接終端機' }).click()

    // A wrong code is refused in the bridge's own words.
    await panel.getByLabel('配對碼').fill('AAAA-AAAA')
    await panel.getByRole('button', { name: '配對', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('配對碼不正確')

    await panel.getByLabel('配對碼').fill(pairingCode.toLowerCase())
    await panel.getByRole('button', { name: '配對', exact: true }).click()

    const run = panel.getByRole('button', { name: '用 Claude Code 執行' })
    await expect(run).toBeVisible()
    await expect(panel).toContainText('已關閉所有工具')

    // A name the CLI refuses: the student sees the CLI's reason and the way back.
    await panel.getByLabel('Claude Code 模型').selectOption({ label: '其他（自行輸入）…' })
    await panel.getByLabel('Claude Code 自訂模型').fill('nope')
    await expect(panel).toContainText('/model')
    await run.click()
    await expect(panel.getByRole('alert')).toContainText('model nope is not available')
    await expect(panel.getByRole('alert')).toContainText('改回「CLI 預設」')

    // A model from the list; the CLI must be started with it.
    await panel.getByLabel('Claude Code 模型').selectOption('sonnet')
    await run.click()

    await expect(agent).toContainText('來自終端機的審閱')
    // The stand-in reports the arguments it was started with: the chosen model, and
    // still every tool removed.
    await expect(agent).toContainText('model:sonnet')
    await expect(agent).toContainText('tools-off:true')
  } finally {
    bridge.kill()
    await rm(bin, { recursive: true, force: true })
  }
})


test('an AI app reads and edits the open report through the MCP connector', async ({ page }) => {
  const { spawn } = await import('node:child_process')
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')

  const port = 47712
  const stateDir = await mkdtemp(path.join(tmpdir(), 'mcp-e2e-state-'))
  const script = fileURLToPath(new URL('../public/mcp/autolabreport-mcp.mjs', import.meta.url))
  // The connector exactly as an AI app starts it, apart from the port, the dev origin and
  // a throwaway folder for its pairing data.
  const connector = spawn(
    process.execPath,
    [script, '--port', String(port), '--allow-origin', 'http://127.0.0.1:5174', '--state-dir', stateDir],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  // A minimal AI app: MCP over stdio, one JSON message per line, the current revision.
  let pending = ''
  const waiting = new Map<number, (message: { result: { content: { text: string }[]; isError: boolean } }) => void>()
  connector.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8')
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const message = JSON.parse(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
      waiting.get(message.id)?.(message)
    }
  })
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'E2E 代理', version: '1' },
  }
  let nextId = 1
  async function callTool(name: string, args: Record<string, unknown> = {}) {
    const id = nextId
    nextId += 1
    const reply = new Promise<{ result: { content: { text: string }[]; isError: boolean } }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${name}`)), 60_000)
      waiting.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
    connector.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: meta } })}\n`)
    const { result } = await reply
    return { text: result.content[0].text, isError: result.isError }
  }
  const editorText = () => page.evaluate(() => window.monaco.editor.getModels()[0].getValue())

  try {
    // The page looks for the connector on this test's port. Seeded before the app loads,
    // because the workspace reads it once, and only if nothing is saved yet.
    await page.addInitScript((testPort) => {
      if (!localStorage.getItem('autolabreport-agent-connector')) {
        localStorage.setItem('autolabreport-agent-connector', JSON.stringify({ port: testPort, token: null }))
      }
    }, port)
    await openBlankReport(page)
    await writeReport(page, '# 單擺實驗\n\n## 結果\n\n週期為 2.01 s。\n\n## 討論\n\n誤差待補。\n')

    // Not connected yet: the AI is told how, with a code to give the student.
    const status = await callTool('connection_status')
    expect(status.isError).toBe(false)
    const code = status.text.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0]
    expect(code, status.text).toBeTruthy()

    await page.getByRole('button', { name: 'AI Agent', exact: true }).click()
    const panel = page.getByRole('region', { name: '連接 AI app' })
    await panel.getByRole('button', { name: '連接 AI app' }).click()
    await panel.getByLabel('AI app 配對碼').fill(code!.toLowerCase())
    await panel.getByRole('button', { name: '配對', exact: true }).click()
    await expect(panel).toContainText('已連線（E2E 代理）')

    // The AI reads the report the student sees.
    const read = await callTool('read_report')
    expect(read.isError).toBe(false)
    expect(read.text).toContain('週期為 2.01 s。')

    // An edit lands in the editor at once, flags the number it introduced, and Ctrl+Z
    // takes it back.
    const edit = await callTool('edit_report', { old_text: '誤差待補。', new_text: '誤差主要來自計時的反應時間，約 0.25 s。' })
    expect(edit.isError).toBe(false)
    expect(edit.text).toContain('0.25')
    await expect.poll(editorText).toContain('誤差主要來自計時的反應時間，約 0.25 s。')
    // The student closes the drawer and undoes it from the keyboard.
    await page.getByRole('button', { name: '關閉 AI Agent' }).click()
    await page.locator('.monaco-editor .view-lines').first().click()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(editorText).toContain('誤差待補。')

    // A mistake comes back as a failure the AI can act on, and changes nothing.
    const miss = await callTool('edit_report', { old_text: '不存在的句子', new_text: 'x' })
    expect(miss.isError).toBe(true)
    expect(miss.text).toContain('read_report')

    // An image file from this computer goes in after the paragraph the AI named; reading
    // again shows it as a short link rather than the image data.
    const png = path.join(stateDir, 'period.png')
    await writeFile(
      png,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
    )
    const inserted = await callTool('insert_image', { path: png, alt: '圖 1：週期', after_text: '週期為 2.01 s。' })
    expect(inserted.isError, inserted.text).toBe(false)
    expect(await editorText()).toContain('週期為 2.01 s。\n\n![圖 1：週期](data:image/png;base64,')
    const reread = await callTool('read_report')
    expect(reread.text).toContain('週期為 2.01 s。\n\n![圖 1：週期](agent-image://1)\n\n## 討論')

    const checks = await callTool('check_report')
    expect(checks.isError).toBe(false)
    expect(checks.text).toContain('項')
    // With the drawer closed the connection carried on; reopening shows what the AI did.
    await page.getByRole('button', { name: 'AI Agent', exact: true }).click()
    await expect(panel.getByRole('list', { name: 'AI app 最近的動作' })).toContainText('插入圖片')

    // ChatGPT on the web works on cloud reports, so a guest is told to sign in first.
    await panel.getByText('用 ChatGPT 網頁版').click()
    await expect(panel).toContainText('需要先登入 AutoLabReport')

    // Disconnecting stops the AI at once.
    await panel.getByRole('button', { name: '中斷連線' }).click()
    await expect(panel.getByRole('button', { name: '連接 AI app' })).toBeVisible()
    const after = await callTool('read_report')
    expect(after.isError).toBe(true)
    expect(after.text).toContain('連接 AI app')
  } finally {
    connector.stdin.end()
    connector.kill()
    await rm(stateDir, { recursive: true, force: true })
  }
})

// Supabase Auth sends a student here to approve ChatGPT; the page must not be rewritten
// to the front page, as other unknown paths are for a visitor who is not signed in.
test('the AI app consent page keeps its address and explains a broken link', async ({ page }) => {
  await page.goto('/oauth/consent?authorization_id=abc-123')
  await expect(page).toHaveURL(/\/oauth\/consent\?authorization_id=abc-123$/)
  await expect(page.getByRole('heading', { name: /登入 AutoLabReport|目前無法處理授權/ })).toBeVisible()

  await page.goto('/oauth/consent')
  await expect(page.getByRole('heading', { name: '授權連結不完整' })).toBeVisible()
})

// The student decides how far a connected AI app may go (aiAppModes.ts).
test('an AI app’s changes follow the mode the student chose', async ({ page }) => {
  const { spawn } = await import('node:child_process')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')

  const port = 47713
  const stateDir = await mkdtemp(path.join(tmpdir(), 'mcp-modes-state-'))
  const script = fileURLToPath(new URL('../public/mcp/autolabreport-mcp.mjs', import.meta.url))
  const connector = spawn(
    process.execPath,
    [script, '--port', String(port), '--allow-origin', 'http://127.0.0.1:5174', '--state-dir', stateDir],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let pending = ''
  const waiting = new Map<number, (message: { result: { content: { text: string }[]; isError: boolean } }) => void>()
  connector.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8')
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const message = JSON.parse(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
      waiting.get(message.id)?.(message)
    }
  })
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'E2E 代理', version: '1' },
  }
  let nextId = 1
  function callTool(name: string, args: Record<string, unknown> = {}) {
    const id = nextId
    nextId += 1
    const reply = new Promise<{ text: string; isError: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${name}`)), 60_000)
      waiting.set(id, (message) => {
        clearTimeout(timer)
        resolve({ text: message.result.content[0].text, isError: message.result.isError })
      })
    })
    connector.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: meta } })}\n`)
    return reply
  }
  const editorText = () => page.evaluate(() => window.monaco.editor.getModels()[0].getValue())

  try {
    await page.addInitScript((testPort) => {
      if (!localStorage.getItem('autolabreport-agent-connector')) {
        localStorage.setItem('autolabreport-agent-connector', JSON.stringify({ port: testPort, token: null }))
      }
    }, port)
    await openBlankReport(page)
    await writeReport(page, '# 單擺實驗\n\n誤差待補。\n')

    const code = (await callTool('connection_status')).text.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)![0]
    await page.getByRole('button', { name: 'AI Agent', exact: true }).click()
    const panel = page.getByRole('region', { name: '連接 AI app' })
    await panel.getByRole('button', { name: '連接 AI app' }).click()
    await panel.getByLabel('AI app 配對碼').fill(code)
    await panel.getByRole('button', { name: '配對', exact: true }).click()
    await expect(panel).toContainText('已連線')
    const modes = panel.getByRole('radiogroup', { name: 'AI 權限模式' })
    await expect(modes.getByRole('radio', { name: '自動' })).toHaveAttribute('aria-checked', 'true')

    // Planning: the AI may read, and every change is refused.
    await modes.getByRole('radio', { name: '規劃' }).click()
    const planned = await callTool('edit_report', { old_text: '誤差待補。', new_text: '誤差約 0.25 s。' })
    expect(planned.isError).toBe(true)
    expect(planned.text).toContain('規劃')
    expect((await callTool('read_report')).isError).toBe(false)
    expect(await editorText()).toContain('誤差待補。')

    // Manual: the change waits on a card; 允許 applies it and the AI hears so.
    await modes.getByRole('radio', { name: '手動' }).click()
    const allowed = callTool('edit_report', { old_text: '誤差待補。', new_text: '誤差約 0.25 s。' })
    const card = page.getByRole('complementary', { name: 'AI app 的修改建議' })
    await expect(card).toContainText('+ 誤差約 0.25 s。')
    await expect(card).toContainText('− 誤差待補。')
    expect(await editorText()).toContain('誤差待補。')
    await card.getByRole('button', { name: '允許' }).click()
    const allowedReply = await allowed
    expect(allowedReply.isError).toBe(false)
    expect(allowedReply.text).toContain('使用者已允許')
    await expect.poll(editorText).toContain('誤差約 0.25 s。')
    await expect(card).toBeHidden()

    // 拒絕 leaves the report alone, and the AI is told.
    const refused = callTool('edit_report', { old_text: '誤差約 0.25 s。', new_text: '亂寫的結論。' })
    await card.getByRole('button', { name: '拒絕' }).click()
    const refusedReply = await refused
    expect(refusedReply.isError).toBe(true)
    expect(refusedReply.text).toContain('拒絕')
    expect(await editorText()).toContain('誤差約 0.25 s。')

    // Automatic: straight in, no card.
    await modes.getByRole('radio', { name: '自動' }).click()
    expect((await callTool('edit_report', { old_text: '# 單擺實驗', new_text: '# 單擺實驗（第二次）' })).isError).toBe(false)
    await expect.poll(editorText).toContain('# 單擺實驗（第二次）')
    await expect(card).toBeHidden()

    // A guest's choice stays in this browser.
    await modes.getByRole('radio', { name: '規劃' }).click()
    await page.reload()
    // Reloading returns to the dashboard; the report is listed there.
    await page.getByRole('button', { name: /未命名報告/ }).first().click()
    await page.getByRole('button', { name: 'AI Agent', exact: true }).click()
    await expect(
      page.getByRole('region', { name: '連接 AI app' }).getByRole('radio', { name: '規劃' }),
    ).toHaveAttribute('aria-checked', 'true')
  } finally {
    connector.stdin.end()
    connector.kill()
    await rm(stateDir, { recursive: true, force: true })
  }
})
