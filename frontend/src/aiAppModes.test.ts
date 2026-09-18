import { describe, expect, it } from 'vitest'
import {
  AI_APP_MODES,
  DEFAULT_AI_APP_MODE,
  compactDiff,
  lineDiff,
  loadGuestAiAppMode,
  loadHandledSuggestions,
  normalizeAiAppMode,
  rememberHandledSuggestion,
  saveGuestAiAppMode,
} from './aiAppModes'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

describe('AI app modes', () => {
  it('offers planning, manual and automatic, and keeps today’s behaviour by default', () => {
    expect(AI_APP_MODES.map((entry) => entry.label)).toEqual(['規劃', '手動', '自動'])
    expect(DEFAULT_AI_APP_MODE).toBe('auto')
  })

  it('reads a stored mode, and falls back to the default for anything else', () => {
    expect(normalizeAiAppMode('plan')).toBe('plan')
    expect(normalizeAiAppMode('manual')).toBe('manual')
    expect(normalizeAiAppMode('yolo')).toBe('auto')
    expect(normalizeAiAppMode(undefined)).toBe('auto')
  })
})

describe('a guest’s choice and handled suggestions', () => {
  it('keeps a guest’s mode in this browser', () => {
    const storage = memoryStorage()
    expect(loadGuestAiAppMode(storage)).toBe('auto')
    saveGuestAiAppMode('plan', storage)
    expect(loadGuestAiAppMode(storage)).toBe('plan')
    storage.setItem('autolabreport-ai-app-mode', 'anything')
    expect(loadGuestAiAppMode(storage)).toBe('auto')
  })

  it('remembers suggestions already decided, the latest 200', () => {
    const storage = memoryStorage()
    for (let index = 0; index < 205; index += 1) rememberHandledSuggestion(`remote-${index}`, storage)
    const handled = loadHandledSuggestions(storage)
    expect(handled.size).toBe(200)
    expect(handled.has('remote-204')).toBe(true)
    expect(handled.has('remote-0')).toBe(false)
  })
})

describe('lineDiff', () => {
  it('shows one changed line among unchanged ones', () => {
    expect(lineDiff('# 結果\n\n誤差待補。\n', '# 結果\n\n誤差約 0.25 s。\n')).toEqual([
      { kind: 'same', text: '# 結果' },
      { kind: 'same', text: '' },
      { kind: 'removed', text: '誤差待補。' },
      { kind: 'added', text: '誤差約 0.25 s。' },
      { kind: 'same', text: '' },
    ])
  })

  it('aligns additions and removals in the middle', () => {
    const changes = lineDiff('a\nb\nc\nd', 'a\nc\nx\nd')
    expect(changes.map((change) => `${change.kind[0]}${change.text}`)).toEqual(['sa', 'rb', 'sc', 'ax', 'sd'])
  })

  it('handles a report written from nothing and one emptied', () => {
    expect(lineDiff('', '# 新報告')).toEqual([
      { kind: 'removed', text: '' },
      { kind: 'added', text: '# 新報告' },
    ])
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ])
  })

  it('stays quick on a long report with one change', () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `第 ${index} 行`)
    const after = [...lines]
    after[2500] = '改過的一行'
    const changes = lineDiff(lines.join('\n'), after.join('\n'))
    expect(changes.filter((change) => change.kind !== 'same')).toEqual([
      { kind: 'removed', text: '第 2500 行' },
      { kind: 'added', text: '改過的一行' },
    ])
  })
})

describe('compactDiff', () => {
  it('keeps the changes with a line of context, and marks the gaps', () => {
    const changes = lineDiff('1\n2\n3\n4\n5\n6\n7\n8', '1\nX\n3\n4\n5\n6\nY\n8')
    expect(compactDiff(changes).map((change) => (change ? `${change.kind[0]}${change.text}` : '…'))).toEqual([
      's1',
      'r2',
      'aX',
      's3',
      '…',
      's6',
      'r7',
      'aY',
      's8',
    ])
  })
})
