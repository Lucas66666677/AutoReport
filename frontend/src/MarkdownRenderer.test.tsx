import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MarkdownRenderer from './MarkdownRenderer'

afterEach(cleanup)

function renderMarkdown(markdown: string) {
  return renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />)
}

describe('MarkdownRenderer', () => {
  it('renders a GFM table with semantic sections and alignment', () => {
    const html = renderMarkdown(`| 項目 | 數值 | 單位 |
|:---|---:|:---:|
| 電壓 | 5.00 | V |
| 電流 | 0.25 | A |`)

    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('text-align:left')
    expect(html).toContain('text-align:right')
    expect(html).toContain('text-align:center')
  })

  it('preserves empty cells, escaped pipes, and inline code in table cells', () => {
    const html = renderMarkdown(`| A | B |
|---|---|
|  | 空白儲存格 |
| \`a \\| b\` | escaped pipe |`)

    expect(html).toContain('<tbody>')
    expect(html).toMatch(/<td[^>]*><\/td>/)
    expect(html).toContain('<code>a | b</code>')
    expect(html).toContain('escaped pipe')
  })

  it('keeps safe table HTML while removing scripts and dangerous attributes', () => {
    const html = renderMarkdown(`
<table><thead><tr><th>安全</th></tr></thead><tbody><tr><td onclick="alert(1)">內容</td></tr></tbody></table>
<script>alert('unsafe')</script>
<img src="https://example.com/image.png" onerror="alert(1)" alt="安全圖片" />`)

    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onerror')
  })

  it('continues to render KaTeX and recognizes Mermaid fenced blocks', () => {
    const mathHtml = renderMarkdown('Inline $E = mc^2$ and block:\n\n$$\na^2+b^2=c^2\n$$')
    const mermaidHtml = renderMarkdown('```mermaid\ngraph TD\n  A --> B\n```')

    expect(mathHtml).toContain('class="katex"')
    expect(mathHtml).toContain('katex-display')
    expect(mermaidHtml).toContain('正在渲染 Mermaid 圖表')
    expect(mermaidHtml).not.toContain('language-mermaid')
  })

  it('loads images lazily and replaces failed images with an accessible fallback', () => {
    const view = render(<MarkdownRenderer markdown="![電路圖](https://example.com/circuit.png)" />)
    const image = view.container.querySelector('img')

    expect(image?.getAttribute('loading')).toBe('lazy')
    expect(image?.getAttribute('decoding')).toBe('async')
    expect(image?.getAttribute('src')).toBe('https://example.com/circuit.png')

    if (image) fireEvent.error(image)
    expect(screen.getByText('圖片載入失敗：電路圖')).not.toBeNull()
  })
})
