// 模板臨摹: split a finished report or template into sections, choose per section
// whether it stays, is rewritten from new material, or is adapted to it, and
// remember that choice for the next report made from the same source.

export type ImitationMode = 'keep' | 'replace' | 'rewrite'

export type ImitationSection = {
  id: string
  heading: string
  level: number
  title: string
  body: string
  mode: ImitationMode
}

export type ImitationPreset = Record<string, ImitationMode>

export type ImitationResult = {
  markdown: string
  generated_section_ids: string[]
  missing_section_ids: string[]
  unverified_numbers: string[]
  provider: string
  model: string | null
  remaining_quota: number | null
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
const FENCE = /^\s*(```|~~~)/
// Sections that usually carry over unchanged between reports of the same kind.
const USUALLY_FIXED = /器材|設備|儀器|參考|附錄|格式|注意事項|評分|rubric|reference|appendix/i

export function splitIntoSections(markdown: string): ImitationSection[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const sections: ImitationSection[] = []
  let heading = ''
  let level = 0
  let title = ''
  let body: string[] = []
  let inFence = false

  const flush = () => {
    const text = body.join('\n').replace(/^\n+|\n+$/g, '')
    if (heading || text.trim()) {
      sections.push({ id: `s${sections.length + 1}`, heading, level, title, body: text, mode: defaultMode(level, title) })
    }
  }

  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence
    const match = inFence ? null : line.match(HEADING)
    if (match) {
      flush()
      heading = line.trim()
      level = match[1].length
      title = match[2].trim()
      body = []
    } else {
      body.push(line)
    }
  }
  flush()
  return sections
}

function defaultMode(level: number, title: string): ImitationMode {
  if (level === 0) return 'keep'
  if (USUALLY_FIXED.test(title)) return 'keep'
  return 'replace'
}

// Presets are keyed by heading, not position, so they still apply after the
// source gains or loses a section.
function presetKey(section: ImitationSection): string {
  return `${section.level}:${section.title || '(開頭)'}`
}

export function toPreset(sections: ImitationSection[]): ImitationPreset {
  return Object.fromEntries(sections.map((section) => [presetKey(section), section.mode]))
}

export function applyPreset(sections: ImitationSection[], preset: ImitationPreset | null | undefined): ImitationSection[] {
  if (!preset) return sections
  return sections.map((section) => {
    const mode = preset[presetKey(section)]
    return mode === 'keep' || mode === 'replace' || mode === 'rewrite' ? { ...section, mode } : section
  })
}

export function countByMode(sections: ImitationSection[]): Record<ImitationMode, number> {
  return sections.reduce(
    (totals, section) => ({ ...totals, [section.mode]: totals[section.mode] + 1 }),
    { keep: 0, replace: 0, rewrite: 0 } as Record<ImitationMode, number>,
  )
}

export function buildImitationRequest(
  sections: ImitationSection[],
  options: {
    material: string
    instructions: string
    title: string
    provider: 'built_in' | 'user_api_key'
    apiProvider?: string
    model?: string
  },
) {
  return {
    provider: options.provider,
    api_provider: options.provider === 'user_api_key' ? options.apiProvider : undefined,
    model: options.model || undefined,
    title: options.title.trim(),
    material: options.material,
    instructions: options.instructions,
    sections: sections.map(({ id, heading, body, mode }) => ({ id, heading, body, mode })),
  }
}

export function suggestTitle(sourceTitle: string): string {
  const base = sourceTitle.replace(/\s*[（(]?(副本|Copy|新版)[)）]?\s*$/i, '').trim()
  return base ? `${base}（新版）` : '新報告'
}
