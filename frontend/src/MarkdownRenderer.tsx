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
import {
  parseLegacyPublicReportImagePath,
  parsePrivateReportImagePath,
  REPORT_IMAGE_BUCKET,
} from './reportImageStorage'
import { SUPABASE_URL, supabaseClient } from './supabaseClient'

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
  const source = typeof props.src === 'string' ? props.src : undefined
  const privatePath =
    parsePrivateReportImagePath(source) ?? parseLegacyPublicReportImagePath(source, SUPABASE_URL)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [signedImage, setSignedImage] = useState<{
    path: string
    url: string
    failed: boolean
  } | null>(null)
  void node

  useEffect(() => {
    let isCancelled = false
    if (!privatePath || !supabaseClient) return

    void supabaseClient.storage
      .from(REPORT_IMAGE_BUCKET)
      .createSignedUrl(privatePath, 3600)
      .then(({ data, error }) => {
        if (isCancelled) return
        if (error || !data.signedUrl) {
          setSignedImage({ path: privatePath, url: '', failed: true })
          return
        }
        setSignedImage({ path: privatePath, url: data.signedUrl, failed: false })
      })

    return () => {
      isCancelled = true
    }
  }, [privatePath, source])

  const resolvedSource = privatePath
    ? signedImage?.path === privatePath
      ? signedImage.url
      : ''
    : source
  const failed =
    failedSource === source ||
    Boolean(privatePath && (!supabaseClient || (signedImage?.path === privatePath && signedImage.failed)))

  if (failed) {
    return (
      <span className="markdown-image-error" role="img" aria-label={alt || '圖片載入失敗'}>
        圖片載入失敗{alt ? `：${alt}` : ''}
      </span>
    )
  }

  if (privatePath && !resolvedSource) {
    return <span className="markdown-image-loading">正在安全載入圖片…</span>
  }

  return (
    <img
      {...props}
      src={resolvedSource}
      alt={alt ?? '報告圖片'}
      className={className}
      loading="lazy"
      decoding="async"
      onError={(event) => {
        onError?.(event)
        setFailedSource(source ?? '')
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
