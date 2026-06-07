import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ImgHTMLAttributes,
  type ReactNode,
} from 'react'
import Editor from '@monaco-editor/react'
import html2pdf from 'html2pdf.js'
import 'katex/dist/katex.min.css'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  FileDown,
  FileText,
  Heading1,
  Heading2,
  Image,
  Italic,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Redo2,
  Sparkles,
  Star,
  Sun,
  Table,
  Trash2,
  Undo2,
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
  isFavorite: boolean
}

const TOOLBAR_ICON_BTN =
  'rounded-md p-2 text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100'

const MARKDOWN_COMPONENTS = {
  img: ({ alt, src, ...props }: ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} src={src} alt={alt ?? 'matplotlib plot'} className="pdf-plot-image" />
  ),
}

function ToolbarDivider() {
  return <div className="mx-2 h-6 w-px shrink-0 bg-gray-300 dark:bg-gray-700" aria-hidden />
}

function ToolbarIconButton({
  title,
  onClick,
  children,
  className = '',
}: {
  title: string
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`${TOOLBAR_ICON_BTN} ${className}`}
    >
      {children}
    </button>
  )
}

function cleanLlmFluff(text: string): string {
  return text
    .replace(/^[^\r\n]*(好的|當然|這是一份|以下是)[^\r\n]*(?:\r?\n|$)/, '')
    .replace(/(?:\r?\n)?[^\r\n]*(希望這|如果有任何問題|以上就是)[^\r\n]*\s*$/, '')
    .trim()
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

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark'

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function createDocument(title = '未命名報告', content = ''): Document {
  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content,
    createdAt: new Date().toISOString(),
    isFavorite: false,
  }
}

