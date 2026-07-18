/**
 * Git Manager Service (isomorphic-git)
 *
 * Manages git repositories using isomorphic-git for Worker/edge compatibility.
 * This is the foundation layer for all git operations.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoCache, invalidateRepoCache } from "@nandan-varma/git-edge";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { gitFs } from "./git-fs";
import {
	getRepoGitStorageRoot,
	sanitizeStorageSegment,
} from "./git-storage-naming";

// ponytail: /tmp is the only writable dir on Vercel; homedir is read-only
const GIT_BASE_PATH =
	process.env.GIT_REPOS_PATH || path.join(os.tmpdir(), "pushstack-repos");
const DEFAULT_USER_NAME = "PushStack";
const DEFAULT_USER_EMAIL = "system@pushstack.dev";

/**
 * Get the filesystem path for a repository.
 *
 * ownerKey/repoName ultimately trace back to user input (repo name at
 * creation, username at registration) — callers are expected to have already
 * gone through sanitizeStorageSegment (e.g. via getRepoStorageCoordinates),
 * but this is the actual path.join into real disk, so it re-sanitizes and
 * verifies containment itself rather than trusting every call site to have
 * done so upstream. Without this, a repo/owner segment of ".." (which
 * sanitizeStorageSegment alone would leave unstripped were it ever skipped)
 * joined via path.join resolves as a real directory traversal.
 */
export function getRepoPath(ownerKey: string, repoName: string): string {
	const safeOwnerKey = sanitizeStorageSegment(ownerKey);
	const safeRepoName = sanitizeStorageSegment(repoName);
	const resolved = path.resolve(GIT_BASE_PATH, safeOwnerKey, safeRepoName);
	const base = path.resolve(GIT_BASE_PATH);
	if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
		throw new Error(
			`Refusing to resolve repo path outside storage root: ${ownerKey}/${repoName}`,
		);
	}
	return resolved;
}

// isomorphic-git re-parses a packfile's index from scratch on every readTree/log/readObject
// call unless callers share a `cache` object across calls — without this, operations that
// touch many objects (e.g. walking commit history) pay that parse cost hundreds of times over.
// Objects are content-addressed/immutable so a long-lived per-repo cache is safe; it's cleared
// in git-repo-storage.ts on sync so a repack (which rewrites pack files) can't leave it stale.
// Delegated to @nandan-varma/git-edge's per-repo cache management.

export function getRepoGitCache(ownerKey: string, repoName: string): object {
	return getRepoCache(ownerKey, repoName);
}

export function invalidateRepoGitCache(
	ownerKey: string,
	repoName: string,
): void {
	invalidateRepoCache(ownerKey, repoName);
}

export function getBareRepoOptions(ownerKey: string, repoName: string) {
	const cache = getRepoGitCache(ownerKey, repoName);
	if (isR2Configured()) {
		return {
			fs: gitFs,
			gitdir: getRepoGitStorageRoot(ownerKey, repoName),
			cache,
		};
	}
	return { fs, gitdir: getRepoPath(ownerKey, repoName), cache };
}

/**
 * Ensure the base git directory exists
 */
export async function ensureGitBaseDir(): Promise<void> {
	await fs.mkdir(GIT_BASE_PATH, { recursive: true });
}

/**
 * Initialize a new repository
 */
export async function initBareRepo(
	ownerKey: string,
	repoName: string,
	defaultBranch: string = "main",
): Promise<string> {
	// No git.setConfig calls here: getDefaultAuthor() (below) returns
	// DEFAULT_USER_NAME/DEFAULT_USER_EMAIL directly as plain JS constants —
	// nothing anywhere ever reads user.name/user.email back out of a repo's
	// git config, so writing them was always dead weight. It was also
	// silently writing to the wrong path: setConfig defaults its internal
	// `gitdir` to `join(dir, '.git')` unless a `gitdir` param is passed
	// explicitly, and this call only ever passed `dir` — for a bare repo
	// (gitdir === dir, no nested `.git`), that resolved to a bogus
	// `<gitdir>/.git/config` key that nothing else ever read, costing an
	// extra ~450-600ms of R2 round trips per repo creation (a failed probe
	// read, then a write, then a second read that only "succeeded" because
	// the first call had just created the bogus file) for a config file nothing
	// consults, while the *actual* bare-repo config (written by git.init,
	// just above) never got a [user] section at all.
	if (isR2Configured()) {
		const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
		await git.init({ fs: gitFs, dir: gitdir, defaultBranch, bare: true });
		return gitdir;
	}

	const dir = getRepoPath(ownerKey, repoName);
	await fs.mkdir(path.dirname(dir), { recursive: true });
	await fs.mkdir(dir, { recursive: true });
	await git.init({ fs, dir, defaultBranch, bare: true });
	return dir;
}

/**
 * Delete a repository from filesystem
 */
export async function deleteRepo(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const dir = getRepoPath(ownerKey, repoName);

	try {
		await fs.rm(dir, { recursive: true, force: true });
	} catch (error) {
		throw new Error(`Failed to delete repository at ${dir}: ${error}`);
	}
}

/**
 * Get disk usage of a repository
 */
export async function getRepoDiskUsage(dir: string): Promise<number> {
	async function calculateSize(dirPath: string): Promise<number> {
		let entries: import("node:fs").Dirent<string>[];
		try {
			entries = await fs.readdir(dirPath, { withFileTypes: true });
		} catch {
			return 0;
		}

		// ponytail: repos can have thousands of loose objects — stat them concurrently
		// instead of one fs call at a time, which serialized this walk on every push.
		const sizes = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(dirPath, entry.name);
				if (entry.isDirectory()) {
					return calculateSize(fullPath);
				}
				const stats = await fs.stat(fullPath);
				return stats.size;
			}),
		);

		return sizes.reduce((sum, size) => sum + size, 0);
	}

	return calculateSize(dir);
}

/**
 * Default author object
 */
export function getDefaultAuthor() {
	return {
		name: DEFAULT_USER_NAME,
		email: DEFAULT_USER_EMAIL,
		timestamp: Math.floor(Date.now() / 1000),
		timezoneOffset: 0,
	};
}
