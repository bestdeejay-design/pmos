import { useEffect, useState } from 'react'

export interface PushMessage {
  type: string
  data: unknown
  ts: string
}

export interface UsePushesResult {
  lastMessage: PushMessage | null
  connected: boolean
}

const MAX_BACKOFF_MS = 15_000
const BASE_BACKOFF_MS = 1_000

/**
 * Connects to the backend WebSocket push endpoint (`/ws`, proxied by Vite in
 * dev and nginx in prod) and surfaces the latest pushed message. Reconnects with
 * exponential backoff on close/error.
 */
export function usePushes(wsUrl = '/ws'): UsePushesResult {
  const [lastMessage, setLastMessage] = useState<PushMessage | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let socket: WebSocket | null = null
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const scheduleReconnect = () => {
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS)
      attempts += 1
      retryTimer = setTimeout(connect, delay)
    }

    const connect = () => {
      if (disposed) return
      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch {
        // Invalid/relative URL (e.g. jsdom) — retry later.
        scheduleReconnect()
        return
      }
      socket = ws
      ws.onopen = () => {
        attempts = 0
        setConnected(true)
      }
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as PushMessage
          setLastMessage(parsed)
        } catch {
          // Ignore malformed frames.
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!disposed) scheduleReconnect()
      }
      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      socket?.close()
    }
  }, [wsUrl])

  return { lastMessage, connected }
}