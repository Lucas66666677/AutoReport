import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cloud, FileText, Loader2, RefreshCcw, X } from 'lucide-react'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type DriveFile = {
  id: string
  name: string
  mime_type: string
  modified_time?: string | null
  size?: number | null
}

type DriveFilesResponse = {
  files: DriveFile[]
}

type DriveImportResponse = {
  markdown: string
  title: string
  mime_type: string
}

export default function GoogleDrivePicker({
  isOpen,
  accessToken,
  onClose,
  onImport,
  onNotify,
}: {
  isOpen: boolean
  accessToken: string | null
  onClose: () => void
  onImport: (payload: { title: string; markdown: string }) => void
  onNotify: (message: string) => void
}) {
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasToken = Boolean(accessToken?.trim())

  const fetchFiles = useCallback(async () => {
    if (!accessToken?.trim()) {
      setError('目前沒有 Google Drive access token，請使用 Google 重新登入。')
      setFiles([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ access_token: accessToken })
      const response = await fetch(`${API_BASE_URL}/api/drive/files?${params.toString()}`)
      const data = (await response.json().catch(() => null)) as DriveFilesResponse | { detail?: string } | null
      if (!response.ok) {
        throw new Error(data && 'detail' in data && data.detail ? data.detail : `HTTP ${response.status}`)
      }
      setFiles(Array.isArray((data as DriveFilesResponse | null)?.files) ? (data as DriveFilesResponse).files : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google Drive 檔案讀取失敗'
      setError(message)
      onNotify(`Google Drive 檔案讀取失敗：${message}`)
    } finally {
      setLoading(false)
    }
  }, [accessToken, onNotify])

  async function importFile(file: DriveFile) {
    if (!accessToken?.trim()) {
      setError('目前沒有 Google Drive access token，請使用 Google 重新登入。')
      return
    }

    setImportingId(file.id)
    setError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/drive/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          file_id: file.id,
        }),
      })
      const data = (await response.json().catch(() => null)) as DriveImportResponse | { detail?: string } | null
      if (!response.ok) {
        throw new Error(data && 'detail' in data && data.detail ? data.detail : `HTTP ${response.status}`)
      }
      const imported = data as DriveImportResponse
      onImport({ title: imported.title || file.name, markdown: imported.markdown })
      onClose()
      onNotify('Google Drive 檔案已匯入')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google Drive 匯入失敗'
      setError(message)
      onNotify(`Google Drive 匯入失敗：${message}`)
    } finally {
      setImportingId(null)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const timer = window.setTimeout(() => {
      void fetchFiles()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchFiles, isOpen])

  const title = useMemo(() => {
    if (loading) return '正在讀取 Google Drive...'
    if (!hasToken) return '需要 Google Drive 授權'
    return `選擇檔案（${files.length}）`
  }, [files.length, hasToken, loading])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700">
              <Cloud className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-950">從 Google Drive 匯入</h2>
              <p className="mt-1 text-sm text-slate-500">{title}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchFiles()}
              disabled={loading || !hasToken}
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              title="重新整理"
            >
              <RefreshCcw className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
              title="關閉"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="min-h-[320px] overflow-auto p-4">
          {error && (
            <div className="mb-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-600">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center gap-3 text-sm font-medium text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              正在讀取檔案列表
            </div>
          ) : !hasToken ? (
            <div className="flex min-h-[260px] items-center justify-center px-8 text-center text-sm leading-6 text-slate-500">
              請使用 Google 登入，並確認 OAuth scope 包含 Google Drive readonly。
            </div>
          ) : files.length === 0 ? (
            <div className="flex min-h-[260px] items-center justify-center px-8 text-center text-sm leading-6 text-slate-500">
              沒有找到可匯入的 Word 或 PDF 檔案。
            </div>
          ) : (
            <div className="grid gap-2">
              {files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => void importFile(file)}
                  disabled={Boolean(importingId)}
                  className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-600">
                    {importingId === file.id ? (
                      <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
                    ) : (
                      <FileText className="h-5 w-5" strokeWidth={2} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-950">{file.name}</span>
                    <span className="mt-1 block text-xs font-medium text-slate-500">
                      {file.mime_type === DOCX_MIME ? 'Word' : 'PDF'}
                      {file.modified_time ? ` · ${new Date(file.modified_time).toLocaleDateString()}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
