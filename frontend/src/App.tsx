import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from 'react'
import Editor from '@monaco-editor/react'
import html2pdf from 'html2pdf.js'
import 'katex/dist/katex.min.css'
import mermaid from 'mermaid'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react'
import type { editor } from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkMath from 'remark-math'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const RENDER_DEBOUNCE_MS = 300
const THEME_STORAGE_KEY = 'autolabreport-theme'
const CONTENT_STORAGE_KEY = 'autoLabReport_content'
const DOCUMENTS_STORAGE_KEY = 'autoLabReport_documents'
const ACTIVE_DOCUMENT_ID_STORAGE_KEY = 'autoLabReport_activeDocumentId'

const REMARK_PLUGINS = [remarkMath]
const REHYPE_PLUGINS = [rehypeKatex, rehypeRaw]
const ydoc = new Y.Doc()
const documentYDocs = new Map<string, Y.Doc>()
const YTEXT_NAME = 'monaco-or-textarea'
const LOCAL_YJS_ORIGIN = 'local-monaco'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

const DEFAULT_TEMPLATES = [
  {
    id: 'electronics-lab-report',
    title: '電子電路實驗標準結報',
    category: '電子電路',
    description: '適合基礎電路、RC/RL 暫態、放大器量測與誤差討論的完整結報骨架。',
    content: `# 電子電路實驗標準結報

## 實驗名稱

## 實驗目的
- 

## 實驗原理
請整理主要定律、公式與電路模型。

## 實驗器材
| 器材 | 型號/規格 | 數量 |
|---|---|---|
| 示波器 |  |  |
| 函數產生器 |  |  |
| 電阻/電容/電感 |  |  |

## 實驗步驟
1. 
2. 
3. 

## 數據紀錄
| 測量項目 | 理論值 | 實測值 | 誤差 |
|---|---|---|---|
|  |  |  |  |

## 結果分析

## 討論與誤差來源

## 結論
`,
  },
  {
    id: 'general-physics-prelab',
    title: '普物實驗預報',
    category: '普通物理',
    description: '用於實驗前預習，包含目的、原理推導、預期現象與風險檢核。',
    content: `# 普物實驗預報

## 實驗題目

## 預習目標
- 

## 理論背景
請寫下本實驗涉及的物理概念與核心公式。

## 預期實驗流程
1. 
2. 
3. 

## 預期數據與圖形

## 可能誤差來源
- 儀器解析度：
- 操作誤差：
- 環境因素：

## 安全注意事項

## 預習問題
1. 
2. 
`,
  },
  {
    id: 'chemistry-analysis-report',
    title: '化學分析實驗結報',
    category: '化學分析',
    description: '適合滴定、濃度分析、吸光度量測與標準曲線實驗。',
    content: `# 化學分析實驗結報

## 實驗名稱

## 實驗目的

## 反應原理
請列出反應式、平衡關係與計算公式。

## 藥品與儀器
| 名稱 | 濃度/規格 | 用途 |
|---|---|---|
|  |  |  |

## 實驗步驟

## 原始數據
| 試次 | 讀值 1 | 讀值 2 | 平均 |
|---|---|---|---|
| 1 |  |  |  |

## 計算過程

## 結果與討論

## 結論
`,
  },
  {
    id: 'digital-logic-lab',
    title: '數位邏輯實驗報告',
    category: '數位邏輯',
    description: '支援真值表、布林代數、邏輯閘模擬與電路驗證。',
    content: `# 數位邏輯實驗報告

## 實驗主題

## 實驗目的

## 理論基礎
### 布林代數

### 邏輯閘關係

## 設計規格

## 真值表
| A | B | 輸出 Y |
|---|---|---|
| 0 | 0 |  |
| 0 | 1 |  |
| 1 | 0 |  |
| 1 | 1 |  |

## 電路圖 / Mermaid
\`\`\`mermaid
flowchart LR
  A[A] --> G1[Logic Gate]
  B[B] --> G1
  G1 --> Y[Y]
\`\`\`

## 實驗結果

## 問題討論

## 結論
`,
  },
  {
    id: 'data-analysis-lab',
    title: '數據分析與誤差報告',
    category: '資料分析',
    description: '聚焦量測資料整理、標準差、不確定度、圖表與線性回歸分析。',
    content: `# 數據分析與誤差報告

## 實驗背景

## 量測資料
| 序號 | x | y | 備註 |
|---|---|---|---|
| 1 |  |  |  |

## 統計量
$$s = \\sqrt{\\frac{\\sum_{i=1}^N (x_i - \\bar{x})^2}{N-1}}$$

## 圖表與回歸
\`\`\`python
# 請在此輸入 Python 程式碼，系統將自動繪圖
\`\`\`

## 誤差分析

## 結論
`,
  },
]

type SyncStatus =
  | 'pending'
  | 'rendering'
  | 'synced'
  | 'error'
  | 'exporting'
  | 'exportingPdf'

type Document = {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt?: string
  isFavorite: boolean
  isTrashed: boolean
  type: 'file' | 'folder'
  parentId: string | null
}

type AppView = 'dashboard' | 'editor' | 'templates' | 'trash'

type WebrtcStatusEvent = {
  connected: boolean
}

type AiSelectionMenuState = {
  visible: boolean
  top: number
  left: number
  selectedText: string
}

type StoredSelectionRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

type PendingAiSelection = {
  range: StoredSelectionRange
  startOffset: number
  endOffset: number
  text: string
}

const TOOLBAR_ICON_BTN =
  'rounded-md p-2 text-zinc-500 transition-all hover:bg-zinc-200/50 hover:text-zinc-800 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
const SUBTLE_BUTTON =
  'rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-all hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
const SCROLLBAR_HIDE =
  'scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false
    const renderId = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    async function renderMermaid() {
      try {
        const result = await mermaid.render(renderId, chart)
        if (!isCancelled) {
          setSvg(result.svg)
          setError(null)
        }
      } catch (err) {
        if (!isCancelled) {
          const message = err instanceof Error ? err.message : 'Mermaid 渲染失敗'
          setError(message)
          setSvg('')
        }
      }
    }

    renderMermaid()

    return () => {
      isCancelled = true
    }
  }, [chart])

  if (error) {
    return <pre className="text-sm text-red-400">{error}</pre>
  }

  if (!svg) {
    return <p className="text-sm text-zinc-500">正在渲染 Mermaid 圖表...</p>
  }

  return (
    <div
      className="my-4 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

const MARKDOWN_COMPONENTS = {
  img: ({ alt, src, ...props }: ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} src={src} alt={alt ?? 'matplotlib plot'} className="pdf-plot-image" />
  ),
  code: ({ children, className, ...props }: HTMLAttributes<HTMLElement>) => {
    const match = /language-(\w+)/.exec(className ?? '')
    const code = String(children ?? '').replace(/\n$/, '')

    if (match?.[1] === 'mermaid') {
      return <MermaidBlock chart={code} />
    }

    return (
      <code {...props} className={className}>
        {children}
      </code>
    )
  },
}

function smartFormat(text: string): string {
  return removeConsecutiveDuplicateContent(text)
    .replace(/\([A-Za-z\s]+\)/g, '')
    .replace(/[（]\s*[A-Za-z\s]+[）]/g, '')
    .replace(/\s*([。，！？；：])\s*/g, '$1')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\*\*\s+(.*?)\s+\*\*/g, '**$1**')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^([*+-]|\d+\.)([^\s])/gm, '$1 $2')
}

function removeConsecutiveDuplicateContent(text: string): string {
  const dedupedParagraphs = text
    .split(/(\n{2,})/)
    .filter((chunk, index, chunks) => {
      if (/^\n+$/.test(chunk)) return true

      const previousContent = [...chunks.slice(0, index)]
        .reverse()
        .find((item) => !/^\n+$/.test(item))

      return chunk.trim() !== previousContent?.trim()
    })
    .join('')

  return dedupedParagraphs
    .split('\n')
    .map((line) => {
      const sentences = line.match(/[^。！？.!?]+[。！？.!?]?/g)
      if (!sentences) return line

      return sentences
        .filter((sentence, index, list) => {
          return index === 0 || sentence.trim() !== list[index - 1].trim()
        })
        .join('')
    })
    .join('\n')
}

