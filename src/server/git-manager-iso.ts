/**
 * Git Manager Service (isomorphic-git)
 *
 * Foundation layer for all git operations: every repository lives in object
 * storage (R2; in-memory without R2 env — see git-fs.ts), read and written
 * through `gitFs`. There is no local-disk mode and no `/tmp` working copy.
 */

import { getRepoCache, invalidateRepoCache } from "git-edge";
import git from "isomorphic-git";
import { gitFs, registerRepoGitdir } from "./git-fs";
import { getRepoGitStorageRoot } from "./git-storage-naming";

// isomorphic-git re-parses a packfile's index from scratch on every readTree/log/readObject
// call unless callers share a `cache` object across calls — without this, operations that
// touch many objects (e.g. walking commit history) pay that parse cost hundreds of times over.
// Objects are content-addressed/immutable so a long-lived per-repo cache is safe; it's cleared
// after a push (git-repo-storage.ts's afterRepositoryPush) so a repack, which rewrites pack
// files, can't leave it holding superseded packs. Delegated to git-edge's per-repo cache.

export function invalidateRepoGitCache(
	ownerKey: string,
	repoName: string,
): void {
	invalidateRepoCache(ownerKey, repoName);
}

export function getBareRepoOptions(ownerKey: string, repoName: string) {
	return {
		fs: gitFs,
		gitdir: registerRepoGitdir(ownerKey, repoName),
		cache: getRepoCache(ownerKey, repoName),
	};
}

/**
 * Initialize a new repository
 */
export async function initBareRepo(
	ownerKey: string,
	repoName: string,
	defaultBranch: string,
): Promise<string> {
	// No git.setConfig calls here: nothing anywhere reads user.name/user.email
	// back out of a repo's git config (commit authors are always explicit), so
	// writing them would only cost extra R2 round trips per repo creation.
	const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
	await git.init({ fs: gitFs, dir: gitdir, defaultBranch, bare: true });
	return gitdir;
}
