// The header search ("搜尋報告、模板或設定...") used to be an input with no handler.
// This finds reports by title or content, templates, and the app's pages.

export type SearchDocument = {
  id: string
  title: string
  content: string
  type: 'file' | 'folder'
  isTrashed: boolean
  createdAt: string
  updatedAt?: string
}

export type SearchTemplate = { id: string; title: string; category: string; description: string }

export type SearchResult =
  | { kind: 'document'; id: string; title: string; snippet: string }
  | { kind: 'template'; id: string; title: string; snippet: string }
  | { kind: 'page'; view: string; title: string; snippet: string }

export const SEARCH_PAGES: Array<{ view: string; label: string; keywords: string[] }> = [
  { view: 'dashboard', label: '首頁', keywords: ['首頁', '總覽', 'home'] },
  { view: 'projects', label: '項目', keywords: ['項目', '報告', '文件', '資料夾', 'projects'] },
  { view: 'templates', label: '模板中心', keywords: ['模板', '範本', '臨摹', 'template'] },
  { view: 'prompts', label: '我的提示詞庫', keywords: ['提示詞', 'prompt'] },
  { view: 'trash', label: '垃圾桶', keywords: ['垃圾桶', '刪除', '復原', 'trash'] },
  {
    view: 'settings',
    label: 'AI 設定',
    keywords: ['設定', 'api', 'key', '金鑰', '額度', '模型', 'openai', 'chatgpt', 'claude', 'gemini', 'deepseek', 'settings'],
  },
]

function timeOf(document: SearchDocument): number {
  return new Date(document.updatedAt ?? document.createdAt).getTime() || 0
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 18)
  const end = Math.min(text.length, index + length + 42)
  const body = text.slice(start, end).replace(/[#>*`|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

function firstLine(text: string): string {
  const line = text.split('\n').map((item) => item.replace(/^#+\s*/, '').trim()).find(Boolean) ?? ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

function pageMatches(query: string, label: string, keywords: string[]): boolean {
  if (label.toLowerCase().includes(query)) return true
  return keywords.some((keyword) => keyword.startsWith(query) || (keyword.length >= 2 && query.startsWith(keyword)))
}

export function searchEverything(
  rawQuery: string,
  documents: SearchDocument[],
  templates: SearchTemplate[],
  limits = { documents: 6, templates: 3, pages: 3 },
): SearchResult[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []

  const documentResults = documents
    .filter((document) => document.type === 'file' && !document.isTrashed)
    .map((document) => {
      const inTitle = (document.title || '').toLowerCase().includes(query)
      const contentIndex = document.content.toLowerCase().indexOf(query)
      if (!inTitle && contentIndex === -1) return null
      return { document, score: inTitle ? 2 : 1, contentIndex }
    })
    .filter((entry): entry is { document: SearchDocument; score: number; contentIndex: number } => entry !== null)
    .sort((left, right) => right.score - left.score || timeOf(right.document) - timeOf(left.document))
    .slice(0, limits.documents)
    .map(({ document, contentIndex }) => ({
      kind: 'document' as const,
      id: document.id,
      title: document.title || '未命名報告',
      snippet: contentIndex >= 0 ? excerpt(document.content, contentIndex, query.length) : firstLine(document.content),
    }))

  const templateResults = templates
    .filter((template) => `${template.title} ${template.category} ${template.description}`.toLowerCase().includes(query))
    .slice(0, limits.templates)
    .map((template) => ({ kind: 'template' as const, id: template.id, title: template.title, snippet: template.category }))

  const pageResults = SEARCH_PAGES.filter((page) => pageMatches(query, page.label, page.keywords))
    .slice(0, limits.pages)
    .map((page) => ({ kind: 'page' as const, view: page.view, title: page.label, snippet: '前往這個頁面' }))

  return [...documentResults, ...templateResults, ...pageResults]
}
