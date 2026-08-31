import type { Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import { dbClient, deleteTestUser, gotoAndWaitForHydration, verifyUserEmail } from './helpers'

const timestamp = Date.now()
const testUser = {
  name: `Repo Test User`,
  username: `repotestuser${timestamp}`,
  email: `pushstack.repo.test.${timestamp}@gmail.com`,
  password: 'SecurePassword123!',
}
const repoName = `test-repo-${timestamp}`

test.describe.serial('Repository Management E2E', () => {
  // A single page/session reused across every test below — the fixture-
  // provided `page` gets a fresh, cookie-less browser context per test, so
  // login from "should login successfully" would never be visible to the
  // tests after it. See https://playwright.dev/docs/test-retries#reuse-single-page-between-tests.
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
  })

  test.afterAll(async () => {
    await page.close()
    await deleteTestUser(testUser.email)
  })

  test('should register and verify test user', async () => {
    await gotoAndWaitForHydration(page, '/auth/register')
    await page.locator('input#name').fill(testUser.name)
    await page.locator('input#username').fill(testUser.username)
    await page.locator('input#email').fill(testUser.email)
    await page.locator('input#password').fill(testUser.password)
    await page.locator('input#confirmPassword').fill(testUser.password)
    await page.click('button[type="submit"]')
    // Email verification is required before a session exists — signUp stays
    // on /auth/register and shows a "Check your email" panel instead of
    // redirecting (see auth.spec.ts's registration test).
    await expect(page.locator('h1')).toContainText('Check your email', { timeout: 15000 })

    const sql = dbClient()
    const rows = await sql`SELECT email FROM "user" WHERE email = ${testUser.email}`
    expect(rows).toHaveLength(1)
    await verifyUserEmail(testUser.email)
  })

  test('should login successfully', async () => {
    await gotoAndWaitForHydration(page, '/auth/login')
    await page.locator('input#identifier').fill(testUser.email)
    await page.locator('input#password').fill(testUser.password)
    await Promise.all([
      page.waitForURL('/dashboard', { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ])
    await expect(page.locator('button[aria-label="Account menu"]')).toBeVisible()
  })

  test('should display repositories page when logged in', async () => {
    await page.goto('/repositories')
    await expect(page).toHaveURL('/repositories')
  })

  test('should access new repository page', async () => {
    await page.goto('/repositories/new')
    await expect(page).toHaveURL('/repositories/new')
  })

  test('should create a new repository', async () => {
    await gotoAndWaitForHydration(page, '/repositories/new')

    await page.locator('input#name').fill(repoName)
    await page.locator('textarea#description').fill('Test repository created by E2E test')
    // "Public" is the default-checked radio (see new.tsx's `visibility` state),
    // so no explicit selection is needed for the common case — this asserts
    // that default stays true rather than silently relying on it.
    await expect(page.getByRole('radio', { name: /^Public/ })).toBeChecked()
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(new RegExp(`/repo/${testUser.username}/${repoName}`), { timeout: 15000 })
  })

  test('should display repository details', async () => {
    await page.goto(`/repo/${testUser.username}/${repoName}`)
    await expect(page.getByText(repoName).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create new file' })).toBeVisible()
  })

  test('should navigate to repository issues tab and show the empty state', async () => {
    await page.goto(`/repo/${testUser.username}/${repoName}/issues`)
    await expect(page).toHaveURL(new RegExp(`/repo/${testUser.username}/${repoName}/issues`))
    await expect(page.getByText(/no issues|no open issues/i)).toBeVisible()
  })

  test('should navigate to repository pull requests tab and show the empty state', async () => {
    await page.goto(`/repo/${testUser.username}/${repoName}/pulls`)
    await expect(page).toHaveURL(new RegExp(`/repo/${testUser.username}/${repoName}/pulls`))
    await expect(page.getByText(/no pull requests|no open pull requests/i)).toBeVisible()
  })

  test('should delete the repository via the settings danger zone', async () => {
    await gotoAndWaitForHydration(page, `/repo/${testUser.username}/${repoName}/settings`)
    await page.getByPlaceholder(`Type "${repoName}" to confirm`).fill(repoName)
    await page.getByRole('button', { name: 'Delete repository' }).click()
    await expect(page).toHaveURL('/repositories', { timeout: 15000 })

    // The repo (and its git storage) should really be gone, not just hidden
    // from this page — a stale row would silently orphan its R2/local
    // storage per git-repo-storage.ts's rename/delete cleanup contract.
    await page.goto(`/repo/${testUser.username}/${repoName}`)
    await expect(page.getByText(/not found/i)).toBeVisible()
  })
})
