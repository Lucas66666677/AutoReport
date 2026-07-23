import {
  useEffect,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { REHYPE_PLUGINS, safeMarkdownUrlTransform } from './markdownSafety'

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]

let mermaidInitialized = false

function createMermaidRenderId() {
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)

  return `autolabreport-mermaid-${randomId}`
}

export function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false
    const renderId = createMermaidRenderId()

    async function renderMermaid() {
      try {
        const { default: mermaid } = await import('mermaid')
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'strict',
          })
          mermaidInitialized = true
        }

        const result = await mermaid.render(renderId, chart)
        if (!isCancelled) {
          setSvg(result.svg)
          setError(null)
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid 渲染失敗')
          setSvg('')
        }
      }
    }

    void renderMermaid()
    return () => {
      isCancelled = true
    }
  }, [chart])

  if (error) {
    return (
      <div className="markdown-mermaid-error" role="alert">
        <strong>Mermaid 圖表無法渲染</strong>
        <span>{error}</span>
      </div>
    )
  }

  if (!svg) {
    return <p className="markdown-mermaid-loading">正在渲染 Mermaid 圖表…</p>
  }

  return (
    <div
      className="markdown-mermaid"
      role="img"
      aria-label="Mermaid 圖表"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

type MarkdownImageProps = ComponentProps<'img'> & ExtraProps

function MarkdownImage({ node, alt, className, onError, ...props }: MarkdownImageProps) {
  const [failed, setFailed] = useState(false)
  void node

  if (failed) {
    return (
      <span className="markdown-image-error" role="img" aria-label={alt || '圖片載入失敗'}>
        圖片載入失敗{alt ? `：${alt}` : ''}
      </span>
    )
  }

  return (
    <img
      {...props}
      alt={alt ?? '報告圖片'}
      className={className}
      loading="lazy"
      decoding="async"
      onError={(event) => {
        onError?.(event)
        setFailed(true)
      }}
    />
  )
}

function MarkdownTable({ children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div
      className="markdown-table-scroll"
      role="region"
      aria-label="表格，可水平捲動"
      tabIndex={0}
    >
      <table {...props}>{children}</table>
    </div>
  )
}

const SHARED_MARKDOWN_COMPONENTS: Components = {
  img: MarkdownImage,
  table(properties) {
    const { node, children, ...props } = properties
    void node
    return <MarkdownTable {...props}>{children}</MarkdownTable>
  },
  code(properties) {
    const { node, children, className, ...props } = properties
    const match = /language-([\w-]+)/.exec(className ?? '')
    const code = String(children ?? '').replace(/\n$/, '')
    void node

    if (match?.[1] === 'mermaid') {
      return <MermaidBlock chart={code} />
    }

    return (
      <code {...props} className={className}>
        {children}
      </code>
    )
  },
}

type MarkdownRendererProps = {
  markdown: string
  components?: Components
  children?: ReactNode
}

export default function MarkdownRenderer({ markdown, components }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      urlTransform={safeMarkdownUrlTransform}
      components={{ ...SHARED_MARKDOWN_COMPONENTS, ...components }}
    >
      {markdown}
    </ReactMarkdown>
  )
}
