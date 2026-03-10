import { test, expect } from '@playwright/test'

test.describe('Authentication Flow E2E', () => {
  test('should redirect to login when accessing protected routes', async ({ page }) => {
    // Try to access dashboard without authentication
    await page.goto('/dashboard')

    // Should redirect to login
    await expect(page).toHaveURL(/\/auth\/login/)
    await expect(page.locator('h1')).toContainText('Welcome to PushStack')
  })

  test('should show login form', async ({ page }) => {
    await page.goto('/auth/login')

    // Check for login form elements
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input#password')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('should navigate to registration page', async ({ page }) => {
    await page.goto('/auth/login')

    // Look for a link to registration (adjust selector as needed)
    const signUpLink = page.locator('text=/sign up/i, text=/register/i').first()
    
    if (await signUpLink.isVisible()) {
      await signUpLink.click()
      await expect(page).toHaveURL(/\/auth\/register/)
    }
  })

  test('should show registration form', async ({ page }) => {
    await page.goto('/auth/register')

    // Check for registration form elements
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input#password')).toBeVisible()
  })

  test('should handle forgot password flow', async ({ page }) => {
    await page.goto('/auth/forgot-password')

    // Check for forgot password form
    await expect(page.locator('h1')).toContainText(/reset.*password/i)
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })

  // Note: Actual login test would require valid test credentials
  // This is just a structure example
  test.skip('should login with valid credentials', async ({ page }) => {
    await page.goto('/auth/login')

    // Fill in credentials (use test account)
    await page.fill('input[type="email"]', 'test@example.com')
    await page.fill('input[type="password"]', 'testpassword123')
    
    // Submit form
    await page.click('button[type="submit"]')

    // Should redirect to dashboard after successful login
    await expect(page).toHaveURL('/dashboard', { timeout: 10000 })
  })

  test.skip('should logout successfully', async ({ page }) => {
    // Assuming user is logged in
    await page.goto('/dashboard')

    // Look for logout button (adjust selector as needed)
    await page.click('[data-testid="logout-button"]')

    // Should redirect to home or login
    const url = page.url()
    expect(['/', '/auth/login']).toContain(new URL(url).pathname)
  })
})
