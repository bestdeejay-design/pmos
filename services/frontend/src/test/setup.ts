// Global WebSocket stub — jsdom's WebSocket throws on relative URLs (e.g. '/ws'),
// which would break any component that mounts usePushes (Dashboard, Layout, App).
class NoopWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = 3
  onopen: (() => void) | null = null
  onmessage: ((event: unknown) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(_url: string) {}

  close(): void {}
  send(_data: string): void {}
}

globalThis.WebSocket = NoopWebSocket as unknown as typeof WebSocket
