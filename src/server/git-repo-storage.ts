import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { repositories } from "#/db/github-schema";
import { isR2Configured } from "#/lib/r2";
import {
	bulkDeleteFromR2,
	bulkUploadToR2,
	downloadFromR2,
	listAllR2Files,
} from "#/lib/r2-operations";
import {
	ensureGitBaseDir,
	getRepoDiskUsage,
	getRepoPath,
	initBareRepo,
} from "./git-manager-iso";
import {
	getLegacyGitPrefixes,
	getRepoGitStoragePrefix,
	getRepoStorageRoot,
} from "./git-storage-naming";

type RepoState = {
	hydratedAt?: number;
	syncedAt?: number;
};

const repoLocks = new Map<string, Promise<void>>();
const repoState = new Map<string, RepoState>();

// ponytail: process.cwd() is read-only on Vercel; /tmp is writable
const LEGACY_GIT_BASE_PATH = path.join(os.tmpdir(), "pushstack-legacy-repos");

function getRepoKey(ownerKey: string, repoName: string): string {
	return `${ownerKey}/${repoName}`;
}

function getRepoPrefix(ownerKey: string, repoName: string): string {
	return getRepoGitStoragePrefix(ownerKey, repoName);
}

function getLegacyLocalRepoPaths(
	legacyOwnerKeys: string[],
	repoName: string,
): string[] {
	const paths = legacyOwnerKeys.flatMap((legacyOwnerKey) => [
		path.join(
			path.dirname(path.dirname(getRepoPath(legacyOwnerKey, repoName))),
			legacyOwnerKey,
			repoName,
		),
		path.join(LEGACY_GIT_BASE_PATH, legacyOwnerKey, repoName),
	]);

	return [...new Set(paths)];
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function promoteLegacyLocalRepo(
	canonicalRepoPath: string,
	legacyRepoPaths: string[],
): Promise<void> {
	if (await pathExists(path.join(canonicalRepoPath, "HEAD"))) {
		return;
	}

	for (const legacyRepoPath of legacyRepoPaths) {
		if (!(await pathExists(path.join(legacyRepoPath, "HEAD")))) {
			continue;
		}

		await fs.mkdir(path.dirname(canonicalRepoPath), { recursive: true });
		await fs.rm(canonicalRepoPath, { recursive: true, force: true });
		await fs.rename(legacyRepoPath, canonicalRepoPath);
		return;
	}
}

async function listLocalFiles(
	dir: string,
	baseDir: string = dir,
): Promise<string[]> {
	let entries: Dirent<string>[];

	try {
		entries = (await fs.readdir(dir, {
			withFileTypes: true,
		})) as Dirent<string>[];
	} catch {
		return [];
	}

	const files = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				return listLocalFiles(fullPath, baseDir);
			}

			if (entry.name.endsWith(".lock")) {
				return [];
			}

			return [path.relative(baseDir, fullPath)];
		}),
	);

	return files.flat().sort();
}

async function writeRemoteFilesToDisk(
	repoPath: string,
	remoteFiles: Awaited<ReturnType<typeof listAllR2Files>>,
	sourcePrefix: string,
) {
	await fs.rm(repoPath, { recursive: true, force: true });
	await fs.mkdir(repoPath, { recursive: true });

	const BATCH_SIZE = 20;
	for (let i = 0; i < remoteFiles.length; i += BATCH_SIZE) {
		const batch = remoteFiles.slice(i, i + BATCH_SIZE);
		await Promise.all(
			batch.map(async (file) => {
				const relativePath = file.key.slice(sourcePrefix.length);
				const destination = path.join(repoPath, relativePath);
				await fs.mkdir(path.dirname(destination), { recursive: true });
				const { content } = await downloadFromR2(file.key);
				await fs.writeFile(destination, content);
			}),
		);
	}
}

