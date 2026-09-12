import { describe, expect, it } from 'vitest'
import { buildErrorEnvelope, describeError, parseSentryDsn } from './errorReporting'

const META = {
  eventId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
  sentAt: '2026-09-12T02:00:00.000Z',
  release: 'test-release',
  environment: 'production',
  url: 'https://auto-report-one.vercel.app/editor',
}

describe('sentry dsn', () => {
  it('turns a dsn into the envelope endpoint', () => {
    const dsn = parseSentryDsn('https://abc123@o42.ingest.sentry.io/1234567')
    expect(dsn).toEqual({
      envelopeUrl:
        'https://o42.ingest.sentry.io/api/1234567/envelope/?sentry_key=abc123&sentry_version=7',
      publicKey: 'abc123',
      projectId: '1234567',
    })
  })

  it('stays off for anything that is not a usable dsn', () => {
    // No DSN configured is the normal case: reporting must simply not happen.
    expect(parseSentryDsn(undefined)).toBeNull()
    expect(parseSentryDsn('')).toBeNull()
    expect(parseSentryDsn('not a url')).toBeNull()
    expect(parseSentryDsn('https://o42.ingest.sentry.io/1234567')).toBeNull()
    expect(parseSentryDsn('https://abc123@o42.ingest.sentry.io/')).toBeNull()
    expect(parseSentryDsn('https://abc123@o42.ingest.sentry.io/not-a-project')).toBeNull()
  })
})

describe('describing an error', () => {
  it('keeps the name, message and stack of a real error', () => {
    const error = new TypeError('x is not a function')
    const described = describeError(error)
    expect(described.type).toBe('TypeError')
    expect(described.value).toBe('x is not a function')
    expect(described.stack).toContain('TypeError')
  })

  it('copes with whatever else gets thrown', () => {
    expect(describeError('plain string')).toEqual({ type: 'Error', value: 'plain string' })
    expect(describeError({ code: 500 })).toEqual({ type: 'Error', value: '{"code":500}' })
  })
})

describe('envelope', () => {
  it('is three newline-delimited json lines sentry can accept', () => {
    const body = buildErrorEnvelope(new Error('boom'), { source: 'window.error' }, META)
    const [header, itemHeader, payload] = body.split('\n')

    expect(JSON.parse(header)).toEqual({ event_id: META.eventId, sent_at: META.sentAt })
    expect(JSON.parse(itemHeader)).toEqual({ type: 'event' })

    const event = JSON.parse(payload)
    expect(event.event_id).toBe(META.eventId)
    expect(event.level).toBe('error')
    expect(event.release).toBe('test-release')
    expect(event.environment).toBe('production')
    expect(event.request.url).toBe(META.url)
    expect(event.exception.values[0]).toMatchObject({ type: 'Error', value: 'boom' })
    expect(event.extra).toEqual({ source: 'window.error' })
  })

  it('does not break when the error carries no stack', () => {
    const body = buildErrorEnvelope('just a string', {}, { ...META, release: undefined })
    const event = JSON.parse(body.split('\n')[2])
    expect(event.exception.values[0].stacktrace).toBeUndefined()
    expect(event.release).toBeUndefined()
  })
})
