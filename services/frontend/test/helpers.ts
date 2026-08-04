import { expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Общие хелперы для E2E-тестов.
 *
 * Все тесты изолированы: создают данные с уникальными именами и удаляют их
 * через API в конце (или в `afterEach`). API-пути соответствуют nginx-gateway
 * (`/api/<svc>/v1/...`), см. `src/api/*.ts`.
 */

/** Уникальное имя для изоляции тестов (не зависит от данных других тестов). */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

/**
 * Дождаться ответа API по HTTP-методу и фрагменту URL.
 * Используется для асинхронных операций (создание/обновление/удаление).
 */
export async function waitForApi(
  page: Page,
  method: string,
  urlFragment: string,
  timeout = 10000,
) {
  return page.waitForResponse(
    res =>
      res.request().method() === method && res.url().includes(urlFragment),
    { timeout },
  )
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function createNote(
  request: APIRequestContext,
  title: string,
  bodyMd = '',
  tags: string[] = [],
) {
  const res = await request.post('/api/notes/v1/notes', {
    data: { title, bodyMd, tags },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as { id: string }
}

export async function deleteNote(request: APIRequestContext, id: string) {
  await request.delete(`/api/notes/v1/notes/${id}`)
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(
  request: APIRequestContext,
  title: string,
  priority = 1,
) {
  const res = await request.post('/api/tasks/v1/tasks', {
    data: { title, priority },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as { id: string }
}

export async function deleteTask(request: APIRequestContext, id: string) {
  await request.delete(`/api/tasks/v1/tasks/${id}`)
}

// ---------------------------------------------------------------------------
// Calendar (meetings)
// ---------------------------------------------------------------------------

export async function createMeeting(
  request: APIRequestContext,
  title: string,
  startTime: string,
  endTime: string,
) {
  const res = await request.post('/api/calendar/v1/meetings', {
    data: { title, startTime, endTime },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as { id: string }
}

export async function deleteMeeting(request: APIRequestContext, id: string) {
  await request.delete(`/api/calendar/v1/meetings/${id}`)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function deleteFile(request: APIRequestContext, id: string) {
  await request.delete(`/api/files/v1/files/${id}`)
}

// ---------------------------------------------------------------------------
// Integrations (webhooks)
// ---------------------------------------------------------------------------

export async function deleteWebhook(request: APIRequestContext, id: string) {
  await request.delete(`/api/integrations/v1/webhooks/${id}`)
}