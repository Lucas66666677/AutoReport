#!/usr/bin/env node
// AutoLabReport terminal bridge.
//
// Lets AutoLabReport, open in your browser, hand an AI task to an AI command-line tool
// you are already signed in to on this computer -- Claude Code, Codex or Gemini CLI --
// and get the answer back, using your own subscription.
//
//   node autolabreport-bridge.mjs                  start (Claude Code only)
//   node autolabreport-bridge.mjs --enable codex   also allow Codex
//   node autolabreport-bridge.mjs --help           every option
//
// This program answers requests from a web page and starts programs on your computer,
// so it is deliberately narrow:
//
// - It listens on 127.0.0.1 only; nothing on your network can reach it.
// - It answers only pages from https://autolabreport.lucirel.com (the Origin header),
//   and only requests addressed to 127.0.0.1 or localhost (the Host header), which stops
//   another site from reaching it by pointing its own domain at your computer.
// - Before it runs anything, the page must be paired using the code this program prints
//   in your terminal. Repeated wrong codes lock pairing until you restart it.
// - It runs only the three tools above, with arguments fixed in this file. The page
//   sends the prompt as input, never as part of a command, so nothing it sends can
//   change what gets run.
// - Each run happens in a new empty folder that is deleted afterwards.
// - Claude Code runs with every tool removed, so it can only write text. Codex and
//   Gemini CLI cannot be restricted that far -- in their safe modes they may still read
//   files on this computer -- so they stay off unless you turn them on with --enable.
// - It never prints or stores your prompts or the answers.
//
// Needs Node.js 18 or later. No packages to install.

import { spawn } from 'node:child_process'
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROTOCOL = 1
export const VERSION = '1.0.0'
export const DEFAULT_PORT = 47632
export const DEFAULT_ORIGINS = ['https://autolabreport.lucirel.com']

export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const MAX_PROMPT_CHARS = 800_000
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
export const RUN_TIMEOUT_MS = 5 * 60 * 1000
export const MAX_PAIRING_FAILURES = 8

// Passed as the command-line prompt; the real prompt arrives on standard input. Plain
// ASCII on purpose: it has to survive cmd.exe quoting and every Windows code page.
const STDIN_INSTRUCTION = 'Follow the instructions given on standard input. Output only what they ask for.'

export const ADAPTERS = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    enabledByDefault: true,
    note: '已關閉所有工具：只產生文字，不會讀寫你電腦上的檔案。',
    // Per the Claude Code CLI reference: `--disallowedTools "*"` removes every tool, MCP
    // tools included, from the model's context. It takes a list, so it goes last.
    // `--permission-mode default` overrides a settings file that sets a looser mode.
    args: [
      '-p',
      STDIN_INSTRUCTION,
      '--output-format',
      'text',
      '--no-session-persistence',
      '--permission-mode',
      'default',
      '--disallowedTools',
      '*',
    ],
    parse: (stdout) => stdout,
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    enabledByDefault: false,
    note: '唯讀沙盒：不能修改檔案或執行指令，但 Codex 仍可能讀取你電腦上的檔案。',
    // `exec -` reads the whole prompt from standard input, and exec prints only the
    // final message to stdout (progress goes to stderr).
    args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'],
    parse: (stdout) => stdout,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    enabledByDefault: false,
    note: '需要核准的工具會被拒絕，但 Gemini CLI 仍可能讀取你電腦上的檔案。',
    // `-p` forces headless mode and is appended to standard input; with JSON output the
    // answer is the `response` field.
    args: ['--output-format', 'json', '--approval-mode', 'default', '-p', STDIN_INSTRUCTION],
    parse: parseGeminiJson,
  },
}

export class BridgeError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ---------------------------------------------------------------------------------
// Output handling

const ANSI = /\[[0-9;?]*[ -/]*[@-~]|\][^]*(|\\)/g

export function stripAnsi(text) {
  return text.replace(ANSI, '')
}

