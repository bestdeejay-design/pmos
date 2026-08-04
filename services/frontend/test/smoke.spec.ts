import { test, expect } from '@playwright/test'

test('homepage has PMOS heading', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('PMOS')).toBeVisible()
})

test('can navigate to Notes', async ({ page }) => {
  await page.goto('/')
  await page.click('text=Notes')
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible()
})
