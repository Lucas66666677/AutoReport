// A converter may claim a paste only when it accounts for essentially all of it.
//
// Copying a table from a web page is one thing. Copying an AI answer that happens to
// contain a table is another, and the paste handler treated them the same: it pulled
// the table out, inserted that, and threw away the answer around it. Measured against
// a realistic Gemini/ChatGPT payload: 147 characters of answer became 62 characters of
// table, losing the heading, the prose, the numbered list and the conclusion. A single
// icon <img> anywhere in the fragment did the same thing through the image branch --
// and AI sites put icons in their markup.
//
// This was invisible for as long as the paste listener was unreachable (Monaco 0.55
// swallowed the event), so these branches ran for the first time in a long while once
// that wiring was repaired, and they ran against payloads nobody had tried them on.
//
// ChatGPT and Gemini both put a plain-text twin on the clipboard that is already good
// Markdown -- headings, tables and lists intact. So when the HTML is a whole answer,
// the right move is to claim nothing and let that plain text through untouched.

/** Share of the fragment's text that must sit inside tables to call it a table paste. */
export const COVERAGE_THRESHOLD = 0.6

/** Characters of stray text still allowed around an image-only paste. */
export const IMAGE_ONLY_STRAY_CHARACTERS = 16

function parse(html: string): Document | null {
  if (typeof DOMParser === 'undefined' || !html.trim()) return null
  try {
    return new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }
}

/** Visible text with whitespace removed, so layout cannot change the measurement. */
export function densify(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, '')
}

/**
 * How much of the fragment's visible text sits inside a table: 1 when the clipboard
 * holds nothing but a table, near 0 for an article that happens to contain one.
 */
export function tableCoverage(html: string): number {
  const document = parse(html)
  if (!document) return 0

  const tables = Array.from(document.querySelectorAll('table'))
  if (tables.length === 0) return 0

  const total = densify(document.body.textContent).length
  if (total === 0) return 0

  const inTables = tables.reduce((sum, table) => sum + densify(table.textContent).length, 0)
  return Math.min(1, inTables / total)
}

/** Whether converting the table would keep essentially everything that was copied. */
export function isEssentiallyOneTable(html: string, threshold = COVERAGE_THRESHOLD): boolean {
  return tableCoverage(html) >= threshold
}

/**
 * Whether the clipboard holds images and almost no text -- copying a picture, rather
 * than copying an answer that has a logo in it.
 */
export function isEssentiallyImagesOnly(
  html: string,
  maxStrayCharacters = IMAGE_ONLY_STRAY_CHARACTERS,
): boolean {
  const document = parse(html)
  if (!document) return false
  if (document.querySelectorAll('img').length === 0) return false

  return densify(document.body.textContent).length <= maxStrayCharacters
}
