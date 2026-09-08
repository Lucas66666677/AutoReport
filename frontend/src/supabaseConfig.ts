// Build-time contract for the Supabase project this SPA authenticates against.
//
// `VITE_SUPABASE_URL` is inlined at build time, exactly like `VITE_API_URL`, so a
// wrong value is not recoverable at runtime -- and unlike a wrong API origin it
// fails *silently in the visitor's browser*: `supabaseClient.ts` builds a client
// against whatever host was baked in, and `signInWithOAuth` hard-redirects the
// page to `${url}/auth/v1/authorize`. When that host no longer exists the
// browser lands on a dead navigation with nothing to catch.
//
// That is not hypothetical. The deployed bundle is pinned to a Supabase project
// that has since been deleted: the host does not resolve, so sign-in has been
// broken for every visitor while the build, the deploy and CI all stayed green.
// A bundle is only as good as the project it names, and nothing checked that the
// project was still there.
//
// `describeSupabaseUrlProblem` covers what is knowable without the network.
// `probeProjectResponds` covers the case that actually happened, and is the
// reason this file exists: a URL can be perfectly well-formed and still name
// nothing.

/** The value `.env.example` documents. A build that inlines it has been configured with the template. */
export const PLACEHOLDER_SUPABASE_URL = 'https://your-project.supabase.co'

/** The anon-key template from the same file. */
export const PLACEHOLDER_SUPABASE_ANON_KEY = 'your-supabase-anon-key'

export type SupabaseEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

/**
 * A human-readable reason `url` cannot be baked into a production bundle, or
 * `null` when it is structurally usable.
 *
 * Structural only: it says nothing about whether the project exists. That is
 * what `probeProjectResponds` is for.
 */
export function describeSupabaseUrlProblem(url: string | undefined): string | null {
  const raw = (url ?? '').trim()
  if (!raw) {
    return 'it is empty, so the bundle ships without a Supabase client and sign-in is inert'
  }
  if (raw === PLACEHOLDER_SUPABASE_URL) {
    return `it is the .env.example template (${PLACEHOLDER_SUPABASE_URL})`
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return `it is not a URL (${raw})`
  }
  if (parsed.protocol !== 'https:') {
    return `it is not https (${parsed.protocol}//)`
  }
  if (!parsed.hostname) {
    return 'it names no host'
  }
  return null
}

/** The same, for the publishable anon key. Never returns or logs the value itself. */
export function describeSupabaseAnonKeyProblem(key: string | undefined): string | null {
  const raw = (key ?? '').trim()
  if (!raw) {
    return 'it is empty, so the bundle ships without a Supabase client and sign-in is inert'
  }
  if (raw === PLACEHOLDER_SUPABASE_ANON_KEY) {
    return 'it is the .env.example template'
  }
  return null
}

export type ProbeOutcome = { responded: true } | { responded: false; reason: string }

type ProbeOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  attempts?: number
}

/**
 * Whether the Supabase project at `url` is still there.
 *
 * Deliberately weak, and that weakness is the point: **any** HTTP response
 * counts as alive. A deleted project does not answer at all -- its hostname
 * stops resolving -- so a transport-level throw is the signal, while a 401 or
 * 404 merely means the endpoint is gated or moved and the project is fine.
 * Requiring a 200 would fail builds against healthy projects whose
 * `/auth/v1/health` wants an `apikey` header, so it is not required here and no
 * key is sent.
 *
 * One retry, because a transient blip during a deploy should not fail a build
 * that would otherwise be correct. A hostname that does not resolve fails both
 * attempts just as fast.
 */
export async function probeProjectResponds(
  url: string,
  { fetchImpl = fetch, timeoutMs = 5000, attempts = 2 }: ProbeOptions = {},
): Promise<ProbeOutcome> {
  let lastReason = 'no attempt was made'
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await fetchImpl(`${url.replace(/\/+$/, '')}/auth/v1/health`, {
        method: 'GET',
        signal: controller.signal,
      })
      return { responded: true }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(timer)
    }
  }
  return { responded: false, reason: lastReason }
}
