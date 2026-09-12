// Pandoc has no idea what Mermaid is, so a diagram reached Word as a code block
// of its own source. The preview already renders it to SVG in the browser, so the
// export turns that SVG into a PNG and sends a picture instead. These are the
// pure parts: finding the diagrams, sizing the SVG, and putting the images back.

const MERMAID_FENCE = /(^|\n)([ \t]*)```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*(?=\n|$)/g

export function collectMermaidCharts(markdown: string): string[] {
  const charts: string[] = []
  MERMAID_FENCE.lastIndex = 0
  let match = MERMAID_FENCE.exec(markdown)
  while (match) {
    const chart = match[3].trim()
    if (chart && !charts.includes(chart)) charts.push(chart)
    match = MERMAID_FENCE.exec(markdown)
  }
  return charts
}

export function replaceMermaidCharts(markdown: string, replacements: Record<string, string>): string {
  MERMAID_FENCE.lastIndex = 0
  return markdown.replace(MERMAID_FENCE, (block, lead: string, indent: string, body: string) => {
    const image = replacements[body.trim()]
    // A diagram we could not render keeps its source, which is what Word used to get.
    return image ? `${lead}${indent}![Mermaid 圖表](${image})` : block
  })
}

export function parseSvgSize(svg: string): { width: number; height: number } {
  const width = Number(/\bwidth\s*=\s*["']([\d.]+)/.exec(svg)?.[1])
  const height = Number(/\bheight\s*=\s*["']([\d.]+)/.exec(svg)?.[1])
  if (width > 0 && height > 0) return { width, height }

  const viewBox = /\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(svg)
  if (viewBox) {
    const boxWidth = Number(viewBox[1])
    const boxHeight = Number(viewBox[2])
    if (boxWidth > 0 && boxHeight > 0) return { width: boxWidth, height: boxHeight }
  }

  return { width: 800, height: 600 }
}

export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

// Mermaid needs a unique element id per render. A clock reading would be an
// impure call inside the component, so the counter lives out here instead.
let renderCounter = 0

export function mermaidRenderId(): string {
  renderCounter += 1
  return `autolabreport-export-${renderCounter}`
}
