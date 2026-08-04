import { test, expect } from '@playwright/test'
import { createNote, deleteNote, uniqueName, waitForApi } from './helpers'

test.describe('Notes CRUD', () => {
  test('create a note and see it in the list', async ({ page, request }) => {
    const title = uniqueName('E2E Note')

    await page.goto('/notes')
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible()

    await page.getByRole('button', { name: '+ New Note' }).click()

    const modal = page.locator('form')
    const responsePromise = waitForApi(page, 'POST', '/api/notes/v1/notes')
    // Модалка: Title (input), Body (textarea), Tags (input) — в этом порядке.
    await modal.getByRole('textbox').nth(0).fill(title)
    await modal.getByRole('textbox').nth(1).fill('Test body from Playwright')
    await modal.getByRole('textbox').nth(2).fill('e2e, test')
    await modal.getByRole('button', { name: 'Save' }).click()

    const response = await responsePromise
    expect(response.ok()).toBeTruthy()
    const created = (await response.json()) as { id: string }

    await expect(page.getByText(title)).toBeVisible()
    await expect(page.getByText('Test body from Playwright')).toBeVisible()

    await deleteNote(request, created.id)
  })

  test('edit an existing note', async ({ page, request }) => {
    const title = uniqueName('E2E Edit')
    const created = await createNote(request, title, 'original body')

    await page.goto('/notes')
    await expect(page.getByText(title)).toBeVisible()

    const card = page.locator('.rounded-lg.border', { hasText: title })
    await card.getByRole('button', { name: 'Edit' }).click()

    const updatedTitle = uniqueName('E2E Updated')
    const modal = page.locator('form')
    const responsePromise = waitForApi(
      page,
      'PATCH',
      `/api/notes/v1/notes/${created.id}`,
    )
    await modal.getByRole('textbox').nth(0).fill(updatedTitle)
    await modal.getByRole('button', { name: 'Save' }).click()

    await responsePromise
    await expect(page.getByText(updatedTitle)).toBeVisible()

    await deleteNote(request, created.id)
  })

  test('delete a note', async ({ page, request }) => {
    const title = uniqueName('E2E Delete')
    const created = await createNote(request, title, 'to be deleted')

    await page.goto('/notes')
    await expect(page.getByText(title)).toBeVisible()

    const card = page.locator('.rounded-lg.border', { hasText: title })
    const responsePromise = waitForApi(
      page,
      'DELETE',
      `/api/notes/v1/notes/${created.id}`,
    )
    await card.getByRole('button', { name: 'Delete' }).click()

    await responsePromise
    await expect(page.getByText(title)).toHaveCount(0)
  })
})