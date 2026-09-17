// @vitest-environment node
//
// The terminal bridge runs on a student's computer and starts programs there on behalf of
// a web page. Most of these tests are about who can make it do that: another website, a
// domain rebound to 127.0.0.1, a page that is not paired, or a prompt trying to smuggle
// in command-line flags. The rest check that a run behaves -- input, output, failure,
// timeout, cleanup.
//
// The CLI under test is a fake, but it is a real executable on disk -- a .cmd shim on
// Windows, a shebang script elsewhere -- so the bridge spawns it exactly as it would
// spawn Claude Code.

import { chmod, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ADAPTERS,
  MAX_BODY_BYTES,
  MAX_PAIRING_FAILURES,
  buildSpawn,
  createBridgeServer,
  formatPairingCode,
  parseArguments,
  parseGeminiJson,
  resolveExecutable,
  runCli,
  stopAllRuns,
  stripAnsi,
} from '../public/bridge/autolabreport-bridge.mjs'

const ORIGIN = 'https://autolabreport.lucirel.com'
const isWindows = process.platform === 'win32'

// Reads the prompt from stdin and decides what to do from a marker in it.
const FAKE_CLI = `
const chunks = []
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  const stdin = Buffer.concat(chunks).toString('utf8')
  const report = JSON.stringify({ args: process.argv.slice(2), stdin, cwd: process.cwd(), files: require('fs').readdirSync(process.cwd()) })
  if (stdin.includes('MODE:fail')) { process.stderr.write('\\u001b[31mnot signed in\\u001b[0m\\nplease run login\\n'); process.exit(3) }
  if (stdin.includes('MODE:slow')) { setTimeout(() => process.stdout.write(report), 60000); return }
  if (stdin.includes('MODE:gemini')) { process.stdout.write('Loaded cached credentials.\\n' + JSON.stringify({ response: '來自 Gemini 的答案' })); return }
  if (stdin.includes('MODE:empty')) { return }
  process.stdout.write('\\u001b[1m' + report + '\\u001b[0m')
})
`

let fakeDir
let fakeExecutable

async function freePort() {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function call(port, { method = 'GET', pathname = '/status', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: {
          Host: host ?? `127.0.0.1:${port}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = null
          }
          resolve({ status: res.statusCode, headers: res.headers, json })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function startBridge({ clis } = {}) {
  const port = await freePort()
  const bridge = createBridgeServer({
    port,
    clis: clis ?? [
      { adapter: ADAPTERS.claude, executable: fakeExecutable, enabled: true, signedIn: true },
      { adapter: ADAPTERS.codex, executable: fakeExecutable, enabled: false, signedIn: null },
      { adapter: ADAPTERS.gemini, executable: null, enabled: false, signedIn: null },
    ],
  })
  await new Promise((resolve) => bridge.server.listen(port, '127.0.0.1', resolve))
  return { ...bridge, port, close: () => new Promise((resolve) => bridge.server.close(resolve)) }
}

beforeAll(async () => {
  fakeDir = await mkdtemp(path.join(tmpdir(), 'bridge-fake-cli-'))
  await writeFile(path.join(fakeDir, 'fake-cli.cjs'), FAKE_CLI)
  if (isWindows) {
    fakeExecutable = path.join(fakeDir, 'claude.cmd')
    await writeFile(fakeExecutable, `@node "%~dp0fake-cli.cjs" %*\r\n`)
  } else {
    fakeExecutable = path.join(fakeDir, 'claude')
    await writeFile(fakeExecutable, `#!/usr/bin/env node\n${FAKE_CLI}`)
    await chmod(fakeExecutable, 0o755)
  }
})

afterAll(async () => {
  await rm(fakeDir, { recursive: true, force: true })
})

describe('who can reach the bridge', () => {
  it('refuses a request addressed to another host name, which is how DNS rebinding arrives', async () => {
    const bridge = await startBridge()
    try {
      const res = await call(bridge.port, { host: `evil.example:${bridge.port}`, headers: { Origin: ORIGIN } })
      expect(res.status).toBe(403)
    } finally {
      await bridge.close()
    }
  })

  it('refuses another website and gives it no CORS permission', async () => {
    const bridge = await startBridge()
    try {
      const res = await call(bridge.port, { headers: { Origin: 'https://evil.example' } })
      expect(res.status).toBe(403)
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    } finally {
      await bridge.close()
    }
  })

  it('answers AutoLabReport’s preflight, including Chrome’s local-network check', async () => {
    const bridge = await startBridge()
    try {
      const res = await call(bridge.port, {
        method: 'OPTIONS',
        pathname: '/run',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
          'Access-Control-Request-Private-Network': 'true',
        },
      })
      expect(res.status).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
      expect(res.headers['access-control-allow-headers']).toContain('Authorization')
      expect(res.headers['access-control-allow-private-network']).toBe('true')
    } finally {
      await bridge.close()
    }
  })

  it('will not pair with a caller that is not the AutoLabReport page', async () => {
    const bridge = await startBridge()
    try {
      const res = await call(bridge.port, { method: 'POST', pathname: '/pair', body: { code: bridge.pairingCode } })
      expect(res.status).toBe(403)
    } finally {
      await bridge.close()
    }
  })
})

