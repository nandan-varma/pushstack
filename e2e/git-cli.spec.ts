import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { test, expect } from '@playwright/test'
import { deleteTestUser, gotoAndWaitForHydration, verifyUserEmail } from './helpers'

/**
 * End-to-end test of the real Git Smart HTTP protocol (git-http-iso.ts /
 * api/git.$.ts) using the actual `git` binary — everything else in this repo
 * tests that path through isomorphic-git (git-integration.test.ts) or
 * git-fs-s3's own test suite, both of which share the *same* library that
 * implements the server side. A real git client is the only thing that
 * verifies actual wire-protocol compatibility, not just "isomorphic-git can
 * talk to itself".
 *
 * Every `git` invocation runs with an isolated HOME/GIT_CONFIG_GLOBAL in a
 * throwaway temp directory — never the machine's real ~/.gitconfig or
 * credential store.
 */

const execFileAsync = promisify(execFile)

const timestamp = Date.now()
const testUser = {
	name: 'Git CLI Test User',
	username: `gitclitest${timestamp}`,
	email: `pushstack.gitcli.test.${timestamp}@gmail.com`,
	password: 'SecurePassword123!',
}
const repoName = `git-cli-test-repo-${timestamp}`

let homeDir: string
let workDir: string

function remoteUrl(credentials?: { username: string; password: string }) {
	const auth = credentials
		? `${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@`
		: ''
	return `http://${auth}localhost:3000/api/git/${testUser.username}/${repoName}.git`
}

async function git(args: string[], cwd: string) {
	return execFileAsync(
		'git',
		[
			// Disabling the credential helper here (not just via an isolated
			// GIT_CONFIG_GLOBAL/SYSTEM) is what actually stops git from touching
			// the real macOS Keychain: `credential.helper=osxkeychain` on Mac
			// git installs is often wired in as a hardcoded fallback, not
			// something that lives in a config file this test could shadow. On
			// a 401 (the wrong-password test), git's credential subsystem would
			// otherwise be free to query *or write to* the user's real Keychain.
			'-c',
			'credential.helper=',
			...args,
		],
		{
			cwd,
			env: {
				...process.env,
				HOME: homeDir,
				GIT_CONFIG_GLOBAL: path.join(homeDir, '.gitconfig'),
				GIT_CONFIG_SYSTEM: '/dev/null',
				GIT_AUTHOR_NAME: testUser.name,
				GIT_AUTHOR_EMAIL: testUser.email,
				GIT_COMMITTER_NAME: testUser.name,
				GIT_COMMITTER_EMAIL: testUser.email,
				// Belt-and-suspenders on top of `-c credential.helper=` above:
				// no terminal prompt, no GUI askpass, and no credential manager
				// fallback can fire, so a 401 fails fast instead of trying to
				// interactively (or silently) source a credential from anywhere
				// on the machine.
				GIT_TERMINAL_PROMPT: '0',
				GIT_ASKPASS: '/bin/echo',
				SSH_ASKPASS: '/bin/echo',
				GCM_INTERACTIVE: 'never',
			},
			timeout: 30_000,
		},
	)
}

