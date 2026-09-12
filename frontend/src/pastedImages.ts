// Copying an image from a web page can put three different things on the
// clipboard: an image file, an HTML fragment with <img src>, or just the image
// address as plain text. Only the first was handled, so "copy image" from a site
// often pasted a bare URL (or nothing useful). These helpers find the image
// sources in the other two cases so they can be uploaded like a pasted file.

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i

export function collectHtmlImageSources(html: string): string[] {
  if (!html.includes('<img') || typeof DOMParser === 'undefined') return []
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const sources: string[] = []
  for (const image of Array.from(parsed.querySelectorAll('img'))) {
    const src = image.getAttribute('src')?.trim()
    if (src && !sources.includes(src) && (src.startsWith('http') || src.startsWith('data:'))) {
      sources.push(src)
    }
  }
  return sources
}

export function collectImageUrlsFromText(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return []
  if (trimmed.startsWith('data:image/')) return [trimmed]
  if (!/^https?:\/\//i.test(trimmed)) return []
  return IMAGE_EXTENSION.test(trimmed) ? [trimmed] : []
}

export function imageMarkdown(url: string, alt = 'pasted-image'): string {
  return `![${alt}](${url})`
}