function getInitialDocuments(): Document[] {
  if (typeof window === 'undefined') return [createDocument()]

  const savedDocuments = window.localStorage.getItem(DOCUMENTS_STORAGE_KEY)
  if (savedDocuments) {
    try {
      const parsed = JSON.parse(savedDocuments) as Document[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      /* ignore invalid local storage payload */
    }
  }

  const legacyContent = window.localStorage.getItem(CONTENT_STORAGE_KEY) ?? ''
  return [createDocument('實驗報告', legacyContent)]
}

function getInitialActiveDocumentId(documents: Document[]) {
  if (typeof window === 'undefined') return documents[0]?.id ?? ''

  const savedId = window.localStorage.getItem(ACTIVE_DOCUMENT_ID_STORAGE_KEY)
  if (savedId && documents.some((document) => document.id === savedId)) return savedId

  return documents[0]?.id ?? ''
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
  isCollapsed,
  onToggleCollapsed,
  onCreateDocument,
  onSelectDocument,
  onRenameDocument,
  onDeleteDocument,
  onToggleFavorite,
}: {
  documents: Document[]
  activeDocumentId: string
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onCreateDocument: () => void
  onSelectDocument: (id: string) => void
  onRenameDocument: (id: string) => void
  onDeleteDocument: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  const favoriteDocuments = documents.filter((document) => document.isFavorite)
  const normalDocuments = documents.filter((document) => !document.isFavorite)

  if (isCollapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-gray-200 bg-white py-3 transition-colors duration-300 dark:border-gray-800 dark:bg-gray-950">
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
          title="新增檔案"
          onClick={onCreateDocument}
          className={`${TOOLBAR_ICON_BTN} mt-2`}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </aside>
    )
  }

  function renderDocumentButton(document: Document) {
    const isActive = document.id === activeDocumentId

    return (
      <div
        key={document.id}
        className={`group flex items-center gap-1 rounded-md px-2 py-1.5 transition ${
          isActive
            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        <button
          type="button"
          title={document.title}
          onClick={() => onSelectDocument(document.id)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium"
        >
          {document.title}
        </button>
        <button
          type="button"
          title={document.isFavorite ? '取消收藏' : '收藏'}
          onClick={() => onToggleFavorite(document.id)}
          className="rounded p-1 text-gray-400 transition hover:bg-gray-200 hover:text-amber-500 dark:hover:bg-gray-700"
        >
          <Star
            className={`h-4 w-4 ${document.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
            strokeWidth={2}
          />
        </button>
        <button
          type="button"
          title="重新命名"
          onClick={() => onRenameDocument(document.id)}
          className="rounded p-1 text-gray-400 opacity-0 transition hover:bg-gray-200 hover:text-gray-700 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <Pencil className="h-4 w-4" strokeWidth={2} />
        </button>
        <button
          type="button"
          title="刪除檔案"
          onClick={() => onDeleteDocument(document.id)}
          className="rounded p-1 text-gray-400 opacity-0 transition hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/50 dark:hover:text-red-300"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-white transition-colors duration-300 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">工作區</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{documents.length} 份文件</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="新增檔案"
            onClick={onCreateDocument}
            className={TOOLBAR_ICON_BTN}
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
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

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {favoriteDocuments.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              收藏
            </h3>
            <div className="space-y-1">{favoriteDocuments.map(renderDocumentButton)}</div>
          </section>
        )}

        <section>
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            所有檔案
          </h3>
          <div className="space-y-1">{normalDocuments.map(renderDocumentButton)}</div>
        </section>
      </div>
    </aside>
  )
}

function App() {
  const [initialWorkspace] = useState(getInitialWorkspace)
  const [documents, setDocuments] = useState<Document[]>(initialWorkspace.documents)
  const [activeDocumentId, setActiveDocumentId] = useState(initialWorkspace.activeDocumentId)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const activeDocument =
    documents.find((document) => document.id === activeDocumentId) ?? documents[0]
  const [markdown, setMarkdown] = useState(activeDocument?.content ?? '')
  const [preview, setPreview] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced')
  const [renderError, setRenderError] = useState<string | null>(null)
  const [healthMessage, setHealthMessage] = useState<string | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [isTablePickerOpen, setIsTablePickerOpen] = useState(false)
  const [tableRows, setTableRows] = useState(2)
  const [tableCols, setTableCols] = useState(3)
  const [isOutlineModalOpen, setIsOutlineModalOpen] = useState(false)
  const [outlineExampleText, setOutlineExampleText] = useState('')
  const [outlineLoading, setOutlineLoading] = useState(false)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorScrollDisposableRef = useRef<{ dispose: () => void } | null>(null)
  const editorPasteCleanupRef = useRef<(() => void) | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)

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
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(CONTENT_STORAGE_KEY, markdown)
      setDocuments((currentDocuments) =>
        currentDocuments.map((document) =>
          document.id === activeDocumentId && document.content !== markdown
            ? { ...document, content: markdown }
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
      editorPasteCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (isEditorEmpty) {
      return
    }

    const controller = new AbortController()

    const timer = window.setTimeout(async () => {
      setSyncStatus('rendering')
      setRenderError(null)
      try {
        const res = await fetch(`${API_BASE_URL}/api/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown }),
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
    editorRef.current?.setValue(value)
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

  function wrapInlineMarkdown(marker: string, placeholder: string) {
    const ed = editorRef.current
    if (!ed) return

    const selection = ed.getSelection()
    const model = ed.getModel()
    if (!selection || !model) return

    const selected = model.getValueInRange(selection)
    if (selected) {
      applyEditorEdit(`${marker}${selected}${marker}`)
      return
    }
    applyEditorEdit(`${marker}${placeholder}${marker}`, marker.length)
  }

  function insertBold() {
    wrapInlineMarkdown('**', '粗體文字')
  }

  function insertItalic() {
    wrapInlineMarkdown('*', '斜體文字')
  }

  function handleUndo() {
    const ed = editorRef.current
    if (ed) {
      ed.trigger('keyboard', 'undo', null)
      updateMarkdownValue(ed.getValue())
      ed.focus()
      return
    }

    document.execCommand('undo')
  }

  function handleRedo() {
    const ed = editorRef.current
    if (ed) {
      ed.trigger('keyboard', 'redo', null)
      updateMarkdownValue(ed.getValue())
      ed.focus()
      return
    }

    document.execCommand('redo')
  }

  function wrapSelectionWithAlign(align: 'left' | 'center' | 'right') {
    const ed = editorRef.current
    if (!ed) return

    const selection = ed.getSelection()
    const model = ed.getModel()
    if (!selection || !model) return

    const selected = model.getValueInRange(selection) || '請輸入文字'
    applyEditorEdit(`<div align="${align}">\n${selected}\n</div>`)
  }

  function buildMarkdownTable(rows: number, cols: number) {
    const safeRows = Number.isFinite(rows) ? Math.max(1, Math.min(rows, 20)) : 1
    const safeCols = Number.isFinite(cols) ? Math.max(1, Math.min(cols, 10)) : 1
    const headers = Array.from({ length: safeCols }, (_, index) => `Col ${index + 1}`)
    const separator = Array.from({ length: safeCols }, () => '---')
    const bodyRows = Array.from({ length: safeRows }, () =>
      Array.from({ length: safeCols }, () => ' ').join(' | '),
    )

    return [
      `| ${headers.join(' | ')} |`,
      `|${separator.join('|')}|`,
      ...bodyRows.map((row) => `| ${row} |`),
    ].join('\n')
  }

  function insertTable() {
    const ed = editorRef.current
    if (!ed) return

    const selection = ed.getSelection()
    if (!selection) return

    const prefix = selection.isEmpty() ? '' : '\n'
    applyEditorEdit(`${prefix}${buildMarkdownTable(tableRows, tableCols)}`)
    setIsTablePickerOpen(false)
    ed.focus()
  }

  function insertImage() {
    imageInputRef.current?.click()
  }

  function insertPythonCodeBlock() {
    insertAtCursor('```python\n# 請在此輸入 Python 程式碼，系統將自動繪圖\n```')
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      insertAtCursor(`![上傳圖片](${reader.result})`)
    }
    reader.readAsDataURL(file)
  }

  function handleSmartFormat() {
    syncEditorValue(smartFormat(markdown))
    editorRef.current?.focus()
  }

  function cleanLlmIntro() {
    syncEditorValue(cleanLlmFluff(markdown))
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

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  function loadDocument(document: Document) {
    setActiveDocumentId(document.id)
    syncEditorValue(document.content)
  }

  function createNewDocument() {
    const nextDocument = createDocument(`未命名報告 ${documents.length + 1}`)
    setDocuments((currentDocuments) => [...currentDocuments, nextDocument])
    loadDocument(nextDocument)
  }

  function selectDocument(id: string) {
    const nextDocument = documents.find((document) => document.id === id)
    if (!nextDocument) return

    loadDocument(nextDocument)
  }

  function renameDocument(id: string) {
    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return

    const nextTitle = window.prompt('重新命名檔案', targetDocument.title)?.trim()
    if (!nextTitle) return

    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === id ? { ...document, title: nextTitle } : document,
      ),
    )
  }

  function deleteDocument(id: string) {
    const targetDocument = documents.find((document) => document.id === id)
    if (!targetDocument) return
    if (!window.confirm(`刪除「${targetDocument.title}」？此操作無法復原。`)) return

    const remainingDocuments = documents.filter((document) => document.id !== id)
    if (!remainingDocuments.length) {
      const replacementDocument = createDocument()
      setDocuments([replacementDocument])
      loadDocument(replacementDocument)
      return
    }

    setDocuments(remainingDocuments)
    if (id === activeDocumentId) {
      loadDocument(remainingDocuments[0])
    }
  }

  function toggleDocumentFavorite(id: string) {
    setDocuments((currentDocuments) =>
      currentDocuments.map((document) =>
        document.id === id ? { ...document, isFavorite: !document.isFavorite } : document,
      ),
    )
  }

  async function downloadExportFile(endpoint: string, filename: string, status: SyncStatus) {
    setExporting(true)
    setSyncStatus(status)
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
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

  async function checkBackendHealth() {
    setHealthLoading(true)
    setHealthMessage(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as { status: string; service: string }
      setHealthMessage(`${data.service}: ${data.status}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '連線失敗'
      setHealthMessage(`後端連線失敗 — ${message}`)
    } finally {
      setHealthLoading(false)
    }
  }

  const isGenerating = syncStatus === 'pending' || syncStatus === 'rendering'

  return (
    <div className="flex h-full min-h-screen bg-gray-50 text-gray-900 transition-colors duration-300 dark:bg-gray-900 dark:text-gray-100">
      <DocumentSidebar
        documents={documents}
        activeDocumentId={activeDocumentId}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
        onCreateDocument={createNewDocument}
        onSelectDocument={selectDocument}
        onRenameDocument={renameDocument}
        onDeleteDocument={deleteDocument}
        onToggleFavorite={toggleDocumentFavorite}
      />

      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4 transition-colors duration-300 dark:border-gray-800 dark:bg-gray-950">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AutoLabReport</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
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
          {healthMessage && (
            <span
              className={`max-w-xs truncate text-xs ${
                healthMessage.includes('失敗') ? 'text-red-400' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {healthMessage}
            </span>
          )}
          <button
            type="button"
            onClick={checkBackendHealth}
            disabled={healthLoading}
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {healthLoading ? '檢查中…' : '測試後端連線'}
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col border-b border-gray-200 transition-colors duration-300 dark:border-gray-800 lg:border-b-0 lg:border-r">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />

          <div className="border-b border-gray-200 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 transition-colors duration-300 dark:border-gray-800 dark:text-gray-400">
            編輯區 — 貼上 LLM 報告
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-200 bg-white px-6 py-3 shadow-sm transition-colors duration-300 dark:border-gray-800 dark:bg-gray-950"
            role="toolbar"
            aria-label="排版與匯出工具列"
          >
            <div className="flex flex-wrap items-center gap-1">
              <div className="flex items-center gap-1">
                <ToolbarIconButton title="撤回 (Undo)" onClick={handleUndo}>
                  <Undo2 className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <ToolbarIconButton title="重做 (Redo)" onClick={handleRedo}>
                  <Redo2 className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
              </div>

              <ToolbarDivider />

              <div className="flex items-center gap-1">
                <ToolbarIconButton title="大標題 (Heading 1)" onClick={() => insertAtCursor('# ')}>
                  <Heading1 className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <ToolbarIconButton title="小標題 (Heading 2)" onClick={() => insertAtCursor('## ')}>
                  <Heading2 className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
              </div>

              <ToolbarDivider />

              <div className="flex items-center gap-1">
                <ToolbarIconButton title="粗體 (Bold)" onClick={insertBold}>
                  <Bold className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <ToolbarIconButton title="斜體 (Italic)" onClick={insertItalic}>
                  <Italic className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <ToolbarIconButton title="靠左對齊" onClick={() => wrapSelectionWithAlign('left')}>
                  <AlignLeft className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <ToolbarIconButton title="置中對齊" onClick={() => wrapSelectionWithAlign('center')}>
                  <AlignCenter className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <ToolbarIconButton title="靠右對齊" onClick={() => wrapSelectionWithAlign('right')}>
                  <AlignRight className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
              </div>

              <ToolbarDivider />

              <div className="flex items-center gap-1">
                <ToolbarIconButton title="插入圖片" onClick={insertImage}>
                  <Image className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <ToolbarIconButton title="插入 Python 程式碼區塊" onClick={insertPythonCodeBlock}>
                  <Code className="h-[18px] w-[18px]" strokeWidth={2} />
                </ToolbarIconButton>
                <div className="relative">
                  <ToolbarIconButton
                    title="插入表格"
                    onClick={() => setIsTablePickerOpen((current) => !current)}
                  >
                    <Table className="h-[18px] w-[18px]" strokeWidth={2} />
                  </ToolbarIconButton>

                  {isTablePickerOpen && (
                    <div className="absolute left-0 top-full z-10 mt-2 w-56 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                          行數
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={tableRows}
                            onChange={(event) => setTableRows(Number(event.target.value))}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                          />
                        </label>
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                          列數
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={tableCols}
                            onChange={(event) => setTableCols(Number(event.target.value))}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={insertTable}
                        className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 active:scale-[0.98]"
                      >
                        插入
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                title="生成報告大綱"
                onClick={() => setIsOutlineModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-blue-400/50 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 shadow-sm transition-all hover:bg-blue-100 active:scale-[0.98] dark:border-blue-500/35 dark:bg-blue-500/15 dark:text-blue-200 dark:hover:bg-blue-500/25"
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">生成報告大綱</span>
              </button>

              <button
                type="button"
                title="智慧排版修復 — 清理標點空白與連續重複段落"
                onClick={handleSmartFormat}
                disabled={isEditorEmpty}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-100 to-blue-100 px-3 py-2 text-sm font-semibold text-purple-800 shadow-sm transition-all hover:from-purple-200 hover:to-blue-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:from-purple-900 dark:to-blue-900 dark:text-purple-100 dark:hover:from-purple-800 dark:hover:to-blue-800"
              >
                <Wand2 className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">智慧排版修復</span>
              </button>

              <button
                type="button"
                title="清理 LLM 廢話 — 刪除第一個標題前的開場白"
                onClick={cleanLlmIntro}
                className="flex items-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800 shadow-sm transition-all hover:bg-amber-200 active:scale-[0.98] dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/25 dark:hover:text-amber-100"
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">清理 LLM 廢話</span>
              </button>

              <ToolbarDivider />

              <button
                type="button"
                title="匯出 Word 報告"
                onClick={exportWordReport}
                disabled={exporting || isEditorEmpty}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">匯出 Word</span>
              </button>
              <button
                type="button"
                title="匯出 PDF（所見即所得）"
                onClick={exportPdfReport}
                disabled={exporting || isEditorEmpty}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileDown className="h-4 w-4" strokeWidth={2} />
                <span className="hidden sm:inline">匯出 PDF</span>
              </button>

              <ToolbarDivider />

              <ToolbarIconButton
                title={isDarkMode ? '切換至淺色模式' : '切換至深色模式'}
                onClick={toggleTheme}
              >
                {isDarkMode ? (
                  <Sun className="h-[18px] w-[18px]" strokeWidth={2} />
                ) : (
                  <Moon className="h-[18px] w-[18px]" strokeWidth={2} />
                )}
              </ToolbarIconButton>
            </div>
          </div>

          <div className="min-h-[280px] flex-1 lg:min-h-0">
            <Editor
              height="100%"
              defaultLanguage="markdown"
              theme={isDarkMode ? 'vs-dark' : 'light'}
              value={markdown}
              onMount={(ed) => {
                editorRef.current = ed
                editorScrollDisposableRef.current?.dispose()
                editorScrollDisposableRef.current = ed.onDidScrollChange((event) => {
                  if (event.scrollTopChanged) {
                    syncPreviewScroll()
                  }
                })

                editorPasteCleanupRef.current?.()
                const editorDomNode = ed.getDomNode()
                editorDomNode?.addEventListener('paste', handleEditorPaste)
                editorPasteCleanupRef.current = () => {
                  editorDomNode?.removeEventListener('paste', handleEditorPaste)
                }
              }}
              onChange={(value) => updateMarkdownValue(value ?? '')}
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                fontSize: 14,
                scrollBeyondLastLine: false,
                placeholder: '在此貼上 ChatGPT / Gemini 產生的實驗報告…',
              }}
            />
          </div>
        </section>

        <section className="flex min-h-0 flex-col transition-colors duration-300">
          <div className="border-b border-gray-200 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 transition-colors duration-300 dark:border-gray-800 dark:text-gray-400">
            預覽區 — 所見即所得
          </div>
          <div
            ref={previewRef}
            className="preview-pane flex-1 overflow-auto bg-gray-100 p-4 transition-colors duration-300 dark:bg-gray-900"
          >
            {renderError ? (
              <p className="text-sm text-red-400">預覽錯誤：{renderError}</p>
            ) : isEditorEmpty ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-8 py-12 text-center transition-colors duration-300 dark:border-gray-700 dark:bg-gray-950/40">
                <div className="mb-4 text-5xl">🤖</div>
                <p className="max-w-md text-base leading-relaxed text-gray-600 dark:text-gray-300">
                  歡迎使用 AutoLabReport！請將 LLM 生成的實驗報告貼在左側，或使用上方工具列排版，我們將自動為您生成精美排版與數據圖表。
                </p>
              </div>
            ) : preview ? (
              <div
                id="pdf-preview-content"
                className="pdf-export-surface markdown-preview rounded-lg border border-gray-200 bg-white p-6 text-gray-900 shadow-sm transition-colors duration-300 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
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
              <p className="text-sm text-gray-500">正在準備預覽…</p>
            )}
          </div>
        </section>
      </main>
      </div>

      {isOutlineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-2xl transition-colors duration-300 dark:border-gray-700 dark:bg-gray-950">
            <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                生成報告大綱
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                貼上範例結構，系統會生成對應的 Markdown 實驗報告大綱。
              </p>
            </div>

            <div className="px-5 py-4">
              <textarea
                value={outlineExampleText}
                onChange={(event) => setOutlineExampleText(event.target.value)}
                placeholder={'# 實驗報告\n## 實驗目的\n## 實驗原理\n## 實驗步驟\n## 結果與討論'}
                className="h-64 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setIsOutlineModalOpen(false)}
                disabled={outlineLoading}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
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
    </div>
  )
}

export default App
