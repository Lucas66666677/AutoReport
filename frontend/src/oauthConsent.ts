// The page Supabase Auth's OAuth 2.1 server sends a student to when an AI app -- ChatGPT,
// Claude or Gemini on the web -- asks to reach their AutoLabReport account (see
// backend/mcp_remote.py). The project's OAuth server settings name this path as the
// authorization path.

export const OAUTH_CONSENT_PATH = '/oauth/consent'

const PENDING_CONSENT_KEY = 'autolabreport-pending-oauth-consent'
const PENDING_CONSENT_LIFETIME_MS = 15 * 60 * 1000
const AUTHORIZATION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/

// Where the AI apps AutoLabReport knows send the student back to after they decide:
// ChatGPT, Claude (https://claude.ai/api/mcp/auth_callback) and Gemini
// (https://gemini.google.com/oauth-redirect).
const KNOWN_AI_APP_HOSTS = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'claude.com', 'gemini.google.com']

export function isConsentRoute(pathname: string): boolean {
  return pathname === OAUTH_CONSENT_PATH
}

/** The authorization being asked about, or null for a missing or malformed one. */
export function consentAuthorizationId(search: string): string | null {
  const id = new URLSearchParams(search).get('authorization_id')
  return id && AUTHORIZATION_ID_RE.test(id) ? id : null
}

// Signing in leaves the page -- to Google, or to a link in an e-mail that opens in a new
// tab -- and lands on the site's front page. Where the student was is kept here, briefly,
// so they come back to the question they were answering.

export function rememberPendingConsent(
  url: string,
  storage: Storage | undefined = globalThis.localStorage,
  now: number = Date.now(),
): void {
  try {
    storage?.setItem(PENDING_CONSENT_KEY, JSON.stringify({ url, at: now }))
  } catch {
    // The student can open the link from their AI app again.
  }
}

/**
 * The consent page to return to after signing in, once: only a fresh one, and only this
 * site's own consent path, whatever the stored value says.
 */
export function takePendingConsent(
  origin: string,
  storage: Storage | undefined = globalThis.localStorage,
  now: number = Date.now(),
): string | null {
  let saved: { url?: unknown; at?: unknown } | null
  try {
    saved = JSON.parse(storage?.getItem(PENDING_CONSENT_KEY) ?? 'null') as { url?: unknown; at?: unknown } | null
    storage?.removeItem(PENDING_CONSENT_KEY)
  } catch {
    return null
  }
  if (!saved || typeof saved.url !== 'string' || typeof saved.at !== 'number') return null
  if (now - saved.at > PENDING_CONSENT_LIFETIME_MS || saved.at > now) return null
  try {
    const target = new URL(saved.url, origin)
    if (target.origin !== origin || !isConsentRoute(target.pathname) || !consentAuthorizationId(target.search)) return null
    return target.toString()
  } catch {
    return null
  }
}

/** Where approving sends the student, and whether it is an AI app AutoLabReport knows. */
export function describeRedirect(redirectUri: string): { host: string; known: boolean } {
  try {
    const { protocol, hostname } = new URL(redirectUri)
    return { host: hostname, known: protocol === 'https:' && KNOWN_AI_APP_HOSTS.includes(hostname) }
  } catch {
    return { host: redirectUri, known: false }
  }
}
