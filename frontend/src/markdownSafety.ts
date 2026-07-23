import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { PluggableList } from 'unified'

const SAFE_MARKDOWN_TAGS = [
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'input',
]

export const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), ...SAFE_MARKDOWN_TAGS])],
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
    ul: [
      ...(defaultSchema.attributes?.ul ?? []),
      ['className', 'contains-task-list'],
    ],
    li: [
      ...(defaultSchema.attributes?.li ?? []),
      ['className', 'task-list-item'],
    ],
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      ['type', 'checkbox'],
      ['checked'],
      ['disabled'],
    ],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      ['align', 'left', 'center', 'right'],
    ],
    td: [
      ...(defaultSchema.attributes?.td ?? []),
      ['align', 'left', 'center', 'right'],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https', 'data', 'supabase-image'],
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

  if (/^supabase-image:\/\/[A-Za-z0-9%._~-]+$/i.test(trimmedValue)) {
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
