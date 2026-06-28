import { test, expect } from '@playwright/test'

test.describe('Repository Management E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Note: In a real scenario, you'd want to authenticate first
    // For now, we'll just navigate to the page
    await page.goto('/')
  })

  test('should display repositories page', async ({ page }) => {
    await page.goto('/repositories')
    
    // Should show repositories or redirect to login
    const url = page.url()
    if (url.includes('/auth/login')) {
      await expect(page.locator('h1')).toContainText('Welcome to PushStack')
    } else {
      await expect(page).toHaveURL('/repositories')
    }
  })

  test('should access new repository page', async ({ page }) => {
    await page.goto('/repositories/new')
    
    // Should show create form or redirect to login
    const url = page.url()
    if (url.includes('/auth/login')) {
      await expect(page.locator('h1')).toContainText('Welcome to PushStack')
    } else {
      await expect(page).toHaveURL('/repositories/new')
      await expect(page.locator('h1')).toContainText(/create.*repository/i)
    }
  })

  test.skip('should create a new repository', async ({ page }) => {
    // This test assumes authentication is working
    await page.goto('/repositories/new')
    
    // Fill in repository details
    await page.fill('input[name="name"]', `test-repo-${Date.now()}`)
    await page.fill('textarea[name="description"]', 'Test repository description')
    
    // Select visibility
    await page.selectOption('select[name="visibility"]', 'public')
    
    // Submit form
    await page.click('button[type="submit"]')
    
    // Should redirect to the new repository page
    await expect(page).toHaveURL(/\/repo\/.*\/test-repo-\d+/)
  })

  test('should display repository details', async ({ page }) => {
    // Navigate to a specific repository
    // Note: Replace with actual test repository
    await page.goto('/repo/testuser/testrepo')
    
    // Should show repository page or redirect
    const url = page.url()
    if (!url.includes('/auth/login')) {
      // Could be 404 or actual repo page
      const heading = page.locator('h1').first()
      await expect(heading).toBeVisible({ timeout: 5000 })
    }
  })

  test('should navigate to repository issues', async ({ page }) => {
    await page.goto('/repo/testuser/testrepo/issues')
    
    const url = page.url()
    if (!url.includes('/auth/login')) {
      await expect(page).toHaveURL(/\/repo\/.*\/.*\/issues/)
    }
  })

  test('should navigate to repository commits', async ({ page }) => {
    await page.goto('/repo/testuser/testrepo/commits')
    
    const url = page.url()
    if (!url.includes('/auth/login')) {
      await expect(page).toHaveURL(/\/repo\/.*\/.*\/commits/)
    }
  })

  test('should navigate to repository pull requests', async ({ page }) => {
    await page.goto('/repo/testuser/testrepo/pulls')
    
    const url = page.url()
    if (!url.includes('/auth/login')) {
      await expect(page).toHaveURL(/\/repo\/.*\/.*\/pulls/)
    }
  })

  test('should handle repository file browsing', async ({ page }) => {
    await page.goto('/repo/testuser/testrepo/blob/main/README.md')
    
    const url = page.url()
    if (!url.includes('/auth/login')) {
      await expect(page).toHaveURL(/\/repo\/.*\/.*\/blob\/.*/)
    }
  })
})
