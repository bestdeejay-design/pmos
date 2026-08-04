import { test, expect } from '@playwright/test'
import { deleteFile, waitForApi } from './helpers'

test.describe('Files', () => {
  test('upload a file and see it in the list', async ({ page, request }) => {
    const filename = `e2e-${Date.now()}.txt`

    await page.goto('/files')
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible()

    const responsePromise = waitForApi(page, 'POST', '/api/files/v1/files')
    // Загрузка запускается сразу при выборе файла (onChange), submit не нужен.
    await page.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: 'text/plain',
      buffer: Buffer.from('Hello from E2E test'),
    })

    const response = await responsePromise
    expect(response.ok()).toBeTruthy()
    const created = (await response.json()) as { id: string }

    await expect(page.getByText(filename)).toBeVisible()

    await deleteFile(request, created.id)
  })
})