test.describe.serial('Git CLI protocol E2E', () => {
	let page: Page

	test.beforeAll(async ({ browser }) => {
		homeDir = await mkdtemp(path.join(tmpdir(), 'pushstack-git-cli-home-'))
		workDir = await mkdtemp(path.join(tmpdir(), 'pushstack-git-cli-work-'))
		page = await browser.newPage()
	})

	test.afterAll(async () => {
		await page.close()
		await rm(homeDir, { recursive: true, force: true })
		await rm(workDir, { recursive: true, force: true })
		await deleteTestUser(testUser.email)
	})

	test('registers and verifies the test user', async () => {
		await gotoAndWaitForHydration(page, '/auth/register')
		await page.locator('input#name').fill(testUser.name)
		await page.locator('input#username').fill(testUser.username)
		await page.locator('input#email').fill(testUser.email)
		await page.locator('input#password').fill(testUser.password)
		await page.locator('input#confirmPassword').fill(testUser.password)
		await page.click('button[type="submit"]')
		await expect(page.locator('h1')).toContainText('Check your email', { timeout: 15000 })
		await verifyUserEmail(testUser.email)
	})

	test('logs in and creates a public repository via the UI', async () => {
		await gotoAndWaitForHydration(page, '/auth/login')
		await page.locator('input#identifier').fill(testUser.email)
		await page.locator('input#password').fill(testUser.password)
		await Promise.all([
			page.waitForURL('/dashboard', { timeout: 15000 }),
			page.click('button[type="submit"]'),
		])

		await gotoAndWaitForHydration(page, '/repositories/new')
		await page.locator('input#name').fill(repoName)
		await page.click('button[type="submit"]')
		await expect(page).toHaveURL(new RegExp(`/repo/${testUser.username}/${repoName}`), {
			timeout: 15000,
		})
	})

	test('clones the freshly created (empty) repository over HTTP', async () => {
		const cloneDir = path.join(workDir, 'clone1')
		await git(['clone', remoteUrl({ username: testUser.username, password: testUser.password }), cloneDir], workDir)
		await expect(readFile(path.join(cloneDir, '.git', 'HEAD'), 'utf8')).resolves.toContain('ref:')
	})

	test('pushes an initial commit on main', async () => {
		const cloneDir = path.join(workDir, 'clone1')
		await writeFile(
			path.join(cloneDir, 'README.md'),
			`# ${repoName}\n\nCreated by the git-cli E2E test.\n`,
		)
		await git(['checkout', '-B', 'main'], cloneDir)
		await git(['add', 'README.md'], cloneDir)
		await git(['commit', '-m', 'Initial commit'], cloneDir)
		await git(
			['push', remoteUrl({ username: testUser.username, password: testUser.password }), 'main'],
			cloneDir,
		)
	})

	test('a fresh clone sees the pushed commit (round trip through storage)', async () => {
		const cloneDir = path.join(workDir, 'clone2')
		await git(['clone', remoteUrl({ username: testUser.username, password: testUser.password }), cloneDir], workDir)
		const readme = await readFile(path.join(cloneDir, 'README.md'), 'utf8')
		expect(readme).toContain(repoName)

		const { stdout } = await git(['log', '--oneline'], cloneDir)
		expect(stdout).toContain('Initial commit')
	})

	test('pushes a new branch and a second clone can fetch it', async () => {
		const cloneDir = path.join(workDir, 'clone1')
		await git(['checkout', '-b', 'feature'], cloneDir)
		await writeFile(path.join(cloneDir, 'feature.txt'), 'feature work\n')
		await git(['add', 'feature.txt'], cloneDir)
		await git(['commit', '-m', 'Add feature file'], cloneDir)
		await git(
			['push', remoteUrl({ username: testUser.username, password: testUser.password }), 'feature'],
			cloneDir,
		)

		const cloneDir2 = path.join(workDir, 'clone2')
		await git(['fetch', remoteUrl({ username: testUser.username, password: testUser.password }), 'feature'], cloneDir2)
		const { stdout } = await git(['ls-remote', '--heads', remoteUrl({ username: testUser.username, password: testUser.password })], cloneDir2)
		expect(stdout).toContain('refs/heads/feature')
		expect(stdout).toContain('refs/heads/main')
	})

	test('deletes the remote branch via git push --delete', async () => {
		const cloneDir = path.join(workDir, 'clone1')
		await git(
			['push', remoteUrl({ username: testUser.username, password: testUser.password }), '--delete', 'feature'],
			cloneDir,
		)

		const { stdout } = await git(
			['ls-remote', '--heads', remoteUrl({ username: testUser.username, password: testUser.password })],
			cloneDir,
		)
		expect(stdout).not.toContain('refs/heads/feature')
		expect(stdout).toContain('refs/heads/main')
	})

	test('an anonymous clone of the public repo succeeds without credentials', async () => {
		const cloneDir = path.join(workDir, 'anon-clone')
		await git(['clone', remoteUrl(), cloneDir], workDir)
		const readme = await readFile(path.join(cloneDir, 'README.md'), 'utf8')
		expect(readme).toContain(repoName)
	})

	test('a push with the wrong password is rejected', async () => {
		const cloneDir = path.join(workDir, 'clone1')
		await expect(
			git(
				['push', remoteUrl({ username: testUser.username, password: 'definitely-wrong-password' }), 'main'],
				cloneDir,
			),
		).rejects.toThrow()
	})

	test('cleans up: deletes the repository via the settings danger zone', async () => {
		await gotoAndWaitForHydration(page, `/repo/${testUser.username}/${repoName}/settings`)
		await page.getByPlaceholder(`Type "${repoName}" to confirm`).fill(repoName)
		await page.getByRole('button', { name: 'Delete repository' }).click()
		await expect(page).toHaveURL('/repositories', { timeout: 15000 })
	})
})
