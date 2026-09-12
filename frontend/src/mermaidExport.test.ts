import { describe, expect, it } from 'vitest'
import { collectMermaidCharts, mermaidRenderId, parseSvgSize, replaceMermaidCharts, svgToDataUrl } from './mermaidExport'

const REPORT = [
  '# 報告',
  '',
  '```mermaid',
  'graph TD;',
  '  A-->B;',
  '```',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
].join('\n')

describe('mermaid export', () => {
  it('finds the diagrams and leaves other code blocks alone', () => {
    expect(collectMermaidCharts(REPORT)).toEqual(['graph TD;\n  A-->B;'])
  })

  it('collects each distinct diagram once', () => {
    const twice = REPORT + '\n```mermaid\ngraph TD;\n  A-->B;\n```\n\n```mermaid\npie title P\n```\n'
    expect(collectMermaidCharts(twice)).toEqual(['graph TD;\n  A-->B;', 'pie title P'])
  })

  it('replaces a rendered diagram with a picture', () => {
    const out = replaceMermaidCharts(REPORT, { 'graph TD;\n  A-->B;': 'data:image/png;base64,AAAA' })
    expect(out).toContain('![Mermaid 圖表](data:image/png;base64,AAAA)')
    expect(out).not.toContain('```mermaid')
    expect(out).toContain('```js')
  })

  it('keeps the source when the diagram could not be rendered', () => {
    expect(replaceMermaidCharts(REPORT, {})).toBe(REPORT)
  })

  it('reads the size from the svg, falling back to the viewBox', () => {
    expect(parseSvgSize('<svg width="320" height="180" viewBox="0 0 640 360">')).toEqual({ width: 320, height: 180 })
    expect(parseSvgSize('<svg viewBox="0 0 640 360" style="max-width:100%">')).toEqual({ width: 640, height: 360 })
    expect(parseSvgSize('<svg>')).toEqual({ width: 800, height: 600 })
  })

  it('encodes an svg, including non-ascii labels, as a data url', () => {
    const url = svgToDataUrl('<svg><text>電路圖</text></svg>')
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(url.length).toBeGreaterThan(30)
  })
})

describe('mermaid render id', () => {
  it('gives every diagram its own id', () => {
    expect(mermaidRenderId()).not.toBe(mermaidRenderId())
    expect(mermaidRenderId().startsWith('autolabreport-export-')).toBe(true)
  })
})
