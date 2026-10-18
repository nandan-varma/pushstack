/**
 * Repository storage orchestration around `gitFs`: every read and write goes
 * straight to object storage (R2) through it — there is no hydrate-to-disk
 * step, no sync-back step, and no scratch worktree. What's left here is the
 * bookkeeping a write needs afterwards, and the storage-level rename/delete
 * that act on a repo's whole prefix rather than through git.
 */
import { and, eq } from "drizzle-orm";
import { qualifyBranchRef } from "git-fs-s3";
import { resultKeyPrefixes } from "git-fs-s3/ops";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import { invalidateObjectCache } from "./git-cache";
import {
	deleteRepoStorage,
	getRepoStorageSize,
	moveRepoStorage,
} from "./git-fs";
import { getBareRepoOptions, invalidateRepoGitCache } from "./git-manager-iso";
import {
	getRepoGitStorageRoot,
	getRepoStorageRoot,
} from "./git-storage-naming";
import { logError } from "./perf-log";

export { withRepositoryLock } from "./git-repo-lock";

// isomorphic-git's resolveRef/expand try several candidate paths in sequence
// for a bare ref name — ref, refs/ref, refs/tags/ref, refs/heads/ref,
// refs/remotes/ref, refs/remotes/ref/HEAD — 404ing (or stat-ing) the first
// three every time before reaching the one this app's ref model actually
// uses. This codebase's ref model is branch-only (never tags, e.g. the
// `branchName` params throughout git-history-ops.ts/git-merge-iso.ts), so
// skip straight to refs/heads/<name> instead of paying 3 guaranteed-failed
// R2 round trips per resolution. Left untouched: already-qualified refs,
// "HEAD" (its own first candidate, already optimal), and 40-char oids
// (resolved locally by isomorphic-git with no I/O at all). Re-exported from
// git-fs-s3's refs.ts (extracted from an earlier version of
// this exact function) so every call site here still imports it from
// git-repo-storage.ts.
export { qualifyBranchRef };

/** The `Repo` (fs, gitdir, shared cache) every git call for a repo uses. */
export function getRepoOptions(ownerKey: string, repoName: string) {
	return getBareRepoOptions(ownerKey, repoName);
}

async function updateRepositoryStorageMetadata(
	ownerDbId: string,
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const diskUsage = await getRepoStorageSize(ownerKey, repoName);
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

/**
 * Bookkeeping after a push (or standalone repack), run inside its lock.
 *
 * Every ops.* result-cache entry for this repo (commit log, tree listings,
 * commit history pages, last-commits-per-dir, file history) is keyed
 * `<kind>:${gitdir}:...` by git-fs-s3/ops itself, and gitdir here must be
 * exactly what getRepoOptions resolves (getRepoGitStorageRoot) or this
 * silently invalidates nothing. Entries are keyed per resolved head sha, so a
 * new head is never served stale content — this drops the superseded ones
 * instead of leaking one orphaned set per push.
 *
 * A repack rewrites pack files out from under any already-parsed
 * isomorphic-git pack index, so the shared per-repo git cache goes too.
 *
 * Storage-size accounting is informational, not required for git
 * correctness — it never delays the push response or fails it.
 */
export function afterRepositoryPush(
	ownerKey: string,
	repoName: string,
	ownerDbId?: string,
): void {
	for (const prefix of resultKeyPrefixes(
		getRepoGitStorageRoot(ownerKey, repoName),
	)) {
		invalidateObjectCache(prefix);
	}
	invalidateRepoGitCache(ownerKey, repoName);

	if (ownerDbId) {
		updateRepositoryStorageMetadata(ownerDbId, ownerKey, repoName).catch(
			(error: unknown) => {
				logError(
					"git-repo-storage",
					`Failed to update storage metadata for ${ownerKey}/${repoName}`,
					error,
				);
			},
		);
	}
}

/** Deletes all of a repository's git storage. */
export async function deleteRepositoryStorage(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	await deleteRepoStorage(ownerKey, repoName);
	invalidateRepoGitCache(ownerKey, repoName);
}

// Moves a repository's git storage from its old name to its new one. Every
// storage key in this app (getRepoGitStorageRoot) is derived from the
// repository's *current* `name` column — renaming the DB row alone, without
// this, orphans all existing commits/branches/objects under the old name's
// prefix forever, while the new name resolves to nothing.
//
// Callers must hold `withRepositoryLock(ownerKey, oldRepoName, ...)` around
// both this call and the DB row update that follows it — this function does
// not lock internally, so a rename that moved storage but crashed before
// committing the DB row can't be observed half-done by another writer.
export async function renameRepositoryStorage(
	ownerKey: string,
	oldRepoName: string,
	newRepoName: string,
): Promise<void> {
	await moveRepoStorage(ownerKey, oldRepoName, newRepoName);
	invalidateRepoGitCache(ownerKey, oldRepoName);
	invalidateRepoGitCache(ownerKey, newRepoName);
}
