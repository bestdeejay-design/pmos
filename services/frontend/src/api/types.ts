import { apiClient, ApiError } from './client'

/**
 * Общие типы по OpenAPI-контрактам (contracts/openapi/*.yaml).
 * Wire-формат — camelCase, все временные метки — ISO 8601 (string).
 */

// ---------------------------------------------------------------------------
// Пагинация (общая для всех сервисов)
// ---------------------------------------------------------------------------

export interface Pagination {
  offset: number
  limit: number
  total: number
}

/** Ответ списочных эндпоинтов: данные + пагинация. */
export interface ListResponse<T> {
  data: T[]
  pagination: Pagination
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface Note {
  id: string
  title: string
  bodyMd: string
  tags: string[]
  profileIds: string[]
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateNote {
  title: string
  bodyMd: string
  tags?: string[]
  profileIds?: string[]
  isArchived?: boolean
}

export interface UpdateNote {
  title?: string
  bodyMd?: string
  tags?: string[]
  profileIds?: string[]
  isArchived?: boolean
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'done'
  | 'archived'

export interface Task {
  id: string
  title: string
  status: TaskStatus
  priority: number
  description?: string | null
  assignee?: string | null
  deadline?: string | null
  projectId?: string | null
  profileIds: string[]
  recurrence?: string | null
  currentStreak?: number | null
  bestStreak?: number | null
  completedAt?: string | null
  isArchived?: boolean | null
  createdAt: string
  updatedAt: string
}

export interface CreateTask {
  title: string
  priority?: number
  description?: string
  assignee?: string
  deadline?: string
  projectId?: string
  profileIds?: string[]
  recurrence?: string
}

export interface UpdateTask {
  title?: string
  status?: TaskStatus
  priority?: number
  description?: string
  assignee?: string
  deadline?: string
  projectId?: string
  profileIds?: string[]
  recurrence?: string
  isArchived?: boolean
}

// ---------------------------------------------------------------------------
// Calendar (entity — Meeting)
// ---------------------------------------------------------------------------

export interface Meeting {
  id: string
  title: string
  startTime: string
  endTime: string
  allDay: boolean
  description?: string | null
  location?: string | null
  recurrence?: string | null
  linkedProjectId?: string | null
  profileIds: string[]
  linkedExternalEventId?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateMeeting {
  title: string
  startTime: string
  endTime: string
  allDay?: boolean
  description?: string
  location?: string
  recurrence?: string
  linkedProjectId?: string
  profileIds?: string[]
}

export interface UpdateMeeting {
  title?: string
  startTime?: string
  endTime?: string
  allDay?: boolean
  description?: string
  location?: string
  recurrence?: string
  linkedProjectId?: string
  profileIds?: string[]
}

export interface Reminder {
  id: string
  meetingId: string
  remindAt: string
  channel: 'push' | 'email'
  sent: boolean
  createdAt: string
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectStatus = 'active' | 'archived' | 'completed'

export interface Project {
  id: string
  name: string
  description?: string | null
  goal?: string | null
  status: ProjectStatus
  profileIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateProject {
  name: string
  description?: string
  goal?: string
  status?: ProjectStatus
  profileIds?: string[]
}

export interface UpdateProject {
  name?: string
  description?: string
  goal?: string
  status?: ProjectStatus
  profileIds?: string[]
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type FileOwnerType = 'note' | 'task' | 'project' | null

export interface FileMeta {
  id: string
  filename: string
  mimeType: string
  size: number
  ownerType?: FileOwnerType
  ownerId?: string | null
  storagePath: string
  profileIds: string[]
  uploadedAt: string
}

export interface UpdateFileMeta {
  filename?: string
  mimeType?: string
  size?: number
  ownerType?: string | null
  ownerId?: string | null
  profileIds?: string[]
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface Profile {
  id: string
  name: string
  color: string
  icon?: string | null
  settings?: Record<string, unknown> | null
  isActive: boolean
  hidden: boolean
}

export interface CreateProfile {
  name: string
  color: string
  icon?: string | null
  settings?: Record<string, unknown> | null
  isActive?: boolean
  hidden?: boolean
}

export interface UpdateProfile {
  name?: string
  color?: string
  icon?: string | null
  settings?: Record<string, unknown> | null
  hidden?: boolean
}

// ---------------------------------------------------------------------------
// Settings (key-value)
// ---------------------------------------------------------------------------

export interface Setting {
  key: string
  /** JSONB — произвольный JSON-объект. */
  value: Record<string, unknown>
}

export interface SettingUpsert {
  key: string
  value: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Утилиты для api-модулей
// ---------------------------------------------------------------------------

/**
 * DELETE-запрос с корректной обработкой 204 No Content.
 *
 * `apiClient` всегда парсит тело ответа как JSON, а Fastify возвращает на
 * DELETE пустое тело (204) — `response.json()` при этом бросает SyntaxError.
 * Здесь SyntaxError от пустого тела трактуется как успех, реальные ошибки
 * API (ApiError) пробрасываются дальше.
 */
export async function apiDelete(path: string): Promise<void> {
  try {
    await apiClient<unknown>(path, { method: 'DELETE' })
  } catch (error) {
    if (error instanceof ApiError) throw error
  }
}

/**
 * Сборка query-строки из опциональных параметров.
 * undefined / пустые строки пропускаются.
 */
export function qs<T extends object>(params: T): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}
