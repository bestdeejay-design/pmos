import { apiClient, ApiError } from './client'
import { apiDelete, qs } from './types'
import type { FileMeta, ListResponse, UpdateFileMeta } from './types'

const BASE = '/files/v1'
const BASE_URL = '/api'

export interface FileListParams {
  profileId?: string
  ownerType?: string
  offset?: number
  limit?: number
}

export const filesApi = {
  list: async (params: FileListParams = {}) =>
    (
      await apiClient<ListResponse<FileMeta>>(`${BASE}/files${qs(params)}`)
    ).data,
  get: (id: string) => apiClient<FileMeta>(`${BASE}/files/${id}`),
  update: (id: string, data: UpdateFileMeta) =>
    apiClient<FileMeta>(`${BASE}/files/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiDelete(`${BASE}/files/${id}`),

  /**
   * Загрузка файла (multipart/form-data).
   *
   * Сознательно использует прямой fetch, а не `apiClient`: клиент
   * принудительно ставит `Content-Type: application/json`, а multipart-тело
   * требует автоматический `Content-Type` с boundary от браузера.
   */
  upload: async (
    file: File,
    options: { profileIds?: string[]; ownerType?: string; ownerId?: string } = {},
  ): Promise<FileMeta> => {
    const form = new FormData()
    form.append('file', file)
    if (options.profileIds) {
      // Контракт: profileIds передаётся JSON-строкой (multipart не умеет массивы).
      form.append('profileIds', JSON.stringify(options.profileIds))
    }
    if (options.ownerType) form.append('ownerType', options.ownerType)
    if (options.ownerId) form.append('ownerId', options.ownerId)

    const response = await fetch(`${BASE_URL}${BASE}/files`, {
      method: 'POST',
      body: form,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new ApiError(response.status, response.statusText, body)
    }
    return response.json() as Promise<FileMeta>
  },

  /** Скачивание файла как Blob (application/octet-stream, не JSON). */
  download: async (id: string): Promise<Blob> => {
    const response = await fetch(`${BASE_URL}${BASE}/files/${id}/download`)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new ApiError(response.status, response.statusText, body)
    }
    return response.blob()
  },
}
