// Word export sends Markdown to Pandoc, which fetches image URLs itself. A
// report's own images use the app's private "supabase-image://" scheme, which
// Pandoc cannot fetch — those images silently vanished from the .docx — and
// remote images often fail (a site that blocks the fetch ends up embedded as an
// error page). Embedding every image as a data: URI first makes the export
// self-contained; data: URIs come back as real PNGs in the document.

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
const HTML_IMAGE = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi

export function collectMarkdownImageUrls(markdown: string): string[] {
  const urls: string[] = []
  for (const pattern of [MARKDOWN_IMAGE, HTML_IMAGE]) {
    pattern.lastIndex = 0
    let match = pattern.exec(markdown)
    while (match) {
      const url = match[1].trim()
      if (url && !urls.includes(url)) urls.push(url)
      match = pattern.exec(markdown)
    }
  }
  return urls
}

export function replaceMarkdownImageUrls(markdown: string, replacements: Record<string, string>): string {
  let output = markdown
  for (const [from, to] of Object.entries(replacements)) {
    if (!to || from === to) continue
    output = output.split(from).join(to)
  }
  return output
}

export function isEmbeddableImageUrl(url: string): boolean {
  return !url.startsWith('data:')
}
