import { describe, expect, it } from 'vitest'
import {
  queueDocumentSave,
  readDocumentSaveOutbox,
  removeDocumentSave,
  type PendingDocumentSave,
} from './documentSaveOutbox'

function createStorage(initialValue: string | null = null) {
  let value = initialValue
  return {
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => {
      value = nextValue
    },
  }
}

const firstSave: PendingDocumentSave = {
  documentId: 'doc-1',
  content: 'first',
  revision: 1,
  queuedAt: '2026-07-23T00:00:00.000Z',
}

describe('document save outbox', () => {
  it('keeps only the newest queued revision for a document', () => {
    const storage = createStorage()
    queueDocumentSave(storage, 'user-a', firstSave)
    queueDocumentSave(storage, 'user-a', { ...firstSave, content: 'second', revision: 2 })

    expect(readDocumentSaveOutbox(storage, 'user-a')).toEqual([
      { ...firstSave, content: 'second', revision: 2 },
    ])
  })

  it('does not remove a newer revision when an older request finishes', () => {
    const storage = createStorage()
    queueDocumentSave(storage, 'user-a', { ...firstSave, revision: 2 })
    removeDocumentSave(storage, 'user-a', firstSave.documentId, 1)

    expect(readDocumentSaveOutbox(storage, 'user-a')).toHaveLength(1)
  })

  it('drops malformed persisted data safely', () => {
    const storage = createStorage('{not-json')

    expect(readDocumentSaveOutbox(storage, 'user-a')).toEqual([])
  })

  it('isolates queued content by authenticated user', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    queueDocumentSave(storage, 'user-a', firstSave)

    expect(readDocumentSaveOutbox(storage, 'user-b')).toEqual([])
  })
})
