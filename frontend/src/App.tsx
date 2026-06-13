import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from 'react'
import 'katex/dist/katex.min.css'
import { createClient, type Provider, type User } from '@supabase/supabase-js'
import {
  ArrowRight,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import type { editor } from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import type { Text as YText, Doc as YDoc } from 'yjs'
import type { WebrtcProvider } from 'y-webrtc'
import {
  createDocumentVersion,
  readDocumentVersions,
  type DocumentVersion,
} from './documentVersions'
import { REHYPE_PLUGINS, safeMarkdownUrlTransform } from './markdownSafety'
import { analyzeReportQuality } from './reportQuality'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const RENDER_DEBOUNCE_MS = 300
const THEME_STORAGE_KEY = 'autolabreport-theme'
const CONTENT_STORAGE_KEY = 'autoLabReport_content'
const DOCUMENTS_STORAGE_KEY = 'autoLabReport_documents'
const ACTIVE_DOCUMENT_ID_STORAGE_KEY = 'autoLabReport_activeDocumentId'
const ANONYMOUS_IDENTITY_STORAGE_KEY = 'autoLabReport_anonymousIdentity'
const AI_SETTINGS_STORAGE_KEY = 'autoLabReport_aiSettings'
const DOCUMENT_VERSIONS_STORAGE_KEY = 'autoLabReport_documentVersions'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

const REMARK_PLUGINS = [remarkMath]
const MarkdownEditor = lazy(() => import('@monaco-editor/react'))
const PrismLandingScene = lazy(() => import('./PrismLandingScene'))
const documentYDocs = new Map<string, YDoc>()
let sharedYDoc: YDoc | null = null
let mermaidInitialized = false
const YTEXT_NAME = 'monaco-or-textarea'
const LOCAL_YJS_ORIGIN = 'local-monaco'

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

type ShareSetting = 'private' | 'view' | 'edit'
type CollaboratorRole = 'view' | 'edit'
type DocumentPermission = 'owner' | 'edit' | 'view' | 'none'
type AiProvider = 'built_in' | 'extension' | 'user_api_key'
type UserApiProvider = 'none' | 'openai' | 'gemini' | 'anthropic' | 'deepseek'
type AiAction = 'outline' | 'rewrite' | 'expand' | 'format' | 'summarize' | 'custom'

type AiSettings = {
  preferredProvider: AiProvider
  userApiProvider: UserApiProvider
  userApiKey: string
  defaultModel: string
  rewritePrompt: string
  expandPrompt: string
  outlinePrompt: string
  summarizePrompt: string
  customPrompt: string
  extensionAutoReturn: boolean
}

type AiTaskRequest = {
  provider?: AiProvider
  action: AiAction
  text: string
  documentId?: string
  prompt?: string
  insertMode?: 'replace-selection' | 'insert-at-cursor' | 'replace-document' | 'return'
}

type AiQuota = {
  plan: 'free' | 'pro' | string
  used: number
  limit: number
  remaining: number
}

type BillingConfig = {
  enabled: boolean
  pro_price_id_configured: boolean
  customer_portal_url: string | null
  message: string
}

type SupabaseAiSettingsRow = {
  user_id: string
  preferred_provider?: AiProvider | null
  api_provider?: UserApiProvider | null
  api_key_encrypted?: string | null
  default_model?: string | null
  rewrite_prompt?: string | null
  expand_prompt?: string | null
  outline_prompt?: string | null
  summarize_prompt?: string | null
  custom_prompt?: string | null
  extension_auto_return?: boolean | null
}

type Document = {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt?: string
  isFavorite: boolean
  isTrashed: boolean
  userId: string | null
  shareSetting: ShareSetting
  type: 'file' | 'folder'
  parentId: string | null
}

type SupabaseDocumentRow = {
  id: string
  title: string | null
  content: string | null
  created_at?: string | null
  updated_at?: string | null
  is_favorite?: boolean | null
  is_trashed?: boolean | null
  user_id?: string | null
  share_setting?: ShareSetting | null
  type?: 'file' | 'folder' | null
  parent_id?: string | null
}

type DocumentCollaboratorRow = {
  document_id: string
  user_email: string | null
  role: CollaboratorRole | null
}

type DocumentCollaborator = {
  documentId: string
  userEmail: string
  role: CollaboratorRole
}

type AnonymousIdentity = {
  name: string
  avatar: string
  emoji: string
  color: string
}

type AppView =
  | 'dashboard'
  | 'editor'
  | 'favorites'
  | 'templates'
  | 'trash'
  | 'settings'
  | 'billing'
  | 'history'
  | 'quality'

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

type CollaboratorPresence = {
  clientId: number
  name: string
  avatar: string
  emoji?: string
  color: string
  isLocal: boolean
}

const TOOLBAR_ICON_BTN =
  'rounded-md p-2 text-zinc-500 transition-all hover:bg-zinc-200/50 hover:text-zinc-800 active:scale-95 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
const SUBTLE_BUTTON =
  'rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-all hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
const SCROLLBAR_HIDE =
  'scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
const COLLABORATOR_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#4f46e5',
  '#be123c',
]
const ANONYMOUS_ANIMALS = [
  { name: '匿名水豚', emoji: '🦫' },
  { name: '匿名羊駝', emoji: '🦙' },
  { name: '匿名貓頭鷹', emoji: '🦉' },
  { name: '匿名企鵝', emoji: '🐧' },
  { name: '匿名柯基', emoji: '🐶' },
  { name: '匿名狐狸', emoji: '🦊' },
  { name: '匿名海獺', emoji: '🦦' },
  { name: '匿名熊貓', emoji: '🐼' },
]
const DEFAULT_AI_SETTINGS: AiSettings = {
  preferredProvider: 'built_in',
  userApiProvider: 'none',
  userApiKey: '',
  defaultModel: '',
  rewritePrompt:
    '請幫我潤飾重寫以下實驗報告片段。請保留原意、修正語氣與結構，只回傳 Markdown 純文字：\n\n{{text}}',
  expandPrompt:
    '請幫我擴寫以下實驗報告片段。請補強學術語氣、邏輯銜接與必要細節，只回傳 Markdown 純文字：\n\n{{text}}',
  outlinePrompt:
    '請根據以下範例結構生成實驗報告 Markdown 大綱，包含標準標題與預留填空區：\n\n{{text}}',
  summarizePrompt:
    '請將以下實驗報告內容整理成精煉的結論段落，只回傳 Markdown 純文字：\n\n{{text}}',
  customPrompt:
    '請根據我的要求處理以下實驗報告內容，只回傳 Markdown 純文字：\n\n{{text}}',
  extensionAutoReturn: false,
}

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false
    const renderId = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    async function renderMermaid() {
      try {
        const { default: mermaid } = await import('mermaid')
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'strict',
          })
          mermaidInitialized = true
        }
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
    userId: null,
    shareSetting: 'private',
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
    userId: null,
    shareSetting: 'private',
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
    userId: document.userId ?? null,
    shareSetting: document.shareSetting ?? 'private',
    type: document.type ?? 'file',
    parentId: document.parentId ?? null,
  }
}

function mapSupabaseDocument(row: SupabaseDocumentRow): Document {
  const createdAt = row.created_at ?? new Date().toISOString()
  return {
    id: row.id,
    title: row.title?.trim() || '未命名報告',
    content: row.content ?? '',
    createdAt,
    updatedAt: row.updated_at ?? createdAt,
    isFavorite: row.is_favorite ?? false,
    isTrashed: row.is_trashed ?? false,
    userId: row.user_id ?? null,
    shareSetting: row.share_setting ?? 'private',
    type: row.type ?? 'file',
    parentId: row.parent_id ?? null,
  }
}

function mapDocumentCollaborator(row: DocumentCollaboratorRow): DocumentCollaborator | null {
  const userEmail = row.user_email?.trim().toLowerCase()
  if (!row.document_id || !userEmail) return null

  return {
    documentId: row.document_id,
    userEmail,
    role: row.role === 'edit' ? 'edit' : 'view',
  }
}

