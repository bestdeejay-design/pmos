import { test, expect } from '@playwright/test'
import { deleteMeeting, uniqueName, waitForApi } from './helpers'

test.describe('Calendar', () => {
  test('create a meeting and see it displayed', async ({ page, request }) => {
    const title = uniqueName('E2E Meeting')

    await page.goto('/calendar')
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible()

    await page.getByRole('button', { name: '+ New Meeting' }).click()

    const modal = page.locator('form')
    const responsePromise = waitForApi(
      page,
      'POST',
      '/api/calendar/v1/meetings',
    )
    // Первый input — Title, затем два datetime-local (Start/End).
    await modal.locator('input').first().fill(title)
    await modal
      .locator('input[type="datetime-local"]')
      .nth(0)
      .fill('2026-08-05T10:00')
    await modal
      .locator('input[type="datetime-local"]')
      .nth(1)
      .fill('2026-08-05T11:00')
    await modal.getByRole('button', { name: 'Save' }).click()

    const response = await responsePromise
    expect(response.ok()).toBeTruthy()
    const created = (await response.json()) as { id: string }

    await expect(page.getByText(title)).toBeVisible()

    await deleteMeeting(request, created.id)
  })
})