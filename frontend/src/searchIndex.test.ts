import { describe, expect, it } from 'vitest'
import { searchEverything, type SearchDocument } from './searchIndex'

const doc = (overrides: Partial<SearchDocument>): SearchDocument => ({
  id: 'd',
  title: '未命名',
  content: '',
  type: 'file',
  isTrashed: false,
  createdAt: '2026-09-01T00:00:00Z',
  ...overrides,
})

const DOCUMENTS = [
  doc({ id: 'rc', title: 'RC 電路實驗', content: '# RC 電路實驗\n量測時間常數', updatedAt: '2026-09-10T00:00:00Z' }),
  doc({ id: 'stats', title: '機率與統計', content: '這週的作業提到 RC 電路的雜訊' }),
  doc({ id: 'trashed', title: 'RC 舊版', content: '', isTrashed: true }),
  doc({ id: 'folder', title: 'RC 資料夾', type: 'folder' }),
]
const TEMPLATES = [
  { id: 'electronics', title: '電子電路實驗標準結報', category: '電子電路', description: 'RC/RL 暫態' },
  { id: 'reading', title: '閱讀心得', category: '閱讀心得', description: '摘要、觀點' },
]

describe('global search', () => {
  it('returns nothing for an empty query', () => {
    expect(searchEverything('   ', DOCUMENTS, TEMPLATES)).toEqual([])
  })

  it('ranks title matches before content matches and skips trashed reports and folders', () => {
    const ids = searchEverything('rc', DOCUMENTS, TEMPLATES).filter((r) => r.kind === 'document').map((r) => (r.kind === 'document' ? r.id : ''))
    expect(ids).toEqual(['rc', 'stats'])
  })

  it('shows where the query appears in the content', () => {
    const stats = searchEverything('雜訊', DOCUMENTS, TEMPLATES).find((r) => r.kind === 'document')
    expect(stats?.snippet).toContain('雜訊')
  })

  it('finds templates by title, category or description', () => {
    expect(searchEverything('暫態', DOCUMENTS, TEMPLATES).some((r) => r.kind === 'template' && r.id === 'electronics')).toBe(true)
  })

  it('finds pages by name or keyword', () => {
    const pages = (query: string) => searchEverything(query, [], []).filter((r) => r.kind === 'page').map((r) => (r.kind === 'page' ? r.view : ''))
    expect(pages('設定')).toContain('settings')
    expect(pages('api')).toContain('settings')
    expect(pages('claude')).toContain('settings')
    expect(pages('垃圾')).toContain('trash')
    expect(pages('rain')).toEqual([])
  })
})
