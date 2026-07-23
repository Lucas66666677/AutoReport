import { useEffect, useMemo, useState } from 'react'
import { BrandLockup } from './Brand'
import MarkdownRenderer from './MarkdownRenderer'
import { supabaseClient } from './supabaseClient'

type PublicDocumentRow = {
  id: string
  title: string | null
  content: string | null
  share_setting: 'private' | 'view' | 'edit' | null
  is_trashed: boolean | null
  updated_at?: string | null
  created_at?: string | null
  view_count?: number | null
}

type PublicReportProps = {
  shareId: string
}

function getOrCreateMeta(selector: string, createAttributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) {
    element = document.createElement('meta')
    Object.entries(createAttributes).forEach(([key, value]) => element?.setAttribute(key, value))
    document.head.appendChild(element)
  }
  return element
}

function getPlainSummary(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[[^\]]+]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|~$-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function applyPublicAutoNumbering(text: string) {
  let figureCount = 1
  let tableCount = 1

  return text
    .replace(/!\[([^\]]*)\]\(([^)\r\n]+)\)/g, (_match, caption, url) => {
      const normalizedCaption = String(caption ?? '').trim()
      const label = /^圖\s*\d+/u.test(normalizedCaption)
        ? normalizedCaption
        : `圖 ${figureCount} ${normalizedCaption || '圖片'}`
      figureCount += 1
      return `![${label}](${url})`
    })
    .replace(/^(\|.+\|\s*\n\|[\s:|-]+\|\s*(?:\n\|.*\|\s*)+)/gm, (table) => {
      const previous = text.slice(0, text.indexOf(table)).split('\n').pop()?.trim()
      if (previous && /^表\s*\d+/u.test(previous)) {
        return table
      }
      const label = `表 ${tableCount}`
      tableCount += 1
      return `${label}\n${table}`
    })
}

export default function PublicReport({ shareId }: PublicReportProps) {
  const [publicDocument, setPublicDocument] = useState<PublicDocumentRow | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(supabaseClient))
  const [error, setError] = useState<string | null>(
    supabaseClient ? null : '尚未設定 Supabase，無法載入公開報告。',
  )

  const markdown = useMemo(() => applyPublicAutoNumbering(publicDocument?.content ?? ''), [publicDocument?.content])
  const summary = useMemo(() => getPlainSummary(publicDocument?.content ?? ''), [publicDocument?.content])
  const title = publicDocument?.title?.trim() || 'AutoLabReport 公開報告'

  useEffect(() => {
    if (!supabaseClient) {
      return
    }

    let isCancelled = false

    async function loadPublicReport() {
      setIsLoading(true)
      setError(null)

      const { data, error: loadError } = await supabaseClient!
        .from('documents')
        .select('id,title,content,share_setting,is_trashed,created_at,updated_at,view_count')
        .eq('id', shareId)
        .eq('is_trashed', false)
        .maybeSingle()

      if (isCancelled) return

      if (loadError) {
        setError(loadError.message)
        setPublicDocument(null)
        setIsLoading(false)
        return
      }

      const nextDocument = data as PublicDocumentRow | null
      if (!nextDocument || nextDocument.share_setting === 'private') {
        setError('這份報告不存在，或尚未開啟公開瀏覽。')
        setPublicDocument(null)
        setIsLoading(false)
        return
      }

      setPublicDocument(nextDocument)
      setIsLoading(false)

      void supabaseClient!.rpc('increment_document_view_count', {
        p_document_id: nextDocument.id,
      })
    }

    void loadPublicReport()

    return () => {
      isCancelled = true
    }
  }, [shareId])

  useEffect(() => {
    const previousTitle = document.title
    const description = summary || 'AutoLabReport 公開實驗報告'
    const shareImage = new URL('/brand/autolabreport-og.png', window.location.origin).href

    document.title = `${title} | AutoLabReport`
    getOrCreateMeta('meta[name="description"]', { name: 'description' }).content = description
    getOrCreateMeta('meta[property="og:title"]', { property: 'og:title' }).content = title
    getOrCreateMeta('meta[property="og:description"]', { property: 'og:description' }).content = description
    getOrCreateMeta('meta[property="og:type"]', { property: 'og:type' }).content = 'article'
    getOrCreateMeta('meta[property="og:image"]', { property: 'og:image' }).content = shareImage
    getOrCreateMeta('meta[property="og:image:width"]', { property: 'og:image:width' }).content = '1200'
    getOrCreateMeta('meta[property="og:image:height"]', { property: 'og:image:height' }).content = '630'
    getOrCreateMeta('meta[name="twitter:card"]', { name: 'twitter:card' }).content = 'summary_large_image'
    getOrCreateMeta('meta[name="twitter:image"]', { name: 'twitter:image' }).content = shareImage

    return () => {
      document.title = previousTitle
    }
  }, [summary, title])

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-sm font-medium text-slate-500">
        正在載入公開報告...
      </main>
    )
  }

  if (error || !publicDocument) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <section className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-950">無法開啟公開報告</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">{error}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4 px-6 py-8">
          <div className="min-w-0">
            <div className="mb-5 flex items-center gap-3">
              <BrandLockup size="compact" surface="light" />
              <span className="h-4 w-px bg-slate-200" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Public Report</p>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
            {summary && <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">{summary}</p>}
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            {publicDocument.view_count ?? 0} views
          </div>
        </div>
      </header>

      <article className="mx-auto max-w-5xl px-6 py-10">
        <div className="markdown-preview prose prose-slate mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm prose-headings:font-semibold prose-p:leading-loose lg:px-12 lg:py-12">
          <MarkdownRenderer markdown={markdown} />
        </div>
      </article>
    </main>
  )
}