export function parseGeminiJson(stdout) {
  // Gemini CLI can log a line or two before the JSON; take the outermost object.
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) throw new BridgeError(502, 'Gemini CLI 回傳的內容不是預期的 JSON。')
  let payload
  try {
    payload = JSON.parse(stdout.slice(start, end + 1))
  } catch {
    throw new BridgeError(502, 'Gemini CLI 回傳的內容不是預期的 JSON。')
  }
  if (typeof payload.response !== 'string') {
    const detail = typeof payload.error?.message === 'string' ? `：${payload.error.message}` : ''
    throw new BridgeError(502, `Gemini CLI 沒有回傳答案${detail}`)
  }
  return payload.response
}

// ---------------------------------------------------------------------------------
// Finding and starting the tools

/** The full path of `command` on PATH, or null. On Windows this honours PATHEXT. */
export async function resolveExecutable(command, { env = process.env, platform = process.platform } = {}) {
  const pathValue = env.PATH ?? env.Path ?? ''
  const directories = pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean)
  const extensions =
    platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension.toLowerCase())
      try {
        await access(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
        return candidate
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null
}

function quoteForCmd(value) {
  if (/^[A-Za-z0-9_\-.:\\/=]+$/.test(value)) return value
  // Every argument comes from ADAPTERS or a PATH lookup, never from a request, so this
  // should be unreachable; refuse rather than guess how cmd.exe would read it.
  if (/["%^&|<>!\r\n]/.test(value)) throw new BridgeError(500, '拒絕把含有特殊字元的參數交給 cmd.exe。')
  return `"${value}"`
}

/**
 * How to start `executable`. npm installs CLIs on Windows as .cmd shims, which Node
 * will not start without a shell (CVE-2024-27980); cmd.exe is used for exactly those.
 */
export function buildSpawn(executable, args, platform = process.platform, comspec = process.env.ComSpec) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const line = [executable, ...args].map(quoteForCmd).join(' ')
    return {
      file: comspec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      options: { windowsVerbatimArguments: true },
    }
  }
  return { file: executable, args, options: {} }
}

// Every CLI currently running and the folder it runs in, so stopping the bridge stops
// them and removes the folders. On macOS and Linux a CLI runs in its own process group,
// which would otherwise outlive this process.
const runningChildren = new Set()
const liveWorkdirs = new Set()

/** Stop every run and delete its folder; resolves once that is done or 3 s have passed. */
export async function stopAllRuns() {
  const exits = [...runningChildren].map(
    (child) =>
      new Promise((resolveExit) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolveExit()
        child.once('close', resolveExit)
        killTree(child)
      }),
  )
  await Promise.race([Promise.all(exits), new Promise((resolveWait) => setTimeout(resolveWait, 3000))])
  await Promise.all(
    [...liveWorkdirs].map((workdir) =>
      rm(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}),
    ),
  )
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // child.kill() would stop cmd.exe and leave the CLI it started running.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

/** Run one adapter on `prompt` in a fresh empty folder and return its answer text. */
export async function runCli({ adapter, executable, prompt, timeoutMs = RUN_TIMEOUT_MS, signal }) {
  const workdir = await mkdtemp(path.join(tmpdir(), 'autolabreport-bridge-'))
  liveWorkdirs.add(workdir)
  try {
    return await new Promise((resolve, reject) => {
      const launch = buildSpawn(executable, adapter.args)
      const child = spawn(launch.file, launch.args, {
        ...launch.options,
        cwd: workdir,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      runningChildren.add(child)
      let markExited
      const exited = new Promise((resolveExit) => {
        markExited = resolveExit
      })
      child.once('close', () => {
        runningChildren.delete(child)
        markExited()
      })

      const stdout = []
      let stdoutBytes = 0
      let stderrTail = ''
      let settled = false

      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (error) {
          killTree(child)
          // Report only once the process is gone: Windows will not delete a folder a
          // process is still running in, and a stopped run must not leave one behind.
          Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 5000))]).then(() => reject(error))
        } else {
          resolve(value)
        }
      }

      const timer = setTimeout(
        () => finish(new BridgeError(504, `${adapter.label} 超過 ${Math.round(timeoutMs / 60000)} 分鐘沒有完成，已停止。`)),
        timeoutMs,
      )
      const onAbort = () => finish(new BridgeError(499, '已取消。'))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort)

      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          finish(new BridgeError(502, `${adapter.label} 的輸出太長，已停止。`))
          return
        }
        stdout.push(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000)
      })
      child.on('error', (error) => {
        // A process that never started has nothing to wait for.
        markExited()
        finish(new BridgeError(502, `無法啟動 ${adapter.label}：${error.message}`))
      })
      child.on('close', (code) => {
        if (settled) return
        const text = stripAnsi(Buffer.concat(stdout).toString('utf8'))
        if (code !== 0) {
          const detail = stripAnsi(stderrTail).trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 400)
          finish(new BridgeError(502, `${adapter.label} 執行失敗（代碼 ${code}）${detail ? `：${detail}` : ''}`))
          return
        }
        try {
          const answer = adapter.parse(text).trim()
          if (!answer) {
            finish(new BridgeError(502, `${adapter.label} 沒有輸出任何內容。`))
            return
          }
          finish(null, answer)
        } catch (error) {
          finish(error instanceof BridgeError ? error : new BridgeError(502, `${adapter.label} 的輸出無法讀取。`))
        }
      })

      // A tool that exits before reading all of its input would otherwise crash us.
      child.stdin.on('error', () => {})
      child.stdin.end(prompt, 'utf8')
    })
  } finally {
    // Retries cover the moment Windows keeps a handle open after the process has exited.
    await rm(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
    liveWorkdirs.delete(workdir)
  }
}

