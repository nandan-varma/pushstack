import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import git from "isomorphic-git";
import { db } from "#/db";
import { repositories } from "#/db/github-schema";
import { isR2Configured } from "#/lib/r2";
import {
	bulkCopyInR2,
	bulkDeleteFromR2,
	bulkUploadToR2,
	downloadFromR2,
	listAllR2Files,
} from "#/lib/r2-operations";
import { invalidateCache, invalidateObjectCache } from "./git-cache";
import { isR2NotFoundError } from "./git-errors";
import {
	ensureGitBaseDir,
	getBareRepoOptions,
	getRepoDiskUsage,
	getRepoPath,
	initBareRepo,
	invalidateRepoGitCache,
} from "./git-manager-iso";
import {
	getRepoGitStoragePrefix,
	getRepoStorageRoot,
} from "./git-storage-naming";
import { logError, perfNote, perfStep } from "./perf-log";

type RepoState = {
	hydratedAt?: number;
	syncedAt?: number;
};

const repoLocks = new Map<string, Promise<void>>();
const repoState = new Map<string, RepoState>();

// ponytail: 5-second TTL avoids re-listing R2 when hydrate + sync run back-to-back in the same push
type R2ListEntry = {
	files: Awaited<ReturnType<typeof listAllR2Files>>;
	at: number;
};
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
				try {
					const { content } = await downloadFromR2(file.key);
					await fs.writeFile(destination, content);
				} catch (err) {
					// A pack/idx file that existed when listAllR2FilesCached ran but is
					// gone by the time we go to download it means a concurrent push's
					// repackLocal + deleteStalePacksFromR2 (see git-http-iso.ts) just
					// deleted it as redundant — deleteStalePacksFromR2 only ever runs
					// after the replacement consolidated pack it supersedes has already
					// been uploaded, so that file's content is not lost, just not needed
					// under this name. Reproduced directly under concurrent-push load:
					// this 404 was previously unhandled, crashing the whole hydration
					// (and the push serving it) with a 500 for a file this hydration
					// never actually needed.
					if (!isR2NotFoundError(err)) throw err;
					perfNote(
						`writeRemoteFilesToDisk: skipping ${file.key} — 404'd mid-hydration, ` +
							"likely just deleted by a concurrent repack as redundant",
					);
				}
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

