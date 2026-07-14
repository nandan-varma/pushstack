import { neon } from '@neondatabase/serverless'
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

// The app requires email verification before a session can be created
// (see requireEmailVerification: true in src/lib/auth.ts), so sign-up never
// auto-logs a user in. There's no way to read the real verification email in
// this environment, so these helpers flip the same DB column the real
// verify-email link would flip, using the app's actual Postgres database —
// this is real DB state, not a mock of any app behavior.
function dbClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — cannot verify test user email')
  }
  return neon(process.env.DATABASE_URL)
}

async function verifyUserEmail(email: string) {
  const sql = dbClient()
  await sql`UPDATE "user" SET "emailVerified" = true WHERE email = ${email}`
}

async function deleteTestUser(email: string) {
  const sql = dbClient()
  await sql`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ${email})`
  await sql`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE email = ${email})`
  await sql`DELETE FROM "user" WHERE email = ${email}`
}

test.describe('Authentication Flow E2E', () => {
  test.describe('Protected Routes', () => {
    test('should redirect to login when accessing protected routes', async ({ page }) => {
      // Try to access dashboard without authentication
      await page.goto('/dashboard')

      // Should redirect to login
      await expect(page).toHaveURL(/\/auth\/login/)
      await expect(page.locator('h1')).toContainText('Welcome back')
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
      await expect(page.locator('h1')).toContainText('Create your account')
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
      await expect(page.locator('h1')).toContainText('Welcome back')
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
      await page.locator('input#identifier').fill(invalidEmail)
      await page.locator('input#password').fill('wrongpassword123')

      // Submit form
      await page.click('button[type="submit"]')

      // Should stay on login page
      await expect(page).toHaveURL(/\/auth\/login/, { timeout: 5000 })
    })
  })

  // Serial execution ensures user exists before login/logout tests
  test.describe.serial('Full Auth Flow', () => {
    test.afterAll(async () => {
      await deleteTestUser(testUser.email)
    })

    test('should successfully register a new user', async ({ page }) => {
      await page.goto('/auth/register')

      // Fill in registration form
      await page.locator('input#name').fill(testUser.name)
      await page.locator('input#username').fill(testUser.username)
      await page.locator('input#email').fill(testUser.email)
      await page.locator('input#password').fill(testUser.password)
      await page.locator('input#confirmPassword').fill(testUser.password)

      // Submit the form. The app requires email verification before a
      // session exists, so signUp does not log the user in — it bounces
      // back to /auth/login instead of landing on /dashboard.
      await page.click('button[type="submit"]')
      await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15000 })

      // Confirm the account actually exists in the real DB before verifying it.
      const sql = dbClient()
      const rows = await sql`SELECT email FROM "user" WHERE email = ${testUser.email}`
      expect(rows).toHaveLength(1)

      // Verify the email the same way clicking the emailed link would.
      await verifyUserEmail(testUser.email)
    })

    // Login once and exercise persistence + logout in a single continuous
    // session — better-auth's rate limiter (20 req/60s, see src/lib/auth.ts)
    // counts every sign-in POST *and* every get-session GET the header fires
    // on each navigation, so re-logging-in via the UI per assertion trips it.
    test('should login, persist session across reload, and log out', async ({ page }) => {
      await page.goto('/auth/login')
      await page.locator('input#identifier').fill(testUser.email)
      await page.locator('input#password').fill(testUser.password)

      await Promise.all([
        page.waitForURL('/dashboard', { timeout: 15000 }),
        page.click('button[type="submit"]')
      ])

      // Logged in
      await expect(page.locator('button[aria-label="Account menu"]')).toBeVisible()

      // Session persists across a reload
      await page.reload()
      await expect(page).toHaveURL('/dashboard')
      await expect(page.locator('button[aria-label="Account menu"]')).toBeVisible()

      // Log out via the account menu
      await page.click('button[aria-label="Account menu"]')
      await page.click('[role="menuitem"]:has-text("Sign out")')
      await page.waitForURL('/', { timeout: 10000 })
      await expect(page.locator('a:has-text("Sign in")')).toBeVisible()

      // Protected routes are no longer reachable
      await page.goto('/dashboard')
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
      await expect(page.locator('h1')).toContainText('Create your account')
    })

    test('should navigate from registration to login', async ({ page }) => {
      await page.goto('/auth/register')

      // Click sign in link
      await page.click('a:has-text("Sign in")')

      // Should navigate to login page
      await expect(page).toHaveURL('/auth/login')
      await expect(page.locator('h1')).toContainText('Welcome back')
    })
  })
})
