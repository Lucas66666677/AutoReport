import { describe, expect, it } from 'vitest'
import { collectHtmlImageSources, collectImageUrlsFromText, imageMarkdown } from './pastedImages'

describe('pasted images', () => {
  it('finds image sources in a copied web page fragment', () => {
    const html = '<meta charset="utf-8"><div><p>圖說</p><img src="https://example.com/a.png" alt="a"><img src="data:image/png;base64,AAAA"></div>'
    expect(collectHtmlImageSources(html)).toEqual(['https://example.com/a.png', 'data:image/png;base64,AAAA'])
  })

  it('ignores html without images and relative sources', () => {
    expect(collectHtmlImageSources('<p>只是文字</p>')).toEqual([])
    expect(collectHtmlImageSources('<img src="/local/a.png">')).toEqual([])
  })

  it('recognises a copied image address', () => {
    expect(collectImageUrlsFromText('https://example.com/photo.JPG?v=2')).toEqual(['https://example.com/photo.JPG?v=2'])
    expect(collectImageUrlsFromText('  data:image/png;base64,AAAA ')).toEqual(['data:image/png;base64,AAAA'])
  })

  it('leaves ordinary text and non-image links alone', () => {
    expect(collectImageUrlsFromText('https://example.com/article')).toEqual([])
    expect(collectImageUrlsFromText('看這張圖 https://example.com/a.png')).toEqual([])
    expect(collectImageUrlsFromText('')).toEqual([])
  })

  it('writes the markdown for an image', () => {
    expect(imageMarkdown('https://example.com/a.png')).toBe('![pasted-image](https://example.com/a.png)')
  })
})
