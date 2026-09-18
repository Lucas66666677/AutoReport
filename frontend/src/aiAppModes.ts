// How far an AI app connected through MCP may go on its own -- through the local
// connector (agentConnector.ts) and ChatGPT on the web (backend/mcp_remote.py) alike.
// The student picks one in the AI Agent drawer; it is kept in their preferences, so the
// server knows it too.
//
// The AI apps ask before each change on their own side as well (Claude Desktop, ChatGPT);
// these modes are AutoLabReport's own say, over what reaches the report.

export type AiAppMode = 'plan' | 'manual' | 'auto'

export const DEFAULT_AI_APP_MODE: AiAppMode = 'auto'

export const AI_APP_MODES: ReadonlyArray<{ mode: AiAppMode; label: string; description: string }> = [
  { mode: 'plan', label: '規劃', description: 'AI 只能讀取和檢查報告，先把計畫告訴你，不會修改。' },
  { mode: 'manual', label: '手動', description: '每個修改都先變成建議，你按「允許」才會套用。' },
  { mode: 'auto', label: '自動', description: 'AI 直接修改；修改前自動備份，可以復原。' },
]

export function normalizeAiAppMode(value: unknown): AiAppMode {
  return value === 'plan' || value === 'manual' || value === 'auto' ? value : DEFAULT_AI_APP_MODE
}

// What the AI is told. The same words are in backend/mcp_remote.py.
export const PLAN_MODE_REFUSAL =
  '目前是「規劃」模式：只能讀取和檢查報告，不能修改。請先把你的計畫告訴使用者；使用者在 AutoLabReport 的「AI Agent」→「連接 AI app」把模式改成「手動」或「自動」之後，才能修改。'
export const SUGGESTION_WAITING =
  '已送出修改建議，使用者在 AutoLabReport 按「允許」才會套用。請告訴使用者到 AutoLabReport 確認。'
export const SUGGESTION_REJECTED = '使用者拒絕了這個修改。'
// ChatGPT on the web leaves its suggestions in the report's version history under this note.
export const AI_SUGGESTION_NOTE = 'AI app 修改建議（待確認）'

// How long a connected AI app waits for the student's 允許 before being told the
// suggestion is waiting; under the connector's 45 s limit for a tool.
export const SUGGESTION_WAIT_MS = 25_000

/** A change an AI app proposed in manual mode, shown for the student to allow or refuse. */
export type AiSuggestion = {
  id: string
  /** 'local': from the connector, waiting in this tab. 'remote': ChatGPT on the web, kept in the version history. */
  source: 'local' | 'remote'
  /** The report it would change; shown only while that report is open. */
  documentId: string | null
  summary: string
  before: string
  after: string
}

/** What deciding a suggestion does. `settle` is set while a connected AI app is waiting. */
export type AiSuggestionActions = {
  apply: () => Promise<string>
  settle?: (allowed: boolean) => void
  remoteVersionId?: string
}

let suggestionCounter = 0
export function nextSuggestionId(): string {
  suggestionCounter += 1
  return `local-${suggestionCounter}`
}

// A guest's choice has no profile to live in; it stays in this browser.
const GUEST_MODE_KEY = 'autolabreport-ai-app-mode'

export function loadGuestAiAppMode(storage: Storage | undefined = globalThis.localStorage): AiAppMode {
  try {
    return normalizeAiAppMode(storage?.getItem(GUEST_MODE_KEY))
  } catch {
    return DEFAULT_AI_APP_MODE
  }
}

export function saveGuestAiAppMode(mode: AiAppMode, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(GUEST_MODE_KEY, mode)
  } catch {
    // The choice lasts until the page is closed.
  }
}

// Suggestions from ChatGPT on the web that this browser already allowed or refused. A
// collaborator cannot delete them from the version history, so they are remembered here.
const HANDLED_KEY = 'autolabreport-handled-ai-suggestions'

export function loadHandledSuggestions(storage: Storage | undefined = globalThis.localStorage): Set<string> {
  try {
    const saved = JSON.parse(storage?.getItem(HANDLED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function rememberHandledSuggestion(id: string, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    const handled = [...loadHandledSuggestions(storage), id].slice(-200)
    storage?.setItem(HANDLED_KEY, JSON.stringify(handled))
  } catch {
    // It may be offered again; refusing again is harmless.
  }
}

export type LineChange = { kind: 'same' | 'added' | 'removed'; text: string }

const MAX_DIFF_LINES = 1500

/**
 * The lines `after` adds to and removes from `before`, in order. Common beginnings and
 * ends are set aside first, so an edit to one paragraph of a long report stays cheap.
 */
export function lineDiff(before: string, after: string): LineChange[] {
  const left = before.split('\n')
  const right = after.split('\n')
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let leftEnd = left.length
  let rightEnd = right.length
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1
    rightEnd -= 1
  }
  const head = left.slice(0, start).map((text): LineChange => ({ kind: 'same', text }))
  const tail = left.slice(leftEnd).map((text): LineChange => ({ kind: 'same', text }))
  const a = left.slice(start, leftEnd)
  const b = right.slice(start, rightEnd)

  let middle: LineChange[]
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    // Too large to align line by line: show it as replaced.
    middle = [...a.map((text): LineChange => ({ kind: 'removed', text })), ...b.map((text): LineChange => ({ kind: 'added', text }))]
  } else {
    // Longest common subsequence, walked back into removals and additions.
    const width = b.length + 1
    const table = new Uint16Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    middle = []
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        middle.push({ kind: 'same', text: a[i] })
        i += 1
        j += 1
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        middle.push({ kind: 'removed', text: a[i] })
        i += 1
      } else {
        middle.push({ kind: 'added', text: b[j] })
        j += 1
      }
    }
    while (i < a.length) middle.push({ kind: 'removed', text: a[i++] })
    while (j < b.length) middle.push({ kind: 'added', text: b[j++] })
  }
  return [...head, ...middle, ...tail]
}

/**
 * The changed lines with `context` unchanged lines around each run of changes; gaps
 * between runs are marked with null, to show as "…".
 */
export function compactDiff(changes: LineChange[], context = 1): Array<LineChange | null> {
  const keep = new Array<boolean>(changes.length).fill(false)
  changes.forEach((change, index) => {
    if (change.kind === 'same') return
    for (let k = Math.max(0, index - context); k <= Math.min(changes.length - 1, index + context); k += 1) keep[k] = true
  })
  const out: Array<LineChange | null> = []
  let skipped = false
  changes.forEach((change, index) => {
    if (keep[index]) {
      if (skipped && out.length) out.push(null)
      skipped = false
      out.push(change)
    } else {
      skipped = true
    }
  })
  return out
}
