import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient, ApiError } from '../../api/client'
import { apiDelete, qs } from '../../api/types'
import { notesApi } from '../../api/notes'
import { tasksApi } from '../../api/tasks'
import { calendarApi } from '../../api/calendar'
import { projectsApi } from '../../api/projects'
import { filesApi } from '../../api/files'
import { profilesApi } from '../../api/profiles'
import { settingsApi } from '../../api/settings'

// ---------------------------------------------------------------------------
// Mock apiClient — vi.mock is hoisted, so define the class inside the factory
// ---------------------------------------------------------------------------

vi.mock('../../api/client', () => {
  class MockApiError extends Error {
    status: number
    statusText: string
    body: string
    constructor(status: number, statusText: string, body: string) {
      super(`API ${status} ${statusText}: ${body}`)
      this.name = 'ApiError'
      this.status = status
      this.statusText = statusText
      this.body = body
    }
  }
  return {
    apiClient: vi.fn(),
    ApiError: MockApiError,
  }
})

const clientMock = vi.mocked(apiClient)

// ---------------------------------------------------------------------------
// Tests — utility: qs()
// ---------------------------------------------------------------------------

describe('qs()', () => {
  it('returns empty string for empty params', () => {
    expect(qs({})).toBe('')
  })

  it('builds query string from params', () => {
    expect(qs({ offset: 0, limit: 10 })).toBe('?offset=0&limit=10')
  })

  it('skips undefined values', () => {
    expect(qs({ offset: 0, limit: undefined })).toBe('?offset=0')
  })

  it('skips empty string values', () => {
    expect(qs({ q: '', tag: 'work' })).toBe('?tag=work')
  })
})

// ---------------------------------------------------------------------------
// Tests — apiDelete()
// ---------------------------------------------------------------------------

describe('apiDelete()', () => {
  beforeEach(() => {
    clientMock.mockReset()
  })

  it('calls apiClient with DELETE method', async () => {
    clientMock.mockResolvedValueOnce(undefined)
    await apiDelete('/notes/v1/notes/1')
    expect(clientMock).toHaveBeenCalledWith('/notes/v1/notes/1', {
      method: 'DELETE',
    })
  })

  it('silently ignores SyntaxError from empty 204 body', async () => {
    clientMock.mockRejectedValueOnce(
      new SyntaxError('Unexpected end of JSON input'),
    )
    await expect(apiDelete('/notes/v1/notes/1')).resolves.toBeUndefined()
  })

  it('re-throws ApiError', async () => {
    // Create an instance of the mocked ApiError using the imported class
    const apiErr = new (ApiError as new (
      status: number,
      statusText: string,
      body: string,
    ) => Error)(500, 'Internal Server Error', '')
    clientMock.mockRejectedValueOnce(apiErr)
    await expect(apiDelete('/notes/v1/notes/1')).rejects.toThrow('500')
  })
})

// ---------------------------------------------------------------------------
// Parameterized CRUD tests for standard modules
// ---------------------------------------------------------------------------

interface ModuleConfig {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: Record<string, (...args: any[]) => Promise<unknown>>
  basePath: string
  resourcePath: string
  createData: Record<string, unknown>
  updateData: Record<string, unknown>
}

const standardModules: ModuleConfig[] = [
  {
    name: 'notesApi',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: notesApi as any,
    basePath: '/notes/v1',
    resourcePath: '/notes',
    createData: { title: 'Test', bodyMd: 'Body' },
    updateData: { title: 'Updated' },
  },
  {
    name: 'tasksApi',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: tasksApi as any,
    basePath: '/tasks/v1',
    resourcePath: '/tasks',
    createData: { title: 'Task' },
    updateData: { status: 'done' },
  },
  {
    name: 'calendarApi',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: calendarApi as any,
    basePath: '/calendar/v1',
    resourcePath: '/meetings',
    createData: {
      title: 'Meeting',
      startTime: '2025-01-01T10:00:00Z',
      endTime: '2025-01-01T11:00:00Z',
    },
    updateData: { title: 'Updated Meeting' },
  },
  {
    name: 'projectsApi',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: projectsApi as any,
    basePath: '/projects/v1',
    resourcePath: '/projects',
    createData: { name: 'Project' },
    updateData: { name: 'Updated Project' },
  },
  {
    name: 'profilesApi',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: profilesApi as any,
    basePath: '/profiles/v1',
    resourcePath: '/profiles',
    createData: { name: 'Profile', color: '#ff0000' },
    updateData: { name: 'Updated Profile' },
  },
]

for (const mod of standardModules) {
  describe(mod.name, () => {
    beforeEach(() => {
      clientMock.mockReset()
    })

    it('list() calls GET with correct path', async () => {
      clientMock.mockResolvedValueOnce({
        data: [],
        pagination: { offset: 0, limit: 20, total: 0 },
      })
      await mod.api.list()
      expect(clientMock).toHaveBeenCalledWith(
        `${mod.basePath}${mod.resourcePath}`,
      )
    })

    it('get(id) calls GET /{id}', async () => {
      clientMock.mockResolvedValueOnce({ id: '1' })
      await mod.api.get('1')
      expect(clientMock).toHaveBeenCalledWith(
        `${mod.basePath}${mod.resourcePath}/1`,
      )
    })

    it('create(data) calls POST with JSON body', async () => {
      clientMock.mockResolvedValueOnce({ id: '1', ...mod.createData })
      await mod.api.create(mod.createData)
      expect(clientMock).toHaveBeenCalledWith(
        `${mod.basePath}${mod.resourcePath}`,
        {
          method: 'POST',
          body: JSON.stringify(mod.createData),
        },
      )
    })

    it('update(id, data) calls PATCH with JSON body', async () => {
      clientMock.mockResolvedValueOnce({ id: '1', ...mod.updateData })
      await mod.api.update('1', mod.updateData)
      expect(clientMock).toHaveBeenCalledWith(
        `${mod.basePath}${mod.resourcePath}/1`,
        {
          method: 'PATCH',
          body: JSON.stringify(mod.updateData),
        },
      )
    })

    it('delete(id) calls DELETE via apiDelete', async () => {
      clientMock.mockResolvedValueOnce(undefined)
      await mod.api.delete('1')
      expect(clientMock).toHaveBeenCalledWith(
        `${mod.basePath}${mod.resourcePath}/1`,
        { method: 'DELETE' },
      )
    })
  })
}