async function ensureRepositoryHydratedUnlocked(
	ownerKey: string,
	repoName: string,
	legacyOwnerKeys: string[] = [],
	remoteUpdatedAt?: Date | null,
	defaultBranch: string = "main",
): Promise<string> {
	await ensureGitBaseDir();

	const repoPath = getRepoPath(ownerKey, repoName);
	const repoKey = getRepoKey(ownerKey, repoName);
	const state = repoState.get(repoKey);
	const remoteVersion = remoteUpdatedAt?.getTime();

	if (state?.hydratedAt && remoteVersion && state.hydratedAt >= remoteVersion) {
		return repoPath;
	}

	await promoteLegacyLocalRepo(
		repoPath,
		getLegacyLocalRepoPaths(legacyOwnerKeys, repoName),
	);

	if (!isR2Configured()) {
		try {
			await fs.access(path.join(repoPath, "HEAD"));
		} catch {
			await initBareRepo(ownerKey, repoName, defaultBranch);
		}

		return repoPath;
	}

	const candidatePrefixes = [
		getRepoPrefix(ownerKey, repoName),
		...getLegacyGitPrefixes(legacyOwnerKeys, repoName),
	];

	let remoteFiles: Awaited<ReturnType<typeof listAllR2Files>> = [];
	let sourcePrefix = getRepoPrefix(ownerKey, repoName);
	for (const prefix of candidatePrefixes) {
		remoteFiles = await listAllR2Files(prefix);
		if (remoteFiles.length > 0) {
			sourcePrefix = prefix;
			break;
		}
	}

	if (remoteFiles.length === 0) {
		try {
			await fs.access(path.join(repoPath, "HEAD"));
		} catch {
			await initBareRepo(ownerKey, repoName, defaultBranch);
		}

		repoState.set(repoKey, {
			...state,
			hydratedAt: remoteVersion ?? Date.now(),
		});

		return repoPath;
	}

	await writeRemoteFilesToDisk(repoPath, remoteFiles, sourcePrefix);

	repoState.set(repoKey, {
		...state,
		hydratedAt: remoteVersion ?? Date.now(),
	});

	return repoPath;
}

export async function withRepositoryLock<T>(
	ownerKey: string,
	repoName: string,
	fn: () => Promise<T>,
): Promise<T> {
	const repoKey = getRepoKey(ownerKey, repoName);
	const previous = repoLocks.get(repoKey) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const lockPromise = previous.then(() => current);
	repoLocks.set(repoKey, lockPromise);

	await previous;

	try {
		return await fn();
	} finally {
		release();

		if (repoLocks.get(repoKey) === lockPromise) {
			repoLocks.delete(repoKey);
		}
	}
}

export async function ensureRepositoryHydrated(
	ownerKey: string,
	repoName: string,
	legacyOwnerKeys: string[] = [],
	remoteUpdatedAt?: Date | null,
	defaultBranch: string = "main",
): Promise<string> {
	return withRepositoryLock(ownerKey, repoName, () =>
		ensureRepositoryHydratedUnlocked(
			ownerKey,
			repoName,
			legacyOwnerKeys,
			remoteUpdatedAt,
			defaultBranch,
		),
	);
}

async function updateRepositoryBackupMetadata(
	ownerDbId: string | undefined,
	ownerKey: string,
	repoName: string,
	repoPath: string,
): Promise<void> {
	if (!ownerDbId) {
		return;
	}

	const diskUsage = await getRepoDiskUsage(repoPath);

	await db
		.update(repositories)
		.set({
			diskUsage,
			lastBackupAt: new Date(),
			backupR2Key: getRepoStorageRoot(ownerKey, repoName),
			updatedAt: new Date(),
		})
		.where(
			and(eq(repositories.ownerId, ownerDbId), eq(repositories.name, repoName)),
		);
}

export async function syncRepositoryToR2(
	ownerKey: string,
	repoName: string,
	ownerDbId?: string,
	legacyOwnerKeys: string[] = [],
): Promise<void> {
	await withRepositoryLock(ownerKey, repoName, () =>
		syncRepositoryToR2Unlocked(ownerKey, repoName, ownerDbId, legacyOwnerKeys),
	);
}

export async function initRepositoryStorage(
	ownerKey: string,
	repoName: string,
	defaultBranch: string = "main",
): Promise<string> {
	return withRepositoryLock(ownerKey, repoName, async () => {
		const repoPath = await initBareRepo(ownerKey, repoName, defaultBranch);
		await syncRepositoryToR2Unlocked(ownerKey, repoName);
		return repoPath;
	});
}

async function branchExists(
	gitdir: string,
	branchName: string,
): Promise<boolean> {
	const git = await import("isomorphic-git");

	try {
		await git.resolveRef({
			fs,
			gitdir,
			ref: `refs/heads/${branchName}`,
		});
		return true;
	} catch {
		return false;
	}
}

