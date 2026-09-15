import { afterEach, describe, expect, it, vi } from 'vitest'
import { HANDOFF_DESTINATIONS, copyText, describeIntegrityFailure, unwrapWholeAnswerFence } from './aiHandoff'

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses the Clipboard API when the browser allows it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const legacy = vi.fn(() => true)
    document.execCommand = legacy

    await expect(copyText('prompt')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('prompt')
    expect(legacy).not.toHaveBeenCalled()
  })

  // Measured in an embedded Chromium that denies clipboard-write: the legacy path still copied.
  it('falls back to the legacy copy when the Clipboard API is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) } })
    let copiedFrom: string | null = null
    document.execCommand = vi.fn(() => {
      copiedFrom = (document.activeElement as HTMLTextAreaElement | null)?.value ?? null
      return true
    })

    await expect(copyText('prompt text')).resolves.toBe(true)
    expect(copiedFrom).toBe('prompt text')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('reports failure when neither path can copy, so the prompt can be shown instead', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => false)
    await expect(copyText('prompt')).resolves.toBe(false)
  })
})

describe('HANDOFF_DESTINATIONS', () => {
  it('covers the AIs the owner asked for', () => {
    const labels = HANDOFF_DESTINATIONS.map((destination) => destination.label)
    for (const wanted of ['ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Kimi']) {
      expect(labels).toContain(wanted)
    }
  })

  it('offers a copy-only choice for desktop apps and anything unlisted', () => {
    expect(HANDOFF_DESTINATIONS.some((destination) => destination.url === null)).toBe(true)
  })

  it('opens every web version over https', () => {
    for (const destination of HANDOFF_DESTINATIONS) {
      if (destination.url) expect(destination.url.startsWith('https://')).toBe(true)
    }
  })

  // A report is too long for a URL, and a URL lands in history and server logs.
  it('never carries a prompt in the URL', () => {
    for (const destination of HANDOFF_DESTINATIONS) {
      if (destination.url) expect(new URL(destination.url).search).toBe('')
    }
  })

  it('keeps ids unique', () => {
    const ids = HANDOFF_DESTINATIONS.map((destination) => destination.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('unwrapWholeAnswerFence', () => {
  it('unwraps an answer the AI put entirely inside a markdown fence', () => {
    expect(unwrapWholeAnswerFence('```markdown\n## 結論\n完成量測。\n```')).toBe('## 結論\n完成量測。')
  })

  it('unwraps a bare fence and a Windows line ending', () => {
    expect(unwrapWholeAnswerFence('```\r\n## 結論\r\n完成。\r\n```')).toBe('## 結論\r\n完成。')
  })

  it('leaves an answer without a wrapper alone, apart from trimming', () => {
    expect(unwrapWholeAnswerFence('\n  ## 結論\n完成。  \n')).toBe('## 結論\n完成。')
  })

  // A code block inside the answer is content: a Python plot, a formula listing.
  it('keeps a code block that is part of a longer answer', () => {
    const answer = '## 圖表\n\n```python\nplt.plot(x, y)\n```\n\n說明如上。'
    expect(unwrapWholeAnswerFence(answer)).toBe(answer)
  })

  it('does not unwrap when two separate fences only look like one pair', () => {
    const answer = '```python\na = 1\n```\n\n文字\n\n```python\nb = 2\n```'
    expect(unwrapWholeAnswerFence(answer)).toBe(answer)
  })
})

describe('describeIntegrityFailure', () => {
  it('names both what was lost and what was invented', () => {
    const message = describeIntegrityFailure(1, 2)
    expect(message).toContain('少了 1 個')
    expect(message).toContain('多了 2 個')
  })

  it('tells the student how to get an answer that will pass', () => {
    expect(describeIntegrityFailure(1, 0)).toContain('保持原樣')
  })

  it('omits a count that is zero', () => {
    expect(describeIntegrityFailure(0, 3)).not.toContain('少了')
  })
})
