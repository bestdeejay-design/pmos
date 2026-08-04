import { apiClient } from './client'
import { apiDelete, qs } from './types'
import type { CreateTask, ListResponse, Task, UpdateTask } from './types'

const BASE = '/tasks/v1'

export interface TaskListParams {
  projectId?: string
  status?: string
  profileId?: string
  offset?: number
  limit?: number
}

export const tasksApi = {
  list: async (params: TaskListParams = {}) =>
    (
      await apiClient<ListResponse<Task>>(`${BASE}/tasks${qs(params)}`)
    ).data,
  get: (id: string) => apiClient<Task>(`${BASE}/tasks/${id}`),
  create: (data: CreateTask) =>
    apiClient<Task>(`${BASE}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateTask) =>
    apiClient<Task>(`${BASE}/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiDelete(`${BASE}/tasks/${id}`),
}
