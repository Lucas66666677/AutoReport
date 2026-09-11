import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { searchEverything, type SearchDocument, type SearchResult, type SearchTemplate } from './searchIndex'

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  document: '報告',
  template: '模板',
  page: '頁面',
}

export default function GlobalSearch({
  documents,
  templates,
  onOpenDocument,
  onOpenTemplate,
  onOpenView,
}: {
  documents: SearchDocument[]
  templates: SearchTemplate[]
  onOpenDocument: (id: string) => void
  onOpenTemplate: (id: string) => void
  onOpenView: (view: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const results = useMemo(() => searchEverything(query, documents, templates), [query, documents, templates])
  const showPanel = open && query.trim().length > 0

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function choose(result: SearchResult) {
    setOpen(false)
    setQuery('')
    if (result.kind === 'document') onOpenDocument(result.id)
    else if (result.kind === 'template') onOpenTemplate(result.id)
    else onOpenView(result.view)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, Math.max(results.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      const result = results[active] ?? results[0]
      if (result) {
        event.preventDefault()
        choose(result)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 max-w-xl">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={2} />
      <input
        type="search"
        role="combobox"
        aria-label="全域搜尋"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        placeholder="搜尋報告、模板或設定..."
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-11 w-full rounded-2xl border border-slate-200/80 bg-white pl-11 pr-4 text-sm font-medium text-slate-700 shadow-sm shadow-slate-200/60 outline-none transition placeholder:text-slate-400 focus:border-blue-200 focus:shadow-md focus:shadow-blue-100/60 focus:ring-4 focus:ring-blue-100/70"
      />
      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="搜尋結果"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-200/70"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">找不到和「{query.trim()}」有關的報告、模板或頁面</p>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.kind}-${result.kind === 'page' ? result.view : result.id}`}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(result)}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  index === active ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                  {KIND_LABELS[result.kind]}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">{result.title}</span>
                  {result.snippet && <span className="block truncate text-xs text-slate-500">{result.snippet}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
