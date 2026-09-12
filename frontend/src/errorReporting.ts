// Runtime errors were invisible: the error boundary wrote to the browser console
// and nothing else, so a student hitting a white screen left no trace anywhere.
//
// This speaks Sentry's envelope endpoint directly with fetch instead of pulling in
// @sentry/browser: the payload is a few fields, it costs nothing in the bundle when
// no DSN is configured, and the parts worth trusting -- reading the DSN and building
// the payload -- stay unit-testable. Set VITE_SENTRY_DSN to turn it on; with no DSN
// every call here is a no-op.

export type SentryDsn = {
  envelopeUrl: string
  publicKey: string
  projectId: string
}

export type ErrorContext = Record<string, string | number | boolean | null | undefined>

export function parseSentryDsn(dsn: string | undefined): SentryDsn | null {
  if (!dsn) return null
  try {
    const url = new URL(dsn)
    const publicKey = url.username
    const projectId = url.pathname.replace(/^\/+/, '')
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null
    return {
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`,
      publicKey,
      projectId,
    }
  } catch {
    return null
  }
}

export function describeError(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || 'Error', value: error.message, stack: error.stack }
  }
  if (typeof error === 'string') return { type: 'Error', value: error }
  try {
    return { type: 'Error', value: JSON.stringify(error) ?? String(error) }
  } catch {
    return { type: 'Error', value: String(error) }
  }
}

export type EnvelopeMeta = {
  eventId: string
  sentAt: string
  release?: string
  environment?: string
  url?: string
}

/** Sentry envelopes are newline-delimited JSON: header, item header, then the event. */
export function buildErrorEnvelope(
  error: unknown,
  context: ErrorContext,
  meta: EnvelopeMeta,
): string {
  const described = describeError(error)
  const event = {
    event_id: meta.eventId,
    timestamp: meta.sentAt,
    platform: 'javascript',
    level: 'error',
    logger: 'autolabreport',
    release: meta.release,
    environment: meta.environment,
    request: meta.url ? { url: meta.url } : undefined,
    exception: {
      values: [
        {
          type: described.type,
          value: described.value,
          stacktrace: described.stack
            ? { frames: [{ filename: described.stack.slice(0, 4000) }] }
            : undefined,
        },
      ],
    },
    extra: context,
  }
  const header = JSON.stringify({ event_id: meta.eventId, sent_at: meta.sentAt })
  const itemHeader = JSON.stringify({ type: 'event' })
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}`
}

export function createEventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const dsn = parseSentryDsn(import.meta.env.VITE_SENTRY_DSN as string | undefined)

export function isErrorReportingEnabled(): boolean {
  return dsn !== null
}

/** Never throws and never blocks: a failure to report must not become a second failure. */
export function reportError(error: unknown, context: ErrorContext = {}): void {
  if (!dsn) return
  try {
    const body = buildErrorEnvelope(error, context, {
      eventId: createEventId(),
      sentAt: new Date().toISOString(),
      release: import.meta.env.VITE_RELEASE as string | undefined,
      environment: import.meta.env.MODE,
      url: typeof location === 'undefined' ? undefined : location.href,
    })
    void fetch(dsn.envelopeUrl, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Reporting is best effort.
  }
}

let globalHandlersInstalled = false

export function installGlobalErrorReporting(): void {
  if (globalHandlersInstalled || !dsn || typeof window === 'undefined') return
  globalHandlersInstalled = true
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { source: 'window.error' })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'unhandledrejection' })
  })
}
