/**
 * Replace a repository's complete R2 Git prefix with the valid bare repository
 * at GIT_REPOS_PATH/<owner>/<repo>. Intended for disposable/test repositories.
 *
 * Usage:
 *   GIT_REPOS_PATH=/path/to/bare-repos node --env-file=.env.local --import tsx scripts/reset-repository-r2.ts <owner> <repo>
 */
import { access } from "node:fs/promises";
import { deleteRepositoryFromR2, syncRepositoryToR2 } from "#/server/git-repo-storage";
import { getRepoPath } from "#/server/git-manager-iso";

async function main(): Promise<void> {
	const [ownerKey, repoName] = process.argv.slice(2);
	if (!ownerKey || !repoName) {
		throw new Error("Usage: reset-repository-r2.ts <owner> <repo>");
	}

	const repoPath = getRepoPath(ownerKey, repoName);
	await access(`${repoPath}/HEAD`);
	console.log(`Replacing R2 Git storage for ${ownerKey}/${repoName} from ${repoPath}.`);
	await deleteRepositoryFromR2(ownerKey, repoName);
	await syncRepositoryToR2(ownerKey, repoName);
	console.log("R2 Git storage reset complete.");
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