describe('pairing', () => {
  it('reports which CLIs exist, which are on, and what each can do, before pairing', async () => {
    const bridge = await startBridge()
    try {
      const res = await call(bridge.port, { headers: { Origin: ORIGIN } })
      expect(res.status).toBe(200)
      expect(res.json.paired).toBe(false)
      const byId = Object.fromEntries(res.json.clis.map((cli) => [cli.id, cli]))
      expect(byId.claude).toMatchObject({ available: true, enabled: true })
      expect(byId.codex).toMatchObject({ available: true, enabled: false })
      expect(byId.gemini).toMatchObject({ available: false, enabled: false })
      expect(byId.codex.note).toContain('讀取')
    } finally {
      await bridge.close()
    }
  })

  it('accepts the code as printed, with or without the dash and in any case', async () => {
    const bridge = await startBridge()
    try {
      const typed = formatPairingCode(bridge.pairingCode).toLowerCase()
      const res = await call(bridge.port, { method: 'POST', pathname: '/pair', headers: { Origin: ORIGIN }, body: { code: typed } })
      expect(res.status).toBe(200)
      expect(res.json.token).toBe(bridge.token)

      const status = await call(bridge.port, { headers: { Origin: ORIGIN, Authorization: `Bearer ${res.json.token}` } })
      expect(status.json.paired).toBe(true)
    } finally {
      await bridge.close()
    }
  })

  it('locks pairing after repeated wrong codes, so the code cannot be guessed', async () => {
    const bridge = await startBridge()
    try {
      for (let attempt = 0; attempt < MAX_PAIRING_FAILURES; attempt += 1) {
        const wrong = await call(bridge.port, { method: 'POST', pathname: '/pair', headers: { Origin: ORIGIN }, body: { code: 'AAAAAAAA' } })
        expect(wrong.status).toBe(401)
      }
      const right = await call(bridge.port, { method: 'POST', pathname: '/pair', headers: { Origin: ORIGIN }, body: { code: bridge.pairingCode } })
      expect(right.status).toBe(423)
    } finally {
      await bridge.close()
    }
  })
})

