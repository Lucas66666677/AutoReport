import { describe, expect, it, vi } from 'vitest'
import {
  REMOTE_VERSION_NOTE,
  decideRemoteChange,
  keepVersionInHistory,
  sameInstant,
  saveOverKnownVersion,
  type GuardedSave,
} from './remoteDocumentSync'

describe('sameInstant', () => {
  it('compares instants, not spellings', () => {
    expect(sameInstant('2026-09-18T04:12:55.123Z', '2026-09-18T04:12:55.123+00:00')).toBe(true)
    expect(sameInstant('2026-09-18T04:12:55.123Z', '2026-09-18T04:12:55.124Z')).toBe(false)
    expect(sameInstant(null, null)).toBe(true)
    expect(sameInstant(null, '2026-09-18T04:12:55Z')).toBe(false)
    expect(sameInstant('garbage', 'garbage')).toBe(false)
  })
})

describe('decideRemoteChange', () => {
  const base = { knownUpdatedAt: '2026-09-18T04:00:00Z', remoteUpdatedAt: '2026-09-18T04:05:00Z', remoteContent: 'AI 改過', localContent: '原本', hasUnsavedLocalChanges: false }

  it('shows the newer version when nothing here is unsaved', () => {
    expect(decideRemoteChange(base)).toBe('apply')
  })

  it('keeps the newer version aside when the student has unsaved typing', () => {
    expect(decideRemoteChange({ ...base, hasUnsavedLocalChanges: true })).toBe('conflict')
  })

  it('does nothing when the version is the one this tab saw, or the text is the same', () => {
    expect(decideRemoteChange({ ...base, remoteUpdatedAt: base.knownUpdatedAt })).toBe('unchanged')
    expect(decideRemoteChange({ ...base, remoteContent: '原本' })).toBe('unchanged')
  })

  it('compares the text when this tab has not seen a version yet', () => {
    expect(decideRemoteChange({ ...base, knownUpdatedAt: null, remoteContent: '原本' })).toBe('unchanged')
    expect(decideRemoteChange({ ...base, knownUpdatedAt: null })).toBe('apply')
  })
})

describe('saveOverKnownVersion', () => {
  function save(outcomes: Array<'saved' | 'missed'>, remote: { content: string; updatedAt: string | null } | null = null) {
    const calls: Array<string | null> = []
    const kept: string[] = []
    const deps: GuardedSave = {
      update: vi.fn(async (onlyIfUpdatedAt: string | null) => {
        calls.push(onlyIfUpdatedAt)
        return outcomes.shift() ?? 'missed'
      }),
      fetchRemote: vi.fn(async () => remote),
      keepRemoteVersion: vi.fn(async (content: string) => {
        kept.push(content)
      }),
    }
    return { deps, calls, kept }
  }

  it('saves over the version it saw', async () => {
    const { deps, calls, kept } = save(['saved'])
    await expect(saveOverKnownVersion('我的', '2026-09-18T04:00:00Z', deps)).resolves.toEqual({ keptRemote: false })
    expect(calls).toEqual(['2026-09-18T04:00:00Z'])
    expect(kept).toEqual([])
  })

  it('saves as before when it has not seen a version yet', async () => {
    const { deps, calls } = save(['saved'])
    await saveOverKnownVersion('我的', null, deps)
    expect(calls).toEqual([null])
  })

  // The case this exists for: ChatGPT changed the report while the student typed. Their
  // typing is saved, and ChatGPT's version is in the history rather than gone.
  it('keeps a version saved elsewhere in the history before saving the student’s typing', async () => {
    const { deps, calls, kept } = save(['missed', 'saved'], { content: 'ChatGPT 的修改', updatedAt: '2026-09-18T04:05:00Z' })
    await expect(saveOverKnownVersion('我的', '2026-09-18T04:00:00Z', deps)).resolves.toEqual({ keptRemote: true })
    expect(kept).toEqual(['ChatGPT 的修改'])
    expect(calls).toEqual(['2026-09-18T04:00:00Z', null])
  })

  it('keeps nothing extra when the other version says the same', async () => {
    const { deps, kept } = save(['missed', 'saved'], { content: '我的', updatedAt: '2026-09-18T04:05:00Z' })
    await expect(saveOverKnownVersion('我的', '2026-09-18T04:00:00Z', deps)).resolves.toEqual({ keptRemote: false })
    expect(kept).toEqual([])
  })

  it('reports a report that is gone, or that the student may no longer edit', async () => {
    await expect(saveOverKnownVersion('我的', null, save(['missed']).deps)).rejects.toThrow('沒有編輯權限')
    await expect(saveOverKnownVersion('我的', '2026-09-18T04:00:00Z', save(['missed'], null).deps)).rejects.toThrow()
    // Unchanged since this tab saw it, yet refused: permission, not a conflict -- and
    // nothing is put into the history for it.
    const unchanged = save(['missed'], { content: '舊的', updatedAt: '2026-09-18T04:00:00.000+00:00' })
    await expect(saveOverKnownVersion('我的', '2026-09-18T04:00:00Z', unchanged.deps)).rejects.toThrow('沒有編輯權限')
    expect(unchanged.kept).toEqual([])
  })
})

describe('keepVersionInHistory', () => {
  it('stores the other version with a note saying where it came from', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const client = { from: vi.fn(() => ({ insert })) }
    const version = await keepVersionInHistory(client, { id: 'doc-1', title: '單擺實驗' }, 'ChatGPT 的修改', 'user-1')
    expect(client.from).toHaveBeenCalledWith('document_versions')
    expect(insert.mock.calls[0][0][0]).toMatchObject({ document_id: 'doc-1', user_id: 'user-1', content: 'ChatGPT 的修改', note: REMOTE_VERSION_NOTE })
    expect(version.note).toBe(REMOTE_VERSION_NOTE)
    await expect(
      keepVersionInHistory({ from: () => ({ insert: vi.fn().mockResolvedValue({ error: { message: 'denied' } }) }) }, { id: 'd', title: 't' }, 'x', 'u'),
    ).rejects.toThrow('denied')
  })
})
