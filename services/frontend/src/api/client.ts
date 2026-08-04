const BASE_URL = '/api'

interface RequestOptions extends RequestInit {
  /** Override base URL. Defaults to '/api' */
  baseUrl?: string
}

/**
 * Typed fetch wrapper for the PMOS API.
 *
 * @example
 * const notes = await apiClient<Note[]>('/notes/v1/notes')
 * const created = await apiClient<Note>('/notes/v1/notes', {
 *   method: 'POST',
 *   body: JSON.stringify({ title: 'Hello' }),
 * })
 */
export async function apiClient<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { baseUrl = BASE_URL, headers: extraHeaders, ...rest } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string>),
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, body)
  }

  return response.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`API ${status} ${statusText}: ${body}`)
    this.name = 'ApiError'
  }
}