// ---------------------------------------------------------------------------
// filesApi — special: upload/download use raw fetch
// ---------------------------------------------------------------------------

describe('filesApi', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clientMock.mockReset()
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('list() calls GET /files/v1/files', async () => {
    clientMock.mockResolvedValueOnce({
      data: [],
      pagination: { offset: 0, limit: 20, total: 0 },
    })
    await filesApi.list()
    expect(clientMock).toHaveBeenCalledWith('/files/v1/files')
  })

  it('get(id) calls GET /files/v1/files/{id}', async () => {
    clientMock.mockResolvedValueOnce({ id: '1' })
    await filesApi.get('1')
    expect(clientMock).toHaveBeenCalledWith('/files/v1/files/1')
  })

  it('update(id, data) calls PATCH with JSON body', async () => {
    const data = { filename: 'new.txt' }
    clientMock.mockResolvedValueOnce({ id: '1', ...data })
    await filesApi.update('1', data)
    expect(clientMock).toHaveBeenCalledWith('/files/v1/files/1', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  })

  it('delete(id) calls DELETE', async () => {
    clientMock.mockResolvedValueOnce(undefined)
    await filesApi.delete('1')
    expect(clientMock).toHaveBeenCalledWith('/files/v1/files/1', {
      method: 'DELETE',
    })
  })

  it('upload() uses fetch with FormData (not apiClient)', async () => {
    const fileMeta = {
      id: '1',
      filename: 'test.txt',
      mimeType: 'text/plain',
      size: 100,
      storagePath: '/tmp/test.txt',
      profileIds: [],
      uploadedAt: '',
    }
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(fileMeta), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    const result = await filesApi.upload(file, { profileIds: ['p1'] })

    expect(result).toEqual(fileMeta)
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/files/v1/files',
      expect.objectContaining({ method: 'POST' }),
    )
    const callBody = fetchSpy.mock.calls[0][1]?.body
    expect(callBody).toBeInstanceOf(FormData)
  })

  it('download() calls fetch and returns blob', async () => {
    const blob = new Blob(['file content'], {
      type: 'application/octet-stream',
    })
    fetchSpy.mockResolvedValueOnce(new Response(blob, { status: 200 }))

    const result = await filesApi.download('1')

    expect(fetchSpy).toHaveBeenCalledWith('/api/files/v1/files/1/download')
    expect(result).toHaveProperty('size')
    expect(result).toHaveProperty('type')
    expect(typeof result.arrayBuffer).toBe('function')
  })

  it('upload() throws on failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('fail', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    )

    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    await expect(filesApi.upload(file)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// settingsApi — special: upsert, ollamaModels, encoded key
// ---------------------------------------------------------------------------

describe('settingsApi', () => {
  beforeEach(() => {
    clientMock.mockReset()
  })

  it('list() calls GET /settings/v1/settings', async () => {
    clientMock.mockResolvedValueOnce({ data: [] })
    await settingsApi.list()
    expect(clientMock).toHaveBeenCalledWith('/settings/v1/settings')
  })

  it('get(key) calls GET /settings/v1/settings/{key}', async () => {
    clientMock.mockResolvedValueOnce({ key: 'theme', value: {} })
    await settingsApi.get('theme')
    expect(clientMock).toHaveBeenCalledWith('/settings/v1/settings/theme')
  })

  it('upsert(data) calls POST with JSON body', async () => {
    const data = { key: 'theme', value: { dark: true } }
    clientMock.mockResolvedValueOnce({ ...data })
    await settingsApi.upsert(data)
    expect(clientMock).toHaveBeenCalledWith('/settings/v1/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

  it('update(key, value) calls PATCH with wrapped value', async () => {
    const value = { dark: false }
    clientMock.mockResolvedValueOnce({ key: 'theme', value })
    await settingsApi.update('theme', value)
    expect(clientMock).toHaveBeenCalledWith('/settings/v1/settings/theme', {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    })
  })

  it('delete(key) calls DELETE with encoded key', async () => {
    clientMock.mockResolvedValueOnce(undefined)
    await settingsApi.delete('key/with/slash')
    expect(clientMock).toHaveBeenCalledWith(
      '/settings/v1/settings/key%2Fwith%2Fslash',
      { method: 'DELETE' },
    )
  })

  it('ollamaModels() calls GET /settings/v1/settings/ollama-models', async () => {
    clientMock.mockResolvedValueOnce({ models: ['llama3'], degraded: false })
    const result = await settingsApi.ollamaModels()
    expect(clientMock).toHaveBeenCalledWith(
      '/settings/v1/settings/ollama-models',
    )
    expect(result).toEqual({ models: ['llama3'], degraded: false })
  })
})