describe('running a CLI', () => {
  const run = (bridge, body, token = bridge.token) =>
    call(bridge.port, {
      method: 'POST',
      pathname: '/run',
      headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    })

  it('refuses to run anything for a page that has not paired', async () => {
    const bridge = await startBridge()
    try {
      expect((await run(bridge, { cli: 'claude', prompt: 'hi' }, null)).status).toBe(401)
      expect((await run(bridge, { cli: 'claude', prompt: 'hi' }, 'not-the-token')).status).toBe(401)
    } finally {
      await bridge.close()
    }
  })

  it('sends the prompt only on stdin, with the fixed no-tools arguments, in an empty folder it deletes', async () => {
    const bridge = await startBridge()
    try {
      const res = await run(bridge, { cli: 'claude', prompt: '請整理這份報告：12 V' })
      expect(res.status).toBe(200)
      const seen = JSON.parse(res.json.text)

      expect(seen.stdin).toBe('請整理這份報告：12 V')
      expect(seen.args).toEqual(ADAPTERS.claude.args)
      expect(seen.args.slice(-2)).toEqual(['--disallowedTools', '*'])
      expect(seen.files).toEqual([])
      await expect(stat(seen.cwd)).rejects.toThrow()
    } finally {
      await bridge.close()
    }
  })

  // The prompt comes from a web page: it must never become part of a command line.
  it('keeps a prompt that looks like flags or shell syntax out of the command line', async () => {
    const bridge = await startBridge()
    try {
      const hostile = '--dangerously-skip-permissions" & calc.exe & echo "\n$(rm -rf ~)\n`whoami`'
      const res = await run(bridge, { cli: 'claude', prompt: hostile })
      expect(res.status).toBe(200)
      const seen = JSON.parse(res.json.text)
      expect(seen.args).toEqual(ADAPTERS.claude.args)
      expect(seen.stdin).toBe(hostile)
    } finally {
      await bridge.close()
    }
  })

  it('strips terminal colour codes from the answer', async () => {
    const bridge = await startBridge()
    try {
      const res = await run(bridge, { cli: 'claude', prompt: 'plain' })
      expect(res.json.text).not.toContain('\u001b')
    } finally {
      await bridge.close()
    }
  })

  it('refuses a CLI that is installed but not switched on', async () => {
    const bridge = await startBridge()
    try {
      const res = await run(bridge, { cli: 'codex', prompt: 'hi' })
      expect(res.status).toBe(403)
      expect(res.json.error).toContain('--enable codex')
    } finally {
      await bridge.close()
    }
  })

  it('refuses a CLI that is not installed, and one it has never heard of', async () => {
    const bridge = await startBridge()
    try {
      expect((await run(bridge, { cli: 'gemini', prompt: 'hi' })).status).toBe(404)
      expect((await run(bridge, { cli: 'bash', prompt: 'hi' })).status).toBe(404)
    } finally {
      await bridge.close()
    }
  })

  it('reports a failing CLI with the end of what it printed, minus colour codes', async () => {
    const bridge = await startBridge()
    try {
      const res = await run(bridge, { cli: 'claude', prompt: 'MODE:fail' })
      expect(res.status).toBe(502)
      expect(res.json.error).toContain('please run login')
      expect(res.json.error).not.toContain('\u001b')
    } finally {
      await bridge.close()
    }
  })

  it('says so when a CLI prints nothing', async () => {
    const bridge = await startBridge()
    try {
      const res = await run(bridge, { cli: 'claude', prompt: 'MODE:empty' })
      expect(res.status).toBe(502)
      expect(res.json.error).toContain('沒有輸出')
    } finally {
      await bridge.close()
    }
  })

  it('runs one task at a time', async () => {
    const bridge = await startBridge()
    try {
      const slow = run(bridge, { cli: 'claude', prompt: 'MODE:slow' })
      await new Promise((resolve) => setTimeout(resolve, 400))
      const second = await run(bridge, { cli: 'claude', prompt: 'hi' })
      expect(second.status).toBe(409)
      // Leaving the page stops the slow run; wait until the bridge has finished tidying up.
      bridge.server.closeAllConnections?.()
      await slow.catch(() => {})
      for (let waited = 0; bridge.state.running && waited < 100; waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(bridge.state.running).toBe(false)
    } finally {
      await bridge.close()
    }
  })

  it('answers an oversized request with a readable 413', async () => {
    const bridge = await startBridge()
    try {
      const res = await call(bridge.port, {
        method: 'POST',
        pathname: '/run',
        headers: { Origin: ORIGIN, Authorization: `Bearer ${bridge.token}` },
        body: JSON.stringify({ cli: 'claude', prompt: 'x'.repeat(MAX_BODY_BYTES + 10) }),
      })
      expect(res.status).toBe(413)
    } finally {
      await bridge.close()
    }
  })
})

describe('runCli', () => {
  it('stops a CLI that runs past the time limit and cleans up its folder', async () => {
    const before = new Set(await readdir(tmpdir()))
    const started = Date.now()
    await expect(
      runCli({ adapter: ADAPTERS.claude, executable: fakeExecutable, prompt: 'MODE:slow', timeoutMs: 800 }),
    ).rejects.toMatchObject({ status: 504 })
    expect(Date.now() - started).toBeLessThan(10000)
    const leftover = (await readdir(tmpdir())).filter((name) => name.startsWith('autolabreport-bridge-') && !before.has(name))
    expect(leftover).toEqual([])
  })

  it('stops every run and removes its folder when the bridge is shut down', async () => {
    const before = new Set(await readdir(tmpdir()))
    const pending = runCli({ adapter: ADAPTERS.claude, executable: fakeExecutable, prompt: 'MODE:slow' })
    pending.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 400))
    await stopAllRuns()
    const leftover = (await readdir(tmpdir())).filter((name) => name.startsWith('autolabreport-bridge-') && !before.has(name))
    expect(leftover).toEqual([])
  })

  it('stops the CLI when the page goes away', async () => {
    const controller = new AbortController()
    const pending = runCli({ adapter: ADAPTERS.claude, executable: fakeExecutable, prompt: 'MODE:slow', signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    await expect(pending).rejects.toMatchObject({ status: 499 })
  })

  it('reads Gemini CLI’s answer out of its JSON, past any log lines', async () => {
    const answer = await runCli({ adapter: ADAPTERS.gemini, executable: fakeExecutable, prompt: 'MODE:gemini' })
    expect(answer).toBe('來自 Gemini 的答案')
  })
})

describe('helpers', () => {
  it('parses Gemini JSON and names a missing answer', () => {
    expect(parseGeminiJson('log\n{"response":"ok"}')).toBe('ok')
    expect(() => parseGeminiJson('{"error":{"message":"quota"}}')).toThrow('quota')
    expect(() => parseGeminiJson('no json here')).toThrow()
  })

  it('removes colour and cursor codes', () => {
    expect(stripAnsi('\u001b[1m粗\u001b[0m \u001b[2K')).toBe('粗 ')
  })

  it('starts a Windows .cmd shim through cmd.exe with every argument quoted', () => {
    const launch = buildSpawn('C:\\Program Files\\npm\\claude.cmd', ADAPTERS.claude.args, 'win32', 'C:\\Windows\\system32\\cmd.exe')
    expect(launch.file).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(launch.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(launch.args[3]).toContain('"C:\\Program Files\\npm\\claude.cmd"')
    expect(launch.args[3]).toContain('--disallowedTools "*"')
    expect(launch.options.windowsVerbatimArguments).toBe(true)
  })

  it('refuses to hand cmd.exe an argument it could read as a command', () => {
    expect(() => buildSpawn('C:\\npm\\claude.cmd', ['a & calc'], 'win32')).toThrow()
  })

  it('starts a real executable directly, without a shell', () => {
    expect(buildSpawn('/usr/local/bin/claude', ['-p'], 'linux')).toEqual({ file: '/usr/local/bin/claude', args: ['-p'], options: {} })
  })

  it('finds a CLI on PATH, using PATHEXT on Windows', async () => {
    const env = isWindows
      ? { PATH: `C:\\nowhere;${fakeDir}`, PATHEXT: '.EXE;.CMD' }
      : { PATH: `/nowhere:${fakeDir}` }
    expect(await resolveExecutable('claude', { env })).toBe(fakeExecutable)
    expect(await resolveExecutable('definitely-not-installed', { env })).toBeNull()
  })

  it('parses the command line and rejects what it does not understand', () => {
    const options = parseArguments(['--enable', 'codex,Gemini', '--port', '48000', '--allow-origin', 'http://localhost:5173'])
    expect([...options.enable]).toEqual(['codex', 'gemini'])
    expect(options.port).toBe(48000)
    expect(options.origins).toContain('http://localhost:5173')

    expect(() => parseArguments(['--enable', 'bash'])).toThrow()
    expect(() => parseArguments(['--port', '80'])).toThrow()
    expect(() => parseArguments(['--allow-origin', 'http://localhost:5173/app'])).toThrow()
    expect(() => parseArguments(['--yolo'])).toThrow()
  })
})