// ---------------------------------------------------------------------------------
// Pairing

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function createPairingCode() {
  let code = ''
  for (let index = 0; index < 8; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

export function formatPairingCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function normalizeCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

// ---------------------------------------------------------------------------------
// HTTP

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // Keep draining rather than destroying the socket, so the page gets a 413 it can
        // read instead of a connection reset.
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(new BridgeError(413, '內容太大。'))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new BridgeError(400, '內容不是有效的 JSON。'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}

/**
 * The bridge's HTTP server, not yet listening.
 *
 * `clis` is the detected state of each adapter: { adapter, executable, enabled, signedIn }.
 */
export function createBridgeServer({
  port,
  origins = DEFAULT_ORIGINS,
  clis,
  pairingCode = createPairingCode(),
  token = randomBytes(32).toString('base64url'),
  onEvent = () => {},
}) {
  const allowedOrigins = new Set(origins)
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const state = { failures: 0, locked: false, running: false }

  const publicClis = () =>
    clis.map(({ adapter, executable, enabled, signedIn }) => ({
      id: adapter.id,
      label: adapter.label,
      available: Boolean(executable),
      enabled: Boolean(executable) && enabled,
      signedIn: signedIn ?? null,
      note: adapter.note,
    }))

  const hasToken = (req) => {
    const header = String(req.headers.authorization ?? '')
    return header.startsWith('Bearer ') && sameSecret(header.slice(7), token)
  }

  async function handle(req, res) {
    // Only requests addressed to this computer by name; a rebound domain is refused.
    if (!allowedHosts.has(String(req.headers.host ?? '').toLowerCase())) {
      send(res, 403, { error: '不接受這個 Host。' })
      return
    }

    const origin = req.headers.origin
    const originAllowed = typeof origin === 'string' && allowedOrigins.has(origin)
    if (origin !== undefined && !originAllowed) {
      send(res, 403, { error: '不接受來自這個網站的請求。' })
      return
    }
    if (originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '600')
      // Chrome asks before a public page may reach a local address.
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true')
      }
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (req.method === 'OPTIONS') {
      res.writeHead(originAllowed ? 204 : 403)
      res.end()
      return
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      send(res, 200, {
        app: 'autolabreport-bridge',
        protocol: PROTOCOL,
        version: VERSION,
        paired: hasToken(req),
        pairingLocked: state.locked,
        clis: publicClis(),
      })
      return
    }

    // Pairing and running are for the AutoLabReport page and nothing else.
    if (!originAllowed && (url.pathname === '/pair' || url.pathname === '/run')) {
      send(res, 403, { error: '只接受 AutoLabReport 網頁的請求。' })
      return
    }

    if (req.method === 'POST' && url.pathname === '/pair') {
      if (state.locked) {
        send(res, 423, { error: '配對已鎖定：錯誤次數太多。請重新啟動 bridge 取得新的配對碼。' })
        return
      }
      const body = await readBody(req)
      if (!sameSecret(normalizeCode(body.code), pairingCode)) {
        state.failures += 1
        if (state.failures >= MAX_PAIRING_FAILURES) {
          state.locked = true
          onEvent('locked')
        }
        send(res, 401, { error: '配對碼不正確。' })
        return
      }
      state.failures = 0
      onEvent('paired')
      send(res, 200, { token })
      return
    }

    if (req.method === 'POST' && url.pathname === '/run') {
      if (!hasToken(req)) {
        send(res, 401, { error: '尚未配對，或 bridge 已重新啟動。請重新輸入配對碼。' })
        return
      }
      const body = await readBody(req)
      const entry = clis.find((candidate) => candidate.adapter.id === body.cli)
      if (!entry || !entry.executable) {
        send(res, 404, { error: '這台電腦上找不到這個 CLI。' })
        return
      }
      if (!entry.enabled) {
        send(res, 403, { error: `${entry.adapter.label} 沒有啟用。請用 --enable ${entry.adapter.id} 重新啟動 bridge。` })
        return
      }
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
        send(res, 400, { error: '沒有收到 prompt。' })
        return
      }
      if (body.prompt.length > MAX_PROMPT_CHARS) {
        send(res, 413, { error: 'Prompt 太長。' })
        return
      }
      if (state.running) {
        send(res, 409, { error: '上一個任務還在執行，請等它完成。' })
        return
      }

      state.running = true
      const controller = new AbortController()
      // Closing the page, or pressing cancel, stops the CLI instead of leaving it running.
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      const started = Date.now()
      try {
        const text = await runCli({
          adapter: entry.adapter,
          executable: entry.executable,
          prompt: body.prompt,
          signal: controller.signal,
        })
        const ms = Date.now() - started
        onEvent('ran', { label: entry.adapter.label, ms })
        send(res, 200, { text, cli: entry.adapter.id, ms })
      } catch (error) {
        const status = error instanceof BridgeError ? error.status : 500
        onEvent('failed', { label: entry.adapter.label, message: error.message })
        if (!res.writableEnded && !res.destroyed) send(res, status, { error: error.message })
      } finally {
        state.running = false
      }
      return
    }

    send(res, 404, { error: '找不到這個路徑。' })
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error instanceof BridgeError ? error.status : 500
      if (!res.headersSent) send(res, status, { error: error instanceof BridgeError ? error.message : '發生未預期的錯誤。' })
    })
  })

  return { server, state, pairingCode, token }
}

