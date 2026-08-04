import { apiClient } from './client'
import { apiDelete, qs } from './types'
import type { CreateNote, ListResponse, Note, UpdateNote } from './types'

const BASE = '/notes/v1'

export interface NoteListParams {
  profileId?: string
  isArchived?: boolean
  tag?: string
  q?: string
  offset?: number
  limit?: number
}

export const notesApi = {
  list: async (params: NoteListParams = {}) =>
    (
      await apiClient<ListResponse<Note>>(`${BASE}/notes${qs(params)}`)
    ).data,
  get: (id: string) => apiClient<Note>(`${BASE}/notes/${id}`),
  create: (data: CreateNote) =>
    apiClient<Note>(`${BASE}/notes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateNote) =>
    apiClient<Note>(`${BASE}/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiDelete(`${BASE}/notes/${id}`),
  /** AI-генерация заголовка и тега по содержимому заметки. */
  generateTitle: (bodyMd: string) =>
    apiClient<{ title: string; tag: string }>(`${BASE}/notes/generate-title`, {
      method: 'POST',
      body: JSON.stringify({ bodyMd }),
    }),
}
