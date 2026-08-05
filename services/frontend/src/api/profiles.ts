import { apiClient } from './client'
import { apiDelete, qs } from './types'
import type { CreateProfile, ListResponse, Profile, UpdateProfile } from './types'

const BASE = '/profiles/v1'

export interface ProfileListParams {
  offset?: number
  limit?: number
}

export const profilesApi = {
  list: async (params: ProfileListParams = {}) =>
    (
      await apiClient<ListResponse<Profile>>(`${BASE}/profiles${qs(params)}`)
    ).data,
  get: (id: string) => apiClient<Profile>(`${BASE}/profiles/${id}`),
  create: (data: CreateProfile) =>
    apiClient<Profile>(`${BASE}/profiles`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateProfile) =>
    apiClient<Profile>(`${BASE}/profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  activate: (id: string) =>
    apiClient<Profile>(`${BASE}/profiles/${id}/activate`, {
      method: 'PATCH',
    }),
  hide: (id: string) =>
    apiClient<Profile>(`${BASE}/profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    }),
  unhide: (id: string) =>
    apiClient<Profile>(`${BASE}/profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden: false }),
    }),
  delete: (id: string) => apiDelete(`${BASE}/profiles/${id}`),
}
