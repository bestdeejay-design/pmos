import { test, expect } from '@playwright/test'
import { deleteTask, uniqueName, waitForApi } from './helpers'

test.describe('Tasks Kanban', () => {
  test('create a task in Backlog column with priority', async ({
    page,
    request,
  }) => {
    const title = uniqueName('E2E Task')

    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
    await expect(page.getByText('Backlog')).toBeVisible()

    const responsePromise = waitForApi(page, 'POST', '/api/tasks/v1/tasks')
    await page.getByPlaceholder('New task…').fill(title)
    await page.locator('input[type="number"]').fill('3')
    await page.getByRole('button', { name: '+ Add Task' }).click()

    const response = await responsePromise
    expect(response.ok()).toBeTruthy()
    const created = (await response.json()) as {
      id: string
      status: string
      priority: number
    }

    // Статус и приоритет из ответа API.
    expect(created.status).toBe('backlog')
    expect(created.priority).toBe(3)

    // Задача отображается в колонке Backlog с приоритетом P3.
    await expect(page.getByText(title)).toBeVisible()
    await expect(page.getByText('P3')).toBeVisible()

    const card = page.locator('.rounded-md.border', { hasText: title })
    await expect(card.locator('select')).toHaveValue('backlog')

    await deleteTask(request, created.id)
  })

  test('verify kanban columns exist', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()

    for (const column of ['Backlog', 'To Do', 'In Progress', 'Done']) {
      await expect(page.getByText(column)).toBeVisible()
    }
  })
})