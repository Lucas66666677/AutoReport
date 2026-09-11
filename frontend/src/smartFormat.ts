// 「改為 Word 格式」 cleanup. The first version ran document-wide regexes that
// crossed line breaks and rewrote content: `\s*` around 。 glued a sentence to the
// next heading ("模型。## 實驗器材"), English in parentheses was deleted, and a line
// starting with "-5 V" or "2.5 mA" became a list item. This version works line by
// line, never changes line breaks, words or numbers, and leaves tables and fenced
// code alone.

const FENCE = /^\s*(```|~~~)/
const TABLE_ROW = /^\s*\|/

function tidyLine(line: string): string {
  if (!line.trim()) return ''
  const indentation = line.match(/^\s*/)?.[0] ?? ''
  let body = line.slice(indentation.length)

  // "-item" / "1.item" -> add the missing space, but never touch a negative
  // number, a decimal or a horizontal rule. "*" and "+" are left alone: without
  // a space they are emphasis ("*斜體*"), not list markers.
  body = body.replace(/^(-)(?=[^\s\d\-.])/, '$1 ')
  body = body.replace(/^(\d+\.)(?=[^\s\d])/, '$1 ')
  // "##Title" -> "## Title"
  body = body.replace(/^(#{1,6})(?=[^\s#])/, '$1 ')

  // Full-width punctuation never takes spaces around it (within the line only).
  body = body.replace(/[ \t]*([。，！？；：、])[ \t]*/g, '$1')
  // "text , more" -> "text, more"; keeps ":" in times and URLs untouched.
  body = body.replace(/(\S)[ \t]+([,.!?;])(?=\s|$)/g, '$1$2')
  // "** bold **" -> "**bold**"
  body = body.replace(/\*\*[ \t]+([^*\n]*?)[ \t]+\*\*/g, '**$1**')
  // Collapse runs of spaces inside the text (not the indentation).
  body = body.replace(/([^ \t])[ \t]{2,}(?=[^ \t])/g, '$1 ')
  body = body.replace(/[ \t]+$/, '')

  return indentation + body
}

export function smartFormat(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let inFence = false

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      output.push(line)
      continue
    }
    if (inFence || TABLE_ROW.test(line)) {
      output.push(line)
      continue
    }
    output.push(tidyLine(line))
  }

  // At most one blank line between blocks, and exactly one trailing newline.
  return output.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n')
}