export async function withRepositoryWorktree<T>(
	ownerKey: string,
	repoName: string,
	branchName: string,
	fn: (context: { worktreePath: string; gitdir: string }) => Promise<T>,
	defaultBranch: string = "main",
	legacyOwnerKeys: string[] = [],
	ownerDbId?: string,
): Promise<T> {
	return withRepositoryLock(ownerKey, repoName, async () => {
		const gitdir = await ensureRepositoryHydratedUnlocked(
			ownerKey,
			repoName,
			legacyOwnerKeys,
			undefined,
			defaultBranch,
		);
		const worktreeRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), `pushstack-${ownerKey}-${repoName}-`),
		);
		const worktreePath = path.join(worktreeRoot, "worktree");

		try {
			const { execFile } = await import("node:child_process");
			const run = (args: string[]) =>
				new Promise<void>((resolve, reject) => {
					execFile("git", args, (error) => {
						if (error) {
							reject(error);
							return;
						}
						resolve();
					});
				});

			await run(["clone", gitdir, worktreePath]);

			if (await branchExists(gitdir, branchName)) {
				await run(["-C", worktreePath, "checkout", branchName]);
			} else {
				await run(["-C", worktreePath, "checkout", "-B", branchName]);
			}

			const result = await fn({ worktreePath, gitdir });
			await run([
				"-C",
				worktreePath,
				"push",
				"origin",
				`HEAD:refs/heads/${branchName}`,
			]);
			await syncRepositoryToR2Unlocked(
				ownerKey,
				repoName,
				ownerDbId,
				legacyOwnerKeys,
			);
			return result;
		} finally {
			await fs.rm(worktreeRoot, { recursive: true, force: true });
		}
	});
}

export async function deleteRepositoryFromR2(
	ownerKey: string,
	repoName: string,
	legacyOwnerKeys: string[] = [],
): Promise<void> {
	if (!isR2Configured()) return;

	const prefix = getRepoPrefix(ownerKey, repoName);
	const files = await listAllR2Files(prefix);
	if (files.length > 0) {
		await bulkDeleteFromR2(files.map((f) => f.key));
	}

	const legacyPrefixes = getLegacyGitPrefixes(legacyOwnerKeys, repoName);
	for (const legacyPrefix of legacyPrefixes) {
		const legacyFiles = await listAllR2Files(legacyPrefix);
		if (legacyFiles.length > 0) {
			await bulkDeleteFromR2(legacyFiles.map((f) => f.key));
		}
	}

	repoState.delete(getRepoKey(ownerKey, repoName));
}

async function syncRepositoryToR2Unlocked(
	ownerKey: string,
	repoName: string,
	ownerDbId?: string,
	legacyOwnerKeys: string[] = [],
): Promise<void> {
	const repoPath = getRepoPath(ownerKey, repoName);
	const repoKey = getRepoKey(ownerKey, repoName);

	await promoteLegacyLocalRepo(
		repoPath,
		getLegacyLocalRepoPaths(legacyOwnerKeys, repoName),
	);

	if (!isR2Configured()) {
		repoState.set(repoKey, {
			...repoState.get(repoKey),
			syncedAt: Date.now(),
		});
		return;
	}

	const localFiles = await listLocalFiles(repoPath);
	const prefix = getRepoPrefix(ownerKey, repoName);
	const remoteFiles = await listAllR2Files(prefix);
	const remoteKeys = new Set(remoteFiles.map((file) => file.key));

	const uploads = await Promise.all(
		localFiles.map(async (relativePath) => {
			const fullPath = path.join(repoPath, relativePath);
			const content = await fs.readFile(fullPath);

			let contentType = "application/octet-stream";
			if (
				relativePath === "HEAD" ||
				relativePath === "config" ||
				relativePath === "packed-refs" ||
				relativePath.startsWith("refs/")
			) {
				contentType = "text/plain";
			}

			return {
				key: `${prefix}${relativePath}`,
				data: content,
				contentType,
			};
		}),
	);

	for (let index = 0; index < uploads.length; index += 100) {
		const chunk = uploads.slice(index, index + 100);
		const results = await bulkUploadToR2(chunk);
		const failed = results.filter((result) => !result.success);

		if (failed.length > 0) {
			throw new Error(`Failed to upload ${failed.length} git object(s) to R2`);
		}
	}

	const localKeys = new Set(uploads.map((upload) => upload.key));
	const staleKeys = [...remoteKeys].filter((key) => !localKeys.has(key));

	if (staleKeys.length > 0) {
		await bulkDeleteFromR2(staleKeys);
	}

	const legacyPrefixes = getLegacyGitPrefixes(legacyOwnerKeys, repoName);
	for (const legacyPrefix of legacyPrefixes) {
		const legacyFiles = await listAllR2Files(legacyPrefix);
		if (legacyFiles.length > 0) {
			await bulkDeleteFromR2(legacyFiles.map((file) => file.key));
		}
	}

	await updateRepositoryBackupMetadata(ownerDbId, ownerKey, repoName, repoPath);

	repoState.set(repoKey, {
		hydratedAt: Date.now(),
		syncedAt: Date.now(),
	});
}
