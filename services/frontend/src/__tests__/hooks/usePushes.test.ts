import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePushes, type PushMessage } from '../../hooks/usePushes'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()

  constructor() {
    MockWebSocket.instances.push(this)
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('usePushes', () => {
  it('starts disconnected and marks connected after open', () => {
    const { result } = renderHook(() => usePushes())
    expect(result.current.connected).toBe(false)

    act(() => {
      MockWebSocket.instances[0]!.onopen!()
    })

    expect(result.current.connected).toBe(true)
  })

  it('stores the last parsed message from onmessage', () => {
    const { result } = renderHook(() => usePushes())
    const msg: PushMessage = {
      type: 'pmos.tasks.tasks.updated',
      data: { id: '1' },
      ts: '2026-08-06T00:00:00.000Z',
    }

    act(() => {
      MockWebSocket.instances[0]!.onmessage!({ data: JSON.stringify(msg) })
    })

    expect(result.current.lastMessage).toEqual(msg)
  })

  it('ignores malformed frames', () => {
    const { result } = renderHook(() => usePushes())

    act(() => {
      MockWebSocket.instances[0]!.onmessage!({ data: 'not-json' })
    })

    expect(result.current.lastMessage).toBeNull()
  })

  it('marks disconnected on close and reconnects with backoff', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => usePushes())
    const first = MockWebSocket.instances[0]!

    act(() => {
      first.onopen!()
    })
    expect(result.current.connected).toBe(true)

    act(() => {
      first.onclose!()
    })
    expect(result.current.connected).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(MockWebSocket.instances.length).toBe(2)
  })
})