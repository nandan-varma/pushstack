import { test, expect } from '@playwright/test'

// Generate unique test credentials for each test run  
const timestamp = Date.now()
const testUser = {
  name: `Test User`,
  username: `testuser${timestamp}`,
  email: `pushstack.test.${timestamp}@gmail.com`,
  password: 'SecurePassword123!',
  invalidPassword: 'WrongPassword123!',
}

test.describe('Authentication Flow E2E', () => {
  test.describe('Protected Routes', () => {
    test('should redirect to login when accessing protected routes', async ({ page }) => {
      // Try to access dashboard without authentication
      await page.goto('/dashboard')

      // Should redirect to login
      await expect(page).toHaveURL(/\/auth\/login/)
      await expect(page.locator('h1')).toContainText('Welcome to PushStack')
    })

    test('should redirect to login when accessing repositories', async ({ page }) => {
      await page.goto('/repositories')
      await expect(page).toHaveURL(/\/auth\/login/)
    })
  })

  test.describe('Form Validation', () => {
    test('should show registration form with all fields', async ({ page }) => {
      await page.goto('/auth/register')

      // Check for registration form elements
      await expect(page.locator('h1')).toContainText('Join')
      await expect(page.locator('input#name')).toBeVisible()
      await expect(page.locator('input#username')).toBeVisible()
      await expect(page.locator('input#email')).toBeVisible()
      await expect(page.locator('input#password')).toBeVisible()
      await expect(page.locator('input#confirmPassword')).toBeVisible()
      await expect(page.locator('button[type="submit"]')).toBeVisible()
    })

    test('should show all login form elements', async ({ page }) => {
      await page.goto('/auth/login')

      // Check for login form elements
      await expect(page.locator('h1')).toContainText('Welcome to PushStack')
      await expect(page.locator('input#identifier')).toBeVisible()
      await expect(page.locator('input#password')).toBeVisible()
      await expect(page.locator('button[type="submit"]')).toBeVisible()
      await expect(page.locator('text=/forgot password/i')).toBeVisible()
      await expect(page.locator('text=/create one/i')).toBeVisible()
    })

    test('should reject invalid credentials', async ({ page }) => {
      await page.goto('/auth/login')

      // Fill in invalid credentials
      const invalidEmail = `nonexistent${Date.now()}@testmail.com`
      await page.locator('input#identifier').pressSequentially(invalidEmail, { delay: 50 })
      await page.locator('input#password').pressSequentially('wrongpassword123', { delay: 50 })

      // Submit form
      await page.click('button[type="submit"]')

      // Should stay on login page
      await expect(page).toHaveURL(/\/auth\/login/, { timeout: 5000 })
    })
  })

  // Serial execution ensures user exists before login/logout tests
  test.describe.serial('Full Auth Flow', () => {
    test('should successfully register a new user', async ({ page }) => {
      await page.goto('/auth/register')

      // Fill in registration form
      await page.locator('input#name').pressSequentially(testUser.name, { delay: 50 })
      await page.locator('input#username').pressSequentially(testUser.username, { delay: 50 })
      await page.locator('input#email').pressSequentially(testUser.email, { delay: 50 })
      await page.locator('input#password').pressSequentially(testUser.password, { delay: 50 })
      await page.locator('input#confirmPassword').pressSequentially(testUser.password, { delay: 50 })

      // Submit form and wait for navigation
      await Promise.all([
        page.waitForURL('/dashboard', { timeout: 15000 }),
        page.click('button[type="submit"]')
      ])

      // Verify user is logged in
      await expect(page.locator('button:has-text("Sign out")')).toBeVisible()
    })

    test('should successfully login with valid credentials', async ({ page }) => {
      await page.goto('/auth/login')

      // Fill in valid credentials
      await page.locator('input#identifier').pressSequentially(testUser.email, { delay: 50 })
      await page.locator('input#password').pressSequentially(testUser.password, { delay: 50 })

      // Submit form and wait for navigation
      await Promise.all([
        page.waitForURL('/dashboard', { timeout: 15000 }),
        page.click('button[type="submit"]')
      ])

      // Verify user is logged in
      await expect(page.locator('button:has-text("Sign out")')).toBeVisible()
    })

    test('should persist session after page reload', async ({ page }) => {
      // Login
      await page.goto('/auth/login')
      await page.locator('input#identifier').pressSequentially(testUser.email, { delay: 50 })
      await page.locator('input#password').pressSequentially(testUser.password, { delay: 50 })
      
      await Promise.all([
        page.waitForURL('/dashboard', { timeout: 15000 }),
        page.click('button[type="submit"]')
      ])

      // Reload page
      await page.reload()

      // Should still be logged in
      await expect(page).toHaveURL('/dashboard')
      await expect(page.locator('button:has-text("Sign out")')).toBeVisible()
    })

    test('should successfully logout', async ({ page }) => {
      // Login
      await page.goto('/auth/login')
      await page.locator('input#identifier').pressSequentially(testUser.email, { delay: 50 })
      await page.locator('input#password').pressSequentially(testUser.password, { delay: 50 })
      
      await Promise.all([
        page.waitForURL('/dashboard', { timeout: 15000 }),
        page.click('button[type="submit"]')
      ])

      // Click sign out button
      await page.click('button:has-text("Sign out")')

      // Wait for navigation to home
      await page.waitForURL('/', { timeout: 10000 })

      // Verify logged out
      await expect(page.locator('a:has-text("Sign in")')).toBeVisible()
    })

    test('should not access protected routes after logout', async ({ page }) => {
      // Login
      await page.goto('/auth/login')
      await page.locator('input#identifier').pressSequentially(testUser.email, { delay: 50 })
      await page.locator('input#password').pressSequentially(testUser.password, { delay: 50 })
      
      await Promise.all([
        page.waitForURL('/dashboard', { timeout: 15000 }),
        page.click('button[type="submit"]')
      ])

      // Logout
      await page.click('button:has-text("Sign out")')
      await page.waitForURL('/', { timeout: 10000 })

      // Try to access dashboard
      await page.goto('/dashboard')

      // Should redirect to login
      await expect(page).toHaveURL(/\/auth\/login/)
    })
  })

  test.describe('Password Reset Flow', () => {
    test('should show forgot password form', async ({ page }) => {
      await page.goto('/auth/forgot-password')

      // Check for forgot password form
      await expect(page.locator('h1')).toContainText(/reset.*password/i)
      await expect(page.locator('input[type="email"]')).toBeVisible()
      await expect(page.locator('button[type="submit"]')).toBeVisible()
    })

    test('should navigate to forgot password from login', async ({ page }) => {
      await page.goto('/auth/login')

      // Click forgot password link
      await page.click('text=/forgot password/i')

      // Should navigate to forgot password page
      await expect(page).toHaveURL('/auth/forgot-password')
      await expect(page.locator('h1')).toContainText(/reset.*password/i)
    })
  })

  test.describe('Navigation Between Auth Pages', () => {
    test('should navigate from login to registration', async ({ page }) => {
      await page.goto('/auth/login')

      // Click create account link
      await page.click('text=/create one/i')

      // Should navigate to registration page
      await expect(page).toHaveURL('/auth/register')
      await expect(page.locator('h1')).toContainText('Join')
    })

    test('should navigate from registration to login', async ({ page }) => {
      await page.goto('/auth/register')

      // Click sign in link
      await page.click('a:has-text("Sign in")')

      // Should navigate to login page
      await expect(page).toHaveURL('/auth/login')
      await expect(page.locator('h1')).toContainText('Welcome to PushStack')
    })
  })
})