async function getDocumentYDoc(documentId: string): Promise<YDoc> {
  const existingDoc = documentYDocs.get(documentId)
  if (existingDoc) return existingDoc

  const { Doc } = await import('yjs')
  const nextDoc = documentYDocs.size === 0 && sharedYDoc ? sharedYDoc : new Doc()
  sharedYDoc ??= nextDoc
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
  user,
  onSignOut,
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
  user: User | null
  onSignOut: () => void
}) {
  const [isProjectTreeOpen, setIsProjectTreeOpen] = useState(true)
  const [isMoreOpen, setIsMoreOpen] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(documents.filter((document) => document.type === 'folder').map((document) => document.id)),
  )
  const visibleDocuments = documents.filter((document) => !document.isTrashed)
  const fileDocuments = visibleDocuments.filter((document) => document.type === 'file')
  const favoriteDocuments = fileDocuments.filter((document) => document.isFavorite)
  const userName = getUserDisplayName(user)
  const avatarUrl = getUserAvatarUrl(user)
  const userInitial = getUserInitial(user)

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
          title="收藏夾"
          onClick={() => onChangeView('favorites')}
          className={TOOLBAR_ICON_BTN}
        >
          ⭐
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
          title="登出"
          onClick={onSignOut}
          className={TOOLBAR_ICON_BTN}
        >
          ⎋
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
          onClick={() => onChangeView('favorites')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
            currentView === 'favorites'
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          <span className="w-5 text-center">⭐</span>
          <span className="flex-1">收藏夾</span>
          <span className="text-xs text-zinc-400">{favoriteDocuments.length}</span>
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
          onClick={() => onChangeView('quality')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
            currentView === 'quality'
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          <span className="w-5 text-center">✓</span>
          報告檢查
        </button>
        <button
          type="button"
          onClick={() => onChangeView('history')}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
            currentView === 'history'
              ? 'border border-zinc-200/50 bg-white font-medium text-zinc-900 shadow-sm dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-100'
              : 'text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          <span className="w-5 text-center">↺</span>
          版本歷史
        </button>
        <button
          type="button"
          onClick={onOpenExtensionModal}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100"
        >
          <span className="w-5 text-center">🧩</span>
          安裝擴充套件
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
              onClick={() => {
                setIsMoreOpen(false)
                onChangeView('billing')
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              💳 方案與用量
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMoreOpen(false)
                onChangeView('settings')
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              ⚙️ 設定
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200/60 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-zinc-200/60 dark:bg-zinc-900 dark:ring-zinc-800">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName}
              className="h-10 w-10 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
              {userInitial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{userName}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {user?.email ?? '已登入'}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            title="登出"
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            登出
          </button>
        </div>
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

function getUserDisplayName(user: User | null): string {
  const fullName = user?.user_metadata?.full_name
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim()

  const name = user?.user_metadata?.name
  if (typeof name === 'string' && name.trim()) return name.trim()

  return user?.email ?? 'AutoLabReport 使用者'
}

function getUserAvatarUrl(user: User | null): string {
  const avatarUrl = user?.user_metadata?.avatar_url
  return typeof avatarUrl === 'string' ? avatarUrl : ''
}

function getUserInitial(user: User | null): string {
  const displayName = getUserDisplayName(user)
  return displayName.trim().charAt(0).toUpperCase() || 'A'
}

function getPresenceColor(seed: string): string {
  const hash = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0)
  return COLLABORATOR_COLORS[hash % COLLABORATOR_COLORS.length]
}

function getRandomHexColor(): string {
  const value = Math.floor(Math.random() * 0xffffff)
  return `#${value.toString(16).padStart(6, '0')}`
}

function createAnonymousIdentity(): AnonymousIdentity {
  const animal = ANONYMOUS_ANIMALS[Math.floor(Math.random() * ANONYMOUS_ANIMALS.length)]
  return {
    name: animal.name,
    emoji: animal.emoji,
    avatar: '',
    color: getRandomHexColor(),
  }
}

function getInitialAnonymousIdentity(): AnonymousIdentity {
  if (typeof window === 'undefined') return createAnonymousIdentity()

  const savedIdentity = window.localStorage.getItem(ANONYMOUS_IDENTITY_STORAGE_KEY)
  if (savedIdentity) {
    try {
      const parsed = JSON.parse(savedIdentity) as Partial<AnonymousIdentity>
      if (parsed.name && parsed.emoji && parsed.color) {
        return {
          name: parsed.name,
          emoji: parsed.emoji,
          avatar: typeof parsed.avatar === 'string' ? parsed.avatar : '',
          color: parsed.color,
        }
      }
    } catch {
      /* ignore corrupt anonymous identity */
    }
  }

  const identity = createAnonymousIdentity()
  window.localStorage.setItem(ANONYMOUS_IDENTITY_STORAGE_KEY, JSON.stringify(identity))
  return identity
}

function normalizeAiSettings(settings: Partial<AiSettings> | null | undefined): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    ...(settings ?? {}),
    userApiKey: typeof settings?.userApiKey === 'string' ? settings.userApiKey : '',
    preferredProvider:
      settings?.preferredProvider === 'extension' || settings?.preferredProvider === 'user_api_key'
        ? settings.preferredProvider
        : 'built_in',
    userApiProvider:
      settings?.userApiProvider === 'openai' ||
      settings?.userApiProvider === 'gemini' ||
      settings?.userApiProvider === 'anthropic' ||
      settings?.userApiProvider === 'deepseek'
        ? settings.userApiProvider
        : 'none',
  }
}

function getInitialAiSettings(): AiSettings {
  if (typeof window === 'undefined') return DEFAULT_AI_SETTINGS

  const savedSettings = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
  if (!savedSettings) return DEFAULT_AI_SETTINGS

  try {
    const parsed = JSON.parse(savedSettings) as Partial<AiSettings>
    return normalizeAiSettings({ ...parsed, userApiKey: '' })
  } catch {
    return DEFAULT_AI_SETTINGS
  }
}

function getPersistableAiSettings(settings: AiSettings): AiSettings {
  return {
    ...settings,
    userApiKey: '',
  }
}

function mapSupabaseAiSettings(row: SupabaseAiSettingsRow, currentSettings: AiSettings): AiSettings {
  return normalizeAiSettings({
    ...currentSettings,
    preferredProvider: row.preferred_provider ?? currentSettings.preferredProvider,
    userApiProvider: row.api_provider ?? currentSettings.userApiProvider,
    defaultModel: row.default_model ?? currentSettings.defaultModel,
    rewritePrompt: row.rewrite_prompt ?? currentSettings.rewritePrompt,
    expandPrompt: row.expand_prompt ?? currentSettings.expandPrompt,
    outlinePrompt: row.outline_prompt ?? currentSettings.outlinePrompt,
    summarizePrompt: row.summarize_prompt ?? currentSettings.summarizePrompt,
    customPrompt: row.custom_prompt ?? currentSettings.customPrompt,
    extensionAutoReturn: row.extension_auto_return ?? currentSettings.extensionAutoReturn,
  })
}

function toSupabaseAiSettingsPayload(userId: string, settings: AiSettings) {
  return {
    user_id: userId,
    preferred_provider: settings.preferredProvider,
    api_provider: settings.userApiProvider,
    api_key_encrypted: null,
    default_model: settings.defaultModel || null,
    rewrite_prompt: settings.rewritePrompt,
    expand_prompt: settings.expandPrompt,
    outline_prompt: settings.outlinePrompt,
    summarize_prompt: settings.summarizePrompt,
    custom_prompt: settings.customPrompt,
    extension_auto_return: settings.extensionAutoReturn,
    updated_at: new Date().toISOString(),
  }
}

function fillPromptTemplate(template: string, text: string, action: AiAction): string {
  return template.replaceAll('{{text}}', text).replaceAll('{{action}}', action)
}

function getPromptTemplateForAction(settings: AiSettings, action: AiAction): string {
  if (action === 'expand') return settings.expandPrompt
  if (action === 'outline') return settings.outlinePrompt
  if (action === 'summarize') return settings.summarizePrompt
  if (action === 'custom') return settings.customPrompt
  return settings.rewritePrompt
}

function getCollaboratorInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'A'
}

function getDocumentPermission(
  document: Document | undefined,
  user: User | null,
  collaborators: DocumentCollaborator[] = [],
): DocumentPermission {
  if (!document || document.type !== 'file' || document.isTrashed) return 'none'
  if (!user) {
    if (document.shareSetting === 'edit') return 'edit'
    if (document.shareSetting === 'view') return 'view'
    return 'none'
  }

  if (!document.userId || document.userId === user.id) return 'owner'

  const currentUserEmail = user.email?.trim().toLowerCase()
  const invitedCollaborator = currentUserEmail
    ? collaborators.find(
        (collaborator) =>
          collaborator.documentId === document.id && collaborator.userEmail === currentUserEmail,
      )
    : undefined

  if (invitedCollaborator) return invitedCollaborator.role
  if (document.shareSetting === 'edit') return 'edit'
  if (document.shareSetting === 'view') return 'view'
  return 'none'
}

function getSharedDocumentIdFromLocation(): string | null {
  const editorMatch = window.location.pathname.match(/^\/editor\/([^/]+)/)
  if (editorMatch?.[1]) return decodeURIComponent(editorMatch[1])
  return new URLSearchParams(window.location.search).get('docId')
}

function getAuthenticatedAwarenessUser(user: User) {
  const name = getUserDisplayName(user)
  const avatar = getUserAvatarUrl(user)
  const color = getPresenceColor(user.id || user.email || name)

  return { name, avatar, color, emoji: '' }
}

function getCursorAwarenessState(
  ed: editor.IStandaloneCodeEditor,
  awarenessUser: AnonymousIdentity | ReturnType<typeof getAuthenticatedAwarenessUser>,
) {
  const model = ed.getModel()
  const selection = ed.getSelection()
  if (!model || !selection) return null

  const position = selection.getPosition()
  return {
    anchor: model.getOffsetAt(selection.getStartPosition()),
    head: model.getOffsetAt(selection.getEndPosition()),
    lineNumber: position.lineNumber,
    column: position.column,
    color: awarenessUser.color,
    name: awarenessUser.name,
  }
}

function getCollaboratorFromAwarenessState(
  clientId: number,
  state: unknown,
  localClientId: number,
): CollaboratorPresence | null {
  if (!state || typeof state !== 'object' || !('user' in state)) return null

  const awarenessUser = (state as { user?: unknown }).user
  if (!awarenessUser || typeof awarenessUser !== 'object') return null

  const { name, avatar, color } = awarenessUser as {
    name?: unknown
    avatar?: unknown
    emoji?: unknown
    color?: unknown
  }
  const { emoji } = awarenessUser as { emoji?: unknown }

  if (typeof name !== 'string' || !name.trim()) return null

  return {
    clientId,
    name: name.trim(),
    avatar: typeof avatar === 'string' ? avatar : '',
    emoji: typeof emoji === 'string' ? emoji : undefined,
    color: typeof color === 'string' && color.trim() ? color : getPresenceColor(name),
    isLocal: clientId === localClientId,
  }
}

function CollaboratorAvatarGroup({ collaborators }: { collaborators: CollaboratorPresence[] }) {
  if (collaborators.length === 0) return null

  const visibleCollaborators = collaborators.slice(0, 5)
  const hiddenCount = Math.max(collaborators.length - visibleCollaborators.length, 0)

  return (
    <div className="flex items-center -space-x-2 pl-1" aria-label="線上協作者">
      {visibleCollaborators.map((collaborator) => (
        <div
          key={collaborator.clientId}
          title={`${collaborator.name}${collaborator.isLocal ? '（你）' : ''}`}
          className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-zinc-100 text-xs font-semibold text-white shadow-sm ring-1 ring-zinc-200/80 transition-transform hover:z-10 hover:-translate-y-0.5 dark:border-zinc-950 dark:ring-zinc-700"
          style={{ backgroundColor: collaborator.avatar ? undefined : collaborator.color }}
        >
          {collaborator.avatar ? (
            <img
              src={collaborator.avatar}
              alt={collaborator.name}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : collaborator.emoji ? (
            <span className="text-base leading-none">{collaborator.emoji}</span>
          ) : (
            getCollaboratorInitial(collaborator.name)
          )}
        </div>
      ))}
      {hiddenCount > 0 && (
        <div
          title={`另有 ${hiddenCount} 位協作者在線`}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-zinc-900 text-[11px] font-semibold text-white shadow-sm ring-1 ring-zinc-200/80 dark:border-zinc-950 dark:ring-zinc-700"
        >
          +{hiddenCount}
        </div>
      )}
    </div>
  )
}

function AiSettingsView({
  settings,
  quota,
  quotaLoading,
  onChangeSettings,
}: {
  settings: AiSettings
  quota: AiQuota | null
  quotaLoading: boolean
  onChangeSettings: (settings: AiSettings) => void
}) {
  function updateSettings(patch: Partial<AiSettings>) {
    onChangeSettings(normalizeAiSettings({ ...settings, ...patch }))
  }

  const providerDescription =
    settings.preferredProvider === 'built_in'
      ? '使用 AutoLabReport 內建 AI，適合小白與付費方案。'
      : settings.preferredProvider === 'extension'
        ? '使用 Chrome 插件連接 ChatGPT、Gemini、Claude、Grok、DeepSeek。'
        : '使用你自己的 API Key，適合進階使用者。'

  return (
    <main className={`flex-1 overflow-auto bg-zinc-50 px-8 py-12 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">AI 設定</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            管理 AutoLabReport 的 AI 供應模式、插件橋接、自備 API Key 與 Prompt 模板。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">AI Provider</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{providerDescription}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">方案</div>
                <div className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {quota?.plan === 'pro' ? 'Pro' : 'Free'}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">今日剩餘</div>
                <div className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {quotaLoading ? '...' : quota ? quota.remaining : '-'}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">每日額度</div>
                <div className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {quotaLoading ? '...' : quota ? quota.limit : '-'}
                </div>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">預設 AI 模式</span>
              <select
                value={settings.preferredProvider}
                onChange={(event) => updateSettings({ preferredProvider: event.target.value as AiProvider })}
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="built_in">AutoLabReport 內建 AI</option>
                <option value="extension">Chrome 插件橋接</option>
                <option value="user_api_key">自備 API Key</option>
              </select>
            </label>

            <div className="mt-5 rounded-xl border border-zinc-200/70 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">免費版建議</div>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                預設使用少量內建 AI 額度；額度用完後，可改用插件橋接自己的 AI 網頁，或填入自己的 API Key。
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">自備 API Key</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              API Key 只保留在目前頁面狀態，不會寫入 localStorage 或 Supabase；重新整理後需重新填入。
            </p>

            <label className="mt-5 block">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">API Provider</span>
              <select
                value={settings.userApiProvider}
                onChange={(event) => updateSettings({ userApiProvider: event.target.value as UserApiProvider })}
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="none">尚未設定</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="anthropic">Claude / Anthropic</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">API Key</span>
              <input
                type="password"
                value={settings.userApiKey}
                onChange={(event) => updateSettings({ userApiKey: event.target.value })}
                placeholder="sk-... / AIza... / 你的金鑰"
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
            <button
              type="button"
              onClick={() => updateSettings({ userApiKey: '' })}
              disabled={!settings.userApiKey}
              className="mt-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-950"
            >
              清除本次 API Key
            </button>

            <label className="mt-4 block">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">預設模型（可選）</span>
              <input
                value={settings.defaultModel}
                onChange={(event) => updateSettings({ defaultModel: event.target.value })}
                placeholder="例如 gpt-4.1-mini / gemini-1.5-flash"
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Prompt 模板</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                使用 <code>{'{{text}}'}</code> 代表選取文字或文件內容，<code>{'{{action}}'}</code> 代表操作名稱。
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={settings.extensionAutoReturn}
                onChange={(event) => updateSettings({ extensionAutoReturn: event.target.checked })}
              />
              插件自動回填
            </label>
            <button
              type="button"
              onClick={() =>
                updateSettings({
                  rewritePrompt: DEFAULT_AI_SETTINGS.rewritePrompt,
                  expandPrompt: DEFAULT_AI_SETTINGS.expandPrompt,
                  outlinePrompt: DEFAULT_AI_SETTINGS.outlinePrompt,
                  summarizePrompt: DEFAULT_AI_SETTINGS.summarizePrompt,
                  customPrompt: DEFAULT_AI_SETTINGS.customPrompt,
                })
              }
              className={SUBTLE_BUTTON}
            >
              恢復預設 Prompt
            </button>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {([
              ['rewritePrompt', '潤飾重寫'],
              ['expandPrompt', '擴寫內容'],
              ['outlinePrompt', '生成大綱'],
              ['summarizePrompt', '摘要成結論'],
              ['customPrompt', '自訂指令'],
            ] as const).map(([key, label]) => (
              <label key={key} className={key === 'customPrompt' ? 'lg:col-span-2' : ''}>
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
                <textarea
                  value={settings[key]}
                  onChange={(event) => updateSettings({ [key]: event.target.value } as Partial<AiSettings>)}
                  className={`mt-2 h-36 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 ${SCROLLBAR_HIDE}`}
                />
              </label>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function BillingView({
  quota,
  quotaLoading,
  billingConfig,
  onOpenAiSettings,
}: {
  quota: AiQuota | null
  quotaLoading: boolean
  billingConfig: BillingConfig | null
  onOpenAiSettings: () => void
}) {
  const remainingPercent = quota ? Math.max(0, Math.min(100, (quota.remaining / Math.max(quota.limit, 1)) * 100)) : 0
  const isPro = quota?.plan === 'pro'

  return (
    <main className={`flex-1 overflow-auto bg-zinc-50 px-8 py-12 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">Billing</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              方案與 AI 用量
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              免費版保留基本 AI 額度；Pro 方案適合長期寫實驗報告、團隊協作與高頻 AI 編修。
            </p>
            <div className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-500 ring-1 ring-zinc-200/70 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
              {billingConfig?.message ?? '正在檢查金流設定...'}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAiSettings}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            調整 AI 模式
          </button>
        </div>

        <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">今日內建 AI 額度</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                插件橋接與自備 API Key 不會消耗 AutoLabReport 內建額度。
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-50 px-5 py-3 text-right ring-1 ring-zinc-200/70 dark:bg-zinc-950 dark:ring-zinc-800">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">目前方案</div>
              <div className="mt-1 text-xl font-bold text-zinc-900 dark:text-zinc-100">
                {isPro ? 'Pro' : 'Free'}
              </div>
            </div>
          </div>

          <div className="mt-7">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-zinc-600 dark:text-zinc-300">
                {quotaLoading ? '讀取中...' : `剩餘 ${quota?.remaining ?? '-'} / ${quota?.limit ?? '-'} 次`}
              </span>
              <span className="text-zinc-400">每日重置</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
                style={{ width: `${quotaLoading ? 35 : remainingPercent}%` }}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-6">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Free</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                適合個人試用與低頻撰寫。保留插件橋接與自備 API Key 兩條免費替代路徑。
              </p>
            </div>
            <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">$0</div>
            <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
              <li>✓ 每日少量內建 AI 額度</li>
              <li>✓ Chrome 插件橋接主流 AI 網頁</li>
              <li>✓ 自備 API Key 模式</li>
              <li>✓ Markdown 編輯與匯出</li>
            </ul>
            <div className="mt-auto pt-8">
              <button
                type="button"
                onClick={onOpenAiSettings}
                className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                使用免費設定
              </button>
            </div>
          </section>

          <section className="flex flex-col rounded-3xl border border-zinc-900 bg-zinc-950 p-7 text-white shadow-xl dark:border-zinc-700">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Pro</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  面向高頻 AI 排版、多人協作與正式課業工作流。Stripe 金流可在下一步接入。
                </p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-zinc-200">
                Coming soon
              </span>
            </div>
            <div className="text-3xl font-bold">$8</div>
            <p className="mt-1 text-sm text-zinc-400">每月，建議定價</p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-300">
              <li>✓ 更高每日內建 AI 額度</li>
              <li>✓ 進階 Prompt 模板與批次修復</li>
              <li>✓ 團隊協作與權限分享</li>
              <li>✓ 優先使用新模型與新功能</li>
            </ul>
            <div className="mt-auto pt-8">
              <button
                type="button"
                onClick={() => {
                  if (billingConfig?.customer_portal_url) {
                    window.location.href = billingConfig.customer_portal_url
                    return
                  }
                  window.location.href = 'mailto:?subject=AutoLabReport Pro 等候名單&body=我想加入 AutoLabReport Pro 等候名單。'
                }}
                className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100"
              >
                {billingConfig?.enabled ? '管理訂閱' : '加入 Pro 等候名單'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function DashboardView({
  documents,
  onOpenDocument,
  onCreateDocument,
  onRenameDocument,
  onShareDocument,
  onToggleFavorite,
  onDeleteDocument,
  favoriteOnly = false,
  isLoading = false,
}: {
  documents: Document[]
  onOpenDocument: (id: string) => void
  onCreateDocument: () => void
  onRenameDocument: (id: string) => void
  onShareDocument: (id: string) => void
  onToggleFavorite: (id: string) => void
  onDeleteDocument: (id: string) => void
  favoriteOnly?: boolean
  isLoading?: boolean
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const openMenuRef = useRef<HTMLDivElement | null>(null)
  const fileDocuments = documents.filter(
    (document) => document.type === 'file' && !document.isTrashed && (!favoriteOnly || document.isFavorite),
  )
  const recentDocuments = [...fileDocuments].sort((left, right) => {
    const leftTime = new Date(left.updatedAt ?? left.createdAt).getTime()
    const rightTime = new Date(right.updatedAt ?? right.createdAt).getTime()
    return rightTime - leftTime
  })
  const pageKicker = favoriteOnly ? 'Favorites' : 'Dashboard'
  const pageTitle = favoriteOnly ? '收藏夾' : '早安，準備好撰寫今天的實驗結報了嗎？'
  const sectionTitle = favoriteOnly ? '已收藏檔案' : '近期編輯檔案'
  const emptyTitle = favoriteOnly ? '尚未收藏任何報告' : '目前沒有報告'
  const emptyDescription = favoriteOnly
    ? '在文件卡片或檔案樹點擊星號，即可把常用報告收進收藏夾。'
    : '點擊右上角建立第一份報告吧！'

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        openMenuRef.current &&
        event.target instanceof Node &&
        !openMenuRef.current.contains(event.target)
      ) {
        setOpenMenuId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-zinc-50 transition-colors duration-300 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl px-8 py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {pageKicker}
            </p>
            <h1 className="mb-8 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {pageTitle}
            </h1>
          </div>
          {!favoriteOnly && (
            <button
              type="button"
              onClick={onCreateDocument}
              disabled={isLoading}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            >
              {isLoading ? '處理中...' : '新增報告'}
            </button>
          )}
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {sectionTitle}
            </h2>
            <span className="text-sm text-zinc-400">{fileDocuments.length} 份文件</span>
          </div>
          {recentDocuments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-8 py-16 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-2xl dark:bg-zinc-800">
                📄
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{emptyTitle}</h3>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {emptyDescription}
              </p>
              {!favoriteOnly && (
                <button
                  type="button"
                  onClick={onCreateDocument}
                  disabled={isLoading}
                  className="mt-6 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                >
                  {isLoading ? '處理中...' : '建立第一份報告'}
                </button>
              )}
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
                      disabled={isLoading}
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
                    <div
                      ref={openMenuId === document.id ? openMenuRef : null}
                      className="absolute bottom-4 right-4"
                    >
                      <button
                        type="button"
                        className="rounded-full px-2 py-1 text-lg leading-none text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        onClick={(event) => {
                          event.stopPropagation()
                          setOpenMenuId((current) => (current === document.id ? null : document.id))
                        }}
                        title="更多操作"
                        aria-label="更多操作"
                      >
                        ⋯
                      </button>
                      {openMenuId === document.id && (
                        <div className="absolute bottom-full right-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-2 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenuId(null)
                              onRenameDocument(document.id)
                            }}
                            disabled={isLoading}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          >
                            📄 重新命名
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenuId(null)
                              onShareDocument(document.id)
                            }}
                            disabled={isLoading}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          >
                            ✨ 分享產生連結
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenuId(null)
                              onToggleFavorite(document.id)
                            }}
                            disabled={isLoading}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          >
                            {document.isFavorite ? '⭐ 取消收藏' : '⭐ 加入收藏'}
                          </button>
                          <div className="my-2 h-px bg-zinc-100 dark:bg-zinc-800" />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenuId(null)
                              onDeleteDocument(document.id)
                            }}
                            disabled={isLoading}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                          >
                            🗑️ 刪除此報告
                          </button>
                        </div>
                      )}
                    </div>
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
  const [query, setQuery] = useState('')
  const categories = ['全部', ...Array.from(new Set(DEFAULT_TEMPLATES.map((template) => template.category)))]
  const normalizedQuery = query.trim().toLowerCase()
  const templates = DEFAULT_TEMPLATES.filter((template) => {
    const matchesCategory = selectedCategory === '全部' || template.category === selectedCategory
    const matchesQuery =
      !normalizedQuery ||
      [template.title, template.category, template.description, template.content]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)

    return matchesCategory && matchesQuery
  })

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

        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋科目、實驗類型或模板內容"
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <span className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {templates.length} 個模板
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
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
        {templates.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-200 bg-white px-8 py-14 text-center text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            找不到符合條件的模板。
          </div>
        )}
      </div>
    </main>
  )
}

