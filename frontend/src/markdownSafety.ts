import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { PluggableList } from 'unified'

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-[\w-]+$/]],
    div: [['className', /^mermaid$/]],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      ['src'],
      ['alt'],
      ['title'],
      ['width'],
      ['height'],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ['className'],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https'],
  },
}

export const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeKatex,
] as PluggableList

export function safeMarkdownUrlTransform(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) return ''

  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmedValue)) {
    return trimmedValue
  }

  if (/^(https?:|mailto:)/i.test(trimmedValue)) {
    return trimmedValue
  }

  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmedValue) && !trimmedValue.startsWith('//')) {
    return trimmedValue
  }

  return ''
}
