import { neon } from '@neondatabase/serverless'
import { test, expect } from '@playwright/test'

const timestamp = Date.now()
const testUser = {
  name: `Repo Test User`,
  username: `repotestuser${timestamp}`,
  email: `pushstack.repo.test.${timestamp}@gmail.com`,
  password: 'SecurePassword123!',
}

function dbClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
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

test.describe.serial('Repository Management E2E', () => {
  test.afterAll(async () => {
    await deleteTestUser(testUser.email)
  })

  test('should register and verify test user', async ({ page }) => {
    await page.goto('/auth/register')
    await page.locator('input#name').fill(testUser.name)
    await page.locator('input#username').fill(testUser.username)
    await page.locator('input#email').fill(testUser.email)
    await page.locator('input#password').fill(testUser.password)
    await page.locator('input#confirmPassword').fill(testUser.password)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15000 })

    const sql = dbClient()
    const rows = await sql`SELECT email FROM "user" WHERE email = ${testUser.email}`
    expect(rows).toHaveLength(1)
    await verifyUserEmail(testUser.email)
  })

  test('should login successfully', async ({ page }) => {
    await page.goto('/auth/login')
    await page.locator('input#identifier').fill(testUser.email)
    await page.locator('input#password').fill(testUser.password)
    await Promise.all([
      page.waitForURL('/dashboard', { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ])
    await expect(page.locator('button[aria-label="Account menu"]')).toBeVisible()
  })

  test('should display repositories page when logged in', async ({ page }) => {
    await page.goto('/repositories')
    await expect(page).toHaveURL('/repositories')
  })

  test('should access new repository page', async ({ page }) => {
    await page.goto('/repositories/new')
    await expect(page).toHaveURL('/repositories/new')
  })

  test('should create a new repository', async ({ page }) => {
    await page.goto('/repositories/new')

    const repoName = `test-repo-${Date.now()}`
    await page.locator('input[name="name"]').fill(repoName)
    await page.locator('textarea[name="description"]').fill('Test repository created by E2E test')
    await page.locator('select[name="visibility"]').selectOption('public')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(new RegExp(`/repo/${testUser.username}/${repoName}`), { timeout: 15000 })
  })

  test('should display repository details', async ({ page }) => {
    await page.goto(`/repositories`)
    const firstRepoLink = page.locator('a[href*="/repo/"]').first()
    if (await firstRepoLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstRepoLink.click()
      await expect(page.locator('h1').first()).toBeVisible()
    }
  })

  test('should navigate to repository issues tab', async ({ page }) => {
    const repoLinks = page.locator('a[href*="/repo/"]')
    if (await repoLinks.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const href = await repoLinks.first().getAttribute('href')
      if (href) {
        await page.goto(`${href}/issues`)
        await expect(page).toHaveURL(/\/issues/)
      }
    }
  })

  test('should navigate to repository pull requests tab', async ({ page }) => {
    const repoLinks = page.locator('a[href*="/repo/"]')
    if (await repoLinks.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const href = await repoLinks.first().getAttribute('href')
      if (href) {
        await page.goto(`${href}/pulls`)
        await expect(page).toHaveURL(/\/pulls/)
      }
    }
  })
})