function convertTsvToMarkdownTable(text: string): string {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((row) => row.split('\t').map((cell) => cell.trim().replace(/\|/g, '\\|')))
    .filter((row) => row.some(Boolean))

  if (!rows.length) return ''

  const columnCount = Math.max(...rows.map((row) => row.length))
  const normalizeRow = (row: string[]) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')

  const [headerRow, ...bodyRows] = rows.map(normalizeRow)
  const separator = Array.from({ length: columnCount }, () => '---')
  const tableRows = bodyRows.length ? bodyRows : [Array.from({ length: columnCount }, () => '')]

  return [
    `| ${headerRow.join(' | ')} |`,
    `|${separator.join('|')}|`,
    ...tableRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function applyAutoNumbering(text: string): string {
  let figureCount = 1
  let tableCount = 1

  return text
    .replace(/!\[([^\]]*)\]\(([^)\r\n]+)\)|\[@fig:[^\]\s]+\]/g, (_match, caption, url) => {
      const currentFigure = figureCount
      figureCount += 1

      if (caption !== undefined && url !== undefined) {
        const normalizedCaption = String(caption).trim()
        const numberedCaption = /^圖\s*\d+\s*[:：]/.test(normalizedCaption)
          ? normalizedCaption
          : `圖 ${currentFigure}: ${normalizedCaption || '圖片'}`

        return `![${numberedCaption}](${url})`
      }

      return `圖 ${currentFigure}`
    })
    .replace(/\[@tbl:[^\]\s]+\]/g, () => {
      const currentTable = tableCount
      tableCount += 1
      return `表 ${currentTable}`
    })
}

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark'

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function createDocument(title = '未命名報告', content = '', parentId: string | null = null): Document {
  const now = new Date().toISOString()
  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    createdAt: now,
    updatedAt: now,
    isFavorite: false,
    isTrashed: false,
    type: 'file',
    parentId,
  }
}

function createFolder(title = '新資料夾', parentId: string | null = null): Document {
  const now = new Date().toISOString()
  return {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content: '',
    createdAt: now,
    updatedAt: now,
    isFavorite: false,
    isTrashed: false,
    type: 'folder',
    parentId,
  }
}

function normalizeDocument(document: Document): Document {
  return {
    ...document,
    content: document.content ?? '',
    isFavorite: document.isFavorite ?? false,
    isTrashed: document.isTrashed ?? false,
    type: document.type ?? 'file',
    parentId: document.parentId ?? null,
  }
}

function getDocumentYDoc(documentId: string) {
  const existingDoc = documentYDocs.get(documentId)
  if (existingDoc) return existingDoc

  const nextDoc = documentYDocs.size === 0 ? ydoc : new Y.Doc()
  documentYDocs.set(documentId, nextDoc)
  return nextDoc
}

function getInitialDocuments(): Document[] {
  if (typeof window === 'undefined') return []

  const savedDocuments = window.localStorage.getItem(DOCUMENTS_STORAGE_KEY)
  if (savedDocuments) {
    try {
      const parsed = JSON.parse(savedDocuments) as Document[]
      if (Array.isArray(parsed)) return parsed.map(normalizeDocument)
    } catch {
      /* ignore invalid local storage payload */
    }
  }

  const legacyContent = window.localStorage.getItem(CONTENT_STORAGE_KEY) ?? ''
  return legacyContent.trim() ? [createDocument('實驗報告', legacyContent)] : []
}

function getInitialActiveDocumentId(documents: Document[]) {
  const firstFileId = documents.find((document) => document.type === 'file' && !document.isTrashed)?.id ?? ''
  if (typeof window === 'undefined') return firstFileId

  const savedId = window.localStorage.getItem(ACTIVE_DOCUMENT_ID_STORAGE_KEY)
  if (
    savedId &&
    documents.some((document) => document.id === savedId && document.type === 'file' && !document.isTrashed)
  ) {
    return savedId
  }

  return firstFileId
}

function getInitialWorkspace() {
  const documents = getInitialDocuments()
  return {
    documents,
    activeDocumentId: getInitialActiveDocumentId(documents),
  }
}

