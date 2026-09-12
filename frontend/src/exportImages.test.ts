import { describe, expect, it } from 'vitest'
import { collectMarkdownImageUrls, isEmbeddableImageUrl, replaceMarkdownImageUrls } from './exportImages'

const REPORT = `# 報告

![貼上的圖](supabase-image://report_images%2Fuser%2Fdoc%2Fa.png)

一段文字，含連結 [不是圖片](https://example.com/page)。

![遠端](https://example.com/remote.png "標題")

<img src="https://example.com/inline.jpg" alt="html">

![已內嵌](data:image/png;base64,AAAA)
`

describe('export images', () => {
  it('collects markdown and html image urls, not ordinary links', () => {
    expect(collectMarkdownImageUrls(REPORT)).toEqual([
      'supabase-image://report_images%2Fuser%2Fdoc%2Fa.png',
      'https://example.com/remote.png',
      'data:image/png;base64,AAAA',
      'https://example.com/inline.jpg',
    ])
  })

  it('swaps the urls it was given and leaves the rest alone', () => {
    const output = replaceMarkdownImageUrls(REPORT, {
      'supabase-image://report_images%2Fuser%2Fdoc%2Fa.png': 'data:image/png;base64,BBBB',
      'https://example.com/remote.png': '',
    })
    expect(output).toContain('![貼上的圖](data:image/png;base64,BBBB)')
    expect(output).toContain('![遠端](https://example.com/remote.png "標題")')
    expect(output).toContain('[不是圖片](https://example.com/page)')
  })

  it('knows what still needs embedding', () => {
    expect(isEmbeddableImageUrl('supabase-image://x')).toBe(true)
    expect(isEmbeddableImageUrl('https://example.com/a.png')).toBe(true)
    expect(isEmbeddableImageUrl('data:image/png;base64,AAAA')).toBe(false)
  })
})