/** Find each adapter's executable and, for Claude Code, whether you are signed in. */
export async function detectClis(enable = new Set()) {
  return Promise.all(
    Object.values(ADAPTERS).map(async (adapter) => {
      const executable = await resolveExecutable(adapter.command)
      let signedIn = null
      if (executable && adapter.id === 'claude') {
        // Documented: `claude auth status` exits 0 when signed in, 1 when not.
        signedIn = await new Promise((resolve) => {
          const launch = buildSpawn(executable, ['auth', 'status'])
          const child = spawn(launch.file, launch.args, { ...launch.options, stdio: 'ignore', windowsHide: true })
          const timer = setTimeout(() => {
            killTree(child)
            resolve(null)
          }, 15000)
          child.on('error', () => {
            clearTimeout(timer)
            resolve(null)
          })
          child.on('close', (code) => {
            clearTimeout(timer)
            resolve(code === 0 ? true : code === 1 ? false : null)
          })
        })
      }
      return { adapter, executable, enabled: adapter.enabledByDefault || enable.has(adapter.id), signedIn }
    }),
  )
}

// ---------------------------------------------------------------------------------
// Command line

const HELP = `AutoLabReport 終端機橋接 v${VERSION}

用法：node autolabreport-bridge.mjs [選項]

  --enable <cli,...>      另外啟用 codex 或 gemini（它們可能讀取本機檔案）
  --port <number>         連接埠，預設 ${DEFAULT_PORT}
  --allow-origin <url>    另外接受的網頁來源，例如本機開發用 http://localhost:5173
  --help                  顯示這段說明
`

