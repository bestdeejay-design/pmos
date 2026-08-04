import { test, expect } from '@playwright/test'
import { deleteWebhook } from './helpers'

/**
 * Webhook-сценарий.
 *
 * Во фронтенде нет UI-страницы управления webhook (роуты: notes, tasks,
 * calendar, projects, files, profiles, settings — см. `src/App.tsx`), поэтому
 * сценарий проверяется напрямую через API-шлюз `/api/integrations/v1/webhooks`
 * (контракт: `contracts/openapi/integrations.yaml`). `active` по умолчанию
 * `true` (см. `services/integrations/src/db/schema.ts`).
 */
test.describe('Webhooks', () => {
  test('create a webhook and verify it is active', async ({ request }) => {
    const url = `https://example.com/hook-${Date.now()}`

    const createRes = await request.post('/api/integrations/v1/webhooks', {
      data: { url, events: ['notes.created', 'tasks.updated'] },
    })
    expect(createRes.status()).toBe(201)

    const created = (await createRes.json()) as {
      id: string
      url: string
      events: string[]
      active: boolean
    }
    expect(created.url).toBe(url)
    expect(created.events).toContain('notes.created')
    expect(created.active).toBe(true)

    // Webhook отображается в списке.
    const listRes = await request.get('/api/integrations/v1/webhooks')
    expect(listRes.ok()).toBeTruthy()
    const list = (await listRes.json()) as {
      data: Array<{ id: string; url: string }>
    }
    expect(list.data.some(w => w.id === created.id)).toBeTruthy()

    await deleteWebhook(request, created.id)
  })
})