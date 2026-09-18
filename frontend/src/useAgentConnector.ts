import { useCallback, useEffect, useState, type RefObject } from 'react'
import {
  AGENT_HUB_PROTOCOL,
  AgentHubError,
  attachAgentHub,
  describeActivity,
  fetchAgentHubStatus,
  loadAgentConnection,
  nextActivityId,
  nextAgentCall,
  pairWithAgentHub,
  saveAgentConnection,
  sendAgentOutcome,
  unpairAgentHub,
  type AgentCall,
  type AgentConnection,
  type AgentHubStatus,
  type AgentOpenReport,
  type AgentOutcome,
  type AgentToolName,
} from './agentConnector'
import { queryLocalNetworkPermission } from './terminalBridge'

export type AgentConnectorPhase =
  | 'off' // not paired, and not looking
  | 'checking'
  | 'not-running' // no AI app has started the connector
  | 'blocked' // the browser will not let this page reach the connector
  | 'outdated'
  | 'pairing'
  | 'connected'
  | 'reconnecting'
  | 'elsewhere' // another tab took over

/** Each tool's work in the page. Resolves to the text the AI reads; throws to report a failure. */
export type AgentToolHandlers = Record<AgentToolName, (args: Record<string, unknown>) => Promise<string>>

export type AgentActivityEntry = { id: number; summary: string; ok: boolean }

const MAX_RETRY_MS = 15_000

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * The page's side of the MCP connector. While a paired tab is open it waits for tool
 * calls from the connector, runs each through `handlersRef`, and answers.
 *
 * It reaches the student's computer only once they ask to connect, or once they have
 * paired: Chrome asks before a page may, and nobody should see that question for a
 * feature they never touched.
 */
export function useAgentConnector({
  handlersRef,
  openReportRef,
}: {
  handlersRef: RefObject<AgentToolHandlers | null>
  openReportRef: RefObject<AgentOpenReport>
}) {
  const [connection, setConnection] = useState<AgentConnection>(loadAgentConnection)
  const [phase, setPhase] = useState<AgentConnectorPhase>(() => (loadAgentConnection().token ? 'reconnecting' : 'off'))
  const [status, setStatus] = useState<AgentHubStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<AgentActivityEntry[]>([])
  const [loopRun, setLoopRun] = useState(0)

  const remember = useCallback((next: AgentConnection) => {
    saveAgentConnection(next)
    setConnection(next)
  }, [])

  useEffect(() => {
    const { port, token } = connection
    if (!token) return
    const controller = new AbortController()
    const { signal } = controller

    async function execute(call: AgentCall): Promise<AgentOutcome> {
      const handler = handlersRef.current?.[call.tool as AgentToolName]
      if (!handler) return { ok: false, error: `這個版本的 AutoLabReport 不支援 ${call.tool}。請使用者重新整理網頁。` }
      try {
        const text = await handler(call.args)
        setActivity((current) => [{ id: nextActivityId(), summary: describeActivity(call.tool, call.args), ok: true }, ...current].slice(0, 6))
        return { ok: true, text }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setActivity((current) => [{ id: nextActivityId(), summary: message, ok: false }, ...current].slice(0, 6))
        return { ok: false, error: message }
      }
    }

    async function run(sessionToken: string) {
      let retryMs = 1000
      const backOff = async () => {
        await sleep(retryMs, signal)
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
      }
      while (!signal.aborted) {
        try {
          const found = await fetchAgentHubStatus(port, sessionToken)
          if (signal.aborted) return
          if (!found) {
            // The AI app is closed (it stops the connector), or the browser is in the way.
            setPhase((await queryLocalNetworkPermission()) === 'denied' ? 'blocked' : 'reconnecting')
            await backOff()
            continue
          }
          setStatus(found)
          if (found.protocol !== AGENT_HUB_PROTOCOL) {
            setPhase('outdated')
            return
          }
          if (!found.paired) {
            remember({ port, token: null })
            setError('這個分頁的配對已失效，請在 AI app 裡再要一次配對碼。')
            setPhase('pairing')
            return
          }
          const session = await attachAgentHub(port, sessionToken)
          setPhase('connected')
          setError(null)
          retryMs = 1000
          while (!signal.aborted) {
            const call = await nextAgentCall(port, sessionToken, session, openReportRef.current, { signal })
            if (!call) continue
            const outcome = await execute(call)
            await sendAgentOutcome(port, sessionToken, session, call.id, outcome)
          }
        } catch (err) {
          if (signal.aborted) return
          if (err instanceof AgentHubError && err.status === 409) {
            setPhase('elsewhere')
            return
          }
          if (err instanceof AgentHubError && err.status === 401) {
            remember({ port, token: null })
            setError('這個分頁的配對已失效，請在 AI app 裡再要一次配對碼。')
            setPhase('pairing')
            return
          }
          setPhase('reconnecting')
          await backOff()
        }
      }
    }

    void run(token)
    return () => controller.abort()
  }, [connection, loopRun, handlersRef, openReportRef, remember])

  // `quiet` re-checks without flashing the checking state, for polling during setup.
  const check = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) {
      setPhase('checking')
      setError(null)
    }
    const found = await fetchAgentHubStatus(connection.port, connection.token)
    if (!found) {
      setPhase((await queryLocalNetworkPermission()) === 'denied' ? 'blocked' : 'not-running')
      return
    }
    setStatus(found)
    if (found.protocol !== AGENT_HUB_PROTOCOL) {
      setPhase('outdated')
      return
    }
    if (found.paired && connection.token) {
      setPhase('reconnecting')
      setLoopRun((run) => run + 1)
      return
    }
    setPhase('pairing')
  }, [connection])

  const pair = useCallback(
    async (code: string) => {
      setError(null)
      try {
        const token = await pairWithAgentHub(connection.port, code)
        setPhase('reconnecting')
        remember({ port: connection.port, token })
      } catch (err) {
        setError(err instanceof Error ? err.message : '配對失敗')
      }
    },
    [connection.port, remember],
  )

  const disconnect = useCallback(async () => {
    const { port, token } = connection
    remember({ port, token: null })
    setPhase('off')
    setStatus(null)
    setActivity([])
    setError(null)
    if (token) await unpairAgentHub(port, token).catch(() => {})
  }, [connection, remember])

  const takeOver = useCallback(() => {
    setPhase('reconnecting')
    setLoopRun((run) => run + 1)
  }, [])

  return { phase, status, error, activity, port: connection.port, check, pair, disconnect, takeOver }
}