export function parseArguments(argv) {
  const options = { port: DEFAULT_PORT, origins: [...DEFAULT_ORIGINS], enable: new Set(), help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${argument} 需要一個值`)
      index += 1
      return value
    }
    if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--port') {
      const port = Number(next())
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port 必須是 1024 到 65535 之間的整數')
      options.port = port
    } else if (argument === '--allow-origin') {
      const origin = next()
      let parsed
      try {
        parsed = new URL(origin)
      } catch {
        throw new Error(`--allow-origin 不是有效的網址：${origin}`)
      }
      if (parsed.origin !== origin || !/^https?:$/.test(parsed.protocol)) {
        throw new Error(`--allow-origin 只能是 http(s)://主機[:埠]，不含路徑：${origin}`)
      }
      options.origins.push(origin)
    } else if (argument === '--enable') {
      for (const id of next().split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
        if (!ADAPTERS[id]) throw new Error(`--enable 不認識 ${id}（可用：codex, gemini）`)
        options.enable.add(id)
      }
    } else {
      throw new Error(`不認識的選項：${argument}（用 --help 查看）`)
    }
  }
  return options
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8)
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log(HELP)
    return
  }

  const [major] = process.versions.node.split('.').map(Number)
  if (major < 18) {
    console.error(`需要 Node.js 18 或更新版本，目前是 ${process.versions.node}。`)
    process.exitCode = 1
    return
  }

  const clis = await detectClis(options.enable)
  const { server, pairingCode } = createBridgeServer({
    port: options.port,
    origins: options.origins,
    clis,
    onEvent: (event, detail) => {
      if (event === 'paired') console.log(`[${timestamp()}] 已與 AutoLabReport 配對`)
      if (event === 'locked') console.log(`[${timestamp()}] 配對碼錯誤太多次，已鎖定配對。重新啟動可取得新的配對碼。`)
      if (event === 'ran') console.log(`[${timestamp()}] ${detail.label} 完成（${(detail.ms / 1000).toFixed(1)} 秒）`)
      if (event === 'failed') console.log(`[${timestamp()}] ${detail.label} 失敗：${detail.message}`)
    },
  })

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`連接埠 ${options.port} 已被占用：可能已經有一個 bridge 在執行。或用 --port 換一個。`)
    } else {
      console.error(`無法啟動：${error.message}`)
    }
    process.exitCode = 1
  })

  server.listen(options.port, '127.0.0.1', () => {
    const lines = [
      '',
      `AutoLabReport 終端機橋接 v${VERSION}`,
      `  只接受：${options.origins.join(', ')}`,
      '',
      `  配對碼：${formatPairingCode(pairingCode)}   ← 在 AutoLabReport 的「終端機 AI」輸入`,
      '',
    ]
    for (const { adapter, executable, enabled, signedIn } of clis) {
      const name = adapter.label.padEnd(12)
      if (!executable) {
        lines.push(`  ${name} 未安裝`)
      } else if (!enabled) {
        lines.push(`  ${name} 未啟用   ${adapter.note}`)
        lines.push(`  ${''.padEnd(12)} 要使用請加上：--enable ${adapter.id}`)
      } else {
        const account = signedIn === true ? '已登入' : signedIn === false ? '未登入，請先執行 claude 登入' : ''
        lines.push(`  ${name} 已啟用   ${account}`)
        lines.push(`  ${''.padEnd(12)} ${adapter.note}`)
      }
    }
    if (!clis.some((entry) => entry.executable && entry.enabled)) {
      lines.push('', '  目前沒有可用的 CLI。安裝並登入 Claude Code 後重新啟動，或用 --enable 啟用 Codex / Gemini CLI。')
    }
    lines.push('', '  保持這個視窗開著。按 Ctrl+C 結束。', '')
    console.log(lines.join('\n'))
  })

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    server.close()
    await stopAllRuns()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

function isRunDirectly() {
  if (!process.argv[1]) return false
  const invoked = path.resolve(process.argv[1])
  const self = fileURLToPath(import.meta.url)
  return process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self
}

if (isRunDirectly()) {
  void main()
}
