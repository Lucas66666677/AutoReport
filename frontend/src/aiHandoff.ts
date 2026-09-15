// Use your own AI: ChatGPT, Claude, Gemini, DeepSeek, Kimi and the rest -- on the web or
// in a desktop app -- with the account the student already has.
//
// The student carries the prompt there and the answer back. Nothing is automated on the
// AI's side: typing into those sites and scraping their answers is what their consumer
// terms forbid, and it breaks whenever they change their pages, which is why the old
// browser extension stays off. Copy and paste is allowed everywhere, works in every
// browser and every desktop app, and needs no install.
//
// It also needs no account here. Built-in AI is metered per user, so a guest could not
// use AI at all; with this they can use their own free ChatGPT or Gemini.
//
// The prompt is never put in the site's URL. A report is far longer than a URL can
// safely carry, and a URL lands in browser history and server logs.

export type HandoffDestination = {
  id: string
  label: string
  /** The web version. null for a desktop app or any other AI: copy only. */
  url: string | null
}

export const HANDOFF_DESTINATIONS: readonly HandoffDestination[] = [
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai/new' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'kimi', label: 'Kimi', url: 'https://www.kimi.com/' },
  { id: 'grok', label: 'Grok', url: 'https://grok.com/' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/' },
  { id: 'copilot', label: 'Copilot', url: 'https://copilot.microsoft.com/' },
  { id: 'desktop', label: '桌面版 App / 其他 AI', url: null },
]

/**
 * Unwrap an answer the AI put inside one code fence.
 *
 * Asked for "只回傳 Markdown", chat sites often answer with the whole thing in a
 * ```markdown block, and copying it brings the fence along -- which would land in the
 * report as a literal code block. Only a fence around the entire answer is removed; a
 * code block inside a longer answer is content and stays.
 */
export function unwrapWholeAnswerFence(reply: string): string {
  const trimmed = reply.trim()
  const match = trimmed.match(/^```[ \t]*(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i)
  if (!match) return trimmed
  // A second fence inside means the outer pair was not one wrapper around everything.
  if (match[1].includes('\n```')) return trimmed
  return match[1].trim()
}

/**
 * Copy text, falling back to the legacy path where the async Clipboard API is refused.
 *
 * Desktop Chrome, Edge, Safari and Firefox allow the modern API on a click. In-app
 * browsers often do not -- a link shared in a LINE group opens inside LINE -- and
 * measured in an embedded Chromium that denies `clipboard-write`, the legacy
 * execCommand copy still succeeded on the same click. Returns whether either worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return legacyCopy(text)
  }
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // Off-screen and invisible, but still selectable: a hidden element cannot be copied from.
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '-9999px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  // Focus and an explicit range, not select() alone: Safari and iOS copy nothing from a
  // textarea that holds a selection without focus. readonly keeps the keyboard closed.
  area.focus()
  area.select()
  area.setSelectionRange(0, area.value.length)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    previousFocus?.focus()
  }
}

/** How many numbers the answer lost or invented, in words a student can act on. */
export function describeIntegrityFailure(missing: number, added: number): string {
  const parts = [missing > 0 ? `少了 ${missing} 個` : '', added > 0 ? `多了 ${added} 個` : ''].filter(Boolean)
  const counts = parts.length > 0 ? `（${parts.join('、')}數字或單位）` : ''
  return `這個回答改動了原文的數字或單位${counts}，為了避免竄改實驗數據，沒有套用。可以請 AI「所有數字與單位保持原樣」再試一次。`
}
