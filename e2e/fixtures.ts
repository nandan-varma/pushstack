import { test as base } from '@playwright/test'

// Extend base test with custom fixtures
export const test = base.extend({
  // Authenticated user fixture
  authenticatedPage: async ({ page }, use) => {
    // This is a placeholder for authentication logic
    // In a real scenario, you would:
    // 1. Navigate to login
    // 2. Fill credentials
    // 3. Submit and wait for redirect
    
    // For now, just pass the page through
    await use(page)
  },

  // Mock API responses
  mockApiResponses: async ({ page }, use) => {
    // Intercept API calls and provide mock responses
    await page.route('**/api/**', (route) => {
      // You can customize responses based on URL
      const url = route.request().url()
      
      if (url.includes('/api/repositories')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            repositories: [
              { id: 1, name: 'test-repo-1', description: 'Test 1' },
              { id: 2, name: 'test-repo-2', description: 'Test 2' },
            ],
          }),
        })
      } else {
        route.continue()
      }
    })
    
    await use(page)
  },
})

export { expect } from '@playwright/test'
