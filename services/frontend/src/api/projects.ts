import { apiClient } from './client'
import { apiDelete, qs } from './types'
import type { CreateProject, ListResponse, Project, UpdateProject } from './types'

const BASE = '/projects/v1'

export interface ProjectListParams {
  offset?: number
  limit?: number
}

export const projectsApi = {
  list: async (params: ProjectListParams = {}) =>
    (
      await apiClient<ListResponse<Project>>(`${BASE}/projects${qs(params)}`)
    ).data,
  get: (id: string) => apiClient<Project>(`${BASE}/projects/${id}`),
  create: (data: CreateProject) =>
    apiClient<Project>(`${BASE}/projects`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateProject) =>
    apiClient<Project>(`${BASE}/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiDelete(`${BASE}/projects/${id}`),
}
