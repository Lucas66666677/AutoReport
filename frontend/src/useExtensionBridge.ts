import { useEffect, useRef } from 'react'

export type ExtensionBridgePayload = {
  text: string
  messageId?: string
}

type BridgeMessage = {
  type?: unknown
  source?: unknown
  messageId?: unknown
  text?: unknown
}

function normalizePayload(value: unknown): ExtensionBridgePayload | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as BridgeMessage
  if (payload.source !== 'autolabreport-extension') return null

  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (!text) return null
  return {
    text,
    messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
  }
}

export function useExtensionBridge(
  onText: (payload: ExtensionBridgePayload) => void,
): void {
  const onTextRef = useRef(onText)
  const seenMessagesRef = useRef(new Set<string>())

  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  useEffect(() => {
    const deliver = (payload: ExtensionBridgePayload | null) => {
      if (!payload) return
      if (payload.messageId) {
        if (seenMessagesRef.current.has(payload.messageId)) return
        seenMessagesRef.current.add(payload.messageId)
        window.setTimeout(() => {
          if (payload.messageId) seenMessagesRef.current.delete(payload.messageId)
        }, 30_000)
      }
      onTextRef.current(payload)
    }

    const handleCustomEvent = (event: Event) => {
      deliver(normalizePayload((event as CustomEvent<unknown>).detail))
    }
    const handleWindowMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as BridgeMessage | null
      if (data?.type !== 'AUTOLABREPORT_EXTENSION_TEXT') return
      deliver(normalizePayload(data))
    }

    window.addEventListener('AutoLabReport_Insert', handleCustomEvent)
    window.addEventListener('message', handleWindowMessage)
    return () => {
      window.removeEventListener('AutoLabReport_Insert', handleCustomEvent)
      window.removeEventListener('message', handleWindowMessage)
    }
  }, [])
}
