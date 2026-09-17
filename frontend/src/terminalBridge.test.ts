import { describe, expect, it, vi } from 'vitest'
import {
  BridgeRequestError,
  DEFAULT_BRIDGE_PORT,
  PRODUCTION_ORIGIN,
  bridgeSetupCommands,
  bridgeUrl,
  fetchBridgeStatus,
  loadBridgeConnection,
  pairWithBridge,
  queryLocalNetworkPermission,
  runOnBridge,
  saveBridgeConnection,
} from './terminalBridge'

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const STATUS = {
  app: 'autolabreport-bridge',
  protocol: 1,
  version: '1.0.0',
  paired: false,
  pairingLocked: false,
  clis: [{ id: 'claude', label: 'Claude Code', available: true, enabled: true, signedIn: true, note: '' }],
}

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

describe('bridgeUrl', () => {
  // localhost can resolve to ::1 first, and the bridge listens on IPv4 only.
  it('addresses the bridge by IPv4 loopback', () => {
    expect(bridgeUrl(47632, '/status')).toBe('http://127.0.0.1:47632/status')
  })
})

describe('fetchBridgeStatus', () => {
  it('returns the status and sends the saved token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { ...STATUS, paired: true }))
    const status = await fetchBridgeStatus(47632, 'tok', fetchImpl)
    expect(status?.paired).toBe(true)
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok' })
  })

  // Not running, or the browser declined to let the page reach this computer.
  it('reports null when nothing answers', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchBridgeStatus(47632, null, fetchImpl)).toBeNull()
  })

  it('does not mistake some other local server for the bridge', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { hello: 'world' }))
    expect(await fetchBridgeStatus(47632, null, fetchImpl)).toBeNull()
  })
})

describe('pairWithBridge', () => {
  it('returns the token for the right code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { token: 'abc' }))
    await expect(pairWithBridge(47632, 'ABCD-EFGH', fetchImpl)).resolves.toBe('abc')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ code: 'ABCD-EFGH' })
  })

  it('passes on the bridge’s own words for a wrong or locked code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(423, { error: '配對已鎖定' }))
    await expect(pairWithBridge(47632, 'x', fetchImpl)).rejects.toMatchObject({ status: 423, message: '配對已鎖定' })
  })
})

describe('runOnBridge', () => {
  it('sends the prompt with the token and returns the answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { text: '答案', cli: 'claude', ms: 1200 }))
    await expect(runOnBridge(47632, 'tok', 'claude', 'prompt', undefined, fetchImpl)).resolves.toBe('答案')
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ cli: 'claude', prompt: 'prompt' })
  })

  it('keeps the status, so a restarted bridge (401) can send the student back to pairing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, { error: '尚未配對' }))
    const failure = await runOnBridge(47632, 'old', 'claude', 'p', undefined, fetchImpl).catch((error) => error)
    expect(failure).toBeInstanceOf(BridgeRequestError)
    expect(failure.status).toBe(401)
  })

  it('names an empty answer rather than returning it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { text: '  ' }))
    await expect(runOnBridge(47632, 'tok', 'claude', 'p', undefined, fetchImpl)).rejects.toThrow('沒有回傳內容')
  })
})

describe('queryLocalNetworkPermission', () => {
  const permissionsWith = (states: Record<string, PermissionState>) => ({
    query: vi.fn(async ({ name }: { name: string }) => {
      if (!(name in states)) throw new TypeError(`unknown permission ${name}`)
      return { state: states[name] } as PermissionStatus
    }),
  })

  // The case that looked like "not running" in the embedded Chromium.
  it('reports denied when the browser blocks this page from the computer', async () => {
    await expect(queryLocalNetworkPermission(permissionsWith({ 'local-network-access': 'denied' }))).resolves.toBe('denied')
  })

  it('lets the most restrictive spelling win', async () => {
    const permissions = permissionsWith({ 'local-network-access': 'granted', 'loopback-network': 'denied' })
    await expect(queryLocalNetworkPermission(permissions)).resolves.toBe('denied')
  })

  it('reports a pending prompt', async () => {
    await expect(queryLocalNetworkPermission(permissionsWith({ 'local-network': 'prompt' }))).resolves.toBe('prompt')
  })

  it('reports unknown in browsers without the permission at all', async () => {
    await expect(queryLocalNetworkPermission(permissionsWith({}))).resolves.toBe('unknown')
    await expect(queryLocalNetworkPermission(undefined)).resolves.toBe('unknown')
  })
})

describe('the saved pairing', () => {
  it('round-trips the port and token', () => {
    const storage = memoryStorage()
    saveBridgeConnection({ port: 48000, token: 'tok' }, storage)
    expect(loadBridgeConnection(storage)).toEqual({ port: 48000, token: 'tok' })
  })

  it('falls back to the default port when nothing valid is saved', () => {
    const storage = memoryStorage()
    storage.setItem('autolabreport-terminal-bridge', '{"port":80,"token":""}')
    expect(loadBridgeConnection(storage)).toEqual({ port: DEFAULT_BRIDGE_PORT, token: null })
    storage.setItem('autolabreport-terminal-bridge', 'not json')
    expect(loadBridgeConnection(storage)).toEqual({ port: DEFAULT_BRIDGE_PORT, token: null })
  })

  it('survives storage that throws, as in a private window', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(loadBridgeConnection(throwing)).toEqual({ port: DEFAULT_BRIDGE_PORT, token: null })
    expect(() => saveBridgeConnection({ port: DEFAULT_BRIDGE_PORT, token: 't' }, throwing)).not.toThrow()
  })
})

describe('bridgeSetupCommands', () => {
  it('downloads from production and starts with no extra flags there', () => {
    const { windows, unix } = bridgeSetupCommands(PRODUCTION_ORIGIN)
    expect(windows).toBe(
      'irm https://autolabreport.lucirel.com/bridge/autolabreport-bridge.mjs -OutFile autolabreport-bridge.mjs; node autolabreport-bridge.mjs',
    )
    expect(unix).toBe(
      'curl -fsSLo autolabreport-bridge.mjs https://autolabreport.lucirel.com/bridge/autolabreport-bridge.mjs && node autolabreport-bridge.mjs',
    )
  })

  // The bridge refuses every page but production unless told otherwise.
  it('names any other page origin, so local development can pair', () => {
    expect(bridgeSetupCommands('http://127.0.0.1:5173').unix).toContain('--allow-origin http://127.0.0.1:5173')
  })

  it('passes a non-default port along', () => {
    expect(bridgeSetupCommands(PRODUCTION_ORIGIN, 48000).windows).toContain('--port 48000')
  })
})
