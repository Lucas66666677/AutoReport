// Single source of truth for the backend origin the SPA talks to.
//
// The value is baked in at build time, so a wrong one is not recoverable at
// runtime: a production bundle built without VITE_API_URL falls back to '' and
// every call becomes same-origin. frontend/vercel.json rewrites /(.*) to
// /index.html, so those calls answer 200 with the SPA shell instead of failing
// loudly. `describeApiBaseUrlProblem` is what the build check in vite.config.ts
// uses to stop that bundle from being produced in the first place.

export const LOCAL_DEV_API_BASE_URL = 'http://localhost:8000'

/**
 * The public origin this SPA is served from -- the same origin the API names as
 * `PRODUCTION_ORIGIN` and allows through CORS. `backend/tests/test_release_preflight.py`
 * pins the two literals together, because nothing else compares them.
 *
 * It is here so the API origin can be rejected for *being* it. A build given
 * this value produces same-origin `/api/...` calls, which never reach CORS at
 * all: the catch-all rewrite in frontend/vercel.json answers them 200 with the
 * app shell, so `res.ok` is true and the HTML only fails later, as a parse error.
 */
export const PUBLIC_SITE_ORIGIN = 'https://auto-report-one.vercel.app'

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

const IPV4_LITERAL_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Returns the four octets of a dotted-quad literal, or null when the host is a name. */
function parseIpv4Octets(host: string): number[] | null {
  const match = IPV4_LITERAL_PATTERN.exec(host)
  if (!match) {
    return null
  }
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

/** True for IPv4 space that never routes on the public internet: RFC 1918, RFC 6598 CGNAT, RFC 3927 link-local, 0.0.0.0/8. */
function isPrivateIpv4(octets: number[]): boolean {
  const [first, second] = octets
  return (
    first === 0 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  )
}

/**
 * Expands a bracketless IPv6 literal into its eight hextets, or null when the
 * host is not one. `URL` has already normalised the literal, so every group is
 * hexadecimal -- an embedded dotted quad arrives as `::ffff:c0a8:1`, not `::ffff:192.168.0.1`.
 */
function parseIpv6Hextets(host: string): number[] | null {
  const halves = host.split('::')
  if (halves.length > 2) {
    return null
  }
  const toHextets = (half: string): number[] | null => {
    if (half === '') {
      return []
    }
    const groups = half.split(':')
    if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
      return null
    }
    return groups.map((group) => parseInt(group, 16))
  }
  const head = toHextets(halves[0])
  const tail = halves.length === 2 ? toHextets(halves[1]) : []
  if (!head || !tail) {
    return null
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null
  }
  const missing = 8 - head.length - tail.length
  return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : null
}

/** True for IPv6 space that never routes on the public internet: fc00::/7 unique-local, fe80::/10 link-local, `::`, and IPv4-mapped private or loopback addresses. */
function isPrivateIpv6(hextets: number[]): boolean {
  const first = hextets[0]
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) {
    return true
  }
  if (hextets.every((hextet) => hextet === 0)) {
    return true
  }
  if (hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff) {
    const mapped = [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff]
    return mapped[0] === 127 || isPrivateIpv4(mapped)
  }
  return false
}

/**
 * True when the host is an address literal that only resolves inside a private
 * network -- a LAN backend, a VPN peer or a container address. Unlike loopback
 * it can answer from the build machine, so a bad value looks healthy there and
 * is unreachable for every visitor.
 */
function isPrivateNetworkHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  const octets = parseIpv4Octets(host)
  if (octets) {
    return isPrivateIpv4(octets)
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    const hextets = parseIpv6Hextets(host.slice(1, -1))
    return hextets ? isPrivateIpv6(hextets) : false
  }
  return false
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
  if (isPrivateNetworkHostname(url.hostname)) {
    return `"${value}" points at a private network address, which no visitor's browser can reach`
  }
  if (url.protocol !== 'https:') {
    return `"${value}" is not HTTPS, so an HTTPS page would refuse the request as mixed content`
  }
  if (url.origin === PUBLIC_SITE_ORIGIN) {
    return `"${value}" is the origin this site is served from, so the SPA fallback would answer API calls with the app shell`
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
