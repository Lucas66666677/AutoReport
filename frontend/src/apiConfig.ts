// Single source of truth for the backend origin the SPA talks to.
//
// The value is baked in at build time, so a wrong one is not recoverable at
// runtime: a production bundle built without VITE_API_URL falls back to '' and
// every call becomes same-origin. frontend/vercel.json rewrites /(.*) to
// /index.html, so those calls answer 200 with the SPA shell instead of failing
// loudly. `describeApiBaseUrlProblem` is what the build check in vite.config.ts
// uses to stop that bundle from being produced in the first place.

export const LOCAL_DEV_API_BASE_URL = 'http://localhost:8000'

export type ApiBaseUrlEnv = {
  VITE_API_URL?: string
  DEV?: boolean
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', '[0:0:0:0:0:0:0:1]'])
const IPV4_LOOPBACK_PATTERN = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return LOOPBACK_HOSTNAMES.has(host) || host.endsWith('.localhost') || IPV4_LOOPBACK_PATTERN.test(host)
}

/** Trims the configured value and drops trailing slashes so `${base}/api/x` stays well formed. */
export function normalizeApiBaseUrl(rawValue: string | undefined | null): string {
  const value = (rawValue ?? '').trim()
  if (!value) {
    return ''
  }
  return value.replace(/\/+$/, '')
}

/**
 * Describes why `rawValue` cannot serve as the production API origin, or returns
 * null when it is usable. The message is written to be read in build output.
 */
export function describeApiBaseUrlProblem(rawValue: string | undefined | null): string | null {
  const value = normalizeApiBaseUrl(rawValue)
  if (!value) {
    return 'it is missing or blank, so every API call would resolve against the frontend origin'
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `"${value}" is not an absolute URL`
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `"${value}" is not an http(s) URL`
  }
  if (isLoopbackHostname(url.hostname)) {
    return `"${value}" points at the build machine (loopback), which no visitor's browser can reach`
  }
  if (url.protocol !== 'https:') {
    return `"${value}" is not HTTPS, so an HTTPS page would refuse the request as mixed content`
  }
  if (url.search || url.hash) {
    return `"${value}" carries a query string or fragment, which breaks request paths appended to it`
  }

  return null
}

/**
 * Resolves the API origin for the running app. Development keeps the local
 * backend fallback; production uses only what the build was given, which the
 * build check has already vetted.
 */
export function resolveApiBaseUrl(env: ApiBaseUrlEnv): string {
  const configured = normalizeApiBaseUrl(env.VITE_API_URL)
  if (configured) {
    return configured
  }
  return env.DEV ? LOCAL_DEV_API_BASE_URL : ''
}
