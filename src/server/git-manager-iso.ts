/**
 * Git Manager Service (isomorphic-git)
 *
 * Manages git repositories using isomorphic-git for Worker/edge compatibility.
 * This is the foundation layer for all git operations.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { r2Backend } from "./git-r2-backend";
import { getRepoGitStorageRoot } from "./git-storage-naming";

// ponytail: /tmp is the only writable dir on Vercel; homedir is read-only
const GIT_BASE_PATH =
	process.env.GIT_REPOS_PATH || path.join(os.tmpdir(), "pushstack-repos");
const DEFAULT_USER_NAME = "PushStack";
const DEFAULT_USER_EMAIL = "system@pushstack.dev";

/**
 * Get the filesystem path for a repository
 */
export function getRepoPath(ownerKey: string, repoName: string): string {
	return path.join(GIT_BASE_PATH, ownerKey, repoName);
}

// isomorphic-git re-parses a packfile's index from scratch on every readTree/log/readObject
// call unless callers share a `cache` object across calls — without this, operations that
// touch many objects (e.g. walking commit history) pay that parse cost hundreds of times over.
// Objects are content-addressed/immutable so a long-lived per-repo cache is safe; it's cleared
// in git-repo-storage.ts on sync so a repack (which rewrites pack files) can't leave it stale.
const repoGitCaches = new Map<string, object>();

function getRepoGitCacheKey(ownerKey: string, repoName: string): string {
	return `${ownerKey}/${repoName}`;
}

export function getRepoGitCache(ownerKey: string, repoName: string): object {
	const key = getRepoGitCacheKey(ownerKey, repoName);
	let cache = repoGitCaches.get(key);
	if (!cache) {
		cache = {};
		repoGitCaches.set(key, cache);
	}
	return cache;
}

export function invalidateRepoGitCache(
	ownerKey: string,
	repoName: string,
): void {
	repoGitCaches.delete(getRepoGitCacheKey(ownerKey, repoName));
}

export function getBareRepoOptions(ownerKey: string, repoName: string) {
	const cache = getRepoGitCache(ownerKey, repoName);
	if (isR2Configured()) {
		return {
			fs: r2Backend,
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
	if (isR2Configured()) {
		const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
		await git.init({ fs: r2Backend, dir: gitdir, defaultBranch, bare: true });
		await git.setConfig({
			fs: r2Backend,
			dir: gitdir,
			path: "user.name",
			value: DEFAULT_USER_NAME,
		});
		await git.setConfig({
			fs: r2Backend,
			dir: gitdir,
			path: "user.email",
			value: DEFAULT_USER_EMAIL,
		});
		return gitdir;
	}

	const dir = getRepoPath(ownerKey, repoName);
	await fs.mkdir(path.dirname(dir), { recursive: true });
	await fs.mkdir(dir, { recursive: true });
	await git.init({ fs, dir, defaultBranch, bare: true });
	await git.setConfig({ fs, dir, path: "user.name", value: DEFAULT_USER_NAME });
	await git.setConfig({
		fs,
		dir,
		path: "user.email",
		value: DEFAULT_USER_EMAIL,
	});
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
