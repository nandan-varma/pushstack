/**
 * A wiki is a second bare repository per repository, at
 * `repos/{ownerKey}/{repoName}/wiki/git`, on branch `master` with `HEAD ->
 * refs/heads/master` (GitHub's) so cloning a fresh wiki is an empty
 * repository, not a failure. Every wiki write takes the repository's own
 * lease: it is the same repository, only a second gitdir.
 */
import { GitRepositoryNotFoundError } from "git-fs-s3";
import { gitFs } from "./git-fs";
import { initBareRepo } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { getRepoWikiGitStorageRoot } from "./git-storage-naming";
import { findRepositoryByName } from "./repository-lookup";

export const WIKI_BRANCH = "master";

async function wikiRepositoryExists(
	ownerKey: string,
	repoName: string,
): Promise<boolean> {
	try {
		await gitFs.promises.stat(
			`${getRepoWikiGitStorageRoot(ownerKey, repoName)}/HEAD`,
		);
		return true;
	} catch (error) {
		if ((error as { code?: string } | null)?.code !== "ENOENT") throw error;
		return false;
	}
}

/**
 * Create the wiki's repository unless it already exists. Idempotent and under
 * the repository lock, so the first clone of a fresh wiki and the web editor's
 * first save race safely; refuses when the repository's wiki is disabled.
 */
export async function ensureWikiRepository(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const repository = await findRepositoryByName(ownerKey, repoName);
	if (!repository?.hasWiki) {
		throw new GitRepositoryNotFoundError("Repository not found");
	}
	await withRepositoryLock(ownerKey, repoName, async () => {
		if (await wikiRepositoryExists(ownerKey, repoName)) return;
		await initBareRepo(ownerKey, repoName, WIKI_BRANCH, "wiki");
	});
}
