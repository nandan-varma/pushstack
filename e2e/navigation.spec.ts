import { test, expect } from '@playwright/test'

test.describe('Route Navigation E2E', () => {
  test('should navigate between pages', async ({ page }) => {
    // Go to home page
    await page.goto('/')

    // Check home page content
    await expect(page.locator('h1')).toContainText('Build, collaborate, and ship together')

    // Navigate to about page
    await page.click('text=About')
    await expect(page).toHaveURL('/about')
    await expect(page.locator('h1')).toContainText('A small starter')

    // Use browser back button
    await page.goBack()
    await expect(page).toHaveURL('/')
  })

  test('should handle dashboard navigation flow', async ({ page }) => {
    await page.goto('/')

    // Click dashboard link
    await page.click('text=Dashboard')

    // Should redirect to login (if not authenticated)
    await expect(page).toHaveURL('/auth/login')
    await expect(page.locator('h1')).toContainText('Login')
  })

  test('should navigate through repository pages', async ({ page }) => {
    // Note: This assumes you have authentication set up
    // You may need to implement login first
    
    await page.goto('/repositories')
    
    // Should either show repositories or redirect to login
    const url = page.url()
    expect(['/repositories', '/auth/login']).toContain(new URL(url).pathname)
  })

  test('should handle deep linking', async ({ page }) => {
    // Navigate directly to a deep route
    await page.goto('/about')
    await expect(page).toHaveURL('/about')
    await expect(page.locator('h1')).toContainText('A small starter')
  })

  test('should preserve state during navigation', async ({ page }) => {
    await page.goto('/')
    
    // Navigate to different pages and back
    await page.click('text=About')
    await expect(page).toHaveURL('/about')
    
    await page.goBack()
    await expect(page).toHaveURL('/')
    
    // Content should be restored
    await expect(page.locator('h1')).toContainText('Build, collaborate')
  })
})
