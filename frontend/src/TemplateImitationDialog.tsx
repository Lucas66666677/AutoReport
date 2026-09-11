import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  applyPreset,
  buildImitationRequest,
  countByMode,
  splitIntoSections,
  suggestTitle,
  toPreset,
  type ImitationMode,
  type ImitationPreset,
  type ImitationResult,
  type ImitationSection,
} from './templateImitation'

export type ImitationSource = {
  kind: 'template' | 'document'
  id: string
  title: string
  markdown: string
}

export type ImitationRequestBody = ReturnType<typeof buildImitationRequest>

export type ImitationProviderChoice = {
  provider: 'built_in' | 'user_api_key'
  apiProvider?: string
  model?: string
}

const MODE_OPTIONS: Array<{ mode: ImitationMode; label: string; hint: string }> = [
  { mode: 'keep', label: '保留', hint: '原文照搬，AI 不會動' },
  { mode: 'replace', label: '替換', hint: '依新資料重寫整段' },
  { mode: 'rewrite', label: '改寫', hint: '保留仍適用的句子，改成符合新資料' },
]

function snippet(section: ImitationSection): string {
  const text = section.body.replace(/[#>*`|_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return '（這段沒有內文）'
  return text.length > 70 ? `${text.slice(0, 70)}…` : text
}

export default function TemplateImitationDialog({
  source,
  initialPreset,
  initialInstructions,
  provider,
  providerLabel,
  onGenerate,
  onCreate,
  onSavePreset,
  onOpenAiSettings,
  onClose,
  renderPreview,
}: {
  source: ImitationSource
  initialPreset: ImitationPreset | null
  initialInstructions: string
  provider: ImitationProviderChoice
  providerLabel: string
  onGenerate: (request: ImitationRequestBody) => Promise<ImitationResult>
  onCreate: (title: string, markdown: string) => Promise<void>
  onSavePreset: (preset: ImitationPreset, instructions: string) => void
  onOpenAiSettings: () => void
  onClose: () => void
  renderPreview: (markdown: string) => ReactNode
}) {
  const baseSections = useMemo(() => splitIntoSections(source.markdown), [source.markdown])
  const [sections, setSections] = useState<ImitationSection[]>(() => applyPreset(baseSections, initialPreset))
  const [material, setMaterial] = useState('')
  const [instructions, setInstructions] = useState(initialInstructions)
  const [title, setTitle] = useState(() => suggestTitle(source.title))
  const [status, setStatus] = useState<'idle' | 'generating' | 'creating'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImitationResult | null>(null)
  const counts = countByMode(sections)
  const titleById = useMemo(
    () => Object.fromEntries(sections.map((section) => [section.id, section.title || '開頭'])),
    [sections],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && status === 'idle') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, status])

  function setMode(id: string, mode: ImitationMode) {
    setSections((current) => current.map((section) => (section.id === id ? { ...section, mode } : section)))
  }

  function setAll(mode: ImitationMode) {
    setSections((current) => current.map((section) => ({ ...section, mode })))
  }

  async function generate() {
    if (!material.trim()) {
      setError('請先貼上這次的新資料（數據、筆記或題目）')
      return
    }
    if (counts.replace + counts.rewrite === 0) {
      setError('至少要有一個段落設為「替換」或「改寫」')
      return
    }
    setStatus('generating')
    setError(null)
    try {
      const response = await onGenerate(
        buildImitationRequest(sections, { material, instructions, title, ...provider }),
      )
      setResult(response)
      onSavePreset(toPreset(sections), instructions)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失敗，請稍後再試')
    } finally {
      setStatus('idle')
    }
  }

  async function create() {
    if (!result) return
    setStatus('creating')
    setError(null)
    try {
      await onCreate(title.trim() || suggestTitle(source.title), result.markdown)
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立新報告失敗')
      setStatus('idle')
    }
  }

  const busy = status !== 'idle'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-imitation-title"
    >
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">模板臨摹</p>
            <h2 id="template-imitation-title" className="mt-1 truncate text-lg font-semibold text-slate-950">
              用「{source.title}」的格式生成新報告
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              「保留」的段落原封不動，其他段落由 AI 依你貼上的新資料寫。原本的{source.kind === 'template' ? '模板' : '報告'}不會被修改。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="關閉模板臨摹"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {!result ? (
            <div className="grid gap-0 md:grid-cols-[1.15fr_1fr]">
              <section className="border-b border-slate-200 p-5 md:border-b-0 md:border-r sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">1. 每一段怎麼處理</h3>
                  <div className="flex gap-1.5 text-xs">
                    <button type="button" onClick={() => setAll('replace')} className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50">
                      全部替換
                    </button>
                    <button type="button" onClick={() => setAll('keep')} className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50">
                      全部保留
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  保留 {counts.keep}・替換 {counts.replace}・改寫 {counts.rewrite}（下次用同一份範本會記住你的選擇）
                </p>
                <ul className="mt-4 space-y-2.5">
                  {sections.map((section) => (
                    <li key={section.id} className="rounded-2xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {section.level > 0 ? section.title : '開頭（標題前的文字）'}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{snippet(section)}</p>
                        </div>
                        <div className="flex shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label={`「${section.title || '開頭'}」的處理方式`}>
                          {MODE_OPTIONS.map((option) => (
                            <button
                              key={option.mode}
                              type="button"
                              title={option.hint}
                              aria-pressed={section.mode === option.mode}
                              onClick={() => setMode(section.id, option.mode)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                section.mode === option.mode
                                  ? option.mode === 'keep'
                                    ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200'
                                    : 'bg-slate-950 text-white shadow-sm'
                                  : 'text-slate-500 hover:text-slate-900'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-5 p-5 sm:p-6">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-950">2. 貼上這次的新資料</span>
                  <textarea
                    value={material}
                    onChange={(event) => setMaterial(event.target.value)}
                    rows={9}
                    placeholder="例如：這次的實驗題目、量測數據表、老師的要求、你的筆記……數字與單位會原樣使用，AI 不會自己編數據。"
                    className="mt-2 w-full resize-y rounded-2xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-950">補充說明（選填）</span>
                  <textarea
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    rows={3}
                    placeholder="例如：這次是 RL 電路；語氣正式；結論要提到誤差來源。"
                    className="mt-2 w-full resize-y rounded-2xl border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-950">新報告標題</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-950">3. 使用的模型</p>
                  <p className="mt-1 text-sm text-slate-600">{providerLabel}</p>
                  <button type="button" onClick={onOpenAiSettings} className="mt-2 text-xs font-semibold text-blue-700 hover:underline">
                    改用 ChatGPT、Claude、Gemini 或 DeepSeek（在 AI 設定填入自己的 API Key）
                  </button>
                </div>
              </section>
            </div>
          ) : (
            <div className="space-y-4 p-5 sm:p-6">
              {(result.missing_section_ids.length > 0 || result.unverified_numbers.length > 0 || result.model === 'fallback-rule') && (
                <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {result.model === 'fallback-rule' && (
                    <p>目前內建 AI 沒有連接大語言模型，只能保留原文並標出待補段落。改用自己的 API Key 可以直接生成內容。</p>
                  )}
                  {result.missing_section_ids.length > 0 && (
                    <p>
                      以下段落 AI 沒有產生，已保留原文並標註「待補」：
                      {result.missing_section_ids.map((id) => `「${titleById[id] ?? id}」`).join('、')}
                    </p>
                  )}
                  {result.unverified_numbers.length > 0 && (
                    <p>
                      這些數字不在你提供的資料中，請確認是否正確：
                      <span className="font-semibold"> {result.unverified_numbers.join('、')}</span>
                    </p>
                  )}
                </div>
              )}
              <div className="prose prose-slate max-w-none rounded-2xl border border-slate-200 p-4 text-sm">
                {renderPreview(result.markdown)}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 sm:px-6">
          <p className="min-w-0 flex-1 text-sm text-red-600" role="alert">
            {error}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {!result ? (
              <>
                <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={busy}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {status === 'generating' ? 'AI 生成中…' : '開始生成'}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setResult(null)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                  返回修改
                </button>
                <button type="button" onClick={() => void generate()} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                  {status === 'generating' ? 'AI 生成中…' : '重新生成'}
                </button>
                <button
                  type="button"
                  onClick={() => void create()}
                  disabled={busy}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {status === 'creating' ? '建立中…' : '建立新報告'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
