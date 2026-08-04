import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient, ApiError } from '../../api/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function errorResponse(
  status: number,
  statusText: string,
  body = '',
): Response {
  return new Response(body, { status, statusText })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('apiClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed JSON data on success', async () => {
    const payload = { id: '1', name: 'test' }
    fetchSpy.mockResolvedValueOnce(jsonResponse(payload))

    const result = await apiClient<typeof payload>('/test/v1/resource')

    expect(result).toEqual(payload)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/test/v1/resource',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('throws ApiError on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(404, 'Not Found', 'missing'))

    await expect(apiClient('/test/v1/missing')).rejects.toThrow(ApiError)
  })

  it('ApiError contains status, statusText, and body', async () => {
    fetchSpy.mockResolvedValueOnce(
      errorResponse(500, 'Internal Server Error', 'boom'),
    )

    try {
      await apiClient('/test/v1/error')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(500)
      expect(apiErr.statusText).toBe('Internal Server Error')
      expect(apiErr.body).toBe('boom')
      expect(apiErr.name).toBe('ApiError')
      expect(apiErr.message).toContain('500')
    }
  })

  it('passes custom headers and options through', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await apiClient('/test/v1/resource', {
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' }),
      headers: { 'X-Custom': 'yes' },
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/test/v1/resource',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' }),
        headers: expect.objectContaining({ 'X-Custom': 'yes' }),
      }),
    )
  })

  it('uses custom baseUrl when provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await apiClient('/resource', { baseUrl: '/custom' })

    expect(fetchSpy).toHaveBeenCalledWith(
      '/custom/resource',
      expect.anything(),
    )
  })

  it('handles empty response body on error gracefully', async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(403, 'Forbidden'))

    try {
      await apiClient('/test/v1/forbidden')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).body).toBe('')
    }
  })
})
