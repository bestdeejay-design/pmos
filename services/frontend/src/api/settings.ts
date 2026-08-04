import { apiClient } from './client'
import { apiDelete } from './types'
import type { Setting, SettingUpsert } from './types'

const BASE = '/settings/v1'

export const settingsApi = {
  /** GET /settings — без пагинации, возвращает все настройки. */
  list: async () => (await apiClient<{ data: Setting[] }>(`${BASE}/settings`)).data,
  get: (key: string) => apiClient<Setting>(`${BASE}/settings/${key}`),
  /** POST /settings — upsert по ключу (200 = обновление, 201 = создание). */
  upsert: (data: SettingUpsert) =>
    apiClient<Setting>(`${BASE}/settings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  /** PATCH /settings/{key} — обновляет только value. */
  update: (key: string, value: Record<string, unknown>) =>
    apiClient<Setting>(`${BASE}/settings/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    }),
  delete: (key: string) => apiDelete(`${BASE}/settings/${encodeURIComponent(key)}`),
  /** Список доступных моделей Ollama (degraded = сервис без Ollama). */
  ollamaModels: () =>
    apiClient<{ models: string[]; degraded: boolean }>(
      `${BASE}/settings/ollama-models`,
    ),
}
