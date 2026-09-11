import { describe, expect, it } from 'vitest'
import { createDocumentVersion, mergeVersions, versionFromRow, versionToRow } from './documentVersions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('document versions', () => {
  it('creates uuid ids so a snapshot can also be stored in document_versions', () => {
    const version = createDocumentVersion({ id: 'doc-1', title: 'Lab' }, '# Lab', '手動儲存')
    expect(version.id).toMatch(UUID)
  })

  it('round-trips through the database row shape', () => {
    const version = createDocumentVersion({ id: 'doc-1', title: 'Lab' }, '# Lab', 'AI 修改前自動備份')
    const row = versionToRow(version, 'user-1')

    expect(row).toMatchObject({ id: version.id, document_id: 'doc-1', user_id: 'user-1', content: '# Lab' })
    expect(versionFromRow({ ...row, created_at: version.createdAt })).toEqual(version)
  })

  it('merges cloud and local copies without duplicates, newest first', () => {
    const older = { id: 'a', documentId: 'd', title: 't', content: '1', createdAt: '2026-09-10T00:00:00Z', note: '' }
    const newer = { ...older, id: 'b', content: '2', createdAt: '2026-09-11T00:00:00Z' }

    expect(mergeVersions([older], [older, newer]).map((version) => version.id)).toEqual(['b', 'a'])
  })

  it('keeps title and note within the column limits', () => {
    const version = createDocumentVersion({ id: 'd', title: 'x'.repeat(600) }, 'c', 'n'.repeat(300))
    const row = versionToRow(version, 'u')

    expect(row.title).toHaveLength(500)
    expect(row.note).toHaveLength(200)
  })
})