function ReportQualityView({
  document,
  markdown,
  onBackToEditor,
}: {
  document: Document | undefined
  markdown: string
  onBackToEditor: () => void
}) {
  const checks = useMemo(() => analyzeReportQuality(markdown), [markdown])
  const passedCount = checks.filter((item) => item.passed).length
  const score = checks.length ? Math.round((passedCount / checks.length) * 100) : 0

  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-zinc-50 transition-colors duration-300 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl px-8 py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Quality Check</p>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">報告檢查</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {document?.title ?? '目前文件'} 的結構完整度檢查，適合匯出前快速補洞。
            </p>
          </div>
          <button type="button" onClick={onBackToEditor} className={SUBTLE_BUTTON}>
            回到編輯器
          </button>
        </div>

        <section className="mb-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{score}</div>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                已通過 {passedCount} / {checks.length} 個檢查項目
              </p>
            </div>
            <div className="h-3 min-w-64 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {checks.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    item.passed
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  }`}
                >
                  {item.passed ? '✓' : '!'}
                </span>
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{item.label}</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{item.description}</p>
                  {!item.passed && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                      {item.suggestion}
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}

function VersionHistoryView({
  document,
  versions,
  onBackToEditor,
  onSaveVersion,
  onRestoreVersion,
}: {
  document: Document | undefined
  versions: DocumentVersion[]
  onBackToEditor: () => void
  onSaveVersion: () => void
  onRestoreVersion: (version: DocumentVersion) => void
}) {
  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-zinc-50 transition-colors duration-300 dark:bg-zinc-950 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl px-8 py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">Version History</p>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">版本歷史</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              為 {document?.title ?? '目前文件'} 儲存本地快照，方便在大量 AI 改寫前後回復。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onBackToEditor} className={SUBTLE_BUTTON}>
              回到編輯器
            </button>
            <button
              type="button"
              onClick={onSaveVersion}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            >
              儲存目前版本
            </button>
          </div>
        </div>

        {versions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-8 py-16 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">尚未儲存版本</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              點擊「儲存目前版本」後，快照會保留在這台瀏覽器。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {versions.map((version) => (
              <article
                key={version.id}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                      {version.title}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {formatDocumentTime(version.createdAt)} · {version.note}
                    </p>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                      {version.content.replace(/[#*_`>|-]/g, ' ').replace(/\s+/g, ' ').trim() || '空白版本'}
                    </p>
                  </div>
                  <button type="button" onClick={() => onRestoreVersion(version)} className={SUBTLE_BUTTON}>
                    還原
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