function DocumentSidebar({
  documents,
  activeDocumentId,
  currentView,
  isCollapsed,
  onToggleCollapsed,
  onChangeView,
  onCreateDocument,
  onCreateFolder,
  onCreateDocumentInFolder,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
  onToggleFavorite,
  onOpenExtensionModal,
  onOpenFeedback,
}: {
  documents: Document[]
  activeDocumentId: string
  currentView: AppView
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onChangeView: (view: AppView) => void
  onCreateDocument: () => void
  onCreateFolder: () => void
  onCreateDocumentInFolder: (parentId: string) => void
  onSelectDocument: (id: string) => void
  onRenameDocument: (id: string) => void
  onDeleteDocument: (id: string) => void
  onToggleFavorite: (id: string) => void
  onOpenExtensionModal: () => void
  onOpenFeedback: () => void
}) {
  const [isProjectTreeOpen, setIsProjectTreeOpen] = useState(true)
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(documents.filter((document) => document.type === 'folder').map((document) => document.id)),
  )
  const visibleDocuments = documents.filter((document) => !document.isTrashed)
  const fileDocuments = visibleDocuments.filter((document) => document.type === 'file')
  const favoriteDocuments = fileDocuments.filter((document) => document.isFavorite)

  function toggleFolder(folderId: string) {
    setExpandedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  function getChildren(parentId: string | null) {
    return visibleDocuments
      .filter((document) => document.parentId === parentId)
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
        return left.title.localeCompare(right.title, 'zh-Hant')
      })
  }

  if (isCollapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-zinc-200 bg-zinc-100/50 py-3 transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-950/70">
        <button
          type="button"
          title="展開工作區"
          onClick={onToggleCollapsed}
          className={TOOLBAR_ICON_BTN}
        >
          <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          title="總覽"
          onClick={() => onChangeView('dashboard')}
          className={`${TOOLBAR_ICON_BTN} mt-3`}
        >
          🏠
        </button>
        <button
          type="button"
          title="項目"
          onClick={() => {
            setIsProjectTreeOpen(true)
            onChangeView('editor')
          }}
          className={TOOLBAR_ICON_BTN}
        >
          📁
        </button>
        <button
          type="button"
          title="模板市集"
          onClick={() => onChangeView('templates')}
          className={TOOLBAR_ICON_BTN}
        >
          ✨
        </button>
        <button
          type="button"
          title="新增報告"
          onClick={onCreateDocument}
          className={`${TOOLBAR_ICON_BTN} mt-auto`}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          title="安裝擴充套件"
          onClick={onOpenExtensionModal}
          className={TOOLBAR_ICON_BTN}
        >
          🧩
        </button>
        <button
          type="button"
          title="垃圾桶"
          onClick={() => onChangeView('trash')}
          className={TOOLBAR_ICON_BTN}
        >
          🗑️
        </button>
      </aside>
    )
  }

  function renderDocumentNode(document: Document, depth = 0): ReactNode {
    const isActive = document.id === activeDocumentId
    const isFolder = document.type === 'folder'
    const isExpanded = expandedFolderIds.has(document.id)
    const children = isFolder ? getChildren(document.id) : []

    return (
      <div key={document.id}>
        <div
          className={`group flex items-center gap-1 rounded-md py-1.5 pr-2 transition ${
            isActive && !isFolder
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
          style={{ paddingLeft: `${10 + depth * 22}px` }}
        >
          <button
            type="button"
            title={document.title}
            onClick={() => {
              if (isFolder) toggleFolder(document.id)
              else onSelectDocument(document.id)
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-sm font-medium"
          >
            <span className="shrink-0">{isFolder ? (isExpanded ? '📂' : '📁') : '📄'}</span>
            <span className="truncate">{document.title}</span>
          </button>
          {isFolder ? (
            <button
              type="button"
              title="在此資料夾建立新報告"
              onClick={() => {
                setExpandedFolderIds((current) => new Set(current).add(document.id))
                onCreateDocumentInFolder(document.id)
              }}
              className="rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200/70 hover:text-blue-600 group-hover:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-blue-300"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              title={document.isFavorite ? '取消收藏' : '收藏'}
              onClick={() => onToggleFavorite(document.id)}
              className="rounded p-1 text-zinc-400 transition hover:bg-zinc-200/70 hover:text-amber-500 dark:hover:bg-zinc-700"
            >
              <Star
                className={`h-4 w-4 ${document.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
                strokeWidth={2}
              />
            </button>
          )}
          <button
            type="button"
            title="重新命名"
            onClick={() => onRenameDocument(document.id)}
            className="rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200/70 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          >
            <Pencil className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            title={isFolder ? '刪除資料夾' : '刪除檔案'}
            onClick={() => onDeleteDocument(document.id)}
            className="rounded p-1 text-zinc-400 opacity-0 transition hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/50 dark:hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {isFolder && isExpanded && children.length > 0 && (
          <div className="mt-1 space-y-1">{children.map((child) => renderDocumentNode(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-950/70">
      <div className="flex items-center justify-between px-5 py-5">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">AutoLabReport</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">SaaS Workspace</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="收合工作區"
            onClick={onToggleCollapsed}
            className={TOOLBAR_ICON_BTN}
          >
            <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={onCreateDocument}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-800 active:scale-[0.99] dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
        >
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          建立新報告
        </button>
      </div>

      <nav className="space-y-1 px-3 pb-3">
        <button
          type="button"
          onClick={() => onChangeView('dashboard')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
            currentView === 'dashboard'
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          <span className="w-5 text-center">🏠</span>
          首頁
        </button>
        <button
          type="button"
          onClick={() => {
            setIsProjectTreeOpen((current) => !current)
            onChangeView('editor')
          }}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
            currentView === 'editor'
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          <span className="w-5 text-center">📁</span>
          <span className="flex-1">項目</span>
          <span className="text-xs text-zinc-400">{isProjectTreeOpen ? '⌄' : '›'}</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeView('templates')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
            currentView === 'templates'
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          <span className="w-5 text-center">✨</span>
          探索模板
        </button>
        <button
          type="button"
          onClick={onOpenExtensionModal}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
        >
          <span className="w-5 text-center">🧩</span>
          安裝擴充套件
        </button>
        <button
          type="button"
          onClick={() => onChangeView('trash')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
            currentView === 'trash'
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          <span className="w-5 text-center">🗑️</span>
          垃圾桶
        </button>
      </nav>

      <div className={`min-h-0 flex-1 overflow-auto px-3 py-3 ${SCROLLBAR_HIDE}`}>
        {isProjectTreeOpen && (
          <>
            <div className="mb-3 flex items-center justify-between px-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  項目
                </h3>
                <p className="text-[11px] text-zinc-400">{fileDocuments.length} 份報告</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="建立新資料夾"
                  onClick={onCreateFolder}
                  className={TOOLBAR_ICON_BTN}
                >
                  📁
                </button>
                <button
                  type="button"
                  title="建立新報告"
                  onClick={onCreateDocument}
                  className={TOOLBAR_ICON_BTN}
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              </div>
            </div>
            {favoriteDocuments.length > 0 && (
              <section className="mb-4">
                <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  收藏
                </h3>
                <div className="space-y-1">{favoriteDocuments.map((document) => renderDocumentNode(document))}</div>
              </section>
            )}

            <section>
              <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                全部
              </h3>
              <div className="space-y-1">{getChildren(null).map((document) => renderDocumentNode(document))}</div>
            </section>
          </>
        )}
      </div>

      <div className="relative border-t border-zinc-200/60 p-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setIsMoreOpen((current) => !current)}
          className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
        >
          <span>更多</span>
          <span>⋯</span>
        </button>
        {isMoreOpen && (
          <div className="absolute bottom-14 left-3 right-3 rounded-xl border border-zinc-200/60 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => {
                setIsMoreOpen(false)
                onChangeView('trash')
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              🗑️ 垃圾桶
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMoreOpen(false)
                onOpenFeedback()
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              💡 意見回饋
            </button>
            <button
              type="button"
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ⚙️ 設定
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

function formatDocumentTime(value?: string) {
  if (!value) return '尚未記錄'

  try {
    return new Intl.DateTimeFormat('zh-TW', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return '尚未記錄'
  }
}

function getDocumentPreview(document: Document): string {
  const content = document.content.trim()
  if (!content) return ''

  const heading = content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading.slice(0, 100)

  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[[^\]]+]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function DashboardView({
  documents,
  onOpenDocument,
  onCreateDocument,
  onToggleFavorite,
}: {
  documents: Document[]
  onOpenDocument: (id: string) => void
  onCreateDocument: () => void
  onToggleFavorite: (id: string) => void
}) {
  const fileDocuments = documents.filter((document) => document.type === 'file' && !document.isTrashed)
  const recentDocuments = [...fileDocuments].sort((left, right) => {
    const leftTime = new Date(left.updatedAt ?? left.createdAt).getTime()
    const rightTime = new Date(right.updatedAt ?? right.createdAt).getTime()
    return rightTime - leftTime
  })

  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-zinc-50 transition-colors duration-300 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl px-8 py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Dashboard
            </p>
            <h1 className="mb-8 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              早安，準備好撰寫今天的實驗結報了嗎？
            </h1>
          </div>
          <button
            type="button"
            onClick={onCreateDocument}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          >
            新增報告
          </button>
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              近期編輯檔案
            </h2>
            <span className="text-sm text-zinc-400">{fileDocuments.length} 份文件</span>
          </div>
          {recentDocuments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-8 py-16 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-2xl dark:bg-zinc-800">
                📄
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">目前沒有報告</h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                點擊右上角建立第一份報告吧！
              </p>
              <button
                type="button"
                onClick={onCreateDocument}
                className="mt-6 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                建立第一份報告
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {recentDocuments.map((document) => {
                const previewText = getDocumentPreview(document)

                return (
                  <article
                    key={document.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenDocument(document.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onOpenDocument(document.id)
                      }
                    }}
                    className="group relative flex min-h-80 cursor-pointer flex-col overflow-hidden rounded-2xl border border-zinc-200/60 bg-white text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                  >
                    <button
                      type="button"
                      title={document.isFavorite ? '取消收藏' : '收藏'}
                      aria-label={document.isFavorite ? '取消收藏' : '收藏'}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggleFavorite(document.id)
                      }}
                      className="absolute right-4 top-4 z-10 rounded-full bg-white/90 p-2 text-zinc-400 shadow-sm ring-1 ring-zinc-200/70 transition hover:scale-105 hover:text-amber-500 dark:bg-zinc-900/90 dark:ring-zinc-700"
                    >
                      <Star
                        className={`h-4 w-4 ${
                          document.isFavorite ? 'fill-amber-400 text-amber-400' : ''
                        }`}
                        strokeWidth={2}
                      />
                    </button>

                    <div className="flex min-h-52 shrink-0 items-center justify-center bg-zinc-50 px-8 py-8 dark:bg-zinc-900/60">
                      <div className="h-36 w-full max-w-48 overflow-hidden rounded-xl border border-zinc-200/60 bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.04)] dark:border-zinc-800 dark:bg-zinc-950">
                        {previewText ? (
                          <div className="h-full rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                            <p className="line-clamp-6 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
                              {previewText}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="mb-4 flex items-center gap-2">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-xl dark:bg-zinc-800">
                                📄
                              </div>
                              <div className="h-3 w-20 rounded-full bg-zinc-200/80 dark:bg-zinc-700" />
                            </div>
                            <div className="h-2.5 rounded-full bg-zinc-200/70 dark:bg-zinc-700" />
                            <div className="h-2.5 w-11/12 rounded-full bg-zinc-200/60 dark:bg-zinc-700" />
                            <div className="h-2.5 w-9/12 rounded-full bg-zinc-200/60 dark:bg-zinc-700" />
                            <div className="mt-4 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="relative min-h-28 shrink-0 border-t border-zinc-100 bg-white p-5 pb-10 pr-12 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="mb-2 truncate text-lg font-semibold leading-snug text-zinc-800 dark:text-zinc-50">
                          {document.title}
                        </h3>
                        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                          最後修改：{formatDocumentTime(document.updatedAt ?? document.createdAt)}
                        </p>
                      </div>
                    </div>
                    <span
                      className="absolute bottom-4 right-4 rounded-full px-2 py-1 text-lg leading-none text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      onClick={(event) => event.stopPropagation()}
                      title="更多操作"
                    >
                      ⋯
                    </span>
                  </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function TrashView({
  documents,
  onRestoreDocument,
  onHardDeleteDocument,
}: {
  documents: Document[]
  onRestoreDocument: (id: string) => void
  onHardDeleteDocument: (id: string) => void
}) {
  const trashedDocuments = documents
    .filter((document) => document.type === 'file' && document.isTrashed)
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt ?? left.createdAt).getTime()
      const rightTime = new Date(right.updatedAt ?? right.createdAt).getTime()
      return rightTime - leftTime
    })

  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-zinc-50 transition-colors duration-300 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl px-8 py-12">
        <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Trash</p>
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          垃圾桶
        </h1>
        <p className="mb-8 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          軟刪除的報告會先放在這裡。你可以復原文件，或永久刪除不再保留。
        </p>

        {trashedDocuments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-8 py-16 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-2xl dark:bg-zinc-800">
              🗑️
            </div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">垃圾桶是空的</h3>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              被刪除的報告會出現在這裡，方便你復原或永久清除。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {trashedDocuments.map((document) => (
              <article
                key={document.id}
                className="rounded-2xl border border-zinc-200/60 bg-white p-5 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {document.title}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      刪除時間：{formatDocumentTime(document.updatedAt ?? document.createdAt)}
                    </p>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                      {getDocumentPreview(document) || '這份報告沒有可顯示的內容預覽。'}
                    </p>
                  </div>
                  {document.isFavorite && (
                    <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" strokeWidth={2} />
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRestoreDocument(document.id)}
                    className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                  >
                    復原
                  </button>
                  <button
                    type="button"
                    onClick={() => onHardDeleteDocument(document.id)}
                    className="rounded-lg border border-red-200 px-3.5 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    永久刪除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

function TemplatesView({
  onUseTemplate,
}: {
  onUseTemplate: (template: (typeof DEFAULT_TEMPLATES)[number]) => void
}) {
  const [selectedCategory, setSelectedCategory] = useState('全部')
  const categories = ['全部', ...Array.from(new Set(DEFAULT_TEMPLATES.map((template) => template.category)))]
  const templates =
    selectedCategory === '全部'
      ? DEFAULT_TEMPLATES
      : DEFAULT_TEMPLATES.filter((template) => template.category === selectedCategory)

  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-zinc-50 transition-colors duration-300 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl px-8 py-12">
        <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Templates</p>
        <h1 className="mb-8 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          探索實驗模板
        </h1>
        <p className="-mt-5 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          從常見 STEM 實驗骨架開始，套用後會建立成新的本地報告並直接進入編輯器。
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                selectedCategory === category
                  ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950'
                  : 'border-zinc-200/60 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
          {templates.map((template) => (
            <article
              key={template.id}
              className="flex min-h-72 cursor-pointer flex-col rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-all duration-300 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            >
              <div className="mb-4">
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {template.category}
                </span>
              </div>
              <h2 className="mb-2 text-lg font-semibold text-zinc-800 dark:text-zinc-50">
                {template.title}
              </h2>
              <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {template.description}
              </p>
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={() => onUseTemplate(template)}
                  className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                >
                  套用此模板
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}

function LandingPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className={`min-h-screen overflow-auto bg-[#FAFAFC] text-zinc-900 ${SCROLLBAR_HIDE}`}>
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
        <div className="text-sm font-semibold tracking-tight">AutoLabReport</div>
        <button
          type="button"
          onClick={onLogin}
          className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
        >
          登入
        </button>
      </nav>

      <main className="px-6 pb-20">
        <section className="mx-auto max-w-6xl pt-10">
          <h1 className="mx-auto mt-20 text-center text-5xl font-bold tracking-tight text-zinc-900 md:text-7xl">
            重塑你的學術生產力。
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-8 text-zinc-500 md:text-xl">
            結合 AI 驅動與 Markdown 協作，為理工實驗結報打造的下一代撰寫平台。
          </p>
          <button
            type="button"
            onClick={onLogin}
            className="mx-auto mt-10 flex items-center justify-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-zinc-900">
              G
            </span>
            使用 Google 繼續
          </button>

          <div className="mx-auto mt-16 h-96 max-w-5xl overflow-hidden rounded-2xl border border-zinc-200/60 bg-white shadow-[0_20px_50px_rgba(0,0,0,0.03)]">
            <div className="flex h-10 items-center gap-2 border-b border-zinc-100 px-5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
            </div>
            <div className="grid h-[calc(100%-2.5rem)] grid-cols-[260px_1fr]">
              <aside className="border-r border-zinc-100 bg-zinc-50/70 p-6">
                <div className="mb-8 h-4 w-28 rounded-full bg-zinc-200/80" />
                <div className="space-y-3">
                  <div className="h-8 rounded-lg bg-white shadow-sm" />
                  <div className="h-8 rounded-lg bg-zinc-200/50" />
                  <div className="h-8 rounded-lg bg-zinc-200/40" />
                </div>
                <div className="mt-10 space-y-3">
                  <div className="h-3 w-20 rounded-full bg-zinc-200/70" />
                  <div className="h-7 rounded-md bg-zinc-200/40" />
                  <div className="h-7 rounded-md bg-zinc-200/40" />
                </div>
              </aside>
              <div className="grid grid-cols-2">
                <div className="border-r border-zinc-100 p-8">
                  <div className="mb-8 h-5 w-44 rounded-full bg-zinc-200/80" />
                  <div className="space-y-4">
                    <div className="h-3 w-11/12 rounded-full bg-zinc-200/70" />
                    <div className="h-3 w-10/12 rounded-full bg-zinc-200/60" />
                    <div className="h-3 w-8/12 rounded-full bg-zinc-200/60" />
                    <div className="h-24 rounded-xl border border-zinc-100 bg-zinc-50" />
                    <div className="h-3 w-9/12 rounded-full bg-zinc-200/60" />
                    <div className="h-3 w-7/12 rounded-full bg-zinc-200/50" />
                  </div>
                </div>
                <div className="p-8">
                  <div className="mb-8 h-5 w-36 rounded-full bg-zinc-200/80" />
                  <div className="space-y-5">
                    <div className="h-4 w-8/12 rounded-full bg-zinc-200/70" />
                    <div className="space-y-3">
                      <div className="h-3 rounded-full bg-zinc-200/50" />
                      <div className="h-3 w-11/12 rounded-full bg-zinc-200/50" />
                      <div className="h-3 w-10/12 rounded-full bg-zinc-200/50" />
                    </div>
                    <div className="h-32 rounded-xl bg-zinc-50 ring-1 ring-zinc-100" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function WorkspaceApp() {
  const [initialWorkspace] = useState(getInitialWorkspace)
  const [documents, setDocuments] = useState<Document[]>(initialWorkspace.documents)
  const [activeDocumentId, setActiveDocumentId] = useState(initialWorkspace.activeDocumentId)
  const [currentView, setCurrentView] = useState<AppView>('dashboard')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const activeDocument =
    documents.find((document) => document.id === activeDocumentId && document.type === 'file' && !document.isTrashed) ??
    documents.find((document) => document.type === 'file' && !document.isTrashed)
  const [markdown, setMarkdown] = useState(activeDocument?.content ?? '')
  const [preview, setPreview] = useState('')
  const [theme] = useState<'light' | 'dark'>(getInitialTheme)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced')
  const [renderError, setRenderError] = useState<string | null>(null)
  const [, setExporting] = useState(false)
  const [isOutlineModalOpen, setIsOutlineModalOpen] = useState(false)
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false)
  const [isAdvancedMenuOpen, setIsAdvancedMenuOpen] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(activeDocument?.title ?? '')
  const [outlineExampleText, setOutlineExampleText] = useState('')
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [bridgeToast, setBridgeToast] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [aiSelectionMenu, setAiSelectionMenu] = useState<AiSelectionMenuState>({
    visible: false,
    top: 0,
    left: 0,
    selectedText: '',
  })
  const [collaborationStatus, setCollaborationStatus] = useState('等待連線...')
  const [onlineCount, setOnlineCount] = useState(1)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorScrollDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorContentDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorSelectionDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorPasteCleanupRef = useRef<(() => void) | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const advancedMenuRef = useRef<HTMLDivElement | null>(null)
  const documentsRef = useRef<Document[]>(documents)
  const providerRef = useRef<WebrtcProvider | null>(null)
  const ytextRef = useRef<Y.Text | null>(null)
  const ytextObserverCleanupRef = useRef<(() => void) | null>(null)
  const isApplyingRemoteRef = useRef(false)
  const activeAiSelectionRef = useRef<PendingAiSelection | null>(null)
  const pendingAiSelectionRef = useRef<PendingAiSelection | null>(null)
  const shareResetTimerRef = useRef<number | null>(null)
  const hasOpenedSharedDocRef = useRef(false)

  const isEditorEmpty = !markdown.trim()
  const isDarkMode = theme === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme, isDarkMode])

  useEffect(() => {
    window.localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(documents))
  }, [documents])

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_ID_STORAGE_KEY, activeDocumentId)
  }, [activeDocumentId])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        advancedMenuRef.current &&
        event.target instanceof Node &&
        !advancedMenuRef.current.contains(event.target)
      ) {
        setIsAdvancedMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(CONTENT_STORAGE_KEY, markdown)
      setDocuments((currentDocuments) =>
        currentDocuments.map((document) =>
          document.id === activeDocumentId && document.content !== markdown
            ? { ...document, content: markdown, updatedAt: new Date().toISOString() }
            : document,
        ),
      )
    }, 300)

    return () => {
      clearTimeout(timer)
    }
  }, [activeDocumentId, markdown])

  useEffect(() => {
    return () => {
      editorScrollDisposableRef.current?.dispose()
      editorContentDisposableRef.current?.dispose()
      editorSelectionDisposableRef.current?.dispose()
      editorPasteCleanupRef.current?.()
      if (shareResetTimerRef.current !== null) {
        window.clearTimeout(shareResetTimerRef.current)
      }
      ytextObserverCleanupRef.current?.()
      providerRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  useEffect(() => {
    if (hasOpenedSharedDocRef.current) return

    const sharedDocId = new URLSearchParams(window.location.search).get('docId')
    if (!sharedDocId) return

    const sharedDocument = documents.find(
      (document) => document.id === sharedDocId && document.type === 'file' && !document.isTrashed,
    )
    if (!sharedDocument) return

    hasOpenedSharedDocRef.current = true
    const openTimer = window.setTimeout(() => {
      setActiveDocumentId(sharedDocument.id)
      isApplyingRemoteRef.current = true
      updateMarkdownValue(sharedDocument.content)
      editorRef.current?.setValue(sharedDocument.content)
      isApplyingRemoteRef.current = false
      setCurrentView('editor')
    }, 0)

    return () => window.clearTimeout(openTimer)
  }, [documents])

  useEffect(() => {
    function handleAutoLabReportInsert(event: Event) {
      const customEvent = event as CustomEvent<{ text?: string }>
      const incomingText = customEvent.detail?.text?.trim()
      if (!incomingText) return

      const ytext = ytextRef.current
      const ed = editorRef.current
      const model = ed?.getModel()
      const position = ed?.getPosition()
      const cursorOffset = model && position ? model.getOffsetAt(position) : ytext?.length ?? 0
      const pendingReplacement = pendingAiSelectionRef.current

      if (ytext && pendingReplacement) {
        ytext.doc?.transact(() => {
          ytext.delete(
            pendingReplacement.startOffset,
            pendingReplacement.endOffset - pendingReplacement.startOffset,
          )
          ytext.insert(pendingReplacement.startOffset, incomingText)
        }, LOCAL_YJS_ORIGIN)
        pendingAiSelectionRef.current = null
        setAiSelectionMenu((current) => ({ ...current, visible: false }))
      } else if (ytext) {
        ytext.doc?.transact(() => {
          ytext.insert(cursorOffset, incomingText)
        }, LOCAL_YJS_ORIGIN)
      } else if (ed && pendingReplacement) {
        ed.executeEdits('extension-bridge', [
          {
            range: pendingReplacement.range,
            text: incomingText,
            forceMoveMarkers: true,
          },
        ])
        ed.focus()
        pendingAiSelectionRef.current = null
        setAiSelectionMenu((current) => ({ ...current, visible: false }))
      } else if (ed) {
        const selection = ed.getSelection()
        if (selection) {
          ed.executeEdits('extension-bridge', [
            { range: selection, text: incomingText, forceMoveMarkers: true },
          ])
          ed.focus()
        }
      }

      setBridgeToast('✨ 成功接收 AI 內容並同步至協作房間！')
    }

    window.addEventListener('AutoLabReport_Insert', handleAutoLabReportInsert)
    window.addEventListener('autolabreport:bridge-text', handleAutoLabReportInsert)

    return () => {
      window.removeEventListener('AutoLabReport_Insert', handleAutoLabReportInsert)
      window.removeEventListener('autolabreport:bridge-text', handleAutoLabReportInsert)
    }
  }, [])

  useEffect(() => {
    if (!bridgeToast) return

    const timer = window.setTimeout(() => {
      setBridgeToast(null)
    }, 2600)

    return () => {
      clearTimeout(timer)
    }
  }, [bridgeToast])

  useEffect(() => {
    if (!activeDocumentId) return

    ytextObserverCleanupRef.current?.()
    providerRef.current?.destroy()

    const activeDoc = documentsRef.current.find((document) => document.id === activeDocumentId)
    const roomDoc = getDocumentYDoc(activeDocumentId)
    const ytext = roomDoc.getText(YTEXT_NAME)

    if (ytext.length === 0 && activeDoc?.content) {
      roomDoc.transact(() => {
        ytext.insert(0, activeDoc.content)
      }, LOCAL_YJS_ORIGIN)
    }

    ytextRef.current = ytext
    const nextMarkdown = ytext.toString()
    isApplyingRemoteRef.current = true
    updateMarkdownValue(nextMarkdown)
    editorRef.current?.setValue(nextMarkdown)
    isApplyingRemoteRef.current = false

    const provider = new WebrtcProvider(activeDocumentId, roomDoc)
    providerRef.current = provider
    const initialStatusTimer = window.setTimeout(() => {
      setCollaborationStatus('等待連線...')
      setOnlineCount(provider.awareness.getStates().size || 1)
    }, 0)
    provider.awareness.setLocalStateField('user', {
      name: `User-${Math.random().toString(36).slice(2, 6)}`,
    })

    const handleStatus = (event: WebrtcStatusEvent) => {
      setCollaborationStatus(
        event.connected ? '🔗 已連線至協作房間' : '等待連線...',
      )
    }
    const handleAwarenessChange = () => {
      setOnlineCount(provider.awareness.getStates().size || 1)
    }
    const handleYTextChange = () => {
      const remoteValue = ytext.toString()
      isApplyingRemoteRef.current = true
      updateMarkdownValue(remoteValue)
      if (editorRef.current && editorRef.current.getValue() !== remoteValue) {
        editorRef.current.setValue(remoteValue)
      }
      isApplyingRemoteRef.current = false
    }

    provider.on('status', handleStatus)
    provider.awareness.on('change', handleAwarenessChange)
    ytext.observe(handleYTextChange)
    ytextObserverCleanupRef.current = () => {
      ytext.unobserve(handleYTextChange)
      provider.awareness.off('change', handleAwarenessChange)
      provider.off('status', handleStatus)
    }

    return () => {
      clearTimeout(initialStatusTimer)
      ytext.unobserve(handleYTextChange)
      provider.awareness.off('change', handleAwarenessChange)
      provider.off('status', handleStatus)
      provider.destroy()
      if (providerRef.current === provider) {
        providerRef.current = null
      }
    }
  }, [activeDocumentId])

  useEffect(() => {
    if (isEditorEmpty) {
      return
    }

    const controller = new AbortController()

    const timer = window.setTimeout(async () => {
      const previewMarkdown = applyAutoNumbering(markdown)
      setSyncStatus('rendering')
      setRenderError(null)
      try {
        const res = await fetch(`${API_BASE_URL}/api/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: previewMarkdown }),
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = (await res.json()) as { markdown: string }
        setPreview(data.markdown)
        setSyncStatus('synced')
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        const message = err instanceof Error ? err.message : '渲染失敗'
        setRenderError(message)
        setPreview('')
        setSyncStatus('error')
      }
    }, RENDER_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [markdown, isEditorEmpty])

  function updateMarkdownValue(value: string) {
    setMarkdown(value)
    if (!value.trim()) {
      setPreview('')
      setRenderError(null)
      setSyncStatus('synced')
    } else {
      setSyncStatus('pending')
    }
  }

  function syncEditorValue(value: string) {
    updateMarkdownValue(value)
    if (editorRef.current) {
      editorRef.current.setValue(value)
      return
    }

    const ytext = ytextRef.current
    if (!ytext) return

    ytext.doc?.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, value)
    }, LOCAL_YJS_ORIGIN)
  }

  function applyMonacoChangesToYText(event: editor.IModelContentChangedEvent) {
    if (isApplyingRemoteRef.current) return

    const ytext = ytextRef.current
    if (!ytext) {
      updateMarkdownValue(editorRef.current?.getValue() ?? '')
      return
    }

    ytext.doc?.transact(() => {
      [...event.changes]
        .sort((left, right) => right.rangeOffset - left.rangeOffset)
        .forEach((change) => {
          if (change.rangeLength > 0) {
            ytext.delete(change.rangeOffset, change.rangeLength)
          }
          if (change.text) {
            ytext.insert(change.rangeOffset, change.text)
          }
        })
    }, LOCAL_YJS_ORIGIN)

    updateMarkdownValue(ytext.toString())
  }

  function syncPreviewScroll() {
    const ed = editorRef.current
    const preview = previewRef.current
    if (!ed || !preview) return

    const editorMaxScroll = ed.getScrollHeight() - ed.getLayoutInfo().height
    const scrollRatio = editorMaxScroll > 0 ? ed.getScrollTop() / editorMaxScroll : 0
    const previewMaxScroll = preview.scrollHeight - preview.clientHeight

    preview.scrollTop = scrollRatio * Math.max(previewMaxScroll, 0)
  }

  function updateAiSelectionMenu(ed: editor.IStandaloneCodeEditor) {
    const selection = ed.getSelection()
    const model = ed.getModel()
    if (!selection || !model || selection.isEmpty()) {
      activeAiSelectionRef.current = null
      setAiSelectionMenu((current) =>
        current.visible ? { ...current, visible: false, selectedText: '' } : current,
      )
      return
    }

    const selectedText = model.getValueInRange(selection)
    if (!selectedText.trim()) {
      activeAiSelectionRef.current = null
      setAiSelectionMenu((current) =>
        current.visible ? { ...current, visible: false, selectedText: '' } : current,
      )
      return
    }

    const startPosition = selection.getStartPosition()
    const endPosition = selection.getEndPosition()
    const visiblePosition = ed.getScrolledVisiblePosition(endPosition)
    const layoutInfo = ed.getLayoutInfo()
    const top = Math.max(8, (visiblePosition?.top ?? 48) - 46)
    const left = Math.min(
      Math.max(8, visiblePosition?.left ?? 8),
      Math.max(8, layoutInfo.width - 220),
    )

    activeAiSelectionRef.current = {
      range: {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      },
      startOffset: model.getOffsetAt(startPosition),
      endOffset: model.getOffsetAt(endPosition),
      text: selectedText,
    }
    setAiSelectionMenu({
      visible: true,
      top,
      left,
      selectedText,
    })
  }

  function requestAiEdit(action: 'rewrite' | 'expand') {
    const activeSelection = activeAiSelectionRef.current
    if (!activeSelection) return

    pendingAiSelectionRef.current = activeSelection
    window.dispatchEvent(
      new CustomEvent('AutoLabReport_RequestAI', {
        detail: {
          text: activeSelection.text,
          action,
        },
      }),
    )
    setAiSelectionMenu((current) => ({ ...current, visible: false }))
    setBridgeToast(action === 'rewrite' ? '已送出潤飾重寫請求' : '已送出擴寫內容請求')
  }

  function applyEditorEdit(text: string, cursorOffset?: number) {
    const ed = editorRef.current
    if (!ed) return

    const selection = ed.getSelection()
    if (!selection) return

    ed.executeEdits('toolbar', [{ range: selection, text, forceMoveMarkers: true }])
    updateMarkdownValue(ed.getValue())

    if (cursorOffset !== undefined) {
      const start = selection.getStartPosition()
      ed.setPosition({
        lineNumber: start.lineNumber,
        column: start.column + cursorOffset,
      })
    }
    ed.focus()
  }

  function insertAtCursor(snippet: string, cursorOffset?: number) {
    applyEditorEdit(snippet, cursorOffset)
  }

  function handleEditorPaste(event: ClipboardEvent) {
    const pastedText = event.clipboardData?.getData('text/plain') ?? ''
    if (!pastedText.includes('\t') || !/\r?\n/.test(pastedText)) return

    const table = convertTsvToMarkdownTable(pastedText)
    if (!table) return

    event.preventDefault()
    event.stopPropagation()
    insertAtCursor(table)
  }

  function handleSmartFormat() {
    syncEditorValue(smartFormat(markdown))
    editorRef.current?.focus()
  }

  async function generateOutline() {
    setOutlineLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/generate-outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_structure: outlineExampleText }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = (await res.json()) as { markdown: string }
      const outlineMarkdown = data.markdown.trim()
      if (!outlineMarkdown) {
        throw new Error('後端未回傳大綱內容')
      }

      if (editorRef.current) {
        insertAtCursor(`${markdown.trim() ? '\n\n' : ''}${outlineMarkdown}\n`)
      } else {
        syncEditorValue(markdown.trim() ? `${markdown}\n\n${outlineMarkdown}\n` : `${outlineMarkdown}\n`)
      }

      setIsOutlineModalOpen(false)
      setOutlineExampleText('')
    } catch (err) {
      const message = err instanceof Error ? err.message : '產生大綱失敗'
      window.alert(`產生大綱失敗：${message}`)
    } finally {
      setOutlineLoading(false)
    }
  }

  function loadDocument(document: Document) {
    if (document.type !== 'file' || document.isTrashed) return

    setActiveDocumentId(document.id)
    isApplyingRemoteRef.current = true
    updateMarkdownValue(document.content)
    editorRef.current?.setValue(document.content)
    isApplyingRemoteRef.current = false
  }

  function createDocumentForParent(parentId: string | null) {
    const fileCount = documents.filter((document) => document.type === 'file' && !document.isTrashed).length
    const nextDocument = createDocument(`未命名報告 ${fileCount + 1}`, '', parentId)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    loadDocument(nextDocument)
    setCurrentView('editor')
  }

  function createNewDocument() {
    createDocumentForParent(null)
  }

  function createDocumentFromTemplate(template: (typeof DEFAULT_TEMPLATES)[number]) {
    const nextDocument = createDocument(template.title, template.content, null)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    loadDocument(nextDocument)
    setCurrentView('editor')
    window.setTimeout(() => {
      editorRef.current?.focus()
      editorRef.current?.setPosition({ lineNumber: 1, column: 1 })
    }, 0)
  }

  function createNewFolder(parentId: string | null = null) {
    const title = window.prompt('資料夾名稱', '新資料夾')?.trim()
    if (!title) return

    const nextFolder = createFolder(title, parentId)
    setDocuments((currentDocuments) => [...currentDocuments, nextFolder])
  }

  function createDocumentInFolder(parentId: string) {
    createDocumentForParent(parentId)
  }

  function selectDocument(id: string) {
    const nextDocument = documents.find((document) => document.id === id)
    if (!nextDocument || nextDocument.type !== 'file' || nextDocument.isTrashed) return

    loadDocument(nextDocument)
    setCurrentView('editor')
  }

  function renameDocument(id: string) {
    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return

    const nextTitle = window.prompt('重新命名檔案', targetDocument.title)?.trim()
    if (!nextTitle) return

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === id ? { ...document, title: nextTitle, updatedAt: new Date().toISOString() } : document,
      ),
    )
  }

  function updateActiveDocumentTitle(nextTitle: string) {
    const trimmedTitle = nextTitle.trim()
    if (!activeDocument || !trimmedTitle) {
      setTitleDraft(activeDocument?.title ?? '')
      setIsTitleEditing(false)
      return
    }

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === activeDocument.id
          ? { ...document, title: trimmedTitle, updatedAt: new Date().toISOString() }
          : document,
      ),
    )
    setTitleDraft(trimmedTitle)
    setIsTitleEditing(false)
  }

  function deleteDocument(id: string) {
    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return
    const deleteLabel = targetDocument.type === 'folder' ? '資料夾與其中所有項目' : '檔案'
    if (!window.confirm(`將${deleteLabel}「${targetDocument.title}」移至垃圾桶？`)) return

    const idsToDelete = new Set<string>([id])
    let previousSize = 0
    while (idsToDelete.size !== previousSize) {
      previousSize = idsToDelete.size
      documents.forEach((document) => {
        if (document.parentId && idsToDelete.has(document.parentId)) {
          idsToDelete.add(document.id)
        }
      })
    }

    const now = new Date().toISOString()
    const nextDocuments = documents.map((document) =>
      idsToDelete.has(document.id) ? { ...document, isTrashed: true, updatedAt: now } : document,
    )
    const remainingFiles = nextDocuments.filter((document) => document.type === 'file' && !document.isTrashed)

    setDocuments(nextDocuments)
    if (idsToDelete.has(activeDocumentId)) {
      const nextDocument = remainingFiles[0]
      if (nextDocument) {
        loadDocument(nextDocument)
      } else {
        setActiveDocumentId('')
        isApplyingRemoteRef.current = true
        updateMarkdownValue('')
        editorRef.current?.setValue('')
        isApplyingRemoteRef.current = false
        setCurrentView('dashboard')
      }
    }
  }

  function restoreDocument(id: string) {
    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return

    const idsToRestore = new Set<string>([id])
    let parentId = targetDocument.parentId
    while (parentId) {
      const parentDocument = documents.find((document) => document.id === parentId)
      if (!parentDocument) break
      idsToRestore.add(parentDocument.id)
      parentId = parentDocument.parentId
    }

    const now = new Date().toISOString()
    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        idsToRestore.has(document.id) ? { ...document, isTrashed: false, updatedAt: now } : document,
      ),
    )
  }

  function hardDeleteDocument(id: string) {
    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return
    if (!window.confirm(`永久刪除「${targetDocument.title}」？此操作無法復原。`)) return

    const idsToDelete = new Set<string>([id])
    let previousSize = 0
    while (idsToDelete.size !== previousSize) {
      previousSize = idsToDelete.size
      documents.forEach((document) => {
        if (document.parentId && idsToDelete.has(document.parentId)) {
          idsToDelete.add(document.id)
        }
      })
    }

    setDocuments((currentDocuments) => currentDocuments.filter((document) => !idsToDelete.has(document.id)))
  }

  function toggleDocumentFavorite(id: string) {
    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === id && document.type === 'file' && !document.isTrashed
          ? { ...document, isFavorite: !document.isFavorite, updatedAt: new Date().toISOString() }
          : document,
      ),
    )
  }

  function openFeedback() {
    window.location.href = 'mailto:?subject=AutoLabReport%20%E5%8F%8D%E9%A5%8B'
  }

  async function downloadExportFile(endpoint: string, filename: string, status: SyncStatus) {
    setExporting(true)
    setSyncStatus(status)
    try {
      const exportMarkdown = applyAutoNumbering(markdown)
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: exportMarkdown }),
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const err = (await res.json()) as { detail?: string | string[] }
          if (typeof err.detail === 'string') detail = err.detail
          else if (Array.isArray(err.detail)) detail = err.detail.join(', ')
        } catch {
          /* response may not be JSON */
        }
        throw new Error(detail)
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setSyncStatus('synced')
    } catch (err) {
      const message = err instanceof Error ? err.message : '匯出失敗'
      setRenderError(message)
      setSyncStatus('error')
    } finally {
      setExporting(false)
    }
  }

  function exportWordReport() {
    if (isEditorEmpty) {
      setRenderError('請先貼上或撰寫報告內容再匯出')
      return
    }
    return downloadExportFile('/api/export', 'AutoLabReport.docx', 'exporting')
  }

  async function exportPdfReport() {
    if (isEditorEmpty || !preview) {
      setRenderError('請等待預覽同步完成後再匯出 PDF')
      return
    }

    const element = document.getElementById('pdf-preview-content')
    if (!element) {
      setRenderError('找不到預覽內容，請稍後再試')
      return
    }

    setExporting(true)
    setSyncStatus('exportingPdf')
    setRenderError(null)

    try {
      element.classList.add('pdf-print-mode')

      const pdfOptions = {
        margin: [12, 12, 12, 12] as [number, number, number, number],
        filename: 'AutoLabReport.pdf',
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
        pagebreak: {
          mode: ['avoid-all', 'css', 'legacy'],
          avoid: ['img', 'h1', 'h2', 'h3', 'pre', 'table'],
        },
      }

      await html2pdf()
        .set(pdfOptions as never)
        .from(element)
        .save()

      setSyncStatus('synced')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF 匯出失敗'
      setRenderError(message)
      setSyncStatus('error')
    } finally {
      element.classList.remove('pdf-print-mode')
      setExporting(false)
    }
  }

  function downloadMarkdownReport() {
    if (isEditorEmpty) {
      setRenderError('請先貼上或撰寫報告內容再下載')
      return
    }

    const filename = `${activeDocument?.title ?? 'AutoLabReport'}.md`
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    setIsAdvancedMenuOpen(false)
  }

  function syncWithGithub() {
    setBridgeToast('GitHub 同步功能準備中')
    setIsAdvancedMenuOpen(false)
  }

  async function shareCurrentDocument() {
    if (!activeDocument) {
      setBridgeToast('請先開啟一份報告再分享')
      return
    }

    const shareUrl = `${window.location.origin}/?docId=${activeDocument.id}`

    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      setBridgeToast('分享連結已複製')

      if (shareResetTimerRef.current !== null) {
        window.clearTimeout(shareResetTimerRef.current)
      }
      shareResetTimerRef.current = window.setTimeout(() => {
        setShareCopied(false)
        shareResetTimerRef.current = null
      }, 2000)
    } catch (err) {
      const message = err instanceof Error ? err.message : '剪貼簿寫入失敗'
      setBridgeToast(`分享連結複製失敗：${message}`)
    }
  }

  function deleteActiveDocument() {
    if (!activeDocument) return

    setIsAdvancedMenuOpen(false)
    deleteDocument(activeDocument.id)
  }

  const isGenerating = syncStatus === 'pending' || syncStatus === 'rendering'

  return (
    <div className="flex h-full min-h-screen bg-zinc-50 font-sans text-zinc-800 transition-colors duration-300 dark:bg-zinc-950 dark:text-zinc-100">
      <DocumentSidebar
        documents={documents}
        activeDocumentId={activeDocumentId}
        currentView={currentView}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
        onChangeView={setCurrentView}
        onCreateDocument={createNewDocument}
        onCreateFolder={createNewFolder}
        onCreateDocumentInFolder={createDocumentInFolder}
        onSelectDocument={selectDocument}
        onRenameDocument={renameDocument}
        onDeleteDocument={deleteDocument}
        onToggleFavorite={toggleDocumentFavorite}
        onOpenExtensionModal={() => setIsExtensionModalOpen(true)}
        onOpenFeedback={openFeedback}
      />

      <div className="flex min-w-0 flex-1 flex-col">
      {currentView === 'editor' ? (
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 bg-white px-4 shadow-sm transition-colors duration-300 dark:bg-zinc-950">
          <div className="min-w-0 flex-1">
            {isTitleEditing ? (
              <input
                value={titleDraft}
                autoFocus
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => updateActiveDocumentTitle(titleDraft)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    updateActiveDocumentTitle(titleDraft)
                  }
                  if (event.key === 'Escape') {
                    setTitleDraft(activeDocument?.title ?? '')
                    setIsTitleEditing(false)
                  }
                }}
                className="w-full max-w-md rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-semibold text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-950"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(activeDocument?.title ?? '')
                  setIsTitleEditing(true)
                }}
                className="max-w-md truncate rounded-lg px-2 py-1 text-left text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-900"
                title="點擊重新命名"
              >
                {activeDocument?.title ?? '未命名報告'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {syncStatus === 'exporting' && (
              <span className="text-xs font-medium text-amber-500">正在打包 Word</span>
            )}
            {syncStatus === 'exportingPdf' && (
              <span className="text-xs font-medium text-amber-500">正在編譯 PDF</span>
            )}
            {isGenerating && <span className="text-xs font-medium text-amber-500">同步中</span>}
            {syncStatus === 'synced' && !isGenerating && !isEditorEmpty && (
              <span className="text-xs font-medium text-emerald-600">已同步</span>
            )}
            {syncStatus === 'error' && (
              <span className="text-xs font-medium text-red-500">同步失敗</span>
            )}
            <span className="text-xs font-medium text-zinc-500">
              {collaborationStatus} · {onlineCount} 人在線
            </span>
            <button
              type="button"
              onClick={shareCurrentDocument}
              className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            >
              {shareCopied ? '✅ 已複製連結' : '✨ 分享'}
            </button>

            <div ref={advancedMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsAdvancedMenuOpen((current) => !current)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-lg leading-none text-zinc-600 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                title="進階操作"
              >
                ⋯
              </button>
              {isAdvancedMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-zinc-700 bg-[#1e1e1e] py-2 text-sm text-zinc-300 shadow-2xl">
                  <button
                    type="button"
                    onClick={downloadMarkdownReport}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span>📥</span>
                    下載為 Markdown
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      exportWordReport()
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span>📄</span>
                    匯出為 Word (.docx)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      exportPdfReport()
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span>🖨️</span>
                    匯出為 PDF
                  </button>
                  <button
                    type="button"
                    onClick={syncWithGithub}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span>🔄</span>
                    與 GitHub 同步
                  </button>
                  <div className="my-2 h-px bg-zinc-700" />
                  <button
                    type="button"
                    onClick={deleteActiveDocument}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium text-red-300 transition-colors hover:bg-white/10 hover:text-red-200"
                  >
                    <span>🗑️</span>
                    刪除此報告
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-40 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/80 px-5 py-4 backdrop-blur-md transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-950/80">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">AutoLabReport</h1>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {activeDocument?.title ?? '未命名報告'} · Word 化工具列 · 所見即所得匯出
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {syncStatus === 'exporting' && (
              <span className="text-sm font-medium text-amber-400">⚡ 正在打包 Word 檔...</span>
            )}
            {syncStatus === 'exportingPdf' && (
              <span className="text-sm font-medium text-amber-400">⚡ 正在編譯 PDF...</span>
            )}
            {isGenerating && (
              <span className="text-sm font-medium text-amber-400">⚡ 報告動態生成中...</span>
            )}
            {syncStatus === 'synced' && !isGenerating && !isEditorEmpty && (
              <span className="text-sm font-medium text-emerald-400">✅ 預覽已同步</span>
            )}
            {syncStatus === 'error' && (
              <span className="text-sm font-medium text-red-400">預覽同步失敗</span>
            )}
            <span className="text-xs font-medium text-blue-600 dark:text-blue-300">
              {collaborationStatus} · {onlineCount} 人在線
            </span>
          </div>
        </header>
      )}

      {currentView === 'dashboard' ? (
        <DashboardView
          documents={documents}
          onOpenDocument={selectDocument}
          onCreateDocument={createNewDocument}
          onToggleFavorite={toggleDocumentFavorite}
        />
      ) : currentView === 'trash' ? (
        <TrashView
          documents={documents}
          onRestoreDocument={restoreDocument}
          onHardDeleteDocument={hardDeleteDocument}
        />
      ) : currentView === 'templates' ? (
        <TemplatesView onUseTemplate={createDocumentFromTemplate} />
      ) : (
      <main className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-2 dark:bg-zinc-950">
        <section className="flex min-h-0 flex-grow flex-col border-b border-zinc-200 transition-colors duration-300 dark:border-zinc-800 lg:border-b-0 lg:border-r">
          <div className="border-b border-zinc-200/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500 transition-colors duration-300 dark:border-zinc-800 dark:text-zinc-400">
            編輯區 — 貼上 LLM 報告
          </div>

          <div
            className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-zinc-800 bg-[#111111]/95 px-4 py-2.5 shadow-sm backdrop-blur-md"
            role="toolbar"
            aria-label="AI 編輯工具列"
          >
            <div className="min-w-0">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                Markdown AI Console
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                title="生成報告大綱"
                onClick={() => setIsOutlineModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-zinc-200 transition-all hover:bg-white/10 hover:text-white active:scale-[0.98]"
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">生成報告大綱</span>
              </button>

              <button
                type="button"
                title="智慧排版修復 — 清理標點空白與連續重複段落"
                onClick={handleSmartFormat}
                disabled={isEditorEmpty}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500/90 to-blue-500/90 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-violet-400 hover:to-blue-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wand2 className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">智慧排版修復</span>
              </button>
            </div>
          </div>

          <div className="relative min-h-[280px] flex-1 flex-grow bg-white font-mono leading-relaxed lg:min-h-0 dark:bg-zinc-950">
            {aiSelectionMenu.visible && (
              <div
                className="absolute z-50 flex items-center gap-1 rounded-lg border border-zinc-200/60 bg-white px-1.5 py-1.5 text-sm shadow-xl transition-colors duration-200 dark:border-zinc-700 dark:bg-zinc-950"
                style={{
                  top: aiSelectionMenu.top,
                  left: aiSelectionMenu.left,
                }}
              >
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => requestAiEdit('rewrite')}
                  className="rounded-md px-3 py-1.5 font-medium text-purple-700 transition hover:bg-purple-50 dark:text-purple-200 dark:hover:bg-purple-950/60"
                  title="潤飾重寫選取文字"
                >
                  ✨ 潤飾重寫
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => requestAiEdit('expand')}
                  className="rounded-md px-3 py-1.5 font-medium text-blue-700 transition hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-950/60"
                  title="擴寫選取文字"
                >
                  📈 擴寫內容
                </button>
              </div>
            )}
            <Editor
              height="100%"
              defaultLanguage="markdown"
              theme="vs-dark"
              value={markdown}
              onMount={(ed) => {
                editorRef.current = ed
                editorScrollDisposableRef.current?.dispose()
                editorScrollDisposableRef.current = ed.onDidScrollChange((event) => {
                  if (event.scrollTopChanged) {
                    syncPreviewScroll()
                    updateAiSelectionMenu(ed)
                  }
                })
                editorContentDisposableRef.current?.dispose()
                editorContentDisposableRef.current = ed.onDidChangeModelContent(
                  applyMonacoChangesToYText,
                )
                editorSelectionDisposableRef.current?.dispose()
                editorSelectionDisposableRef.current = ed.onDidChangeCursorSelection(() => {
                  updateAiSelectionMenu(ed)
                })

                editorPasteCleanupRef.current?.()
                const editorDomNode = ed.getDomNode()
                editorDomNode?.addEventListener('paste', handleEditorPaste)
                editorPasteCleanupRef.current = () => {
                  editorDomNode?.removeEventListener('paste', handleEditorPaste)
                }
              }}
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                fontSize: 14,
                lineHeight: 24,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                scrollBeyondLastLine: false,
                placeholder: '在此貼上 ChatGPT / Gemini 產生的實驗報告…',
              }}
            />
          </div>
        </section>

        <section className="flex min-h-0 flex-grow flex-col bg-zinc-100 transition-colors duration-300 dark:bg-zinc-900">
          <div className="border-b border-zinc-200/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500 transition-colors duration-300 dark:border-zinc-800 dark:text-zinc-400">
            預覽區 — 所見即所得
          </div>
          <div
            ref={previewRef}
            className={`preview-pane flex-1 overflow-auto bg-zinc-100 px-8 py-12 transition-colors duration-300 dark:bg-zinc-900 lg:px-14 lg:py-16 ${SCROLLBAR_HIDE}`}
          >
            {renderError ? (
              <p className="text-sm text-red-400">預覽錯誤：{renderError}</p>
            ) : isEditorEmpty ? (
              <div className="mx-auto flex h-full min-h-[420px] max-w-4xl flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200/80 bg-white px-12 py-16 text-center shadow-[0_24px_80px_rgba(0,0,0,0.08)] transition-colors duration-300 dark:border-zinc-700 dark:bg-white">
                <div className="mb-4 text-5xl">🤖</div>
                <p className="max-w-md text-base leading-relaxed text-zinc-600">
                  歡迎使用 AutoLabReport！請將 LLM 生成的實驗報告貼在左側，或使用上方工具列排版，我們將自動為您生成精美排版與數據圖表。
                </p>
              </div>
            ) : preview ? (
              <div
                id="pdf-preview-content"
                className="pdf-export-surface markdown-preview prose prose-zinc mx-auto min-h-[calc(100vh-12rem)] max-w-4xl rounded-2xl bg-white px-14 py-16 text-zinc-900 shadow-[0_24px_80px_rgba(0,0,0,0.10)] transition-colors duration-300 prose-headings:font-semibold prose-p:leading-loose lg:px-20 lg:py-20"
              >
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  rehypePlugins={REHYPE_PLUGINS}
                  urlTransform={(value) => value}
                  components={MARKDOWN_COMPONENTS}
                >
                  {preview}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">正在準備預覽…</p>
            )}
          </div>
        </section>
      </main>
      )}
      </div>

      {isOutlineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-100 bg-white p-8 shadow-2xl transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-950">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                生成報告大綱
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                貼上範例結構，系統會生成對應的 Markdown 實驗報告大綱。
              </p>
            </div>

            <div className="py-6">
              <textarea
                value={outlineExampleText}
                onChange={(event) => setOutlineExampleText(event.target.value)}
                placeholder={'# 實驗報告\n## 實驗目的\n## 實驗原理\n## 實驗步驟\n## 結果與討論'}
                className={`h-64 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-900 outline-none transition-all focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-950 ${SCROLLBAR_HIDE}`}
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsOutlineModalOpen(false)}
                disabled={outlineLoading}
                className={SUBTLE_BUTTON}
              >
                取消
              </button>
              <button
                type="button"
                onClick={generateOutline}
                disabled={outlineLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {outlineLoading ? '產生中...' : '產生大綱'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isExtensionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-100 bg-white p-8 shadow-2xl transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-2xl dark:bg-zinc-900">
                🧩
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  安裝 AutoLabReport Bridge
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  Chrome 擴充套件已建立在專案根目錄的 extension 資料夾。請到 Chrome 的擴充功能頁面開啟開發人員模式，選擇「載入未封裝項目」，並選取該資料夾。
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/60 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">路徑</div>
              <div className="mt-1 font-mono text-xs">D:\AutoLabReport\extension</div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setIsExtensionModalOpen(false)}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {bridgeToast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-lg bg-zinc-950 px-4 py-3 text-sm font-medium text-white shadow-2xl dark:bg-zinc-100 dark:text-zinc-950">
          {bridgeToast}
        </div>
      )}
    </div>
  )
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  if (!isAuthenticated) {
    return <LandingPage onLogin={() => setIsAuthenticated(true)} />
  }

  return <WorkspaceApp />
}

export default App
