// Talking to the terminal bridge (public/bridge/autolabreport-bridge.mjs), which a
// student runs on their own computer to hand AI tasks to a CLI they are signed in to --
// Claude Code, Codex or Gemini CLI -- instead of copying prompts by hand.
//
// The bridge is a plain pipe: prompt in, answer text out. Prompts are built and answers
// checked exactly as for copy and paste (aiHandoff.ts), so a terminal answer meets the
// same rules as any other.

export const BRIDGE_PROTOCOL = 1
export const DEFAULT_BRIDGE_PORT = 47632
export const PRODUCTION_ORIGIN = 'https://autolabreport.lucirel.com'
export const BRIDGE_SCRIPT_PATH = '/bridge/autolabreport-bridge.mjs'

export type BridgeCli = {
  id: string
  label: string
  available: boolean
  enabled: boolean
  signedIn: boolean | null
  note: string
}

export type BridgeStatus = {
  app: string
  protocol: number
  version: string
  paired: boolean
  pairingLocked: boolean
  clis: BridgeCli[]
}

export class BridgeRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// 127.0.0.1 rather than localhost: localhost can resolve to ::1 first, and the bridge
// listens on IPv4 only.
export function bridgeUrl(port: number, pathname: string): string {
  return `http://127.0.0.1:${port}${pathname}`
}

async function readError(response: Response, fallback: string): Promise<BridgeRequestError> {
  try {
    const payload = (await response.json()) as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error) return new BridgeRequestError(response.status, payload.error)
  } catch {
    // Not JSON.
  }
  return new BridgeRequestError(response.status, `${fallback}（HTTP ${response.status}）`)
}

/**
 * The bridge's status, or null when nothing answers -- it is not running, or the browser
 * blocked the request (Chrome asks before a page may reach this computer's addresses).
 */
export async function fetchBridgeStatus(
  port: number,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<BridgeStatus | null> {
  let response: Response
  try {
    response = await fetchImpl(bridgeUrl(port, '/status'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const payload = (await response.json()) as Partial<BridgeStatus>
  if (payload.app !== 'autolabreport-bridge' || !Array.isArray(payload.clis)) return null
  return payload as BridgeStatus
}

export async function pairWithBridge(port: number, code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(bridgeUrl(port, '/pair'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) throw await readError(response, '配對失敗')
  const { token } = (await response.json()) as { token?: unknown }
  if (typeof token !== 'string' || !token) throw new BridgeRequestError(502, '配對失敗：bridge 沒有回傳憑證')
  return token
}

export async function runOnBridge(
  port: number,
  token: string,
  cli: string,
  prompt: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(bridgeUrl(port, '/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cli, prompt }),
    signal,
  })
  if (!response.ok) throw await readError(response, '執行失敗')
  const { text } = (await response.json()) as { text?: unknown }
  if (typeof text !== 'string' || !text.trim()) throw new BridgeRequestError(502, 'CLI 沒有回傳內容')
  return text
}

// --- Chrome's Local Network Access -------------------------------------------------

export type LocalNetworkPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

// Spellings Chromium has used for the permission. Measured on 2026-09-17 in an embedded
// Chromium: `local-network-access` is queryable and reported 'denied'. The others are
// asked too, so a later split of loopback into its own permission is still caught.
const LOCAL_NETWORK_PERMISSION_NAMES = ['local-network-access', 'loopback-network', 'local-network']

/**
 * Whether the browser lets this page reach addresses on the student's own computer.
 *
 * 'denied' is the case worth spotting. The bridge can be running perfectly and the
 * browser still refuses to reach it -- measured in that Chromium: `Failed to fetch`,
 * `net::ERR_BLOCKED_BY_CLIENT`, and the bridge never saw a request -- which otherwise
 * looks exactly like "not running" and sends the student off to reinstall it.
 * The most restrictive answer wins.
 */
export async function queryLocalNetworkPermission(
  permissions: Pick<Permissions, 'query'> | undefined = globalThis.navigator?.permissions,
): Promise<LocalNetworkPermission> {
  if (!permissions?.query) return 'unknown'
  const states: string[] = []
  for (const name of LOCAL_NETWORK_PERMISSION_NAMES) {
    try {
      states.push((await permissions.query({ name } as unknown as PermissionDescriptor)).state)
    } catch {
      // Not a permission this browser knows.
    }
  }
  if (states.includes('denied')) return 'denied'
  if (states.includes('prompt')) return 'prompt'
  if (states.includes('granted')) return 'granted'
  return 'unknown'
}

// --- Remembering the pairing -------------------------------------------------------
// The token only works until the bridge restarts, and localStorage can be unavailable
// (private windows, blocked site data), so every access is best-effort.

const STORAGE_KEY = 'autolabreport-terminal-bridge'

export type BridgeConnection = { port: number; token: string | null }

export function loadBridgeConnection(storage: Storage | undefined = globalThis.localStorage): BridgeConnection {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as Partial<BridgeConnection> | null
    const port = Number(saved?.port)
    return {
      port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_BRIDGE_PORT,
      token: typeof saved?.token === 'string' && saved.token ? saved.token : null,
    }
  } catch {
    return { port: DEFAULT_BRIDGE_PORT, token: null }
  }
}

export function saveBridgeConnection(connection: BridgeConnection, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(connection))
  } catch {
    // Pairing again next time is the only cost.
  }
}

/**
 * What to paste into a terminal to download and start the bridge. A page served from
 * anywhere but production (local development) has to be named with --allow-origin, or
 * the bridge would refuse it.
 */
export function bridgeSetupCommands(pageOrigin: string, port: number = DEFAULT_BRIDGE_PORT): { windows: string; unix: string } {
  const scriptUrl = `${pageOrigin}${BRIDGE_SCRIPT_PATH}`
  const extra = [
    pageOrigin === PRODUCTION_ORIGIN ? '' : ` --allow-origin ${pageOrigin}`,
    port === DEFAULT_BRIDGE_PORT ? '' : ` --port ${port}`,
  ].join('')
  return {
    windows: `irm ${scriptUrl} -OutFile autolabreport-bridge.mjs; node autolabreport-bridge.mjs${extra}`,
    unix: `curl -fsSLo autolabreport-bridge.mjs ${scriptUrl} && node autolabreport-bridge.mjs${extra}`,
  }
}