export async function getRepoOptions(ownerKey: string, repoName: string) {
	if (!isR2Configured()) {
		perfNote(`getRepoOptions ${ownerKey}/${repoName}: local disk, hydrating`);
		await perfStep(`ensureRepositoryHydrated ${ownerKey}/${repoName}`, () =>
			ensureRepositoryHydrated(ownerKey, repoName),
		);
	} else {
		perfNote(
			`getRepoOptions ${ownerKey}/${repoName}: R2-direct, no hydration needed`,
		);
	}
	return getBareRepoOptions(ownerKey, repoName);
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

// isomorphic-git's resolveRef/expand try several candidate paths in sequence
// for a bare ref name — ref, refs/ref, refs/tags/ref, refs/heads/ref,
// refs/remotes/ref, refs/remotes/ref/HEAD — 404ing (or stat-ing) the first
// three every time before reaching the one this app's ref model actually
// uses. This codebase's ref model is branch-only (never tags, e.g. the
// `branchName` params throughout git-history-ops.ts/git-merge-iso.ts), so
// skip straight to refs/heads/<name> instead of paying 3 guaranteed-failed
// R2 round trips per resolution. Left untouched: already-qualified refs,
// "HEAD" (its own first candidate, already optimal), and 40-char oids
// (resolved locally by isomorphic-git with no I/O at all).
export function qualifyBranchRef(ref: string): string {
	if (ref.startsWith("refs/") || ref === "HEAD" || /^[0-9a-f]{40}$/.test(ref)) {
		return ref;
	}
	return `refs/heads/${ref}`;
}

async function branchExists(
	gitdir: string,
	branchName: string,
): Promise<boolean> {
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

// Runs a receive-pack (push) body under a single lock spanning hydrate -> write -> sync,
// so a concurrent hydrate/push on the same repo can't interleave and clobber
// not-yet-synced local state (ensureRepositoryHydrated + syncRepositoryToR2 each take
// the lock independently, which left a gap between them for exactly that race).
export async function withReceivePackLock<T>(
	ownerKey: string,
	repoName: string,
	defaultBranch: string,
	fn: (localGitdir: string) => Promise<T>,
	ownerDbId?: string,
): Promise<T> {
	return withRepositoryLock(ownerKey, repoName, async () => {
		const gitdir = await ensureRepositoryHydratedUnlocked(
			ownerKey,
			repoName,
			null,
			defaultBranch,
		);
		const result = await fn(gitdir);
		await syncRepositoryToR2Unlocked(ownerKey, repoName, ownerDbId);
		return result;
	});
}

// Materializes a scratch working directory (`dir`) checked out against the
// bare repo (`gitdir`) directly — no clone, no push. `git.checkout`/
// `git.commit`/`git.merge` all accept independent `dir`/`gitdir` params, and
// `git.commit`/`git.merge` take an explicit target `ref`, so a mutation
// against `{dir: worktreePath, gitdir}` writes straight into the bare repo;
// there's no separate "push the worktree's result back" step the way a real
// `git clone` + `git push` would need. `noUpdateHead: true` on the checkout
// keeps the bare repo's own HEAD untouched (we're not making `worktreePath`
// "the" checkout of this repo, just borrowing gitdir's object store).
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
		await fs.mkdir(worktreePath, { recursive: true });

		try {
			// New-branch case: check out the default branch's current tip so a
			// commit on a not-yet-existing branch still forks from it (matching
			// what `git clone` + `git checkout -B <new>` used to produce), rather
			// than starting from an empty working directory.
			const checkoutRef = (await branchExists(gitdir, branchName))
				? branchName
				: defaultBranch;

			if (await branchExists(gitdir, checkoutRef)) {
				await git.checkout({
					fs,
					dir: worktreePath,
					gitdir,
					ref: qualifyBranchRef(checkoutRef),
					noUpdateHead: true,
				});
			}
			// else: brand new, empty repo — leave worktreePath empty.

			const result = await fn({ worktreePath, gitdir });
			await syncRepositoryToR2Unlocked(ownerKey, repoName, ownerDbId);
			return result;
		} finally {
			await fs.rm(worktreeRoot, { recursive: true, force: true });
			// `git.checkout`/`git.commit` write a working-tree index at
			// `gitdir/index`, which a bare repo doesn't conventionally have —
			// don't let it leak into what gets synced to R2.
			await fs.rm(path.join(gitdir, "index"), { force: true });
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

// Moves a repository's actual git storage (R2 objects, or the local hydration
// directory) from its old name to its new one. Every git storage path in this
// app (getRepoGitStorageRoot/getRepoPath) is derived from the repository's
// *current* `name` column read fresh from the DB — renaming the DB row alone,
// without this, orphans all existing commits/branches/objects under the old
// name's storage prefix forever, while the new name resolves to nothing and
// silently gets initialized as a brand-new empty repo on next access.
//
// Callers must hold `withRepositoryLock(ownerKey, oldRepoName, ...)` around
// both this call and the DB row update that follows it — this function does
// not lock internally, so a rename that renamed storage but crashed before
// committing the DB row (or a concurrent hydrate racing the in-flight rename)
// can't observe a half-moved state.
export async function renameRepositoryStorage(
	ownerKey: string,
	oldRepoName: string,
	newRepoName: string,
): Promise<void> {
	if (isR2Configured()) {
		const oldPrefix = getRepoGitStoragePrefix(ownerKey, oldRepoName);
		const newPrefix = getRepoGitStoragePrefix(ownerKey, newRepoName);
		const files = await listAllR2Files(oldPrefix);

		if (files.length > 0) {
			const copies = files.map((file) => ({
				from: file.key,
				to: `${newPrefix}${file.key.slice(oldPrefix.length)}`,
			}));
			const copyResults = await bulkCopyInR2(copies);
			const failed = copyResults.filter((result) => !result.success);
			if (failed.length > 0) {
				throw new Error(
					`Failed to copy ${failed.length} object(s) while renaming repository storage from ` +
						`${oldRepoName} to ${newRepoName} — aborting rename, old storage left untouched`,
				);
			}
			await bulkDeleteFromR2(files.map((f) => f.key));
		}
	} else {
		const oldPath = getRepoPath(ownerKey, oldRepoName);
		const newPath = getRepoPath(ownerKey, newRepoName);
		try {
			await fs.mkdir(path.dirname(newPath), { recursive: true });
			await fs.rename(oldPath, newPath);
		} catch (err) {
			// Nothing hydrated locally yet under the old name (e.g. R2 was
			// configured until now, or this repo was never read/written on this
			// instance) — nothing to move.
			if ((err as { code?: string }).code !== "ENOENT") throw err;
		}
	}

	const oldRepoKey = getRepoKey(ownerKey, oldRepoName);
	const newRepoKey = getRepoKey(ownerKey, newRepoName);
	repoState.delete(oldRepoKey);
	repoState.delete(newRepoKey);
	r2ListCache.delete(getRepoGitStoragePrefix(ownerKey, oldRepoName));
	r2ListCache.delete(getRepoGitStoragePrefix(ownerKey, newRepoName));
	invalidateCache(`dir:${ownerKey}/${oldRepoName}/`);
	invalidateCache(`dir:${ownerKey}/${newRepoName}/`);
	invalidateCache(`${ownerKey}/${oldRepoName}/`);
	invalidateObjectCache(`${ownerKey}/${oldRepoName}/`);
	invalidateRepoGitCache(ownerKey, oldRepoName);
	invalidateRepoGitCache(ownerKey, newRepoName);
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

	// Never delete anything under objects/ here: git objects are content-addressed and
	// immutable, and the local checkout is not a reliable source of truth for what
	// should exist remotely (R2 listing cache, a guarded repackLocal skip, or a
	// mid-hydration race can all make local transiently incomplete). Treating a
	// missing-locally object as "stale" and deleting it from R2 is permanent data
	// loss. Only repackLocal — which has its own object-count safety check — may
	// remove pack files. Stale-key cleanup here is for mutable refs/config/HEAD only.
	const localKeys = new Set(localFiles.map((f) => `${prefix}${f}`));
	const staleKeys = [...remoteKeys].filter(
		(key) => !localKeys.has(key) && !key.startsWith(`${prefix}objects/`),
	);

	if (staleKeys.length > 0) {
		await bulkDeleteFromR2(staleKeys);
	}

	// Disk-usage accounting is informational bookkeeping, not required for git
	// correctness — don't hold the repo lock (or delay the push response) on a
	// filesystem walk + DB write that nothing downstream depends on.
	updateRepositoryBackupMetadata(ownerDbId, ownerKey, repoName, repoPath).catch(
		(error: unknown) => {
			logError(
				"git-repo-storage",
				`Failed to update backup metadata for ${ownerKey}/${repoName}`,
				error,
			);
		},
	);

	// Invalidate the list cache so the next read sees the just-uploaded state
	r2ListCache.delete(prefix);
	// Invalidate r2Backend dir-listing caches — bulkUploadToR2 bypasses r2Backend.writeFile
	// so dir entries (e.g. refs/heads/) stay stale on warm Lambda reuse without this.
	invalidateCache(`dir:${ownerKey}/${repoName}/`);

	// Invalidate in-process git cache so refs/trees read fresh from R2
	invalidateCache(`${ownerKey}/${repoName}/`);
	invalidateObjectCache(`result:tree:${ownerKey}/${repoName}/`);
	invalidateObjectCache(`result:commits:${ownerKey}/${repoName}/`);
	// getCommitLog's own walk-result cache (git-history-ops.ts) — getCommits,
	// getLastCommits, and getFileHistory all build on it. It's keyed per resolved
	// head sha so a *new* head is never served this cache's old content, but
	// without this it leaks one orphaned entry per push instead of being cleared
	// alongside the result caches built on top of it.
	invalidateObjectCache(`result:commitlog:${ownerKey}/${repoName}/`);
	// Also covers git-r2-backend.ts's stat()/readFile() negative-result and
	// directory-exists markers (keyed the same as the buffer cache above) — a push
	// can turn a previously-missing ref/loose-object path into one that exists.
	invalidateObjectCache(`${ownerKey}/${repoName}/`);

	// A repack rewrites pack files out from under any already-parsed isomorphic-git
	// pack index, so drop the shared per-repo git cache too.
	invalidateRepoGitCache(ownerKey, repoName);

	repoState.set(repoKey, {
		hydratedAt: Date.now(),
		syncedAt: Date.now(),
	});
}
