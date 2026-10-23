/**
 * A repository's handle for git calls, and the operations that act on its
 * whole storage prefix (init, delete, rename). Every repository lives in
 * object storage behind `gitFs`; nothing touches local disk.
 */
import { getRepoCache, invalidateRepoCache } from "git-edge";
import {
	type HttpHooks,
	REPACK_PACK_COUNT_THRESHOLD,
	repackRepository,
} from "git-fs-s3/http";
import { type Repo, resultKeyPrefixes } from "git-fs-s3/ops";
import git from "isomorphic-git";
import { invalidateResultCache } from "./git-cache";
import {
	deleteRepoStorage,
	gitFs,
	moveRepoStorage,
	registerRepoGitdir,
	transferRepoStorage,
} from "./git-fs";
import { withRepositoryLock } from "./git-repo-lock";
import { getRepoGitStorageRoot } from "./git-storage-naming";
import { logWarn, perfStep } from "./perf-log";

export const httpHooks: HttpHooks = {
	step: perfStep,
	onWarn: (message, err) => logWarn("git-http", message, err),
};

/**
 * The `Repo` every git call for a repository uses: `gitFs`, the registered
 * gitdir, and the per-repo isomorphic-git cache (its parsed pack indexes —
 * without it every object read re-parses every `.idx`). Only call once the
 * repository's row is known to exist.
 */
export function repoFor(ownerKey: string, repoName: string): Repo {
	return {
		fs: gitFs,
		gitdir: registerRepoGitdir(ownerKey, repoName),
		cache: getRepoCache(ownerKey, repoName),
	};
}

export async function initBareRepo(
	ownerKey: string,
	repoName: string,
	defaultBranch: string,
): Promise<void> {
	await git.init({
		fs: gitFs,
		dir: getRepoGitStorageRoot(ownerKey, repoName),
		defaultBranch,
		bare: true,
	});
}

/**
 * Bookkeeping after a push or repack, inside its lock: drop the repo's
 * result-cache entries (keyed per head sha, so this frees superseded ones)
 * and its isomorphic-git cache (a repack replaces pack files).
 */
export function afterRepositoryPush(ownerKey: string, repoName: string): void {
	for (const prefix of resultKeyPrefixes(
		getRepoGitStorageRoot(ownerKey, repoName),
	)) {
		invalidateResultCache(prefix);
	}
	invalidateRepoCache(ownerKey, repoName);
}

/** Delete all of a repository's storage. Callers hold the repo lock. */
export async function deleteRepositoryStorage(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	await deleteRepoStorage(ownerKey, repoName);
	invalidateRepoCache(ownerKey, repoName);
}

/**
 * Move a repository's storage to its new name (keys derive from the name, so
 * a rename that only touched the DB row would orphan its history). Callers
 * hold the repo lock across this and the row update.
 */
export async function renameRepositoryStorage(
	ownerKey: string,
	oldRepoName: string,
	newRepoName: string,
): Promise<void> {
	await moveRepoStorage(ownerKey, oldRepoName, newRepoName);
	invalidateRepoCache(ownerKey, oldRepoName);
	invalidateRepoCache(ownerKey, newRepoName);
}

/** Move storage to another owner (a transfer). Callers hold both repo locks. */
export async function transferRepositoryStorage(
	oldOwnerKey: string,
	oldRepoName: string,
	newOwnerKey: string,
	newRepoName: string,
): Promise<void> {
	await transferRepoStorage(oldOwnerKey, oldRepoName, newOwnerKey, newRepoName);
	invalidateRepoCache(oldOwnerKey, oldRepoName);
	invalidateRepoCache(newOwnerKey, newRepoName);
}

/**
 * Consolidate packs once enough have accumulated (every write adds one).
 * Call inside the repo lock, after the write; returns how many pack files
 * the repack removed.
 *
 * A failure rejects: callers decide whether it is fatal. Post-write callers
 * (git-write.ts) treat it as best-effort — the write is already durable —
 * while the explicit maintenance call (repackRepositoryNow) reports it.
 */
export async function repackIfNeededUnlocked(
	ownerKey: string,
	repoName: string,
): Promise<number> {
	const stalePaths = await repackRepository(
		repoFor(ownerKey, repoName),
		{ threshold: REPACK_PACK_COUNT_THRESHOLD },
		httpHooks,
	);
	if (stalePaths.length > 0) afterRepositoryPush(ownerKey, repoName);
	return stalePaths.length;
}

/**
 * Consolidate a repository's packs now (threshold-gated), under its lock.
 * Unlike the post-write path this propagates a failure: an explicit
 * maintenance action must report that it did nothing, not "removed 0 files".
 */
export function repackRepositoryNow(
	ownerKey: string,
	repoName: string,
): Promise<number> {
	return withRepositoryLock(ownerKey, repoName, () =>
		repackIfNeededUnlocked(ownerKey, repoName),
	);
}
