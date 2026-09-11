import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  buildImitationRequest,
  countByMode,
  splitIntoSections,
  suggestTitle,
  toPreset,
} from './templateImitation'

const REPORT = `課程：電子學實驗

# 電子電路實驗報告

## 實驗目的
量測 RC 電路。

## 實驗器材
| 器材 | 數量 |
|---|---|
| 示波器 | 1 |

## 程式
\`\`\`python
# not a heading
print(1)
\`\`\`

## 參考資料
- 課本第 3 章
`

describe('template imitation sections', () => {
  it('splits by headings, keeping the text before the first heading', () => {
    const sections = splitIntoSections(REPORT)
    expect(sections.map((section) => section.title || '(開頭)')).toEqual([
      '(開頭)',
      '電子電路實驗報告',
      '實驗目的',
      '實驗器材',
      '程式',
      '參考資料',
    ])
    expect(sections[0].body).toBe('課程：電子學實驗')
    expect(sections.map((section) => section.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6'])
  })

  it('does not treat "#" inside a code block as a heading', () => {
    const code = splitIntoSections(REPORT).find((section) => section.title === '程式')
    expect(code?.body).toContain('# not a heading')
  })

  it('keeps usually-fixed sections and the preamble, replaces the rest', () => {
    const modes = Object.fromEntries(splitIntoSections(REPORT).map((section) => [section.title || '(開頭)', section.mode]))
    expect(modes).toEqual({
      '(開頭)': 'keep',
      電子電路實驗報告: 'replace',
      實驗目的: 'replace',
      實驗器材: 'keep',
      程式: 'replace',
      參考資料: 'keep',
    })
  })

  it('re-applies a saved preset by heading even after the source changes', () => {
    const edited = splitIntoSections(REPORT).map((section) =>
      section.title === '實驗目的' ? { ...section, mode: 'rewrite' as const } : section,
    )
    const preset = toPreset(edited)
    const changedSource = splitIntoSections(REPORT.replace('## 實驗器材', '## 新章節\n內容\n\n## 實驗器材'))
    const restored = applyPreset(changedSource, preset)
    expect(restored.find((section) => section.title === '實驗目的')?.mode).toBe('rewrite')
    expect(restored.find((section) => section.title === '新章節')?.mode).toBe('replace')
  })

  it('counts modes and builds the request the backend expects', () => {
    const sections = splitIntoSections(REPORT)
    expect(countByMode(sections)).toEqual({ keep: 3, replace: 3, rewrite: 0 })
    const request = buildImitationRequest(sections, {
      material: '新資料',
      instructions: '',
      title: ' RL 電路 ',
      provider: 'user_api_key',
      apiProvider: 'anthropic',
    })
    expect(request.title).toBe('RL 電路')
    expect(request.api_provider).toBe('anthropic')
    expect(request.sections[0]).toEqual({ id: 's1', heading: '', body: '課程：電子學實驗', mode: 'keep' })
    expect(Object.keys(request.sections[1]).sort()).toEqual(['body', 'heading', 'id', 'mode'])
  })

  it('suggests a title for the new report', () => {
    expect(suggestTitle('RC 電路實驗報告')).toBe('RC 電路實驗報告（新版）')
    expect(suggestTitle('RC 電路實驗報告 Copy')).toBe('RC 電路實驗報告（新版）')
    expect(suggestTitle('')).toBe('新報告')
  })
})
