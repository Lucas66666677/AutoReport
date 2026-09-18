import { describe, expect, it } from 'vitest'
import {
  consentAuthorizationId,
  describeRedirect,
  isConsentRoute,
  rememberPendingConsent,
  takePendingConsent,
} from './oauthConsent'

const ORIGIN = 'https://autolabreport.lucirel.com'
const CONSENT = `${ORIGIN}/oauth/consent?authorization_id=abc-123`

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

describe('the consent route', () => {
  it('is the authorization path set in the OAuth server settings', () => {
    expect(isConsentRoute('/oauth/consent')).toBe(true)
    expect(isConsentRoute('/oauth/consent/extra')).toBe(false)
    expect(isConsentRoute('/')).toBe(false)
  })

  it('reads a well-formed authorization id and nothing else', () => {
    expect(consentAuthorizationId('?authorization_id=abc-123_X')).toBe('abc-123_X')
    expect(consentAuthorizationId('')).toBeNull()
    expect(consentAuthorizationId('?authorization_id=../../x')).toBeNull()
  })
})

describe('coming back after signing in', () => {
  it('returns to the consent page once', () => {
    const storage = memoryStorage()
    rememberPendingConsent(CONSENT, storage, 1000)
    expect(takePendingConsent(ORIGIN, storage, 2000)).toBe(CONSENT)
    expect(takePendingConsent(ORIGIN, storage, 3000)).toBeNull()
  })

  it('forgets it after fifteen minutes', () => {
    const storage = memoryStorage()
    rememberPendingConsent(CONSENT, storage, 0)
    expect(takePendingConsent(ORIGIN, storage, 15 * 60 * 1000 + 1)).toBeNull()
  })

  // Whatever is stored, the only place this can send the student is this site's own
  // consent page: storage is not a way to redirect them elsewhere.
  it('goes nowhere but this site’s consent page', () => {
    for (const url of [
      'https://evil.example/oauth/consent?authorization_id=abc',
      `${ORIGIN}/dashboard/home`,
      `${ORIGIN}/oauth/consent`,
      'javascript:alert(1)',
    ]) {
      const storage = memoryStorage()
      rememberPendingConsent(url, storage, 1000)
      expect(takePendingConsent(ORIGIN, storage, 2000), url).toBeNull()
    }
    const garbage = memoryStorage()
    garbage.setItem('autolabreport-pending-oauth-consent', '{not json')
    expect(takePendingConsent(ORIGIN, garbage, 2000)).toBeNull()
  })
})

describe('describeRedirect', () => {
  it('recognises the AI apps AutoLabReport knows, over https only', () => {
    expect(describeRedirect('https://chatgpt.com/connector_platform_oauth_redirect')).toEqual({ host: 'chatgpt.com', known: true })
    expect(describeRedirect('https://claude.ai/api/mcp/auth_callback')).toEqual({ host: 'claude.ai', known: true })
    expect(describeRedirect('https://gemini.google.com/oauth-redirect')).toEqual({ host: 'gemini.google.com', known: true })
    // Anyone can put a page on some other Google host; only Gemini's own is known.
    expect(describeRedirect('https://sites.google.com/view/cb')).toEqual({ host: 'sites.google.com', known: false })
    expect(describeRedirect('http://chatgpt.com/cb')).toEqual({ host: 'chatgpt.com', known: false })
    expect(describeRedirect('https://chatgpt.com.evil.example/cb')).toEqual({ host: 'chatgpt.com.evil.example', known: false })
    expect(describeRedirect('not a url')).toEqual({ host: 'not a url', known: false })
  })
})
