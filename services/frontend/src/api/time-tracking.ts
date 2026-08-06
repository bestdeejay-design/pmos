import { apiClient } from './client'
import { apiDelete, qs } from './types'
import type {
  CreateTimesheet,
  ListResponse,
  Timesheet,
  TimesheetStats,
  UpdateTimesheet,
} from './types'

const BASE = '/time-tracking/v1'

export interface TimesheetListParams {
  /** Начало диапазона (ISO 8601). */
  from?: string
  /** Конец диапазона (ISO 8601). */
  to?: string
  /** Фильтр по задаче (uuid). */
  taskId?: string
  offset?: number
  limit?: number
}

export const timesheetApi = {
  list: async (params: TimesheetListParams = {}) =>
    (
      await apiClient<ListResponse<Timesheet>>(`${BASE}/timesheet${qs(params)}`)
    ).data,
  get: (id: string) => apiClient<Timesheet>(`${BASE}/timesheet/${id}`),
  create: (data: CreateTimesheet) =>
    apiClient<Timesheet>(`${BASE}/timesheet`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateTimesheet) =>
    apiClient<Timesheet>(`${BASE}/timesheet/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => apiDelete(`${BASE}/timesheet/${id}`),
}

export const timesheetStats = {
  getStats: async (params: { from?: string; to?: string } = {}) =>
    apiClient<TimesheetStats>(`${BASE}/timesheet/stats${qs(params)}`),
}
