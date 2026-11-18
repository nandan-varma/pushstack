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
	forkRepoGitStorage,
	gitFs,
	moveRepoStorage,
	registerRepoGitdir,
	transferRepoStorage,
} from "./git-fs";
import { withRepositoryLock } from "./git-repo-lock";
import { getRepoGitStorageRoot, type RepoKind } from "./git-storage-naming";
import { logWarn, perfStep } from "./perf-log";

export const httpHooks: HttpHooks = {
	step: perfStep,
	onWarn: (message, err) => logWarn("git-http", message, err),
};

/** A wiki is a second bare repository; its isomorphic-git cache has its own key. */
function repoCacheKey(repoName: string, kind: RepoKind) {
	return kind === "wiki" ? `${repoName}.wiki` : repoName;
}

/** Both of a repository's caches: its own and its wiki's. */
function invalidateRepoCaches(ownerKey: string, repoName: string): void {
	invalidateRepoCache(ownerKey, repoName);
	invalidateRepoCache(ownerKey, repoCacheKey(repoName, "wiki"));
}

/**
 * The `Repo` every git call for a repository uses: `gitFs`, the registered
 * gitdir, and the per-repo isomorphic-git cache (its parsed pack indexes —
 * without it every object read re-parses every `.idx`). Only call once the
 * repository's row is known to exist.
 */
export function repoFor(
	ownerKey: string,
	repoName: string,
	kind: RepoKind = "repo",
): Repo {
	return {
		fs: gitFs,
		gitdir: registerRepoGitdir(ownerKey, repoName, kind),
		cache: getRepoCache(ownerKey, repoCacheKey(repoName, kind)),
	};
}

export async function initBareRepo(
	ownerKey: string,
	repoName: string,
	defaultBranch: string,
	kind: RepoKind = "repo",
): Promise<void> {
	await git.init({
		fs: gitFs,
		dir: getRepoGitStorageRoot(ownerKey, repoName, kind),
		defaultBranch,
		bare: true,
	});
}

/**
 * Bookkeeping after a push or repack, inside its lock: drop the repo's
 * result-cache entries (keyed per head sha, so this frees superseded ones)
 * and its isomorphic-git cache (a repack replaces pack files).
 */
export function afterRepositoryPush(
	ownerKey: string,
	repoName: string,
	kind: RepoKind = "repo",
): void {
	for (const prefix of resultKeyPrefixes(
		getRepoGitStorageRoot(ownerKey, repoName, kind),
	)) {
		invalidateResultCache(prefix);
	}
	invalidateRepoCache(ownerKey, repoCacheKey(repoName, kind));
}

/** Delete all of a repository's storage. Callers hold the repo lock. */
export async function deleteRepositoryStorage(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	await deleteRepoStorage(ownerKey, repoName);
	invalidateRepoCaches(ownerKey, repoName);
}

/**
 * Create a fork's git storage as a copy of its parent's, with HEAD on the
 * fork's default branch. Any leftover under the fork's prefix is cleared
 * first. Callers hold both repositories' locks; a failure is left for the
 * caller to clean up with {@link deleteRepositoryStorage}.
 */
export async function forkRepositoryStorage(
	parent: { ownerKey: string; repoName: string },
	fork: { ownerKey: string; repoName: string },
	defaultBranch: string,
	maxBytes: number,
): Promise<void> {
	await deleteRepositoryStorage(fork.ownerKey, fork.repoName);
	const copied = await forkRepoGitStorage(
		parent.ownerKey,
		parent.repoName,
		fork.ownerKey,
		fork.repoName,
		maxBytes,
	);
	// A parent always holds at least its HEAD; an empty copy means the source
	// was not there, and a "fork" of nothing must not be served.
	if (copied === 0) {
		throw new Error(
			`Cannot fork ${parent.ownerKey}/${parent.repoName}: its storage is empty`,
		);
	}
	await git.writeRef({
		...repoFor(fork.ownerKey, fork.repoName),
		ref: "HEAD",
		value: `refs/heads/${defaultBranch}`,
		symbolic: true,
		force: true,
	});
	invalidateRepoCaches(fork.ownerKey, fork.repoName);
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
	invalidateRepoCaches(ownerKey, oldRepoName);
	invalidateRepoCaches(ownerKey, newRepoName);
}

/** Move storage to another owner (a transfer). Callers hold both repo locks. */
export async function transferRepositoryStorage(
	oldOwnerKey: string,
	oldRepoName: string,
	newOwnerKey: string,
	newRepoName: string,
): Promise<void> {
	await transferRepoStorage(oldOwnerKey, oldRepoName, newOwnerKey, newRepoName);
	invalidateRepoCaches(oldOwnerKey, oldRepoName);
	invalidateRepoCaches(newOwnerKey, newRepoName);
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
	kind: RepoKind = "repo",
): Promise<number> {
	const stalePaths = await repackRepository(
		repoFor(ownerKey, repoName, kind),
		{ threshold: REPACK_PACK_COUNT_THRESHOLD },
		httpHooks,
	);
	if (stalePaths.length > 0) afterRepositoryPush(ownerKey, repoName, kind);
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
