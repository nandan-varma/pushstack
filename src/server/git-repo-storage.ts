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
	getRepoGitStoragePrefix,
	getRepoStorageRoot,
} from "./git-storage-naming";

type RepoState = {
	hydratedAt?: number;
	syncedAt?: number;
};

const repoLocks = new Map<string, Promise<void>>();
const repoState = new Map<string, RepoState>();

// ponytail: 5-second TTL avoids re-listing R2 when hydrate + sync run back-to-back in the same push
type R2ListEntry = { files: Awaited<ReturnType<typeof listAllR2Files>>; at: number };
const r2ListCache = new Map<string, R2ListEntry>();
const R2_LIST_TTL_MS = 5000;

async function listAllR2FilesCached(
	prefix: string,
): Promise<Awaited<ReturnType<typeof listAllR2Files>>> {
	const entry = r2ListCache.get(prefix);
	if (entry && Date.now() - entry.at < R2_LIST_TTL_MS) return entry.files;
	const files = await listAllR2Files(prefix);
	r2ListCache.set(prefix, { files, at: Date.now() });
	return files;
}

function getRepoKey(ownerKey: string, repoName: string): string {
	return `${ownerKey}/${repoName}`;
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

	if (!isR2Configured()) {
		try {
			await fs.access(path.join(repoPath, "HEAD"));
		} catch {
			await initBareRepo(ownerKey, repoName, defaultBranch);
		}

		return repoPath;
	}

	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	const remoteFiles = await listAllR2FilesCached(prefix);

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
	} else {
		await writeRemoteFilesToDisk(repoPath, remoteFiles, prefix);

		repoState.set(repoKey, {
			...state,
			hydratedAt: remoteVersion ?? Date.now(),
		});
	}

	// Native git clone requires objects/ and refs/heads/ to exist on local disk.
	await Promise.all([
		fs.mkdir(path.join(repoPath, "objects"), { recursive: true }),
		fs.mkdir(path.join(repoPath, "refs", "heads"), { recursive: true }),
		fs.mkdir(path.join(repoPath, "refs", "tags"), { recursive: true }),
	]);

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
	remoteUpdatedAt?: Date | null,
	defaultBranch: string = "main",
): Promise<string> {
	return withRepositoryLock(ownerKey, repoName, () =>
		ensureRepositoryHydratedUnlocked(
			ownerKey,
			repoName,
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
): Promise<void> {
	await withRepositoryLock(ownerKey, repoName, () =>
		syncRepositoryToR2Unlocked(ownerKey, repoName, ownerDbId),
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
	ownerDbId?: string,
): Promise<T> {
	return withRepositoryLock(ownerKey, repoName, async () => {
		const gitdir = await ensureRepositoryHydratedUnlocked(
			ownerKey,
			repoName,
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
			await syncRepositoryToR2Unlocked(ownerKey, repoName, ownerDbId);
			return result;
		} finally {
			await fs.rm(worktreeRoot, { recursive: true, force: true });
		}
	});
}

export async function deleteRepositoryFromR2(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	if (!isR2Configured()) return;

	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	const files = await listAllR2Files(prefix);
	if (files.length > 0) {
		await bulkDeleteFromR2(files.map((f) => f.key));
	}

	repoState.delete(getRepoKey(ownerKey, repoName));
}

async function syncRepositoryToR2Unlocked(
	ownerKey: string,
	repoName: string,
	ownerDbId?: string,
): Promise<void> {
	const repoPath = getRepoPath(ownerKey, repoName);
	const repoKey = getRepoKey(ownerKey, repoName);

	if (!isR2Configured()) {
		repoState.set(repoKey, {
			...repoState.get(repoKey),
			syncedAt: Date.now(),
		});
		return;
	}

	const localFiles = await listLocalFiles(repoPath);
	const prefix = getRepoGitStoragePrefix(ownerKey, repoName);
	const remoteFiles = await listAllR2FilesCached(prefix);
	const remoteKeys = new Set(remoteFiles.map((file) => file.key));

	// ponytail: git objects are content-addressed — skip uploading any that already exist in R2
	const newFiles = localFiles.filter(
		(relativePath) =>
			!relativePath.startsWith("objects/") ||
			!remoteKeys.has(`${prefix}${relativePath}`),
	);

	const uploads = await Promise.all(
		newFiles.map(async (relativePath) => {
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

	// stale check uses all local keys (including skipped objects still present locally)
	const localKeys = new Set(localFiles.map((f) => `${prefix}${f}`));
	const staleKeys = [...remoteKeys].filter((key) => !localKeys.has(key));

	if (staleKeys.length > 0) {
		await bulkDeleteFromR2(staleKeys);
	}

	await updateRepositoryBackupMetadata(ownerDbId, ownerKey, repoName, repoPath);

	// Invalidate the list cache so the next read sees the just-uploaded state
	r2ListCache.delete(prefix);

	repoState.set(repoKey, {
		hydratedAt: Date.now(),
		syncedAt: Date.now(),
	});
}
