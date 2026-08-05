import { apiClient } from './client'
import { apiDelete, qs } from './types'
import type {
  CreateMeeting,
  ListResponse,
  Meeting,
  Reminder,
  UpdateMeeting,
} from './types'

const BASE = '/calendar/v1'

export interface MeetingListParams {
  profileId?: string
  /** Начало диапазона (ISO 8601). */
  from?: string
  /** Конец диапазона (ISO 8601). */
  to?: string
  offset?: number
  limit?: number
}

export const calendarApi = {
  list: async (params: MeetingListParams = {}) =>
    (
      await apiClient<ListResponse<Meeting>>(`${BASE}/meetings${qs(params)}`)
    ).data,
  get: (id: string) => apiClient<Meeting>(`${BASE}/meetings/${id}`),
  create: (data: CreateMeeting) =>
    apiClient<Meeting>(`${BASE}/meetings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateMeeting) =>
    apiClient<Meeting>(`${BASE}/meetings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiDelete(`${BASE}/meetings/${id}`),
  listReminders: async (meetingId: string) =>
    (await apiClient<{ data: Reminder[] }>(`${BASE}/meetings/${meetingId}/reminders`))
      .data,
  createReminder: (meetingId: string, data: { remindAt: string; channel?: string }) =>
    apiClient<Reminder>(`${BASE}/meetings/${meetingId}/reminders`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
