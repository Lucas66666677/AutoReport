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
  Archive,
  Beaker,
  Bold,
  BookMarked,
  BriefcaseBusiness,
  ChevronDown,
  CheckSquare,
  Clock3,
  Code2,
  Cloud,
  Copy,
  CreditCard,
  CalendarDays,
  Database,
  Download,
  ExternalLink,
  FileClock,
  FileText,
  FileCode2,
  FilePlus2,
  FileUp,
  Filter,
  FolderOpen,
  FolderPlus,
  Gauge,
  Heading2,
  History,
  Home,
  Image as ImageIcon,
  Info,
  Italic,
  LayoutTemplate,
  Library,
  Link,
  List,
  ListOrdered,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  Minus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  PenLine,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Quote,
  Redo2,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Star,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
  UploadCloud,
  UserPlus,
  Users,
  Video,
  X,
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
  | 'projects'
  | 'editor'
  | 'favorites'
  | 'templates'
  | 'prompts'
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

type EditorStats = {
  lineNumber: number
  column: number
  lineCount: number
  length: number
  selectedLength: number
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

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
}

function rowsToMarkdownTable(rows: string[][]): string {
  const cleanRows = rows
    .map((row) => row.map(escapeMarkdownTableCell))
    .filter((row) => row.some(Boolean))

  if (!cleanRows.length) return ''

  const columnCount = Math.max(...cleanRows.map((row) => row.length))
  const normalizeRow = (row: string[]) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  const [headerRow, ...bodyRows] = cleanRows.map(normalizeRow)
  const separator = Array.from({ length: columnCount }, () => '---')
  const tableRows = bodyRows.length ? bodyRows : [Array.from({ length: columnCount }, () => '')]

  return [
    `| ${headerRow.join(' | ')} |`,
    `| ${separator.join('|')}|`,
    ...tableRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function convertHtmlTableToMarkdown(html: string): string {
  if (typeof DOMParser === 'undefined' || !html.includes('<table')) return ''

  const parser = new DOMParser()
  const document = parser.parseFromString(html, 'text/html')
  const table = document.querySelector('table')
  if (!table) return ''

  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th,td')).map((cell) => cell.textContent ?? ''),
  )

  return rowsToMarkdownTable(rows)
}

function convertHtmlImagesToMarkdown(html: string): string {
  if (typeof DOMParser === 'undefined' || !html.includes('<img')) return ''

  const parser = new DOMParser()
  const document = parser.parseFromString(html, 'text/html')
  const images = Array.from(document.querySelectorAll('img'))
    .map((image) => {
      const src = image.getAttribute('src')?.trim()
      if (!src) return ''
      const alt = image.getAttribute('alt')?.trim() || 'image'
      return `![${alt.replace(/\[|\]/g, '')}](${src})`
    })
    .filter(Boolean)

  return images.join('\n\n')
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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
  quota,
  quotaLoading,
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
  quota: AiQuota | null
  quotaLoading: boolean
  user: User | null
  onSignOut: () => void
}) {
  const [isProjectTreeOpen, setIsProjectTreeOpen] = useState(true)
  const [isMoreOpen, setIsMoreOpen] = useState(true)
  const [pinnedItemIds, setPinnedItemIds] = useState<string[]>(['templates', 'ai-mode'])
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(documents.filter((document) => document.type === 'folder').map((document) => document.id)),
  )
  const visibleDocuments = documents.filter((document) => !document.isTrashed)
  const fileDocuments = visibleDocuments.filter((document) => document.type === 'file')
  const userName = getUserDisplayName(user)
  const avatarUrl = getUserAvatarUrl(user)
  const userInitial = getUserInitial(user)
  const remainingPercent = quota ? Math.max(0, Math.min(100, (quota.remaining / Math.max(quota.limit, 1)) * 100)) : 0
  const navButtonBase =
    'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200'
  const navButtonIdle =
    'text-slate-500 hover:bg-white hover:text-slate-950 hover:shadow-sm hover:ring-1 hover:ring-slate-200/70'
  const navButtonActive = 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/80'
  const pinItems = [
    {
      id: 'templates',
      label: '模板中心',
      icon: LayoutTemplate,
      isActive: currentView === 'templates',
      onClick: () => onChangeView('templates'),
    },
    {
      id: 'ai-mode',
      label: 'AI Mode',
      icon: Gauge,
      isActive: currentView === 'settings',
      onClick: () => onChangeView('settings'),
    },
    {
      id: 'extensions',
      label: '擴充功能',
      icon: Puzzle,
      isActive: false,
      onClick: onOpenExtensionModal,
    },
    {
      id: 'prompts',
      label: '我的提示詞庫',
      icon: Library,
      isActive: currentView === 'prompts',
      onClick: () => onChangeView('prompts'),
    },
    {
      id: 'trash',
      label: '垃圾桶',
      icon: Trash2,
      isActive: currentView === 'trash',
      onClick: () => onChangeView('trash'),
    },
    {
      id: 'settings',
      label: '設定',
      icon: Settings,
      isActive: currentView === 'settings',
      onClick: () => onChangeView('settings'),
    },
    {
      id: 'about',
      label: '關於',
      icon: Info,
      isActive: false,
      onClick: onOpenFeedback,
    },
  ]
  const pinnedItems = pinItems.filter((item) => pinnedItemIds.includes(item.id))
  const moreItems = pinItems.filter((item) => !pinnedItemIds.includes(item.id))

  function toggleFolder(folderId: string) {
    setExpandedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  function togglePinnedItem(itemId: string) {
    setPinnedItemIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    )
  }

  function getChildren(parentId: string | null) {
    return visibleDocuments
      .filter((document) => document.parentId === parentId)
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
        return left.title.localeCompare(right.title, 'zh-Hant')
      })
  }

  function renderNavItem({
    icon: Icon,
    label,
    isActive,
    onClick,
    pinState,
    onTogglePin,
  }: {
    icon: typeof Home
    label: string
    isActive?: boolean
    onClick: () => void
    pinState?: 'pinned' | 'unpinned'
    onTogglePin?: () => void
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${navButtonBase} ${isActive ? navButtonActive : navButtonIdle}`}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {pinState && onTogglePin && (
          <span
            role="button"
            tabIndex={0}
            title={pinState === 'pinned' ? '取消釘選' : '釘選'}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePin()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onTogglePin()
            }}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-indigo-600 group-hover:opacity-100"
          >
            {pinState === 'pinned' ? (
              <PinOff className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Pin className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </span>
        )}
      </button>
    )
  }

  if (isCollapsed) {
    return (
      <aside className="flex w-16 shrink-0 flex-col items-center border-r border-slate-200/80 bg-slate-50 py-4 text-slate-500">
        <button
          type="button"
          title="展開工作區"
          onClick={onToggleCollapsed}
          className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-950"
        >
          <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          title="總覽"
          onClick={() => onChangeView('dashboard')}
          className="mt-4 grid h-10 w-10 place-items-center rounded-xl transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
        >
          <Home className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          title="項目"
          onClick={() => {
            setIsProjectTreeOpen(true)
            onChangeView('projects')
          }}
          className="grid h-10 w-10 place-items-center rounded-xl transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
        >
          <FolderOpen className="h-4 w-4" strokeWidth={2} />
        </button>
        {pinnedItems.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.label}
            onClick={item.onClick}
            className="grid h-10 w-10 place-items-center rounded-xl transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
          >
            <item.icon className="h-4 w-4" strokeWidth={2} />
          </button>
        ))}
        <button
          type="button"
          title="新增報告"
          onClick={onCreateDocument}
          className="mt-auto grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          title="登出"
          onClick={onSignOut}
          className="mt-2 grid h-10 w-10 place-items-center rounded-xl transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
        >
          <LogOut className="h-4 w-4" strokeWidth={2} />
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
          className={`group flex items-center gap-1 rounded-xl py-1.5 pr-2 transition ${
            isActive && !isFolder
              ? 'bg-white font-medium text-slate-950 shadow-sm ring-1 ring-slate-200/80'
              : 'text-slate-500 hover:bg-white hover:text-slate-900 hover:shadow-sm'
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
            {isFolder ? (
              <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={2} />
            ) : (
              <FileText className="h-4 w-4 shrink-0" strokeWidth={2} />
            )}
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
              className="rounded-lg p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-indigo-600 group-hover:opacity-100"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              title={document.isFavorite ? '取消收藏' : '收藏'}
              onClick={() => onToggleFavorite(document.id)}
              className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-amber-500"
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
            className="rounded-lg p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-900 group-hover:opacity-100"
          >
            <Pencil className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            title={isFolder ? '刪除資料夾' : '刪除檔案'}
            onClick={() => onDeleteDocument(document.id)}
            className="rounded-lg p-1 text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
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
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200/80 bg-slate-50 text-slate-700">
      <div className="flex items-center justify-between px-5 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/20">
            <FileText className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-slate-950">AutoLabReport</h2>
            <p className="text-xs text-slate-400">Lab workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="收合工作區"
            onClick={onToggleCollapsed}
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-white hover:text-slate-900 hover:shadow-sm"
          >
            <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={onCreateDocument}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all hover:brightness-110 active:scale-[0.99]"
        >
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          建立新報告
        </button>
      </div>

      <nav className="space-y-6 px-3 pb-3">
        <section className="space-y-1">
          {renderNavItem({
            icon: Home,
            label: '首頁',
            isActive: currentView === 'dashboard',
            onClick: () => onChangeView('dashboard'),
          })}
          {renderNavItem({
            icon: FolderOpen,
            label: '項目',
            isActive: currentView === 'projects',
            onClick: () => {
              setIsProjectTreeOpen((current) => !current)
              onChangeView('projects')
            },
          })}
        </section>

        <section className="space-y-2">
          <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pinned</div>
          <div className="space-y-1">
            {pinnedItems.map((item) =>
              renderNavItem({
                icon: item.icon,
                label: item.label,
                isActive: item.isActive,
                onClick: item.onClick,
                pinState: 'pinned',
                onTogglePin: () => togglePinnedItem(item.id),
              }),
            )}
          </div>
        </section>

        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setIsMoreOpen((current) => !current)}
            className="flex w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 transition hover:text-slate-600"
          >
            <span>More</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${isMoreOpen ? 'rotate-180' : ''}`}
              strokeWidth={2}
            />
          </button>
          {isMoreOpen && (
            <div className="space-y-1">
              {moreItems.map((item) =>
                renderNavItem({
                  icon: item.icon,
                  label: item.label,
                  isActive: item.isActive,
                  onClick: item.onClick,
                  pinState: 'unpinned',
                  onTogglePin: () => togglePinnedItem(item.id),
                }),
              )}
              <button
                type="button"
                onClick={() => onChangeView('settings')}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">AI 額度</p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">
                      {quotaLoading ? '讀取中...' : `${quota?.remaining ?? 3} / ${quota?.limit ?? 3} 次`}
                    </p>
                  </div>
                  <Gauge className="h-4 w-4 text-slate-400" strokeWidth={2} />
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-950 transition-all"
                    style={{ width: `${quotaLoading ? 35 : quota ? remainingPercent : 100}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] font-medium text-slate-400">
                  {quota?.plan === 'pro' ? 'Pro 高級 AI' : '免費版：內建 3 次或自備連接'}
                </p>
              </button>
            </div>
          )}
        </section>
      </nav>

      <div className={`min-h-0 flex-1 overflow-auto px-3 py-3 ${SCROLLBAR_HIDE}`}>
        {isProjectTreeOpen && (
          <>
            <div className="mb-3 flex items-center justify-between px-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  項目
                </h3>
                <p className="text-[11px] text-slate-400">{fileDocuments.length} 份報告</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="建立新資料夾"
                  onClick={onCreateFolder}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
                >
                  <FolderPlus className="h-4 w-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  title="建立新報告"
                  onClick={onCreateDocument}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
                >
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              </div>
            </div>
            <section>
              <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                全部
              </h3>
              <div className="space-y-1">{getChildren(null).map((document) => renderDocumentNode(document))}</div>
            </section>
          </>
        )}
      </div>

      <div className="border-t border-slate-200/80 p-3">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/80">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName}
              className="h-10 w-10 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
              {userInitial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-950">{userName}</p>
            <p className="truncate text-xs text-slate-400">
              {user?.email ?? '已登入'}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            title="登出"
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-950"
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

function getInitialAppView(initialSharedDocument?: Document | null): AppView {
  if (initialSharedDocument) return 'editor'
  if (typeof window === 'undefined') return 'dashboard'
  if (window.location.pathname === '/dashboard/home' || window.location.pathname === '/dashboard') return 'dashboard'
  if (window.location.pathname === '/dashboard/projects') return 'projects'
  if (window.location.pathname === '/dashboard/settings') return 'settings'
  if (window.location.pathname === '/dashboard/templates') return 'templates'
  if (window.location.pathname === '/dashboard/prompts') return 'prompts'
  if (window.location.pathname === '/dashboard/trash') return 'trash'
  return 'dashboard'
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

  const isPro = quota?.plan === 'pro'
  const used = quota ? Math.max(0, quota.used) : 0
  const limit = quota?.limit ?? 3
  const remaining = quota?.remaining ?? 3
  const remainingPercent = Math.max(0, Math.min(100, (remaining / Math.max(limit, 1)) * 100))
  const modelOptions = isPro
    ? [
        { value: '', label: 'AutoLab Premium（自動選擇）' },
        { value: 'gpt-4.1', label: 'GPT-4.1（高品質）' },
        { value: 'claude-sonnet-4', label: 'Claude Sonnet（長文寫作）' },
        { value: 'gemini-2.5-pro', label: 'Gemini Pro（資料整理）' },
        { value: 'deepseek-r1', label: 'DeepSeek R1（推理檢查）' },
      ]
    : [
        { value: '', label: 'Auto Free（自動選擇）' },
        { value: 'gemini-flash', label: 'Gemini Flash（免費/快速）' },
        { value: 'deepseek-chat', label: 'DeepSeek Chat（免費/長文）' },
        { value: 'user-api-model', label: '自備 API 模型' },
      ]
  const connectionCards = [
    {
      id: 'built_in' as AiProvider,
      title: '內建額度',
      status: isPro ? 'Pro 高級 AI 可用' : `${remaining} / ${limit} 次可用`,
      description: isPro ? '付費版直接使用 AutoLabReport 的高級 AI。' : '免費版先提供 3 次測試額度，適合確認流程。',
      icon: Gauge,
    },
    {
      id: 'extension' as AiProvider,
      title: '瀏覽器插件',
      status: '待測試連接',
      description: '用你自己的 ChatGPT、Gemini 或其他網頁 AI，不消耗內建額度。',
      icon: Puzzle,
    },
    {
      id: 'user_api_key' as AiProvider,
      title: '自備 API Key',
      status: settings.userApiKey ? '本次已填入' : '未設定',
      description: '適合進階使用者；金鑰只留在本次頁面狀態。',
      icon: Database,
    },
  ]
  const toolCards = [
    { title: 'Google Drive', description: '匯出、同步與備份文件。', status: '待連接', icon: Cloud },
    { title: 'Markdown 匯入', description: '上傳 .md 後直接進入編輯器。', status: '已可用', icon: FileUp },
    { title: 'Word / PDF 匯出', description: '把報告交付成常用格式。', status: '已可用', icon: Download },
    { title: '新增工具', description: '之後可讓使用者添加自己的工具列。', status: '預留', icon: Plus },
  ]

  return (
    <main className={`flex-1 overflow-auto bg-slate-50 px-8 py-10 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">AI Mode</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">AI 連接方式</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              不需要理解模型或 prompt。先選你要怎麼連接 AI，再決定要用快速、穩定，還是高品質模式。
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-right shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">目前方案</p>
            <p className="mt-1 text-xl font-semibold text-slate-950">{isPro ? 'Pro' : 'Free'}</p>
          </div>
        </div>

        <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">今日內建額度</h2>
              <p className="mt-1 text-sm text-slate-500">
                免費版可用內建 3 次測試；插件與自備 API Key 不消耗這裡的額度。
              </p>
            </div>
            <p className="text-sm font-semibold text-slate-500">
              {quotaLoading ? '讀取中...' : `已用 ${used} 次，剩餘 ${remaining} / ${limit} 次`}
            </p>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-950 transition-all"
              style={{ width: `${quotaLoading ? 35 : remainingPercent}%` }}
            />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-slate-950">選擇連接方式</h2>
              <p className="mt-1 text-sm text-slate-500">按你現在擁有的資源選，不需要懂技術設定。</p>
            </div>
            <div className="grid gap-3">
              {connectionCards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => updateSettings({ preferredProvider: card.id })}
                  className={`group flex items-start gap-4 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                    settings.preferredProvider === card.id
                      ? 'border-slate-950 bg-slate-950 text-white shadow-md'
                      : 'border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
                      settings.preferredProvider === card.id ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <card.icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{card.title}</h3>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          settings.preferredProvider === card.id
                            ? 'bg-white/15 text-white'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {card.status}
                      </span>
                    </div>
                    <p
                      className={`mt-1 text-sm leading-6 ${
                        settings.preferredProvider === card.id ? 'text-white/72' : 'text-slate-500'
                      }`}
                    >
                      {card.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">模型選擇</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              免費版顯示免費模型；Pro 版可切換高級模型。留空代表由系統自動選擇。
            </p>
            <label className="mt-5 block">
              <span className="text-sm font-semibold text-slate-700">預設模型</span>
              <select
                value={settings.defaultModel}
                onChange={(event) => updateSettings({ defaultModel: event.target.value })}
                className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
              >
                {modelOptions.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-600">
              <span>插件完成後自動回填編輯器</span>
              <input
                type="checkbox"
                checked={settings.extensionAutoReturn}
                onChange={(event) => updateSettings({ extensionAutoReturn: event.target.checked })}
                className="h-4 w-4"
              />
            </label>
          </section>
        </div>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">自備 API Key</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                適合你有自己的模型帳號。金鑰只保留在目前頁面狀態，不寫入瀏覽器或資料庫。
              </p>
              <div className="mt-5 grid gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">API 供應商</span>
                  <select
                    value={settings.userApiProvider}
                    onChange={(event) => updateSettings({ userApiProvider: event.target.value as UserApiProvider })}
                    className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  >
                    <option value="none">尚未設定</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    <option value="anthropic">Claude / Anthropic</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">API Key</span>
                  <input
                    type="password"
                    value={settings.userApiKey}
                    onChange={(event) => updateSettings({ userApiKey: event.target.value })}
                    placeholder="貼上你的 API Key"
                    className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => updateSettings({ userApiKey: '' })}
                  disabled={!settings.userApiKey}
                  className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  清除本次金鑰
                </button>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">可用工具</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                先把工具入口留清楚，已完成的可以直接使用；Google Drive 需要後端 OAuth 才能真正連接。
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {toolCards.map((tool) => (
                  <button
                    key={tool.title}
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <tool.icon className="h-5 w-5 text-slate-500" strokeWidth={2} />
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                        {tool.status}
                      </span>
                    </div>
                    <h3 className="mt-4 text-sm font-semibold text-slate-950">{tool.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{tool.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">進階文字模板</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                這裡留給進階使用者調整語氣。一般使用者只需要在 Assist 裡選任務即可。
              </p>
            </div>
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
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              恢復預設
            </button>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {([
              ['rewritePrompt', '整理內容'],
              ['expandPrompt', '補完整段落'],
              ['outlinePrompt', '生成報告'],
              ['summarizePrompt', '摘要結論'],
              ['customPrompt', '自訂處理'],
            ] as const).map(([key, label]) => (
              <label key={key} className={key === 'customPrompt' ? 'lg:col-span-2' : ''}>
                <span className="text-sm font-semibold text-slate-700">{label}</span>
                <textarea
                  value={settings[key]}
                  onChange={(event) => updateSettings({ [key]: event.target.value } as Partial<AiSettings>)}
                  className={`mt-2 h-32 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100 ${SCROLLBAR_HIDE}`}
                />
              </label>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

type PromptKey = 'outlinePrompt' | 'rewritePrompt' | 'expandPrompt' | 'summarizePrompt' | 'customPrompt'

function PromptLibraryView({
  settings,
  onChangeSettings,
  onOpenAiSettings,
  onNotify,
}: {
  settings: AiSettings
  onChangeSettings: (settings: AiSettings) => void
  onOpenAiSettings: () => void
  onNotify: (message: string) => void
}) {
  const promptCards: Array<{
    key: PromptKey
    title: string
    description: string
    task: string
  }> = [
    {
      key: 'outlinePrompt',
      title: '生成報告',
      description: '只有資料或老師要求時，先產生報告骨架。',
      task: '原始資料 → 報告大綱',
    },
    {
      key: 'rewritePrompt',
      title: '整理內容',
      description: '把 ChatGPT / Gemini 生成的內容整理成正式段落。',
      task: '亂格式 → 清楚 Markdown',
    },
    {
      key: 'expandPrompt',
      title: '補完整段落',
      description: '讓過短的原理、分析或結論變得完整。',
      task: '草稿 → 完整敘述',
    },
    {
      key: 'summarizePrompt',
      title: '摘要結論',
      description: '把長篇內容濃縮成可以放進結論的版本。',
      task: '長文 → 精簡結論',
    },
    {
      key: 'customPrompt',
      title: '自訂處理',
      description: '留給你自己的課程、老師要求或固定寫作風格。',
      task: '自訂流程',
    },
  ]

  function updatePrompt(key: PromptKey, value: string) {
    onChangeSettings(normalizeAiSettings({ ...settings, [key]: value }))
  }

  function restorePrompt(key: PromptKey) {
    updatePrompt(key, DEFAULT_AI_SETTINGS[key])
    onNotify('已恢復預設提示詞')
  }

  async function copyPrompt(key: PromptKey) {
    try {
      await navigator.clipboard.writeText(settings[key])
      onNotify('提示詞已複製')
    } catch {
      onNotify('瀏覽器不允許直接複製，請手動選取文字')
    }
  }

  return (
    <main className={`flex-1 overflow-auto bg-slate-50 px-8 py-10 ${SCROLLBAR_HIDE}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Prompt Library</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">我的提示詞庫</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              這裡放你常用的 AI 指令。小白平常只要用 Assist，進階時才需要調整這些文字模板。
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAiSettings}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
          >
            AI 連接方式
          </button>
        </div>

        <section className="grid gap-5 lg:grid-cols-2">
          {promptCards.map((prompt) => (
            <article
              key={prompt.key}
              className={`rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ${
                prompt.key === 'customPrompt' ? 'lg:col-span-2' : ''
              }`}
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                    {prompt.task}
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-slate-950">{prompt.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{prompt.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyPrompt(prompt.key)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    onClick={() => restorePrompt(prompt.key)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                  >
                    預設
                  </button>
                </div>
              </div>
              <textarea
                value={settings[prompt.key]}
                onChange={(event) => updatePrompt(prompt.key, event.target.value)}
                className={`h-44 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100 ${SCROLLBAR_HIDE}`}
              />
            </article>
          ))}
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
  onImportMarkdown,
  onShareDocument,
  favoriteOnly = false,
  isLoading = false,
}: {
  documents: Document[]
  onOpenDocument: (id: string) => void
  onCreateDocument: () => void
  onImportMarkdown: (file: File) => void
  onRenameDocument: (id: string) => void
  onShareDocument: (id: string) => void
  onToggleFavorite: (id: string) => void
  onDeleteDocument: (id: string) => void
  favoriteOnly?: boolean
  isLoading?: boolean
}) {
  const markdownInputRef = useRef<HTMLInputElement | null>(null)
  const fileDocuments = documents.filter(
    (document) => document.type === 'file' && !document.isTrashed && (!favoriteOnly || document.isFavorite),
  )
  const recentDocuments = [...fileDocuments]
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt ?? left.createdAt).getTime()
      const rightTime = new Date(right.updatedAt ?? right.createdAt).getTime()
      return rightTime - leftTime
    })
    .slice(0, 8)
  const quickStarts = [
    {
      title: '從空白報告開始',
      description: '建立乾淨的新稿',
      icon: FilePlus2,
      tint: 'from-white to-slate-100',
      iconTone: 'text-slate-800',
      action: 'create',
    },
    {
      title: '匯入 Word/PDF',
      description: '先支援 MD 編輯',
      icon: UploadCloud,
      tint: 'from-sky-50 to-cyan-100/70',
      iconTone: 'text-cyan-700',
      action: 'import-markdown',
    },
    {
      title: '貼上 AI 生成內容',
      description: '整理亂格式',
      icon: PenLine,
      tint: 'from-violet-50 to-indigo-100/70',
      iconTone: 'text-indigo-700',
      action: 'create',
    },
    {
      title: '整理實驗數據',
      description: '表格與分析',
      icon: Beaker,
      tint: 'from-amber-50 to-orange-100/70',
      iconTone: 'text-orange-700',
      action: 'create',
    },
    {
      title: '套用課堂模板',
      description: '從範本開始',
      icon: LayoutTemplate,
      tint: 'from-emerald-50 to-teal-100/70',
      iconTone: 'text-emerald-700',
      action: 'create',
    },
  ]

  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-slate-50 ${SCROLLBAR_HIDE}`}>
      <input
        ref={markdownInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImportMarkdown(file)
          event.currentTarget.value = ''
        }}
      />
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8 lg:px-10">
        <div className="mb-10">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200">
            <Clock3 className="h-3.5 w-3.5" strokeWidth={2} />
            {favoriteOnly ? 'Pinned workspace' : 'Dashboard home'}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            今天你想推進什麼進度？
          </h1>
        </div>

        <section className="mb-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">快速啟動列</h2>
            {isLoading && <span className="text-sm font-medium text-slate-400">處理中...</span>}
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {quickStarts.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => {
                  if (item.action === 'import-markdown') {
                    markdownInputRef.current?.click()
                    return
                  }
                  onCreateDocument()
                }}
                disabled={isLoading}
                className={`group flex h-36 w-40 shrink-0 flex-col items-start justify-between rounded-2xl border border-slate-200 bg-gradient-to-br ${item.tint} p-5 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-200/70 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <item.icon className={`h-8 w-8 ${item.iconTone} transition-transform duration-300 group-hover:scale-110`} strokeWidth={1.9} />
                <span>
                  <span className="block text-sm font-semibold leading-snug text-slate-900">{item.title}</span>
                  <span className="mt-1 block text-xs font-medium text-slate-500">{item.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">最近使用</h2>
              <p className="mt-1 text-sm text-slate-500">從最近的報告、教案與草稿繼續開始。</p>
            </div>
            <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm">
              <Filter className="h-4 w-4 text-slate-400" strokeWidth={2} />
              <select
                aria-label="篩選類型"
                className="bg-transparent pr-6 text-sm font-medium text-slate-700 outline-none"
                defaultValue="all"
              >
                <option value="all">全部類型</option>
                <option value="lab">實驗報告</option>
                <option value="paper">專題論文</option>
                <option value="lesson">教案設計</option>
                <option value="notes">閱讀心得</option>
              </select>
            </label>
          </div>

          {recentDocuments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-8 py-14 text-center shadow-sm">
              <FileText className="mx-auto mb-4 h-10 w-10 text-slate-300" strokeWidth={1.8} />
              <h3 className="text-base font-semibold text-slate-950">還沒有最近文件</h3>
              <p className="mt-2 text-sm text-slate-500">先建立一份報告，之後會在這裡快速回到工作。</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
              {recentDocuments.map((document) => {
                const previewText = getDocumentPreview(document) || '尚未填寫內容'

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
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-200/70"
              >
                <div className="aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-200 p-4">
                  <div className="h-full rounded-xl border border-white/80 bg-white/85 p-3 shadow-sm">
                    <div className="mb-2 h-2 w-16 rounded-full bg-slate-200" />
                    <p className="line-clamp-5 text-xs leading-5 text-slate-500">{previewText}</p>
                  </div>
                </div>
                <div className="border-t border-slate-100 p-4">
                  <p className="mb-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                    {document.isFavorite ? '收藏' : '報告'}
                  </p>
                  <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-slate-950">
                    {document.title}
                  </h3>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium text-slate-400">
                      最後編輯：{formatDocumentTime(document.updatedAt ?? document.createdAt)}
                    </p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void onShareDocument(document.id)
                      }}
                      className="rounded-lg p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                      aria-label="分享"
                    >
                      <Share2 className="h-4 w-4" strokeWidth={2} />
                    </button>
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

type ProjectTab = 'files' | 'imports' | 'snippets' | 'shared'

function ProjectsView({
  documents,
  onOpenDocument,
  onRenameDocument,
  onShareDocument,
  onDeleteDocument,
  onDuplicateDocument,
  onMoveDocument,
  onCreateDocument,
  onImportMarkdown,
}: {
  documents: Document[]
  onOpenDocument: (id: string) => void
  onRenameDocument: (id: string) => void
  onShareDocument: (id: string) => void
  onDeleteDocument: (id: string) => void
  onDuplicateDocument: (id: string) => void
  onMoveDocument: (id: string) => void
  onCreateDocument: () => void
  onImportMarkdown: (file: File) => void
}) {
  const [activeTab, setActiveTab] = useState<ProjectTab>('files')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const markdownInputRef = useRef<HTMLInputElement | null>(null)
  const tabs: Array<{ id: ProjectTab; label: string }> = [
    { id: 'files', label: '文件' },
    { id: 'imports', label: '匯入檔案' },
    { id: 'snippets', label: '片段庫' },
    { id: 'shared', label: '共用' },
  ]
  const fileDocuments = documents
    .filter((document) => document.type === 'file' && !document.isTrashed)
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt ?? left.createdAt).getTime()
      const rightTime = new Date(right.updatedAt ?? right.createdAt).getTime()
      return rightTime - leftTime
    })
  const sharedDocuments = fileDocuments.filter((document) => document.shareSetting !== 'private')
  const snippets = [
    {
      id: 'error-python-snippet',
      title: '誤差分析 Python 繪圖片段',
      owner: 'Lucas Shelby',
      updatedAt: '6 月 10 日',
      status: '草稿',
      icon: FileCode2,
    },
    {
      id: 'markdown-table-snippet',
      title: 'Markdown 表格清理片段',
      owner: 'Lucas Shelby',
      updatedAt: '6 月 8 日',
      status: '已匯出',
      icon: Code2,
    },
  ]
  const conversionRecords = [
    {
      title: '光學實驗原始 Word',
      status: '已轉換',
      time: '今天 13:42',
    },
    {
      title: '數據表 PDF',
      status: '需檢查',
      time: '昨天 20:11',
    },
  ]
  const visibleDocuments =
    activeTab === 'shared' ? sharedDocuments : activeTab === 'files' || activeTab === 'imports' ? fileDocuments : []
  const visibleSnippets = activeTab === 'snippets' ? snippets : []

  function getDocumentStatus(document: Document) {
    if (document.shareSetting !== 'private') return '已共用'
    if ((document.content ?? '').length > 1200) return '已匯出'
    if ((document.content ?? '').trim().length < 80) return '草稿'
    return '需檢查'
  }

  function getStatusStyle(status: string) {
    if (status === '已匯出' || status === '已轉換') return 'bg-emerald-50 text-emerald-700 ring-emerald-100'
    if (status === '需檢查') return 'bg-amber-50 text-amber-700 ring-amber-100'
    if (status === '已共用') return 'bg-indigo-50 text-indigo-700 ring-indigo-100'
    return 'bg-slate-100 text-slate-600 ring-slate-200'
  }

  const emptyMessage =
    activeTab === 'shared'
      ? '目前沒有共用文件'
      : activeTab === 'snippets'
        ? '目前沒有片段'
        : '目前沒有文件'

  const hasRows = visibleDocuments.length > 0 || visibleSnippets.length > 0

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setOpenMenuId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <main className={`min-h-0 flex-1 overflow-auto bg-slate-50 ${SCROLLBAR_HIDE}`}>
      <input
        ref={markdownInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImportMarkdown(file)
          event.currentTarget.value = ''
        }}
      />
      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8 lg:px-10">
        <section className="mb-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">項目</h1>
              <p className="mt-2 text-sm text-slate-500">集中管理報告、匯入檔案、共用文件與常用片段。</p>
            </div>
            <button
              type="button"
              onClick={onCreateDocument}
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              新增文件
            </button>
          </div>
          <button
            type="button"
            onClick={() => markdownInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const file = event.dataTransfer.files?.[0]
              if (file) onImportMarkdown(file)
            }}
            className="group flex h-32 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 text-center shadow-sm transition-all duration-300 hover:border-slate-400 hover:bg-white hover:shadow-md"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500 transition-colors group-hover:bg-slate-50 group-hover:text-slate-800">
                <UploadCloud className="h-6 w-6" strokeWidth={1.9} />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                拖曳 Markdown 檔案至此直接編輯；Word / PDF 解析入口已預留
              </p>
            </div>
          </button>
        </section>

        <section className="mb-6 grid gap-3 md:grid-cols-2">
          {conversionRecords.map((record) => (
            <div key={record.title} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
                <FileClock className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-950">{record.title}</p>
                <p className="text-xs text-slate-400">{record.time}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${getStatusStyle(record.status)}`}>
                {record.status}
              </span>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6">
            <div className="flex gap-8">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative py-4 text-sm font-semibold transition-colors ${
                    activeTab === tab.id ? 'text-slate-950' : 'text-slate-500 hover:text-slate-950'
                  }`}
                >
                  {tab.label}
                  <span
                    className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-slate-950 transition-all duration-300 ${
                      activeTab === tab.id ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {!hasRows && (
              <div className="px-6 py-12 text-center text-sm font-medium text-slate-400">{emptyMessage}</div>
            )}
            {visibleDocuments.map((document) => {
              const status = getDocumentStatus(document)
              return (
                <article
                  key={document.id}
                  className="group grid grid-cols-[minmax(0,1.6fr)_minmax(7rem,0.55fr)_minmax(8rem,0.7fr)_minmax(6rem,0.5fr)_3rem] items-center gap-4 px-6 py-4 transition-colors duration-200 hover:bg-slate-50"
                >
                  <button
                    type="button"
                    onClick={() => onOpenDocument(document.id)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                      <FileText className="h-5 w-5" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-950">{document.title}</span>
                      <span className="mt-0.5 block text-xs text-slate-400">Markdown report</span>
                    </span>
                  </button>
                  <div className="hidden items-center gap-2 text-sm font-medium text-slate-500 md:flex">
                    <Users className="h-4 w-4 text-slate-300" strokeWidth={2} />
                    {document.shareSetting !== 'private' ? '共用文件' : '我'}
                  </div>
                  <div className="hidden items-center gap-2 text-sm font-medium text-slate-500 md:flex">
                    <CalendarDays className="h-4 w-4 text-slate-300" strokeWidth={2} />
                    {formatDocumentTime(document.updatedAt ?? document.createdAt)}
                  </div>
                  <span className={`hidden rounded-full px-2.5 py-1 text-center text-xs font-semibold ring-1 md:inline-flex ${getStatusStyle(status)}`}>
                    {status}
                  </span>
                  <div ref={openMenuId === document.id ? menuRef : null} className="relative justify-self-end">
                    <button
                      type="button"
                      onClick={() => setOpenMenuId((current) => (current === document.id ? null : document.id))}
                      className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-white hover:text-slate-950 hover:shadow-sm"
                      aria-label="文件操作"
                      title="文件操作"
                    >
                      <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                    </button>
                    {openMenuId === document.id && (
                      <div className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-2 text-sm shadow-xl shadow-slate-200/70">
                        <button type="button" onClick={() => onOpenDocument(document.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950">
                          <FileText className="h-4 w-4" /> 開啟
                        </button>
                        <button type="button" onClick={() => { setOpenMenuId(null); onRenameDocument(document.id) }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950">
                          <Pencil className="h-4 w-4" /> 重新命名
                        </button>
                        <button type="button" onClick={() => { setOpenMenuId(null); onDuplicateDocument(document.id) }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950">
                          <Copy className="h-4 w-4" /> 複製
                        </button>
                        <button type="button" onClick={() => { setOpenMenuId(null); onMoveDocument(document.id) }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950">
                          <Archive className="h-4 w-4" /> 移動
                        </button>
                        <button type="button" onClick={() => { setOpenMenuId(null); void onShareDocument(document.id) }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-950">
                          <Share2 className="h-4 w-4" /> 分享
                        </button>
                        <div className="my-1 h-px bg-slate-100" />
                        <button type="button" onClick={() => { setOpenMenuId(null); onDeleteDocument(document.id) }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-medium text-red-600 transition hover:bg-red-50">
                          <Trash2 className="h-4 w-4" /> 刪除
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
            {visibleSnippets.map((item) => (
              <article
                key={item.id}
                className="group grid grid-cols-[minmax(0,1.6fr)_minmax(7rem,0.55fr)_minmax(8rem,0.7fr)_minmax(6rem,0.5fr)_3rem] items-center gap-4 px-6 py-4 transition-colors duration-200 hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                    <item.icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-950">{item.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">Reusable snippet</span>
                  </span>
                </div>
                <div className="hidden text-sm font-medium text-slate-500 md:block">{item.owner}</div>
                <div className="hidden text-sm font-medium text-slate-500 md:block">{item.updatedAt}</div>
                <span className={`hidden rounded-full px-2.5 py-1 text-center text-xs font-semibold ring-1 md:inline-flex ${getStatusStyle(item.status)}`}>
                  {item.status}
                </span>
                <button type="button" className="grid h-9 w-9 place-items-center justify-self-end rounded-xl text-slate-400 transition hover:bg-white hover:text-slate-950 hover:shadow-sm">
                  <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                </button>
              </article>
            ))}
          </div>
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

      <main className="pointer-events-none relative z-10 flex min-h-[calc(100vh-88px)] items-center px-6 pb-12 pt-8 sm:px-8">
        <section className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="max-w-3xl py-12">
            <p className="mb-5 text-xs font-semibold uppercase text-white/45">
              Laboratory writing, clarified.
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-7xl lg:text-8xl">
              AutoLabReport
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-white/58 sm:text-lg">
              把原始筆記、表格與草稿整理成可提交的實驗報告。登入後進入極簡寫作空間，專注編輯、預覽與匯出。
            </p>
            <div className="mt-10 flex flex-wrap gap-3 text-xs text-white/48">
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

          <div className="pointer-events-auto border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/35 backdrop-blur-2xl sm:rounded-[2rem] sm:border sm:p-7">
            <div className="mb-7">
              <p className="text-sm font-medium text-white/45">進入工作區</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">登入你的報告空間</h2>
            </div>

            <form onSubmit={handleMagicLinkSubmit} className="space-y-4">
              {authMessage && (
                <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                  {authMessage}
                </div>
              )}
              <label className="block text-sm font-medium text-white/72" htmlFor="magic-link-email">
                Email
              </label>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 transition-all focus-within:border-white/25 focus-within:bg-black/28">
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

            <div className="my-6 flex items-center gap-4 text-white/30">
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
  initialSharedDocument,
}: {
  user: User | null
  onSignOut: () => void
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
  const [currentView, setCurrentView] = useState<AppView>(() => getInitialAppView(initialSharedDocument))
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
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isAssistDrawerOpen, setIsAssistDrawerOpen] = useState(false)
  const [activeAssistTask, setActiveAssistTask] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
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
  const [editorStats, setEditorStats] = useState<EditorStats>({
    lineNumber: 1,
    column: 1,
    lineCount: 1,
    length: 0,
    selectedLength: 0,
  })
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorScrollDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorContentDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorSelectionDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorPasteCleanupRef = useRef<(() => void) | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const advancedMenuRef = useRef<HTMLDivElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const editorImportInputRef = useRef<HTMLInputElement | null>(null)
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

  useEffect(() => {
    if (typeof window === 'undefined' || currentView === 'editor') return

    const routeByView: Partial<Record<AppView, string>> = {
      dashboard: '/dashboard/home',
      projects: '/dashboard/projects',
      settings: '/dashboard/settings',
      templates: '/dashboard/templates',
      prompts: '/dashboard/prompts',
      trash: '/dashboard/trash',
    }
    const nextPath = routeByView[currentView] ?? '/dashboard/home'
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, '', nextPath)
    }
  }, [currentView])

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
      if (
        userMenuRef.current &&
        event.target instanceof Node &&
        !userMenuRef.current.contains(event.target)
      ) {
        setIsUserMenuOpen(false)
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

      setBridgeToast('成功接收 AI 內容並同步至協作房間')
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

  function updateEditorStats(ed = editorRef.current) {
    const fallbackLineCount = Math.max(1, markdown.split(/\r?\n/).length)
    if (!ed) {
      setEditorStats({
        lineNumber: 1,
        column: 1,
        lineCount: fallbackLineCount,
        length: markdown.length,
        selectedLength: 0,
      })
      return
    }

    const model = ed.getModel()
    const position = ed.getPosition()
    const selection = ed.getSelection()
    const selectedLength = model && selection ? model.getValueInRange(selection).length : 0

    setEditorStats({
      lineNumber: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
      lineCount: model?.getLineCount() ?? fallbackLineCount,
      length: model?.getValueLength() ?? markdown.length,
      selectedLength,
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
    updateEditorStats(ed)

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

  function headingSelection() {
    const selectedText = getSelectedEditorText() || '標題'
    const nextText = selectedText
      .split(/\r?\n/)
      .map((line) => `## ${line}`)
      .join('\n')
    applyEditorEdit(nextText, selectedText ? undefined : 3)
  }

  function prefixSelection(prefix: string, placeholder = '文字') {
    const selectedText = getSelectedEditorText()
    const sourceText = selectedText || placeholder
    const nextText = sourceText
      .split(/\r?\n/)
      .map((line) => `${prefix}${line || placeholder}`)
      .join('\n')
    applyEditorEdit(nextText)
  }

  function insertLink() {
    const selectedText = getSelectedEditorText()
    const url = window.prompt('貼上連結網址', 'https://')
    if (!url) return
    const label = selectedText || window.prompt('連結文字', '連結') || '連結'
    applyEditorEdit(`[${label}](${url})`)
  }

  function insertImage() {
    const url = window.prompt('貼上圖片網址', 'https://')
    if (!url) return
    const alt = window.prompt('圖片描述', 'image') || 'image'
    applyEditorEdit(`![${alt.replace(/\[|\]/g, '')}](${url})`)
  }

  function insertChecklist() {
    prefixSelection('- [ ] ', '待辦事項')
  }

  function insertCommentBlock() {
    applyEditorEdit('> [!NOTE]\n> 在這裡補充說明或提醒。\n')
  }

  function triggerEditorCommand(command: 'undo' | 'redo') {
    const ed = editorRef.current
    if (!ed || !canEditActiveDocumentRef.current) return

    ed.trigger('toolbar', command, null)
    updateMarkdownValue(ed.getValue())
    updateEditorStats(ed)
    ed.focus()
  }

  function handleEditorPaste(event: ClipboardEvent) {
    if (!canEditActiveDocumentRef.current) return

    const imageFile = Array.from(event.clipboardData?.items ?? [])
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile()
    if (imageFile) {
      event.preventDefault()
      event.stopPropagation()
      void readFileAsDataUrl(imageFile)
        .then((dataUrl) => {
          if (!dataUrl) return
          insertAtCursor(`![pasted-image](${dataUrl})`)
          setBridgeToast('圖片已貼上為 Markdown')
        })
        .catch(() => setBridgeToast('圖片貼上失敗'))
      return
    }

    const pastedHtml = event.clipboardData?.getData('text/html') ?? ''
    const htmlTable = convertHtmlTableToMarkdown(pastedHtml)
    if (htmlTable) {
      event.preventDefault()
      event.stopPropagation()
      insertAtCursor(htmlTable)
      return
    }

    const htmlImages = convertHtmlImagesToMarkdown(pastedHtml)
    if (htmlImages) {
      event.preventDefault()
      event.stopPropagation()
      insertAtCursor(htmlImages)
      return
    }

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

  function createBlankDocument() {
    setIsCreateModalOpen(false)
    void createDocumentForParent(null)
  }

  function createNewDocument() {
    setIsCreateModalOpen(true)
  }

  async function importMarkdownFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.md') && !file.name.toLowerCase().endsWith('.markdown')) {
      setBridgeToast('目前先支援上傳 .md / .markdown 檔案')
      return
    }

    const content = await file.text()
    const title = file.name.replace(/\.(md|markdown)$/i, '') || '匯入的 Markdown'
    const nextDocument = createDocument(title, content, null)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    loadDocument(nextDocument)
    setIsSidebarCollapsed(true)
    setCurrentView('editor')
    setBridgeToast('Markdown 檔案已匯入')
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

  function createDocumentFromPreset(title: string, content: string) {
    const nextDocument = createDocument(title, content, null)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    loadDocument(nextDocument)
    setIsSidebarCollapsed(true)
    setCurrentView('editor')
    setIsCreateModalOpen(false)
  }

  function duplicateDocument(id: string) {
    const sourceDocument = documents.find((document) => document.id === id && document.type === 'file' && !document.isTrashed)
    if (!sourceDocument) return

    const nextDocument = createDocument(`${sourceDocument.title} Copy`, sourceDocument.content, sourceDocument.parentId)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    setBridgeToast('已建立副本')
  }

  async function moveDocument(id: string) {
    if (databaseLoading) return

    const targetDocument = documents.find((document) => document.id === id && document.type === 'file' && !document.isTrashed)
    if (!targetDocument) return
    if (getDocumentPermission(targetDocument, user) !== 'owner') {
      setBridgeToast('只有文件擁有者可以移動文件')
      return
    }

    const folders = documents.filter((document) => document.type === 'folder' && !document.isTrashed)
    const folderHint = folders.length > 0 ? folders.map((folder) => folder.title).join('、') : '目前沒有資料夾'
    const nextFolderName = window.prompt(
      `移動「${targetDocument.title}」到哪個資料夾？\n輸入空白可移回根目錄。\n現有資料夾：${folderHint}`,
      targetDocument.parentId ? documents.find((document) => document.id === targetDocument.parentId)?.title ?? '' : '',
    )
    if (nextFolderName === null) return

    const trimmedFolderName = nextFolderName.trim()
    const matchedFolder = trimmedFolderName
      ? folders.find((folder) => folder.title.trim().toLowerCase() === trimmedFolderName.toLowerCase())
      : null
    const nextParentId: string | null = matchedFolder?.id ?? null
    if (trimmedFolderName && !nextParentId) {
      setBridgeToast('找不到這個資料夾，請先建立資料夾後再移動')
      return
    }

    const now = new Date().toISOString()
    if (supabase && shouldUseSupabaseDocuments) {
      setDatabaseLoading(true)
      try {
        const { error } = await supabase
          .from('documents')
          .update({ parent_id: nextParentId, updated_at: now })
          .eq('id', id)
        if (error) throw error
        await refreshSupabaseDocuments()
        setBridgeToast(nextParentId ? '文件已移動到資料夾' : '文件已移回根目錄')
      } catch (err) {
        const message = err instanceof Error ? err.message : '移動文件失敗'
        setBridgeToast(`移動文件失敗：${message}`)
      } finally {
        setDatabaseLoading(false)
      }
      return
    }

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === id ? { ...document, parentId: nextParentId, updatedAt: now } : document,
      ),
    )
    setBridgeToast(nextParentId ? '文件已移動到資料夾' : '文件已移回根目錄')
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
  const shouldShowSidebar = Boolean(user && currentView !== 'editor')
  const topbarAvatarUrl = getUserAvatarUrl(user)
  const topbarUserName = getUserDisplayName(user)
  const topbarUserInitial = getUserInitial(user)
  const isAiConnected =
    aiSettings.preferredProvider === 'extension' ||
    (aiSettings.preferredProvider === 'user_api_key' && aiSettings.userApiProvider !== 'none')
  const assistTasks = [
    {
      title: '生成報告',
      description: '只有原始資料也可以開始，幫你整理成可寫的報告骨架。',
      question: '你現在有什麼？',
      options: ['實驗數據', '老師要求', '已寫草稿', '不知道，幫我開始'],
      onClick: () => setIsOutlineModalOpen(true),
    },
    {
      title: '整理內容',
      description: '把貼上的 ChatGPT 或 Gemini 內容整理成清楚段落。',
      question: '要整理成哪種格式？',
      options: ['正式結報', '課堂作業', '條列重整', '保留原文語氣'],
      onClick: () => requestAiEdit('rewrite'),
    },
    {
      title: '檢查問題',
      description: '交作業前檢查公式、缺漏、數據與段落完整度。',
      question: '要檢查哪些地方？',
      options: ['數據缺漏', '公式單位', '段落完整度', '引用與格式'],
      onClick: () => setCurrentView('quality'),
    },
    {
      title: '改為 Word 格式',
      description: '讓表格、標題與段落更適合複製或匯出到 Word。',
      question: '要優先修正什麼？',
      options: ['標題層級', '表格格式', '段落間距', '全部整理'],
      onClick: handleSmartFormat,
    },
  ]
  const activeAssistTaskConfig = assistTasks.find((task) => task.title === activeAssistTask) ?? null
  const editorToolbarGroups = [
    [
      { label: '復原', icon: Undo2, action: () => triggerEditorCommand('undo') },
      { label: '重做', icon: Redo2, action: () => triggerEditorCommand('redo') },
    ],
    [
      { label: '粗體', icon: Bold, action: () => wrapSelection('**', '**', '粗體文字') },
      { label: '斜體', icon: Italic, action: () => wrapSelection('*', '*', '斜體文字') },
      { label: '刪除線', icon: Strikethrough, action: () => wrapSelection('~~', '~~', '刪除線') },
      { label: '標題', icon: Heading2, action: headingSelection },
    ],
    [
      { label: '程式碼', icon: Code2, action: () => wrapSelection('`', '`', 'code') },
      { label: '引用', icon: Quote, action: () => prefixSelection('> ', '引用文字') },
      { label: '項目清單', icon: List, action: () => prefixSelection('- ', '項目') },
      { label: '編號清單', icon: ListOrdered, action: () => prefixSelection('1. ', '項目') },
      { label: '核取清單', icon: CheckSquare, action: insertChecklist },
    ],
    [
      { label: '連結', icon: Link, action: insertLink },
      { label: '圖片', icon: ImageIcon, action: insertImage },
      { label: '表格', icon: Table2, action: () => insertAtCursor('| 欄位 A | 欄位 B |\n|---|---|\n|  |  |') },
      { label: '分隔線', icon: Minus, action: () => insertAtCursor('\n---\n') },
      { label: '註解', icon: MessageCircle, action: insertCommentBlock },
    ],
  ]

  return (
    <div className="flex h-full min-h-screen bg-slate-50 font-sans text-slate-800">
      <input
        ref={editorImportInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importMarkdownFile(file)
          event.currentTarget.value = ''
        }}
      />
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
          quota={aiQuota}
          quotaLoading={aiQuotaLoading}
          user={user}
          onSignOut={onSignOut}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
      {currentView === 'editor' ? (
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 text-slate-700 shadow-sm">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => setCurrentView('projects')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
              title="返回項目"
              aria-label="返回項目"
            >
              <ArrowRight className="h-4 w-4 rotate-180" strokeWidth={2} />
            </button>
            <span className="hidden text-sm font-medium text-slate-400 sm:inline">Projects /</span>
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
                className="w-full max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950 outline-none transition focus:border-indigo-200 focus:ring-4 focus:ring-indigo-100"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!isActiveDocumentOwner) return
                  setTitleDraft(activeDocument?.title ?? '')
                  setIsTitleEditing(true)
                }}
                className={`max-w-md truncate rounded-xl px-2 py-1.5 text-left text-sm font-semibold text-slate-950 transition-colors ${
                  isActiveDocumentOwner
                    ? 'hover:bg-slate-100'
                    : 'cursor-default'
                }`}
                title={isActiveDocumentOwner ? '點擊重新命名' : '只有擁有者可以重新命名'}
              >
                {activeDocument?.title ?? '未命名報告'}
              </button>
            )}
            {isReadOnlyMode ? (
              <span className="text-sm font-medium text-amber-600">唯讀模式</span>
            ) : null}
            {syncStatus === 'exporting' && (
              <span className="text-sm font-medium text-amber-600">正在打包 Word</span>
            )}
            {syncStatus === 'exportingPdf' && (
              <span className="text-sm font-medium text-amber-600">正在編譯 PDF</span>
            )}
            {isGenerating && <span className="text-sm font-medium text-amber-600">同步中</span>}
            {syncStatus === 'synced' && !isGenerating && !isEditorEmpty && (
              <span className="text-sm font-medium text-slate-400">已儲存</span>
            )}
            {syncStatus === 'error' && (
              <span className="text-sm font-medium text-red-500">同步失敗</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <div ref={userMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen((current) => !current)}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 pr-3 text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
                  title="帳號選單"
                >
                  {topbarAvatarUrl ? (
                    <img
                      src={topbarAvatarUrl}
                      alt={topbarUserName}
                      className="h-7 w-7 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">
                      {topbarUserInitial}
                    </span>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} strokeWidth={2} />
                </button>
                {isUserMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 shadow-2xl shadow-slate-200/80">
                    <div className="flex items-center gap-3 border-b border-slate-100 p-4">
                      {topbarAvatarUrl ? (
                        <img
                          src={topbarAvatarUrl}
                          alt={topbarUserName}
                          className="h-12 w-12 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                          {topbarUserInitial}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{topbarUserName}</p>
                        <p className="truncate text-xs text-slate-400">{user.email ?? '已登入'}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setIsUserMenuOpen(false)
                            setBridgeToast('公開頁面功能準備中')
                          }}
                          className="mt-1 text-xs font-semibold text-indigo-600 transition hover:text-indigo-500"
                        >
                          瀏覽公開頁面
                        </button>
                      </div>
                    </div>
                    {[
                      {
                        label: '我的工作空間',
                        icon: Lock,
                        action: () => setCurrentView('dashboard'),
                      },
                      {
                        label: '設定',
                        icon: Settings,
                        action: () => setCurrentView('settings'),
                      },
                      {
                        label: '我參與的團隊',
                        icon: Users,
                        action: () => setBridgeToast('團隊功能準備中'),
                      },
                      {
                        label: '付費',
                        icon: CreditCard,
                        action: () => setCurrentView('billing'),
                      },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          item.action()
                        }}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                      >
                        <item.icon className="h-4 w-4" strokeWidth={2} />
                        {item.label}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-slate-100" />
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false)
                        onSignOut()
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950"
                    >
                      <LogOut className="h-4 w-4" strokeWidth={2} />
                      登出
                    </button>
                  </div>
                )}
              </div>
            )}
            <CollaboratorAvatarGroup collaborators={collaborators} />
            <button
              type="button"
              onClick={() => void exportWordReport()}
              disabled={isEditorEmpty || syncStatus === 'exporting' || syncStatus === 'exportingPdf'}
              className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
            >
              Word
            </button>
            <button
              type="button"
              onClick={() => void exportPdfReport()}
              disabled={isEditorEmpty || syncStatus === 'exporting' || syncStatus === 'exportingPdf'}
              className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
            >
              PDF
            </button>
            {user && (
              <button
                type="button"
                onClick={() => void shareCurrentDocument()}
                className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 sm:inline-flex"
              >
                Share
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsAssistDrawerOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Assist
            </button>

            <div ref={advancedMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsAdvancedMenuOpen((current) => !current)}
                className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
                title="進階操作"
              >
                <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
              </button>
              {isAdvancedMenuOpen && (
                <div className={`absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-6rem)] w-80 overflow-auto rounded-2xl border border-slate-200 bg-white py-2 text-sm text-slate-600 shadow-2xl shadow-slate-200/80 ${SCROLLBAR_HIDE}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      saveActiveDocumentVersion()
                      syncWithGithub()
                      setCurrentView('history')
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <History className="h-4 w-4" strokeWidth={2} />
                    版本與 GitHub 同步
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      setBridgeToast('筆記設定功能準備中')
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Info className="h-4 w-4" strokeWidth={2} />
                    筆記設定
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      void shareCurrentDocument()
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
                    參與度設定
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      setCurrentView('quality')
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <CheckSquare className="h-4 w-4" strokeWidth={2} />
                    報告完整度檢查
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      setIsAssistDrawerOpen(true)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <PanelRightOpen className="h-4 w-4" strokeWidth={2} />
                    Assist
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      if (activeDocument) void moveDocument(activeDocument.id)
                    }}
                    disabled={!activeDocument || !isActiveDocumentOwner}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Archive className="h-4 w-4" strokeWidth={2} />
                    移動
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      if (activeDocument) duplicateDocument(activeDocument.id)
                    }}
                    disabled={!activeDocument || !isActiveDocumentOwner}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Copy className="h-4 w-4" strokeWidth={2} />
                    建立副本
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      setBridgeToast('轉移筆記擁有權需要後端權限流程')
                    }}
                    disabled={!isActiveDocumentOwner}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <BriefcaseBusiness className="h-4 w-4" strokeWidth={2} />
                    轉移筆記擁有權
                  </button>
                  <button
                    type="button"
                    onClick={deleteActiveDocument}
                    disabled={!isActiveDocumentOwner}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                    刪除此筆記
                  </button>
                  <div className="my-2 h-px bg-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      setBridgeToast('已保留為範本入口，後續可接 templates 資料表')
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <BookMarked className="h-4 w-4" strokeWidth={2} />
                    存為範本
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      setCurrentView('templates')
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} />
                    插入範本
                  </button>
                  <div className="my-2 h-px bg-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      editorImportInputRef.current?.click()
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <FileUp className="h-4 w-4" strokeWidth={2} />
                    匯入 Markdown
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      void exportWordReport()
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Download className="h-4 w-4" strokeWidth={2} />
                    匯出 Word
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdvancedMenuOpen(false)
                      void exportPdfReport()
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Download className="h-4 w-4" strokeWidth={2} />
                    匯出 PDF
                  </button>
                  <button
                    type="button"
                    onClick={downloadMarkdownReport}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left font-medium transition-colors hover:bg-slate-50 hover:text-slate-950"
                  >
                    <Download className="h-4 w-4" strokeWidth={2} />
                    下載 Markdown
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-slate-50/85 px-5 backdrop-blur-xl">
          <div className="relative min-w-0 flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2} />
            <input
              type="search"
              aria-label="全域搜尋"
              placeholder="搜尋報告、模板或設定..."
              className="h-11 w-full rounded-2xl border border-slate-200/80 bg-white pl-11 pr-4 text-sm font-medium text-slate-700 shadow-sm shadow-slate-200/60 outline-none transition placeholder:text-slate-400 focus:border-indigo-200 focus:shadow-md focus:shadow-indigo-100/60 focus:ring-4 focus:ring-indigo-100/70"
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {syncStatus === 'exporting' && (
              <span className="hidden text-sm font-medium text-amber-500 lg:inline">正在打包 Word</span>
            )}
            {syncStatus === 'exportingPdf' && (
              <span className="hidden text-sm font-medium text-amber-500 lg:inline">正在編譯 PDF</span>
            )}
            {isGenerating && (
              <span className="hidden text-sm font-medium text-amber-500 lg:inline">報告同步中</span>
            )}
            {syncStatus === 'synced' && !isGenerating && !isEditorEmpty && (
              <span className="hidden text-sm font-medium text-emerald-600 lg:inline">已同步</span>
            )}
            {syncStatus === 'error' && (
              <span className="hidden text-sm font-medium text-red-500 lg:inline">同步失敗</span>
            )}
            <button
              type="button"
              onClick={createNewDocument}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
              <span className="hidden sm:inline">建立新報告</span>
            </button>
            {topbarAvatarUrl ? (
              <img
                src={topbarAvatarUrl}
                alt={topbarUserName}
                className="h-10 w-10 rounded-full object-cover ring-2 ring-white"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-950 text-sm font-semibold text-white ring-2 ring-white">
                {topbarUserInitial}
              </div>
            )}
          </div>
        </header>
      )}

      {currentView === 'dashboard' ? (
        <DashboardView
          documents={documents}
          onOpenDocument={selectDocument}
          onCreateDocument={createNewDocument}
          onImportMarkdown={(file) => void importMarkdownFile(file)}
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
          onImportMarkdown={(file) => void importMarkdownFile(file)}
          onRenameDocument={renameDocument}
          onShareDocument={shareDocument}
          onToggleFavorite={toggleDocumentFavorite}
          onDeleteDocument={deleteDocument}
          favoriteOnly
          isLoading={databaseLoading}
        />
      ) : currentView === 'projects' ? (
        <ProjectsView
          documents={documents}
          onOpenDocument={selectDocument}
          onRenameDocument={renameDocument}
          onShareDocument={shareDocument}
          onDeleteDocument={deleteDocument}
          onDuplicateDocument={duplicateDocument}
          onMoveDocument={moveDocument}
          onCreateDocument={createNewDocument}
          onImportMarkdown={(file) => void importMarkdownFile(file)}
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
      ) : currentView === 'prompts' ? (
        <PromptLibraryView
          settings={aiSettings}
          onChangeSettings={setAiSettings}
          onOpenAiSettings={() => setCurrentView('settings')}
          onNotify={setBridgeToast}
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
      <div className="flex border-b border-slate-200 bg-white p-2 lg:hidden">
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
                ? 'bg-slate-950 text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <main className="relative grid min-h-0 flex-1 grid-cols-1 bg-slate-50 lg:grid-cols-2">
        <section
          className={`min-h-0 flex-grow flex-col border-b border-slate-200 bg-slate-50 transition-colors duration-300 lg:flex lg:border-b-0 lg:border-r ${
            mobileEditorPane === 'edit' ? 'flex' : 'hidden'
          }`}
        >
          <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2">
            <div className={`flex min-w-0 flex-1 items-center gap-1 overflow-x-auto ${SCROLLBAR_HIDE}`}>
              {editorToolbarGroups.map((group, groupIndex) => (
                <div key={groupIndex} className="flex items-center gap-1 border-r border-slate-200 pr-2 last:border-r-0 last:pr-0">
                  {group.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.action}
                      disabled={!canEditActiveDocument}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
                      title={item.label}
                      aria-label={item.label}
                    >
                      <item.icon className="h-4 w-4" strokeWidth={2} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsAssistDrawerOpen(true)}
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
            >
              <PanelRightOpen className="h-4 w-4" strokeWidth={2} />
              Assist
            </button>
          </div>
          <div className="relative min-h-[280px] flex-1 flex-grow bg-slate-50 font-mono leading-relaxed lg:min-h-0">
            {aiSelectionMenu.visible && (
              <div
                className="absolute z-50 flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-1.5 py-1.5 text-sm shadow-xl shadow-slate-200/80 transition-colors duration-200"
                style={{
                  top: aiSelectionMenu.top,
                  left: aiSelectionMenu.left,
                }}
              >
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => wrapSelection('**', '**', '粗體文字')}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                  title="粗體"
                >
                  <Bold className="h-4 w-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={headingSelection}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                  title="標題"
                >
                  <Heading2 className="h-4 w-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertAtCursor('| 欄位 A | 欄位 B |\n|---|---|\n|  |  |')}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                  title="表格"
                >
                  <Table2 className="h-4 w-4" strokeWidth={2} />
                </button>
                <span className="mx-1 h-5 w-px bg-slate-200" />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setIsAssistDrawerOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                  title="Assist"
                >
                  <PanelRightOpen className="h-4 w-4" strokeWidth={2} />
                  Assist
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
                theme="vs"
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
                    (event) => {
                      applyMonacoChangesToYText(event)
                      updateEditorStats(ed)
                    },
                  )
                  editorSelectionDisposableRef.current?.dispose()
                  editorSelectionDisposableRef.current = ed.onDidChangeCursorSelection(() => {
                    updateLocalCursorAwareness(ed)
                    updateAiSelectionMenu(ed)
                    updateEditorStats(ed)
                  })

                  editorPasteCleanupRef.current?.()
                  const editorDomNode = ed.getDomNode()
                  editorDomNode?.addEventListener('paste', handleEditorPaste)
                  editorPasteCleanupRef.current = () => {
                    editorDomNode?.removeEventListener('paste', handleEditorPaste)
                  }
                  updateLocalCursorAwareness(ed)
                  updateEditorStats(ed)
                }}
                options={{
                  readOnly: !canEditActiveDocument,
                  domReadOnly: !canEditActiveDocument,
                  readOnlyMessage: { value: '此文件目前為唯讀模式' },
                  lineNumbers: 'on',
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  fontSize: 16,
                  lineHeight: 28,
                  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                  scrollBeyondLastLine: false,
                  overviewRulerBorder: false,
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  glyphMargin: false,
                  folding: false,
                  lineDecorationsWidth: 8,
                  lineNumbersMinChars: 3,
                  renderLineHighlight: 'none',
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                  padding: { top: 48, bottom: 48 },
                  placeholder: '在此貼上 ChatGPT / Gemini 產生的實驗報告...',
                }}
              />
            </Suspense>
          </div>
          <div className="flex h-9 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-3 text-xs font-medium text-slate-500">
            <div className="flex min-w-0 items-center gap-3">
              <span>第 {editorStats.lineNumber} 行，第 {editorStats.column} 欄</span>
              <span className="hidden sm:inline">共 {editorStats.lineCount} 行</span>
              {editorStats.selectedLength > 0 && (
                <span className="hidden sm:inline">已選 {editorStats.selectedLength} 字</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline">空白寬度：4</span>
              <span>換行</span>
              <span>Markdown</span>
              <span>長度：{editorStats.length}</span>
            </div>
          </div>
        </section>

        <section
          className={`min-h-0 flex-grow flex-col bg-white transition-colors duration-300 lg:flex ${
            mobileEditorPane === 'preview' ? 'flex' : 'hidden'
          }`}
        >
          <div
            ref={previewRef}
            className={`preview-pane flex-1 overflow-auto bg-white px-8 py-10 transition-colors duration-300 lg:px-14 ${SCROLLBAR_HIDE}`}
          >
            {renderError ? (
              <p className="text-sm text-red-500">預覽錯誤：{renderError}</p>
            ) : isEditorEmpty ? (
              <div className="mx-auto flex h-full min-h-[420px] max-w-4xl flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-12 py-16 text-center">
                <p className="max-w-md text-base leading-relaxed text-slate-500">
                  開始在左側撰寫或貼上內容，右側會即時形成乾淨的報告預覽。
                </p>
              </div>
            ) : preview ? (
              <div
                id="pdf-preview-content"
                className="pdf-export-surface markdown-preview prose prose-slate mx-auto min-h-[calc(100vh-9rem)] max-w-4xl bg-white px-4 py-8 text-slate-900 transition-colors duration-300 prose-headings:font-semibold prose-p:leading-loose lg:px-10 lg:py-12"
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

      {currentView === 'editor' && (
        <div className={`pointer-events-none fixed inset-0 z-50 ${isAssistDrawerOpen ? '' : 'hidden'}`}>
          <button
            type="button"
            aria-label="關閉 Assist"
            onClick={() => {
              setActiveAssistTask(null)
              setIsAssistDrawerOpen(false)
            }}
            className="pointer-events-auto absolute inset-0 bg-slate-950/10 backdrop-blur-[1px]"
          />
          <aside
            className={`pointer-events-auto absolute bottom-0 right-0 top-0 w-full max-w-[350px] border-l border-slate-200 bg-white shadow-2xl shadow-slate-300/60 transition-transform duration-300 ${
              isAssistDrawerOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-200 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-950">Assist</h2>
                    <p className="mt-1 text-sm text-slate-500">選一個任務，讓 AI 協助你完成下一步。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveAssistTask(null)
                      setIsAssistDrawerOpen(false)
                    }}
                    className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
                    aria-label="關閉"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isAiConnected ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]' : 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.14)]'
                    }`}
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {isAiConnected ? 'AI 已連接' : '範例模式'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {isAiConnected ? 'API 或插件目前可用。' : '可先體驗流程，不消耗 AI。'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
                {activeAssistTaskConfig ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setActiveAssistTask(null)}
                      className="mb-4 text-sm font-semibold text-slate-400 transition hover:text-slate-700"
                    >
                      ← 返回任務
                    </button>
                    <h3 className="text-base font-semibold text-slate-950">{activeAssistTaskConfig.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{activeAssistTaskConfig.description}</p>
                    <div className="mt-6">
                      <p className="mb-3 text-sm font-semibold text-slate-700">{activeAssistTaskConfig.question}</p>
                      <div className="grid gap-2">
                        {activeAssistTaskConfig.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAssistDrawerOpen(false)
                        setActiveAssistTask(null)
                        activeAssistTaskConfig.onClick()
                      }}
                      disabled={
                        (activeAssistTaskConfig.title === '整理內容' || activeAssistTaskConfig.title === '改為 Word 格式') &&
                        (isEditorEmpty || !canEditActiveDocument || Boolean(aiTaskLoading))
                      }
                      className="mt-6 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      開始處理
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assistTasks.map((task) => (
                      <button
                        key={task.title}
                        type="button"
                        onClick={() => setActiveAssistTask(task.title)}
                        className="group w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/70"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-950">{task.title}</h3>
                            <p className="mt-1 text-sm leading-6 text-slate-500">{task.description}</p>
                          </div>
                          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" strokeWidth={2} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
      </>
      )}
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 px-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-300/70">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-7 py-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">建立新文件</h2>
                <p className="mt-2 text-sm text-slate-500">先選擇你要完成的任務，進入後再用 Assist 補內容。</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
                aria-label="關閉"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <div className="grid gap-3 px-7 py-6 md:grid-cols-[240px_1fr]">
              <aside className="space-y-1 text-sm font-semibold text-slate-500">
                {['精選推薦', '學術報告', '教案與課堂', '長文寫作', '匯入檔案', '自訂大小'].map((item, index) => (
                  <div
                    key={item}
                    className={`rounded-xl px-4 py-3 ${index === 0 ? 'bg-slate-100 text-slate-950' : 'hover:bg-slate-50'}`}
                  >
                    {item}
                  </div>
                ))}
              </aside>
              <section>
                <div className="mb-5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2} />
                    <input
                      placeholder="你想建立哪種文件？"
                      className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-4 text-sm font-medium outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    {
                      title: '空白 Markdown',
                      description: '完全從空白開始',
                      icon: FilePlus2,
                      action: createBlankDocument,
                    },
                    {
                      title: '實驗報告',
                      description: '目的、原理、數據、結論',
                      icon: Beaker,
                      action: () => void createDocumentFromTemplate(DEFAULT_TEMPLATES[0]),
                    },
                    {
                      title: '閱讀心得',
                      description: '摘要、觀點、反思',
                      icon: BookMarked,
                      action: () =>
                        createDocumentFromPreset(
                          '閱讀心得',
                          '# 閱讀心得\n\n## 書籍 / 文章資訊\n\n## 內容摘要\n\n## 重要觀點\n\n## 我的反思\n\n## 結論\n',
                        ),
                    },
                    {
                      title: '專題論文',
                      description: '緒論、方法、結果、討論',
                      icon: FileText,
                      action: () =>
                        createDocumentFromPreset(
                          '專題論文草稿',
                          '# 專題論文\n\n## 摘要\n\n## 緒論\n\n## 文獻回顧\n\n## 研究方法\n\n## 結果\n\n## 討論\n\n## 結論\n',
                        ),
                    },
                    {
                      title: '寫書 / 長文',
                      description: '章節大綱與段落草稿',
                      icon: PenLine,
                      action: () =>
                        createDocumentFromPreset(
                          '長文草稿',
                          '# 長文草稿\n\n## 核心主題\n\n## 章節大綱\n\n### 第一章\n\n### 第二章\n\n## 待補資料\n',
                        ),
                    },
                    {
                      title: '教案設計',
                      description: '目標、活動、評量',
                      icon: LayoutTemplate,
                      action: () =>
                        createDocumentFromPreset(
                          '教案設計',
                          '# 教案設計\n\n## 教學目標\n\n## 適用對象\n\n## 教學流程\n\n## 活動設計\n\n## 評量方式\n\n## 延伸任務\n',
                        ),
                    },
                    {
                      title: '資料分析',
                      description: '表格、統計與圖表',
                      icon: Database,
                      action: () => void createDocumentFromTemplate(DEFAULT_TEMPLATES[4]),
                    },
                    {
                      title: '匯入 Markdown',
                      description: '上傳 .md 直接編輯',
                      icon: FileUp,
                      action: () => setBridgeToast('請到 Home 或 Projects 的匯入入口選擇 .md 檔案'),
                    },
                  ].map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={item.action}
                      className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/70"
                    >
                      <item.icon className="h-7 w-7 text-slate-700" strokeWidth={1.8} />
                      <h3 className="mt-4 text-sm font-semibold text-slate-950">{item.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">{item.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

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
        <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-sm">
          <button
            type="button"
            aria-label="關閉分享"
            onClick={() => setIsShareModalOpen(false)}
            className="absolute inset-0"
          />
          <aside className="absolute bottom-0 right-0 top-0 flex w-full max-w-[520px] flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-400/60">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">分享文件</h2>
                <p className="mt-1 text-sm text-slate-500">{activeDocument.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </header>

            <div className={`min-h-0 flex-1 space-y-6 overflow-auto px-6 py-5 ${SCROLLBAR_HIDE}`}>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-950">具有訪問權限的人</h3>
                  {documentCollaboratorsLoading && <span className="text-xs font-medium text-slate-400">載入中...</span>}
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void inviteDocumentCollaborator()
                  }}
                  className="relative"
                >
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2} />
                  <input
                    type="email"
                    value={collaboratorEmail}
                    onChange={(event) => setCollaboratorEmail(event.target.value)}
                    placeholder="添加成員 Email"
                    disabled={!isActiveDocumentOwner || shareSettingLoading}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-12 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={!isActiveDocumentOwner || shareSettingLoading || !collaboratorEmail.trim()}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-xl bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="邀請"
                  >
                    <UserPlus className="h-4 w-4" strokeWidth={2} />
                  </button>
                </form>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                      {getUserInitial(user)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-950">{getUserDisplayName(user)}</p>
                      <p className="truncate text-xs text-slate-500">{user.email}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">擁有者</span>
                  </div>

                  {documentCollaborators.map((collaborator) => (
                    <div key={collaborator.userEmail} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                        {getCollaboratorInitial(collaborator.userEmail)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-950">{collaborator.userEmail}</p>
                        <p className="text-xs text-slate-500">協作者</p>
                      </div>
                      <select
                        value={collaborator.role}
                        onChange={(event) =>
                          void updateDocumentCollaboratorRole(collaborator.userEmail, event.target.value as CollaboratorRole)
                        }
                        disabled={!isActiveDocumentOwner || shareSettingLoading}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none"
                      >
                        <option value="view">可檢視</option>
                        <option value="edit">可編輯</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void removeDocumentCollaborator(collaborator.userEmail)}
                        disabled={!isActiveDocumentOwner || shareSettingLoading}
                        className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`移除 ${collaborator.userEmail}`}
                      >
                        <X className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-t border-slate-200 pt-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-950">訪問級別</h3>
                <select
                  value={activeDocument.shareSetting}
                  onChange={(event) => void updateShareSetting(event.target.value as ShareSetting)}
                  disabled={!isActiveDocumentOwner || shareSettingLoading}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="private">只有你可以訪問</option>
                  <option value="view">知道連結的人可以檢視</option>
                  <option value="edit">知道連結的人可以編輯</option>
                </select>
                <button
                  type="button"
                  onClick={() => void shareDocument(activeDocument.id, true)}
                  className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  <Link className="h-4 w-4" strokeWidth={2} />
                  {shareCopied ? '已複製連結' : '複製連結'}
                </button>
              </section>

              <section className="border-t border-slate-200 pt-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-950">更多分享方式</h3>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: '下載', icon: Download, action: () => void exportWordReport() },
                    { label: '公開查看', icon: ExternalLink, action: () => void updateShareSetting('view') },
                    { label: '錄製', icon: Video, action: () => setBridgeToast('錄製功能準備中') },
                    { label: 'Google Drive', icon: Cloud, action: () => setBridgeToast('Google Drive 連接需要設定 OAuth Client ID') },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.action}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-600 transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600">
                        <item.icon className="h-5 w-5" strokeWidth={1.9} />
                      </span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </aside>
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
      onSignOut={signOut}
    />
  )
}

export default App