function LandingPage({
  onOAuthLogin,
  onSendMagicLink,
  authLoading,
  authMessage,
}: {
  onOAuthLogin: (provider: Provider) => void
  onSendMagicLink: (email: string) => Promise<boolean>
  authLoading: boolean
  authMessage: string | null
}) {
  const [email, setEmail] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicLinkLoading, setMagicLinkLoading] = useState(false)
  const [prismActivationKey, setPrismActivationKey] = useState(0)
  const oauthTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (oauthTimerRef.current) {
        window.clearTimeout(oauthTimerRef.current)
      }
    }
  }, [])

  function ignitePrism() {
    setPrismActivationKey((current) => current + 1)
  }

  function handleOAuthLogin(provider: Provider) {
    if (authLoading) return

    ignitePrism()
    if (oauthTimerRef.current) {
      window.clearTimeout(oauthTimerRef.current)
    }
    oauthTimerRef.current = window.setTimeout(() => onOAuthLogin(provider), 620)
  }

  async function handleMagicLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || magicLinkSent) return

    ignitePrism()
    setMagicLinkLoading(true)
    await new Promise((resolve) => window.setTimeout(resolve, 520))
    const didSend = await onSendMagicLink(email.trim())
    setMagicLinkLoading(false)
    if (didSend) {
      setMagicLinkSent(true)
    }
  }

  return (
    <div className={`relative isolate min-h-screen overflow-x-hidden bg-[#050507] text-white ${SCROLLBAR_HIDE}`}>
      <Suspense
        fallback={
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,rgba(255,255,255,0.12),transparent_34%),#050507]" />
        }
      >
        <PrismLandingScene activationKey={prismActivationKey} />
      </Suspense>

      <nav className="pointer-events-none relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_22px_rgba(255,255,255,0.9)]" />
          <div>
            <div className="text-sm font-semibold tracking-tight text-white">AutoLabReport</div>
            <div className="text-[11px] uppercase text-white/40">Prism workspace</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleOAuthLogin('google')}
          disabled={authLoading}
          className="pointer-events-auto rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/70 backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          登入
        </button>
      </nav>

      <main className="pointer-events-none relative z-10 flex min-h-[calc(100vh-88px)] items-start px-6 pb-12 pt-3 sm:px-8">
        <section className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(280px,420px)_minmax(320px,390px)] lg:justify-between">
          <div className="max-w-md pt-8 lg:pt-12">
            <p className="mb-4 text-xs font-semibold uppercase text-white/45">
              Laboratory writing, clarified.
            </p>
            <h1 className="max-w-md text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
              AutoLabReport
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-white/58 sm:text-base">
              把原始筆記、表格與草稿整理成可提交的實驗報告。登入後進入極簡寫作空間，專注編輯、預覽與匯出。
            </p>
            <div className="mt-7 flex flex-wrap gap-3 text-xs text-white/48">
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 backdrop-blur">
                Markdown 編輯
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 backdrop-blur">
                即時預覽
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 backdrop-blur">
                Word 匯出
              </span>
            </div>
          </div>

          <div className="pointer-events-auto w-full max-w-full justify-self-stretch border-white/12 bg-black/35 p-5 shadow-2xl shadow-black/45 backdrop-blur-sm sm:rounded-[1.5rem] sm:border sm:p-6 lg:mt-2 lg:max-w-[390px] lg:justify-self-end">
            <div className="mb-5">
              <p className="text-sm font-medium text-white/45">進入工作區</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">登入你的報告空間</h2>
            </div>

            <form onSubmit={handleMagicLinkSubmit} className="space-y-3">
              {authMessage && (
                <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                  {authMessage}
                </div>
              )}
              <label className="block text-sm font-medium text-white/72" htmlFor="magic-link-email">
                Email
              </label>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 transition-all focus-within:border-white/25 focus-within:bg-black/45">
                <Mail className="h-4 w-4 shrink-0 text-white/38" aria-hidden="true" />
                <input
                  id="magic-link-email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setMagicLinkSent(false)
                  }}
                  placeholder="you@example.com"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/28"
                  disabled={magicLinkLoading || magicLinkSent}
                  autoComplete="email"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={!email.trim() || magicLinkLoading || magicLinkSent}
                className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {magicLinkSent
                  ? '連結已發送，請檢查信箱'
                  : magicLinkLoading
                    ? '傳送中...'
                    : '傳送登入連結'}
                {!magicLinkSent && !magicLinkLoading && (
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                )}
              </button>
            </form>

            <div className="my-5 flex items-center gap-4 text-white/30">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs font-medium uppercase tracking-wider">或</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handleOAuthLogin('google')}
                disabled={authLoading}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/82 transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-black">
                  G
                </span>
                使用 Google 繼續
              </button>
              <button
                type="button"
                onClick={() => handleOAuthLogin('github')}
                disabled={authLoading}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-semibold text-white/82 transition-all hover:border-white/20 hover:bg-black/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-xs font-semibold tracking-wide text-white/58">GH</span>
                使用 GitHub 繼續
              </button>
            </div>

            <p className="mt-6 text-xs leading-6 text-white/36">
              登入只負責同步你的工作區；報告內容、預覽與匯出設定會在工作區內管理。
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

function WorkspaceApp({
  user,
  onSignOut,
  onRequestAuth,
  initialSharedDocument,
}: {
  user: User | null
  onSignOut: () => void
  onRequestAuth: () => void
  initialSharedDocument?: Document | null
}) {
  const [initialWorkspace] = useState(() => {
    if (initialSharedDocument) {
      return {
        documents: [initialSharedDocument],
        activeDocumentId: initialSharedDocument.id,
      }
    }
    return getInitialWorkspace()
  })
  const [documents, setDocuments] = useState<Document[]>(initialWorkspace.documents)
  const [documentVersions, setDocumentVersions] = useState<DocumentVersion[]>(() =>
    readDocumentVersions(DOCUMENT_VERSIONS_STORAGE_KEY),
  )
  const [activeDocumentId, setActiveDocumentId] = useState(initialWorkspace.activeDocumentId)
  const [currentView, setCurrentView] = useState<AppView>(initialSharedDocument ? 'editor' : 'dashboard')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(Boolean(initialSharedDocument))
  const activeDocument =
    documents.find((document) => document.id === activeDocumentId && document.type === 'file' && !document.isTrashed) ??
    documents.find((document) => document.type === 'file' && !document.isTrashed)
  const [markdown, setMarkdown] = useState(activeDocument?.content ?? '')
  const [preview, setPreview] = useState('')
  const [theme] = useState<'light' | 'dark'>(getInitialTheme)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced')
  const [renderError, setRenderError] = useState<string | null>(null)
  const [, setExporting] = useState(false)
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [isOutlineModalOpen, setIsOutlineModalOpen] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false)
  const [isAdvancedMenuOpen, setIsAdvancedMenuOpen] = useState(false)
  const [mobileEditorPane, setMobileEditorPane] = useState<'edit' | 'preview'>('edit')
  const [collaboratorEmail, setCollaboratorEmail] = useState('')
  const [documentCollaborators, setDocumentCollaborators] = useState<DocumentCollaborator[]>([])
  const [documentCollaboratorsLoading, setDocumentCollaboratorsLoading] = useState(false)
  const [shareSettingLoading, setShareSettingLoading] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(activeDocument?.title ?? '')
  const [outlineExampleText, setOutlineExampleText] = useState('')
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [aiSettings, setAiSettings] = useState<AiSettings>(getInitialAiSettings)
  const [aiTaskLoading, setAiTaskLoading] = useState<AiAction | null>(null)
  const [aiQuota, setAiQuota] = useState<AiQuota | null>(null)
  const [aiQuotaLoading, setAiQuotaLoading] = useState(false)
  const [billingConfig, setBillingConfig] = useState<BillingConfig | null>(null)
  const [bridgeToast, setBridgeToast] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([])
  const [anonymousIdentity] = useState(getInitialAnonymousIdentity)
  const [aiSelectionMenu, setAiSelectionMenu] = useState<AiSelectionMenuState>({
    visible: false,
    top: 0,
    left: 0,
    selectedText: '',
  })
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorScrollDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorContentDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorSelectionDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorPasteCleanupRef = useRef<(() => void) | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const advancedMenuRef = useRef<HTMLDivElement | null>(null)
  const documentsRef = useRef<Document[]>(documents)
  const providerRef = useRef<WebrtcProvider | null>(null)
  const ytextRef = useRef<YText | null>(null)
  const ytextObserverCleanupRef = useRef<(() => void) | null>(null)
  const isApplyingRemoteRef = useRef(false)
  const canEditActiveDocumentRef = useRef(true)
  const aiSettingsHydratedRef = useRef(false)
  const activeAiSelectionRef = useRef<PendingAiSelection | null>(null)
  const pendingAiSelectionRef = useRef<PendingAiSelection | null>(null)
  const shareResetTimerRef = useRef<number | null>(null)
  const hasOpenedSharedDocRef = useRef(false)

  const isEditorEmpty = !markdown.trim()
  const isDarkMode = theme === 'dark'
  const shouldUseSupabaseDocuments = Boolean(supabase && user)
  const awarenessUser = useMemo(
    () => (user ? getAuthenticatedAwarenessUser(user) : anonymousIdentity),
    [anonymousIdentity, user],
  )
  const activeDocumentPermission = getDocumentPermission(activeDocument, user, documentCollaborators)
  const isActiveDocumentOwner = activeDocumentPermission === 'owner'
  const canEditActiveDocument =
    activeDocumentPermission === 'owner' || activeDocumentPermission === 'edit'
  const isReadOnlyMode = activeDocumentPermission === 'view'
  const activeDocumentVersions = useMemo(
    () =>
      activeDocument
        ? documentVersions
            .filter((version) => version.documentId === activeDocument.id)
            .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        : [],
    [activeDocument, documentVersions],
  )

  const applyLoadedDocument = useCallback((document: Document) => {
    setActiveDocumentId(document.id)
    isApplyingRemoteRef.current = true
    updateMarkdownValue(document.content)
    editorRef.current?.setValue(document.content)
    isApplyingRemoteRef.current = false
  }, [])

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!supabase || !user) return {}
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [user])

  const refreshAiQuota = useCallback(async () => {
    if (!user) {
      setAiQuota(null)
      return
    }

    setAiQuotaLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`${API_BASE_URL}/api/ai/quota`, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const quota = (await res.json()) as AiQuota
      setAiQuota(quota)
    } catch {
      setAiQuota(null)
    } finally {
      setAiQuotaLoading(false)
    }
  }, [getAuthHeaders, user])

  const readDocumentCollaborators = useCallback(async (documentId: string): Promise<DocumentCollaborator[]> => {
    if (!supabase || !shouldUseSupabaseDocuments) return []

    const { data, error } = await supabase
      .from('document_collaborators')
      .select('*')
      .eq('document_id', documentId)
      .order('user_email', { ascending: true })

    if (error) throw error

    return ((data ?? []) as DocumentCollaboratorRow[])
      .map(mapDocumentCollaborator)
      .filter((collaborator): collaborator is DocumentCollaborator => Boolean(collaborator))
  }, [shouldUseSupabaseDocuments])

  const refreshDocumentCollaborators = useCallback(
    async (documentId: string) => {
      if (!supabase || !shouldUseSupabaseDocuments) {
        setDocumentCollaborators([])
        return [] as DocumentCollaborator[]
      }

      setDocumentCollaboratorsLoading(true)
      try {
        const nextCollaborators = await readDocumentCollaborators(documentId)
        setDocumentCollaborators(nextCollaborators)
        return nextCollaborators
      } catch (err) {
        const message = err instanceof Error ? err.message : '協作者讀取失敗'
        setBridgeToast(`協作者讀取失敗：${message}`)
        setDocumentCollaborators([])
        return [] as DocumentCollaborator[]
      } finally {
        setDocumentCollaboratorsLoading(false)
      }
    },
    [readDocumentCollaborators, shouldUseSupabaseDocuments],
  )

  const refreshSupabaseDocuments = useCallback(
    async (openDocumentId?: string) => {
      if (!supabase || !shouldUseSupabaseDocuments) return [] as Document[]

      setDatabaseLoading(true)
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('*')
          .eq('is_trashed', false)
          .order('updated_at', { ascending: false })

        if (error) throw error

        const nextDocuments = ((data ?? []) as SupabaseDocumentRow[])
          .map(mapSupabaseDocument)
          .filter((document) => getDocumentPermission(document, user) !== 'none')
        setDocuments(nextDocuments)

        const documentToOpen = openDocumentId
          ? nextDocuments.find((document) => document.id === openDocumentId)
          : undefined
        if (documentToOpen) {
          applyLoadedDocument(documentToOpen)
          setIsSidebarCollapsed(true)
          setCurrentView('editor')
        }

        return nextDocuments
      } catch (err) {
        const message = err instanceof Error ? err.message : '資料庫讀取失敗'
        setBridgeToast(`資料庫同步失敗：${message}`)
        return [] as Document[]
      } finally {
        setDatabaseLoading(false)
      }
    },
    [applyLoadedDocument, shouldUseSupabaseDocuments, user],
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme, isDarkMode])

  useEffect(() => {
    window.localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(documents))
  }, [documents])

  useEffect(() => {
    window.localStorage.setItem(DOCUMENT_VERSIONS_STORAGE_KEY, JSON.stringify(documentVersions.slice(0, 120)))
  }, [documentVersions])

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_ID_STORAGE_KEY, activeDocumentId)
  }, [activeDocumentId])

  useEffect(() => {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(getPersistableAiSettings(aiSettings)))
  }, [aiSettings])

  useEffect(() => {
    let isCancelled = false

    async function fetchBillingConfig() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/billing/config`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as BillingConfig
        if (!isCancelled) setBillingConfig(data)
      } catch {
        if (!isCancelled) {
          setBillingConfig({
            enabled: false,
            pro_price_id_configured: false,
            customer_portal_url: null,
            message: '金流設定尚未連線',
          })
        }
      }
    }

    void fetchBillingConfig()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!supabase || !user) {
      aiSettingsHydratedRef.current = false
      return
    }

    let isCancelled = false
    const fetchTimer = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('user_ai_settings')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) throw error
        if (!isCancelled && data) {
          setAiSettings((currentSettings) =>
            mapSupabaseAiSettings(data as SupabaseAiSettingsRow, currentSettings),
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'AI 設定讀取失敗'
        if (!isCancelled) setBridgeToast(`AI 設定讀取失敗：${message}`)
      } finally {
        if (!isCancelled) {
          aiSettingsHydratedRef.current = true
          void refreshAiQuota()
        }
      }
    }, 0)

    return () => {
      isCancelled = true
      window.clearTimeout(fetchTimer)
    }
  }, [refreshAiQuota, user])

  useEffect(() => {
    if (!supabase || !user || !aiSettingsHydratedRef.current) return

    const saveTimer = window.setTimeout(async () => {
      const { error } = await supabase
        .from('user_ai_settings')
        .upsert(toSupabaseAiSettingsPayload(user.id, aiSettings), { onConflict: 'user_id' })

      if (error) {
        setBridgeToast(`AI 設定儲存失敗：${error.message}`)
      }
    }, 600)

    return () => window.clearTimeout(saveTimer)
  }, [aiSettings, user])

  useEffect(() => {
    if (!shouldUseSupabaseDocuments) return

    const fetchTimer = window.setTimeout(() => {
      void refreshSupabaseDocuments()
    }, 0)

    return () => window.clearTimeout(fetchTimer)
  }, [refreshSupabaseDocuments, shouldUseSupabaseDocuments, user?.id])

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
    if (!canEditActiveDocument) return

    const timer = window.setTimeout(() => {
      window.localStorage.setItem(CONTENT_STORAGE_KEY, markdown)
      setDocuments((currentDocuments) =>
        currentDocuments.map((document) =>
          document.id === activeDocumentId && document.content !== markdown
            ? { ...document, content: markdown, updatedAt: new Date().toISOString() }
            : document,
        ),
      )
      if (supabase && activeDocumentId) {
        void supabase
          .from('documents')
          .update({ content: markdown })
          .eq('id', activeDocumentId)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
    }
  }, [activeDocumentId, canEditActiveDocument, markdown])

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
    if (!activeDocumentId) {
      const clearTimer = window.setTimeout(() => setDocumentCollaborators([]), 0)
      return () => window.clearTimeout(clearTimer)
    }

    const fetchTimer = window.setTimeout(() => {
      void refreshDocumentCollaborators(activeDocumentId)
    }, 0)

    return () => window.clearTimeout(fetchTimer)
  }, [activeDocumentId, refreshDocumentCollaborators])

  useEffect(() => {
    canEditActiveDocumentRef.current = canEditActiveDocument
  }, [canEditActiveDocument])

  useEffect(() => {
    if (!activeDocument || documentCollaboratorsLoading || activeDocumentPermission !== 'none') return

    const redirectTimer = window.setTimeout(() => {
      setBridgeToast('您沒有權限存取此文件')
      setCurrentView('dashboard')
      window.history.replaceState(null, '', '/dashboard')
    }, 0)

    return () => {
      window.clearTimeout(redirectTimer)
    }
  }, [activeDocument, activeDocumentPermission, documentCollaboratorsLoading])

  useEffect(() => {
    if (hasOpenedSharedDocRef.current) return

    const sharedDocId = getSharedDocumentIdFromLocation()
    if (!sharedDocId) return

    let isCancelled = false

    async function openSharedDocument() {
      let sharedDocument = documents.find(
        (document) => document.id === sharedDocId && document.type === 'file' && !document.isTrashed,
      )

      if (!sharedDocument && supabase && shouldUseSupabaseDocuments) {
        const { data, error } = await supabase
          .from('documents')
          .select('*')
          .eq('id', sharedDocId)
          .eq('is_trashed', false)
          .maybeSingle()

        if (error) {
          setBridgeToast(`文件載入失敗：${error.message}`)
        }

        if (data) {
          sharedDocument = mapSupabaseDocument(data as SupabaseDocumentRow)
        }
      }

      if (isCancelled) return

      if (!sharedDocument) {
        hasOpenedSharedDocRef.current = true
        setBridgeToast('您沒有權限存取此文件')
        setCurrentView('dashboard')
        window.history.replaceState(null, '', '/dashboard')
        return
      }

      let sharedCollaborators: DocumentCollaborator[] = []
      try {
        sharedCollaborators = await readDocumentCollaborators(sharedDocument.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : '協作者讀取失敗'
        setBridgeToast(`協作者讀取失敗：${message}`)
      }

      if (isCancelled) return

      const permission = getDocumentPermission(sharedDocument, user, sharedCollaborators)
      if (permission === 'none') {
        hasOpenedSharedDocRef.current = true
        setBridgeToast('您沒有權限存取此文件')
        setCurrentView('dashboard')
        window.history.replaceState(null, '', '/dashboard')
        return
      }

      hasOpenedSharedDocRef.current = true
      setDocumentCollaborators(sharedCollaborators)
      setDocuments((currentDocuments) => {
        if (currentDocuments.some((document) => document.id === sharedDocument.id)) {
          return currentDocuments.map((document) =>
            document.id === sharedDocument.id ? sharedDocument : document,
          )
        }
        return [sharedDocument, ...currentDocuments]
      })
      applyLoadedDocument(sharedDocument)
      setIsSidebarCollapsed(true)
      setCurrentView('editor')
      window.history.replaceState(null, '', `/editor/${encodeURIComponent(sharedDocument.id)}`)
    }

    void openSharedDocument()

    return () => {
      isCancelled = true
    }
  }, [applyLoadedDocument, documents, readDocumentCollaborators, shouldUseSupabaseDocuments, user])

  useEffect(() => {
    function handleAutoLabReportInsert(event: Event) {
      if (!canEditActiveDocumentRef.current) {
        setBridgeToast('此文件目前為唯讀模式，無法插入內容')
        return
      }

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

    let isCancelled = false
    let cleanupCollaboration: (() => void) | null = null

    ytextObserverCleanupRef.current?.()
    providerRef.current?.destroy()
    ytextRef.current = null

    async function setupCollaboration() {
      const activeDoc = documentsRef.current.find((document) => document.id === activeDocumentId)
      const roomDoc = await getDocumentYDoc(activeDocumentId)
      if (isCancelled) return

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

      const { WebrtcProvider: WebrtcProviderCtor } = await import('y-webrtc')
      if (isCancelled) return

      const provider = new WebrtcProviderCtor(activeDocumentId, roomDoc)
      providerRef.current = provider
      provider.awareness.setLocalStateField('user', awarenessUser)
      if (editorRef.current) {
        const cursorState = getCursorAwarenessState(editorRef.current, awarenessUser)
        if (cursorState) {
          provider.awareness.setLocalStateField('cursor', cursorState)
        }
      }

      const syncCollaborators = () => {
        const nextCollaborators = Array.from(provider.awareness.getStates().entries())
          .map(([clientId, state]) =>
            getCollaboratorFromAwarenessState(clientId, state, roomDoc.clientID),
          )
          .filter((collaborator): collaborator is CollaboratorPresence => Boolean(collaborator))
          .sort((left, right) => Number(right.isLocal) - Number(left.isLocal) || left.name.localeCompare(right.name))

        setCollaborators(nextCollaborators)
      }

      provider.awareness.on('change', syncCollaborators)
      syncCollaborators()

      const handleYTextChange = () => {
        const remoteValue = ytext.toString()
        isApplyingRemoteRef.current = true
        updateMarkdownValue(remoteValue)
        if (editorRef.current && editorRef.current.getValue() !== remoteValue) {
          editorRef.current.setValue(remoteValue)
        }
        isApplyingRemoteRef.current = false
      }

      ytext.observe(handleYTextChange)
      ytextObserverCleanupRef.current = () => {
        ytext.unobserve(handleYTextChange)
      }

      cleanupCollaboration = () => {
        ytext.unobserve(handleYTextChange)
        ytextObserverCleanupRef.current = null
        provider.awareness.off('change', syncCollaborators)
        setCollaborators([])
        provider.destroy()
        if (providerRef.current === provider) {
          providerRef.current = null
        }
      }
    }

    void setupCollaboration().catch((err) => {
      if (isCancelled) return
      const message = err instanceof Error ? err.message : '協作連線初始化失敗'
      setBridgeToast(`協作連線初始化失敗：${message}`)
    })

    return () => {
      isCancelled = true
      cleanupCollaboration?.()
      ytextObserverCleanupRef.current = null
      providerRef.current?.destroy()
      providerRef.current = null
      ytextRef.current = null
    }
  }, [activeDocumentId, awarenessUser])

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
    if (!canEditActiveDocumentRef.current) {
      setBridgeToast('此文件目前為唯讀模式，無法修改內容')
      return
    }

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
    if (!canEditActiveDocumentRef.current) {
      const ytextValue = ytextRef.current?.toString() ?? markdown
      isApplyingRemoteRef.current = true
      editorRef.current?.setValue(ytextValue)
      updateMarkdownValue(ytextValue)
      isApplyingRemoteRef.current = false
      return
    }

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

  function updateLocalCursorAwareness(ed: editor.IStandaloneCodeEditor) {
    const provider = providerRef.current
    const cursorState = getCursorAwarenessState(ed, awarenessUser)
    if (!provider || !cursorState) return

    provider.awareness.setLocalStateField('cursor', cursorState)
  }

  function updateAiSelectionMenu(ed: editor.IStandaloneCodeEditor) {
    if (!canEditActiveDocumentRef.current) {
      setAiSelectionMenu((current) => (current.visible ? { ...current, visible: false } : current))
      return
    }

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

  async function runAiTask(request: AiTaskRequest): Promise<string | null> {
    const provider = request.provider ?? aiSettings.preferredProvider
    const cleanText = request.text.trim()
    if (!cleanText) {
      setBridgeToast('請先提供要處理的文字')
      return null
    }

    const promptTemplate = request.prompt ?? getPromptTemplateForAction(aiSettings, request.action)
    const prompt = fillPromptTemplate(promptTemplate, cleanText, request.action)

    if (provider === 'user_api_key' && (!aiSettings.userApiKey.trim() || aiSettings.userApiProvider === 'none')) {
      setBridgeToast('請先到 AI 設定填入 API Provider 與 API Key')
      return null
    }

    if (provider === 'extension') {
      window.dispatchEvent(
        new CustomEvent('AutoLabReport_RequestAI', {
          detail: {
            text: cleanText,
            action: request.action,
            prompt,
            autoReturn: aiSettings.extensionAutoReturn,
          },
        }),
      )
      setBridgeToast('已送出至瀏覽器插件')
      return null
    }

    setAiTaskLoading(request.action)
    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch(`${API_BASE_URL}/api/ai/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          provider,
          action: request.action,
          text: cleanText,
          document_id: request.documentId ?? activeDocumentId,
          prompt,
          api_provider: provider === 'user_api_key' ? aiSettings.userApiProvider : undefined,
          api_key: provider === 'user_api_key' ? aiSettings.userApiKey : undefined,
          model: aiSettings.defaultModel || undefined,
        }),
      })

      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const err = (await res.json()) as { detail?: string }
          if (err.detail) detail = err.detail
        } catch {
          /* response may not be JSON */
        }
        throw new Error(detail)
      }

      const data = (await res.json()) as { markdown?: string; remaining_quota?: number }
      if (typeof data.remaining_quota === 'number') {
        setAiQuota((currentQuota) =>
          currentQuota ? { ...currentQuota, remaining: data.remaining_quota ?? currentQuota.remaining } : currentQuota,
        )
        void refreshAiQuota()
        setBridgeToast(`AI 已完成，今日剩餘 ${data.remaining_quota} 次`)
      }
      return data.markdown?.trim() || null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 任務失敗'
      setBridgeToast(`AI 任務失敗：${message}`)
      return null
    } finally {
      setAiTaskLoading(null)
    }
  }

  async function requestAiEdit(action: 'rewrite' | 'expand') {
    if (!canEditActiveDocumentRef.current) {
      setBridgeToast('此文件目前為唯讀模式，無法發送重寫請求')
      return
    }

    const activeSelection = activeAiSelectionRef.current
    if (!activeSelection) return

    pendingAiSelectionRef.current = activeSelection
    const result = await runAiTask({
      action,
      text: activeSelection.text,
      documentId: activeDocumentId,
      insertMode: 'replace-selection',
    })
    if (result) {
      insertAtCursor(result)
      pendingAiSelectionRef.current = null
    }
    setAiSelectionMenu((current) => ({ ...current, visible: false }))
  }

  function applyEditorEdit(text: string, cursorOffset?: number) {
    if (!canEditActiveDocumentRef.current) {
      setBridgeToast('此文件目前為唯讀模式，無法修改內容')
      return
    }

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

  function getSelectedEditorText() {
    const ed = editorRef.current
    const selection = ed?.getSelection()
    const model = ed?.getModel()
    if (!ed || !selection || !model) return ''

    return model.getValueInRange(selection)
  }

  function wrapSelection(prefix: string, suffix = prefix, placeholder = '文字') {
    const selectedText = getSelectedEditorText()
    const nextText = `${prefix}${selectedText || placeholder}${suffix}`
    const cursorOffset = selectedText ? nextText.length : prefix.length
    applyEditorEdit(nextText, cursorOffset)
  }

  function prefixSelectionLines(prefix: string, placeholder = '文字') {
    const selectedText = getSelectedEditorText()
    const sourceText = selectedText || placeholder
    const nextText = sourceText
      .split(/\r?\n/)
      .map((line) => `${prefix}${line}`)
      .join('\n')
    applyEditorEdit(nextText, selectedText ? undefined : prefix.length)
  }

  function runEditorCommand(command: string) {
    const ed = editorRef.current
    if (!ed) return
    ed.trigger('markdown-toolbar', command, null)
    ed.focus()
  }

  function insertMarkdownSnippet(kind: string) {
    if (!canEditActiveDocumentRef.current) {
      setBridgeToast('此文件目前為唯讀模式，無法修改內容')
      return
    }

    if (kind === 'undo') {
      runEditorCommand('undo')
      return
    }
    if (kind === 'redo') {
      runEditorCommand('redo')
      return
    }
    if (kind === 'bold') {
      wrapSelection('**', '**', '粗體文字')
      return
    }
    if (kind === 'italic') {
      wrapSelection('*', '*', '斜體文字')
      return
    }
    if (kind === 'strike') {
      wrapSelection('~~', '~~', '刪除線文字')
      return
    }
    if (kind === 'heading') {
      prefixSelectionLines('## ', '標題')
      return
    }
    if (kind === 'code') {
      wrapSelection('`', '`', 'code')
      return
    }
    if (kind === 'quote') {
      prefixSelectionLines('> ', '引用文字')
      return
    }
    if (kind === 'bullet') {
      prefixSelectionLines('- ', '清單項目')
      return
    }
    if (kind === 'ordered') {
      const selectedText = getSelectedEditorText()
      const lines = (selectedText || '清單項目').split(/\r?\n/)
      applyEditorEdit(lines.map((line, index) => `${index + 1}. ${line}`).join('\n'), selectedText ? undefined : 3)
      return
    }
    if (kind === 'check') {
      prefixSelectionLines('- [ ] ', '待辦事項')
      return
    }
    if (kind === 'link') {
      insertAtCursor('[連結文字](https://example.com)', 1)
      return
    }
    if (kind === 'image') {
      insertAtCursor('![圖片說明](https://example.com/image.png)', 2)
      return
    }
    if (kind === 'table') {
      insertAtCursor('| 欄位 A | 欄位 B |\n|---|---|\n|  |  |')
      return
    }
    if (kind === 'hr') {
      insertAtCursor('\n---\n')
      return
    }
    if (kind === 'comment') {
      insertAtCursor('<!-- 註解 -->', 5)
    }
  }

  function handleEditorPaste(event: ClipboardEvent) {
    if (!canEditActiveDocumentRef.current) return

    const pastedText = event.clipboardData?.getData('text/plain') ?? ''
    if (!pastedText.includes('\t') || !/\r?\n/.test(pastedText)) return

    const table = convertTsvToMarkdownTable(pastedText)
    if (!table) return

    event.preventDefault()
    event.stopPropagation()
    insertAtCursor(table)
  }

  function handleSmartFormat() {
    if (!canEditActiveDocument) {
      setBridgeToast('此文件目前為唯讀模式，無法修改內容')
      return
    }

    syncEditorValue(smartFormat(markdown))
    editorRef.current?.focus()
  }

  async function generateOutline() {
    if (!canEditActiveDocument) {
      setBridgeToast('此文件目前為唯讀模式，無法插入大綱')
      return
    }

    setOutlineLoading(true)
    try {
      const outlineMarkdown = await runAiTask({
        action: 'outline',
        text: outlineExampleText || markdown || '# 實驗報告\n## 實驗目的\n## 實驗原理\n## 實驗步驟\n## 結果與討論',
        documentId: activeDocumentId,
        insertMode: 'insert-at-cursor',
      })
      if (!outlineMarkdown) {
        return
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
      setBridgeToast(`產生大綱失敗：${message}`)
    } finally {
      setOutlineLoading(false)
    }
  }

  function loadDocument(document: Document) {
    if (document.type !== 'file' || document.isTrashed) return

    if (supabase && shouldUseSupabaseDocuments) {
      setDocumentCollaboratorsLoading(true)
    }
    setActiveDocumentId(document.id)
    isApplyingRemoteRef.current = true
    updateMarkdownValue(document.content)
    editorRef.current?.setValue(document.content)
    isApplyingRemoteRef.current = false
  }

  async function createDocumentForParent(parentId: string | null) {
    if (databaseLoading) return

    if (supabase && shouldUseSupabaseDocuments) {
      setDatabaseLoading(true)
      try {
        const { data, error } = await supabase
          .from('documents')
          .insert([{ title: '未命名報告', content: '', share_setting: 'private' }])
          .select('*')
          .single()

        if (error) throw error

        const nextDocument = mapSupabaseDocument(data as SupabaseDocumentRow)
        await refreshSupabaseDocuments(nextDocument.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : '新增報告失敗'
        setBridgeToast(`新增報告失敗：${message}`)
      } finally {
        setDatabaseLoading(false)
      }
      return
    }

    const fileCount = documents.filter((document) => document.type === 'file' && !document.isTrashed).length
    const nextDocument = createDocument(`未命名報告 ${fileCount + 1}`, '', parentId)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    loadDocument(nextDocument)
    setIsSidebarCollapsed(true)
    setCurrentView('editor')
  }

  function createNewDocument() {
    void createDocumentForParent(null)
  }

  async function createDocumentFromTemplate(template: (typeof DEFAULT_TEMPLATES)[number]) {
    if (databaseLoading) return

    if (supabase && shouldUseSupabaseDocuments) {
      setDatabaseLoading(true)
      try {
        const { data, error } = await supabase
          .from('documents')
          .insert([{ title: template.title, content: template.content, share_setting: 'private' }])
          .select('*')
          .single()

        if (error) throw error

        const nextDocument = mapSupabaseDocument(data as SupabaseDocumentRow)
        await refreshSupabaseDocuments(nextDocument.id)
        window.setTimeout(() => {
          editorRef.current?.focus()
          editorRef.current?.setPosition({ lineNumber: 1, column: 1 })
        }, 0)
      } catch (err) {
        const message = err instanceof Error ? err.message : '套用模板失敗'
        setBridgeToast(`套用模板失敗：${message}`)
      } finally {
        setDatabaseLoading(false)
      }
      return
    }

    const nextDocument = createDocument(template.title, template.content, null)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    loadDocument(nextDocument)
    setIsSidebarCollapsed(true)
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
    void createDocumentForParent(parentId)
  }

  function selectDocument(id: string) {
    const nextDocument = documents.find((document) => document.id === id)
    if (!nextDocument || nextDocument.type !== 'file' || nextDocument.isTrashed) return
    if (getDocumentPermission(nextDocument, user) === 'none') {
      setBridgeToast('您沒有權限存取此文件')
      setCurrentView('dashboard')
      window.history.replaceState(null, '', '/dashboard')
      return
    }

    loadDocument(nextDocument)
    setIsSidebarCollapsed(true)
    setCurrentView('editor')
  }

  async function renameDocument(id: string) {
    if (databaseLoading) return

    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return
    if (getDocumentPermission(targetDocument, user) !== 'owner') {
      setBridgeToast('只有文件擁有者可以重新命名')
      return
    }

    const nextTitle = window.prompt('重新命名檔案', targetDocument.title)?.trim()
    if (!nextTitle) return

    if (supabase && shouldUseSupabaseDocuments) {
      setDatabaseLoading(true)
      try {
        const { error } = await supabase.from('documents').update({ title: nextTitle }).eq('id', id)
        if (error) throw error
        await refreshSupabaseDocuments()
        if (id === activeDocumentId) setTitleDraft(nextTitle)
      } catch (err) {
        const message = err instanceof Error ? err.message : '重新命名失敗'
        setBridgeToast(`重新命名失敗：${message}`)
      } finally {
        setDatabaseLoading(false)
      }
      return
    }

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === id ? { ...document, title: nextTitle, updatedAt: new Date().toISOString() } : document,
      ),
    )
  }

  async function updateActiveDocumentTitle(nextTitle: string) {
    if (databaseLoading) return
    if (!isActiveDocumentOwner) {
      setBridgeToast('只有文件擁有者可以重新命名')
      setTitleDraft(activeDocument?.title ?? '')
      setIsTitleEditing(false)
      return
    }

    const trimmedTitle = nextTitle.trim()
    if (!activeDocument || !trimmedTitle) {
      setTitleDraft(activeDocument?.title ?? '')
      setIsTitleEditing(false)
      return
    }

    if (supabase && shouldUseSupabaseDocuments) {
      setDatabaseLoading(true)
      try {
        const { error } = await supabase
          .from('documents')
          .update({ title: trimmedTitle })
          .eq('id', activeDocument.id)
        if (error) throw error
        await refreshSupabaseDocuments()
        setTitleDraft(trimmedTitle)
        setIsTitleEditing(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : '重新命名失敗'
        setBridgeToast(`重新命名失敗：${message}`)
      } finally {
        setDatabaseLoading(false)
      }
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

  async function deleteDocument(id: string) {
    if (databaseLoading) return

    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return
    if (getDocumentPermission(targetDocument, user) !== 'owner') {
      setBridgeToast('只有文件擁有者可以刪除文件')
      return
    }

    const deleteLabel = targetDocument.type === 'folder' ? '資料夾與其中所有項目' : '檔案'
    if (!window.confirm(`將${deleteLabel}「${targetDocument.title}」移至垃圾桶？`)) return

    if (supabase && shouldUseSupabaseDocuments && targetDocument.type === 'file') {
      setDatabaseLoading(true)
      try {
        const { error } = await supabase.from('documents').update({ is_trashed: true }).eq('id', id)
        if (error) throw error

        const now = new Date().toISOString()
        const nextDocuments = documents.map((document) =>
          document.id === id ? { ...document, isTrashed: true, updatedAt: now } : document,
        )
        const remainingFiles = nextDocuments.filter((document) => document.type === 'file' && !document.isTrashed)
        setDocuments(nextDocuments)

        if (id === activeDocumentId) {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : '刪除報告失敗'
        setBridgeToast(`刪除報告失敗：${message}`)
      } finally {
        setDatabaseLoading(false)
      }
      return
    }

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

  async function toggleDocumentFavorite(id: string) {
    if (databaseLoading) return

    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument || targetDocument.type !== 'file' || targetDocument.isTrashed) return

    if (supabase && shouldUseSupabaseDocuments) {
      const nextFavoriteState = !targetDocument.isFavorite
      setDatabaseLoading(true)
      try {
        const { error } = await supabase
          .from('documents')
          .update({ is_favorite: nextFavoriteState })
          .eq('id', id)
        if (error) throw error
        await refreshSupabaseDocuments()
      } catch (err) {
        const message = err instanceof Error ? err.message : '收藏狀態更新失敗'
        setBridgeToast(`收藏狀態更新失敗：${message}`)
      } finally {
        setDatabaseLoading(false)
      }
      return
    }

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
      const { default: html2pdf } = await import('html2pdf.js')

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

  function saveActiveDocumentVersion(note = '手動儲存') {
    if (!activeDocument) {
      setBridgeToast('目前沒有可儲存版本的文件')
      return
    }

    const nextVersion = createDocumentVersion(activeDocument, markdown, note)
    setDocumentVersions((currentVersions) => {
      const versionsForDocument = currentVersions.filter((version) => version.documentId === activeDocument.id)
      const duplicateLatest = versionsForDocument
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]

      if (duplicateLatest?.content === markdown) {
        setBridgeToast('目前內容與最新版本相同')
        return currentVersions
      }

      return [nextVersion, ...currentVersions].slice(0, 120)
    })
    setBridgeToast('已儲存目前版本')
  }

  function restoreDocumentVersion(version: DocumentVersion) {
    if (!activeDocument || version.documentId !== activeDocument.id) {
      setBridgeToast('此版本不屬於目前文件')
      return
    }

    if (!canEditActiveDocument) {
      setBridgeToast('此文件目前為唯讀模式，無法還原版本')
      return
    }

    saveActiveDocumentVersion('還原前自動備份')
    syncEditorValue(version.content)
    setCurrentView('editor')
    setBridgeToast(`已還原 ${formatDocumentTime(version.createdAt)} 的版本`)
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

    void refreshDocumentCollaborators(activeDocument.id)
    setIsShareModalOpen(true)
  }

  async function shareDocument(documentId: string, updateShareButton = false) {
    const targetDocument = documents.find(
      (document) => document.id === documentId && document.type === 'file' && !document.isTrashed,
    )
    if (!targetDocument) {
      setBridgeToast('找不到可分享的報告')
      return
    }

    const shareUrl = `${window.location.origin}/editor/${encodeURIComponent(targetDocument.id)}`

    try {
      await navigator.clipboard.writeText(shareUrl)
      if (updateShareButton) setShareCopied(true)
      setBridgeToast('分享連結已複製')

      if (updateShareButton) {
        if (shareResetTimerRef.current !== null) {
          window.clearTimeout(shareResetTimerRef.current)
        }
        shareResetTimerRef.current = window.setTimeout(() => {
          setShareCopied(false)
          shareResetTimerRef.current = null
        }, 2000)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '剪貼簿寫入失敗'
      setBridgeToast(`分享連結複製失敗：${message}`)
    }
  }

  async function updateShareSetting(nextShareSetting: ShareSetting) {
    if (!activeDocument) return
    if (!isActiveDocumentOwner) {
      setBridgeToast('只有文件擁有者可以修改分享權限')
      return
    }

    setShareSettingLoading(true)
    try {
      if (supabase && shouldUseSupabaseDocuments) {
        const { error } = await supabase
          .from('documents')
          .update({ share_setting: nextShareSetting })
          .eq('id', activeDocument.id)
        if (error) throw error
      }

      const now = new Date().toISOString()
      setDocuments((currentDocuments) =>
        currentDocuments.map((document) =>
          document.id === activeDocument.id
            ? { ...document, shareSetting: nextShareSetting, updatedAt: now }
            : document,
        ),
      )
      setBridgeToast('分享權限已更新')
    } catch (err) {
      const message = err instanceof Error ? err.message : '分享權限更新失敗'
      setBridgeToast(`分享權限更新失敗：${message}`)
    } finally {
      setShareSettingLoading(false)
    }
  }

  async function inviteDocumentCollaborator() {
    if (!activeDocument || !isActiveDocumentOwner || !user) {
      setBridgeToast('只有文件擁有者可以邀請協作者')
      return
    }

    const normalizedEmail = collaboratorEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setBridgeToast('請輸入有效的 Email')
      return
    }
    if (normalizedEmail === user.email?.trim().toLowerCase()) {
      setBridgeToast('擁有者不需要加入協作者名單')
      return
    }
    if (documentCollaborators.some((collaborator) => collaborator.userEmail === normalizedEmail)) {
      setBridgeToast('此使用者已在協作者名單中')
      return
    }

    setShareSettingLoading(true)
    try {
      if (supabase && shouldUseSupabaseDocuments) {
        const { error } = await supabase.from('document_collaborators').insert([
          {
            document_id: activeDocument.id,
            user_email: normalizedEmail,
            role: 'edit',
          },
        ])
        if (error) throw error
      }

      setDocumentCollaborators((currentCollaborators) => [
        ...currentCollaborators,
        { documentId: activeDocument.id, userEmail: normalizedEmail, role: 'edit' },
      ])
      setCollaboratorEmail('')
      setBridgeToast('協作者已邀請')
    } catch (err) {
      const message = err instanceof Error ? err.message : '邀請協作者失敗'
      setBridgeToast(`邀請協作者失敗：${message}`)
    } finally {
      setShareSettingLoading(false)
    }
  }

  async function updateDocumentCollaboratorRole(userEmail: string, nextRole: CollaboratorRole) {
    if (!activeDocument || !isActiveDocumentOwner) {
      setBridgeToast('只有文件擁有者可以修改協作者權限')
      return
    }

    setShareSettingLoading(true)
    try {
      if (supabase && shouldUseSupabaseDocuments) {
        const { error } = await supabase
          .from('document_collaborators')
          .update({ role: nextRole })
          .eq('document_id', activeDocument.id)
          .eq('user_email', userEmail)
        if (error) throw error
      }

      setDocumentCollaborators((currentCollaborators) =>
        currentCollaborators.map((collaborator) =>
          collaborator.userEmail === userEmail ? { ...collaborator, role: nextRole } : collaborator,
        ),
      )
      setBridgeToast('協作者權限已更新')
    } catch (err) {
      const message = err instanceof Error ? err.message : '協作者權限更新失敗'
      setBridgeToast(`協作者權限更新失敗：${message}`)
    } finally {
      setShareSettingLoading(false)
    }
  }

  async function removeDocumentCollaborator(userEmail: string) {
    if (!activeDocument || !isActiveDocumentOwner) {
      setBridgeToast('只有文件擁有者可以移除協作者')
      return
    }

    setShareSettingLoading(true)
    try {
      if (supabase && shouldUseSupabaseDocuments) {
        const { error } = await supabase
          .from('document_collaborators')
          .delete()
          .eq('document_id', activeDocument.id)
          .eq('user_email', userEmail)
        if (error) throw error
      }

      setDocumentCollaborators((currentCollaborators) =>
        currentCollaborators.filter((collaborator) => collaborator.userEmail !== userEmail),
      )
      setBridgeToast('協作者已移除')
    } catch (err) {
      const message = err instanceof Error ? err.message : '移除協作者失敗'
      setBridgeToast(`移除協作者失敗：${message}`)
    } finally {
      setShareSettingLoading(false)
    }
  }

  function deleteActiveDocument() {
    if (!activeDocument) return

    setIsAdvancedMenuOpen(false)
    deleteDocument(activeDocument.id)
  }

  const isGenerating = syncStatus === 'pending' || syncStatus === 'rendering'
  const shouldShowSidebar = Boolean(user && (currentView !== 'editor' || !isSidebarCollapsed))

  return (
    <div className="flex h-full min-h-screen bg-zinc-50 font-sans text-zinc-800 transition-colors duration-300 dark:bg-zinc-950 dark:text-zinc-100">
      {shouldShowSidebar && (
        <DocumentSidebar
          documents={documents}
          activeDocumentId={activeDocumentId}
          currentView={currentView}
          isCollapsed={currentView === 'editor' ? false : isSidebarCollapsed}
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
          user={user}
          onSignOut={onSignOut}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
      {currentView === 'editor' ? (
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-[#242529] px-4 text-zinc-100 shadow-sm">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {user && isSidebarCollapsed && (
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(false)}
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white"
                title="顯示工作區"
              >
                <PanelLeftOpen className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">工作區</span>
              </button>
            )}
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
                className="w-full max-w-md rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-zinc-100 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!isActiveDocumentOwner) return
                  setTitleDraft(activeDocument?.title ?? '')
                  setIsTitleEditing(true)
                }}
                className={`max-w-md truncate rounded-lg px-2 py-1 text-left text-sm font-semibold text-zinc-100 transition-colors ${
                  isActiveDocumentOwner
                    ? 'hover:bg-white/10'
                    : 'cursor-default'
                }`}
                title={isActiveDocumentOwner ? '點擊重新命名' : '只有擁有者可以重新命名'}
              >
                {activeDocument?.title ?? '未命名報告'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <CollaboratorAvatarGroup collaborators={collaborators} />
            {isReadOnlyMode && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                唯讀模式
              </span>
            )}
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
            <button
              type="button"
              onClick={() => setCurrentView('settings')}
              className="hidden rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white md:inline-flex"
            >
              AI 設定
            </button>
            <button
              type="button"
              onClick={() => setCurrentView('quality')}
              className="hidden rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white lg:inline-flex"
            >
              報告檢查
            </button>
            <button
              type="button"
              onClick={() => setCurrentView('history')}
              className="hidden rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white lg:inline-flex"
            >
              版本
            </button>
            <button
              type="button"
              onClick={() => void exportWordReport()}
              disabled={isEditorEmpty || syncStatus === 'exporting' || syncStatus === 'exportingPdf'}
              className="hidden rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 xl:inline-flex"
            >
              Word
            </button>
            <button
              type="button"
              onClick={() => void exportPdfReport()}
              disabled={isEditorEmpty || syncStatus === 'exporting' || syncStatus === 'exportingPdf'}
              className="hidden rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 xl:inline-flex"
            >
              PDF
            </button>
            {user ? (
              <button
                type="button"
                onClick={shareCurrentDocument}
                className="rounded-md bg-violet-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
              >
                ✨ 分享
              </button>
            ) : (
              <button
                type="button"
                onClick={onRequestAuth}
                className="rounded-md bg-violet-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500"
              >
                註冊 / 登入
              </button>
            )}

            <div ref={advancedMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsAdvancedMenuOpen((current) => !current)}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-lg leading-none text-zinc-200 transition hover:bg-white/10 hover:text-white"
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
                      saveActiveDocumentVersion()
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span>↺</span>
                    儲存版本快照
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      setCurrentView('quality')
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span>✓</span>
                    報告完整度檢查
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
                    disabled={!isActiveDocumentOwner}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium text-red-300 transition-colors hover:bg-white/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
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
          </div>
        </header>
      )}

      {currentView === 'editor' && (
        <div
          className={`z-30 flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-[#303138] px-3 text-zinc-300 ${SCROLLBAR_HIDE}`}
          role="toolbar"
          aria-label="Markdown 格式工具列"
        >
          {[
            ['undo', '↶', '復原'],
            ['redo', '↷', '重做'],
            ['divider-1', '', ''],
            ['bold', 'B', '粗體'],
            ['italic', 'I', '斜體'],
            ['strike', 'S', '刪除線'],
            ['heading', 'H', '標題'],
            ['code', '</>', '程式碼'],
            ['quote', '”', '引用'],
            ['bullet', '•', '項目清單'],
            ['ordered', '1.', '編號清單'],
            ['check', '☑', '待辦清單'],
            ['divider-2', '', ''],
            ['link', '🔗', '連結'],
            ['image', '▧', '圖片'],
            ['table', '▦', '表格'],
            ['hr', '—', '分隔線'],
            ['comment', '○', '註解'],
          ].map(([kind, label, title]) =>
            kind.startsWith('divider') ? (
              <span key={kind} className="mx-1 h-5 w-px shrink-0 bg-zinc-600" />
            ) : (
              <button
                key={kind}
                type="button"
                title={title}
                aria-label={title}
                disabled={!canEditActiveDocument}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMarkdownSnippet(kind)}
                className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-2 text-sm font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                {label}
              </button>
            ),
          )}
          <span className="min-w-3 flex-1" />
          <button
            type="button"
            title="切換 AI 模式、插件橋接或自備 API Key"
            onClick={() => setCurrentView('settings')}
            className="hidden h-8 shrink-0 items-center rounded-md border border-white/10 bg-white/5 px-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white md:inline-flex"
          >
            AI 設定
          </button>
          <button
            type="button"
            title="生成報告大綱"
            onClick={() => setIsOutlineModalOpen(true)}
            disabled={!canEditActiveDocument || Boolean(aiTaskLoading)}
            className="hidden h-8 shrink-0 items-center rounded-md border border-white/10 bg-white/5 px-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex"
          >
            生成大綱
          </button>
          <button
            type="button"
            title="智慧排版修復"
            onClick={handleSmartFormat}
            disabled={isEditorEmpty || !canEditActiveDocument || Boolean(aiTaskLoading)}
            className="hidden h-8 shrink-0 items-center rounded-md bg-violet-600 px-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
          >
            智慧排版
          </button>
        </div>
      )}

      {currentView === 'dashboard' ? (
        <DashboardView
          documents={documents}
          onOpenDocument={selectDocument}
          onCreateDocument={createNewDocument}
          onRenameDocument={renameDocument}
          onShareDocument={shareDocument}
          onToggleFavorite={toggleDocumentFavorite}
          onDeleteDocument={deleteDocument}
          isLoading={databaseLoading}
        />
      ) : currentView === 'favorites' ? (
        <DashboardView
          documents={documents}
          onOpenDocument={selectDocument}
          onCreateDocument={createNewDocument}
          onRenameDocument={renameDocument}
          onShareDocument={shareDocument}
          onToggleFavorite={toggleDocumentFavorite}
          onDeleteDocument={deleteDocument}
          favoriteOnly
          isLoading={databaseLoading}
        />
      ) : currentView === 'trash' ? (
        <TrashView
          documents={documents}
          onRestoreDocument={restoreDocument}
          onHardDeleteDocument={hardDeleteDocument}
        />
      ) : currentView === 'settings' ? (
        <AiSettingsView
          settings={aiSettings}
          quota={aiQuota}
          quotaLoading={aiQuotaLoading}
          onChangeSettings={setAiSettings}
        />
      ) : currentView === 'billing' ? (
        <BillingView
          quota={aiQuota}
          quotaLoading={aiQuotaLoading}
          billingConfig={billingConfig}
          onOpenAiSettings={() => setCurrentView('settings')}
        />
      ) : currentView === 'quality' ? (
        <ReportQualityView
          document={activeDocument}
          markdown={markdown}
          onBackToEditor={() => setCurrentView('editor')}
        />
      ) : currentView === 'history' ? (
        <VersionHistoryView
          document={activeDocument}
          versions={activeDocumentVersions}
          onBackToEditor={() => setCurrentView('editor')}
          onSaveVersion={() => saveActiveDocumentVersion()}
          onRestoreVersion={restoreDocumentVersion}
        />
      ) : currentView === 'templates' ? (
        <TemplatesView onUseTemplate={createDocumentFromTemplate} />
      ) : (
      <>
      <div className="flex border-b border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950 lg:hidden">
        {([
          ['edit', '編輯'],
          ['preview', '預覽'],
        ] as const).map(([pane, label]) => (
          <button
            key={pane}
            type="button"
            onClick={() => setMobileEditorPane(pane)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              mobileEditorPane === pane
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <main className="grid min-h-0 flex-1 grid-cols-1 bg-[#1f2023] lg:grid-cols-2">
        <section
          className={`min-h-0 flex-grow flex-col border-b border-zinc-800 transition-colors duration-300 lg:flex lg:border-b-0 lg:border-r ${
            mobileEditorPane === 'edit' ? 'flex' : 'hidden'
          }`}
        >
          <div className="relative min-h-[280px] flex-1 flex-grow bg-[#1f2023] font-mono leading-relaxed lg:min-h-0">
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
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm font-medium text-zinc-500">
                  正在載入編輯器...
                </div>
              }
            >
              <MarkdownEditor
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
                    updateLocalCursorAwareness(ed)
                    updateAiSelectionMenu(ed)
                  })

                  editorPasteCleanupRef.current?.()
                  const editorDomNode = ed.getDomNode()
                  editorDomNode?.addEventListener('paste', handleEditorPaste)
                  editorPasteCleanupRef.current = () => {
                    editorDomNode?.removeEventListener('paste', handleEditorPaste)
                  }
                  updateLocalCursorAwareness(ed)
                }}
                options={{
                  readOnly: !canEditActiveDocument,
                  domReadOnly: !canEditActiveDocument,
                  readOnlyMessage: { value: '此文件目前為唯讀模式' },
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  fontSize: 14,
                  lineHeight: 24,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  scrollBeyondLastLine: false,
                  placeholder: '在此貼上 ChatGPT / Gemini 產生的實驗報告...',
                }}
              />
            </Suspense>
          </div>
        </section>

        <section
          className={`min-h-0 flex-grow flex-col bg-white transition-colors duration-300 lg:flex ${
            mobileEditorPane === 'preview' ? 'flex' : 'hidden'
          }`}
        >
          <div className="border-b border-zinc-200 bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
            預覽區 — 所見即所得
          </div>
          <div
            ref={previewRef}
            className={`preview-pane flex-1 overflow-auto bg-white px-8 py-10 transition-colors duration-300 lg:px-14 ${SCROLLBAR_HIDE}`}
          >
            {renderError ? (
              <p className="text-sm text-red-400">預覽錯誤：{renderError}</p>
            ) : isEditorEmpty ? (
              <div className="mx-auto flex h-full min-h-[420px] max-w-4xl flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white px-12 py-16 text-center">
                <div className="mb-4 text-5xl">🤖</div>
                <p className="max-w-md text-base leading-relaxed text-zinc-600">
                  歡迎使用 AutoLabReport！請將 LLM 生成的實驗報告貼在左側，或使用上方工具列排版，我們將自動為您生成精美排版與數據圖表。
                </p>
              </div>
            ) : preview ? (
              <div
                id="pdf-preview-content"
                className="pdf-export-surface markdown-preview prose prose-zinc mx-auto min-h-[calc(100vh-9rem)] max-w-4xl bg-white px-4 py-8 text-zinc-900 transition-colors duration-300 prose-headings:font-semibold prose-p:leading-loose lg:px-10 lg:py-12"
              >
                <ReactMarkdown
                  remarkPlugins={REMARK_PLUGINS}
                  rehypePlugins={REHYPE_PLUGINS}
                  urlTransform={safeMarkdownUrlTransform}
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
      </>
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

      {isShareModalOpen && activeDocument && user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-100 bg-white p-7 shadow-2xl transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  分享「{activeDocument.title}」
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  邀請特定使用者，或設定知道連結的人可以如何存取這份報告。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                title="關閉"
              >
                ×
              </button>
            </div>

            <div className="mt-7 space-y-7">
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">特定協作者</h3>
                  {documentCollaboratorsLoading && (
                    <span className="text-xs font-medium text-zinc-400">載入中...</span>
                  )}
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void inviteDocumentCollaborator()
                  }}
                  className="flex flex-col gap-2 sm:flex-row"
                >
                  <input
                    type="email"
                    value={collaboratorEmail}
                    onChange={(event) => setCollaboratorEmail(event.target.value)}
                    placeholder="新增使用者 Email"
                    disabled={!isActiveDocumentOwner || shareSettingLoading}
                    className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-950"
                  />
                  <button
                    type="submit"
                    disabled={!isActiveDocumentOwner || shareSettingLoading || !collaboratorEmail.trim()}
                    className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                  >
                    邀請
                  </button>
                </form>

                <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200/70 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="flex items-center gap-3 border-b border-zinc-200/70 px-4 py-3 dark:border-zinc-800">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
                      {getUserInitial(isActiveDocumentOwner ? user : null)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {isActiveDocumentOwner ? getUserDisplayName(user) : '文件擁有者'}
                      </p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {isActiveDocumentOwner ? user.email : 'Owner'}
                      </p>
                    </div>
                    <span className="rounded-full bg-zinc-200/70 px-3 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      擁有者
                    </span>
                  </div>

                  {documentCollaborators.length > 0 ? (
                    documentCollaborators.map((collaborator) => (
                      <div
                        key={collaborator.userEmail}
                        className="flex items-center gap-3 border-b border-zinc-200/70 px-4 py-3 last:border-b-0 dark:border-zinc-800"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-200 dark:ring-zinc-800">
                          {getCollaboratorInitial(collaborator.userEmail)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {collaborator.userEmail}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">已邀請協作者</p>
                        </div>
                        <select
                          value={collaborator.role}
                          onChange={(event) =>
                            void updateDocumentCollaboratorRole(
                              collaborator.userEmail,
                              event.target.value as CollaboratorRole,
                            )
                          }
                          disabled={!isActiveDocumentOwner || shareSettingLoading}
                          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-700 outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
                        >
                          <option value="view">可檢視</option>
                          <option value="edit">可編輯</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void removeDocumentCollaborator(collaborator.userEmail)}
                          disabled={!isActiveDocumentOwner || shareSettingLoading}
                          className="rounded-lg px-2.5 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        >
                          移除
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400">
                      尚未邀請任何協作者。
                    </div>
                  )}
                </div>
              </section>

              <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">一般存取權</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    不在特定協作者名單內的人，會依照此連結權限存取文件。
                  </p>
                </div>

                <select
                  value={activeDocument.shareSetting}
                  onChange={(event) => void updateShareSetting(event.target.value as ShareSetting)}
                  disabled={!isActiveDocumentOwner || shareSettingLoading}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-950"
                >
                  <option value="private">🔒 私密（僅限擁有者與受邀協作者）</option>
                  <option value="view">👁️ 知道連結的人可以檢視</option>
                  <option value="edit">✏️ 知道連結的人可以編輯</option>
                </select>

                {!isActiveDocumentOwner && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    你不是此文件擁有者，因此只能複製連結，無法修改分享與協作者權限。
                  </div>
                )}
              </section>

              <div className="rounded-xl border border-zinc-200/70 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {`${window.location.origin}/editor/${activeDocument.id}`}
                </div>
              </div>
            </div>

            <div className="mt-7 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className={SUBTLE_BUTTON}
              >
                完成
              </button>
              <button
                type="button"
                onClick={() => void shareDocument(activeDocument.id, true)}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                {shareCopied ? '✅ 已複製' : '複製連結'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isExtensionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-100 bg-white p-8 shadow-2xl transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-2xl dark:bg-zinc-900">
                🧩
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  安裝 AutoLabReport Bridge
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  用插件把 ChatGPT、Claude、Gemini、Grok、DeepSeek 的回覆送回目前文件，也可以把反白文字帶到 AI 網頁重寫。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExtensionModalOpen(false)}
                className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                title="關閉"
              >
                ×
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['1', '開啟擴充功能頁', '進入 chrome://extensions，開啟右上角開發人員模式。'],
                ['2', '載入未封裝項目', '點擊 Load unpacked，選擇專案根目錄的 extension 資料夾。'],
                ['3', '設定 Prompt', '點擊插件圖示，選擇 AI 網站並調整重寫/擴寫 Prompt。'],
              ].map(([step, title, description]) => (
                <div
                  key={step}
                  className="rounded-2xl border border-zinc-200/70 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
                    {step}
                  </div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
                  <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{description}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-200/60 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">本機插件路徑</div>
              <div className="mt-2 rounded-xl bg-white px-3 py-2 font-mono text-xs text-zinc-500 ring-1 ring-zinc-200/70 dark:bg-zinc-950 dark:text-zinc-400 dark:ring-zinc-800">
                D:\AutoLabReport\extension
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {['ChatGPT', 'Claude', 'Gemini', 'Grok', 'DeepSeek'].map((site) => (
                  <span
                    key={site}
                    className="rounded-full bg-white px-3 py-1 ring-1 ring-zinc-200/70 dark:bg-zinc-950 dark:ring-zinc-800"
                  >
                    {site}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => window.open('chrome://extensions', '_blank')}
                className={SUBTLE_BUTTON}
              >
                開啟 Chrome 擴充功能頁
              </button>
              <button
                type="button"
                onClick={() => setIsExtensionModalOpen(false)}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                完成
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
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [publicRouteLoading, setPublicRouteLoading] = useState(false)
  const [publicSharedDocument, setPublicSharedDocument] = useState<Document | null>(null)

  useEffect(() => {
    if (!supabase) return

    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setUser(data.session?.user ?? null)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (authLoading) return

    if (user) {
      const clearTimer = window.setTimeout(() => {
        setPublicSharedDocument(null)
        setPublicRouteLoading(false)
      }, 0)
      return () => window.clearTimeout(clearTimer)
    }

    const sharedDocId = getSharedDocumentIdFromLocation()
    if (!sharedDocId) {
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/')
      }
      return
    }

    if (!supabase) {
      window.history.replaceState(null, '', '/')
      return
    }

    let isCancelled = false
    const loadTimer = window.setTimeout(async () => {
      setPublicRouteLoading(true)
      try {
        const { data, error } = await supabase
          .from('documents')
          .select('*')
          .eq('id', sharedDocId)
          .eq('is_trashed', false)
          .maybeSingle()

        if (error) throw error

        const sharedDocument = data ? mapSupabaseDocument(data as SupabaseDocumentRow) : null
        if (!sharedDocument || sharedDocument.shareSetting === 'private') {
          if (!isCancelled) {
            setPublicSharedDocument(null)
            window.history.replaceState(null, '', '/')
          }
          return
        }

        if (!isCancelled) {
          setPublicSharedDocument(sharedDocument)
          window.history.replaceState(null, '', `/editor/${encodeURIComponent(sharedDocument.id)}`)
        }
      } catch {
        if (!isCancelled) {
          setPublicSharedDocument(null)
          window.history.replaceState(null, '', '/')
        }
      } finally {
        if (!isCancelled) setPublicRouteLoading(false)
      }
    }, 0)

    return () => {
      isCancelled = true
      window.clearTimeout(loadTimer)
    }
  }, [authLoading, user])

  async function signInWithOAuth(provider: Provider) {
    setAuthMessage(null)
    if (!supabase) {
      setAuthMessage('尚未設定 Supabase 環境變數，請先設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。')
      return
    }

    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    })

    if (error) {
      setAuthLoading(false)
      setAuthMessage(`登入失敗：${error.message}`)
    }
  }

  async function sendMagicLink(email: string): Promise<boolean> {
    setAuthMessage(null)
    if (!supabase) {
      setAuthMessage('尚未設定 Supabase 環境變數，請先設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。')
      return false
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) {
      setAuthMessage(`登入連結發送失敗：${error.message}`)
      return false
    }

    return true
  }

  async function signOut() {
    setUser(null)
    if (supabase) {
      await supabase.auth.signOut()
    }
  }

  if (authLoading || publicRouteLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] text-sm font-medium text-zinc-500">
        {authLoading ? '正在確認登入狀態...' : '正在開啟共享文件...'}
      </div>
    )
  }

  if (!user && publicSharedDocument) {
    return (
      <WorkspaceApp
        user={null}
        initialSharedDocument={publicSharedDocument}
        onRequestAuth={() => {
          window.location.href = '/'
        }}
        onSignOut={() => {
          window.location.href = '/'
        }}
      />
    )
  }

  if (!user) {
    return (
      <LandingPage
        onOAuthLogin={signInWithOAuth}
        onSendMagicLink={sendMagicLink}
        authLoading={authLoading}
        authMessage={authMessage}
      />
    )
  }

  return (
    <WorkspaceApp
      user={user}
      onRequestAuth={() => {
        window.location.href = '/'
      }}
      onSignOut={signOut}
    />
  )
}

export default App
