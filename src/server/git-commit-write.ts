import {
	assertSafeBranchName,
	authorNow,
	commitFilesToBare,
	deleteFileFromBare,
	listBranches,
	type Repo,
} from "git-fs-s3/ops";
import { GitInvalidRequestError } from "./git-errors";
import { repackIfNeededUnlocked } from "./git-http-iso";
import { getBareRepoOptions } from "./git-manager-iso";
import { withRepositoryLock } from "./git-repo-storage";

export interface CommitAuthorInput {
	name: string;
	email: string;
}

/**
 * Commits go onto an existing branch — or, as the first commit, into an
 * empty repository. A commit to a missing branch of a non-empty repository
 * would otherwise start unrelated history; branches are created explicitly
 * (git-branch-ops.ts's createBranch), from a chosen start point.
 */
async function assertCommitTarget(repo: Repo, branch: string): Promise<void> {
	const branches = await listBranches(repo);
	if (branches.length > 0 && !branches.some((b) => b.name === branch)) {
		throw new GitInvalidRequestError(`Branch ${branch} does not exist`);
	}
}

export async function createCommit(
	ownerKey: string,
	repoName: string,
	commit: {
		branch: string;
		message: string;
		files: Array<{ path: string; content: string | Uint8Array }>;
		author: CommitAuthorInput;
	},
): Promise<string> {
	const { branch, message, files } = commit;
	assertSafeBranchName(branch);
	const author = authorNow(commit.author.name, commit.author.email);

	// Blobs, tree and commit straight to R2 — no worktree, no disk I/O.
	return withRepositoryLock(ownerKey, repoName, async () => {
		const repo = getBareRepoOptions(ownerKey, repoName);
		await assertCommitTarget(repo, branch);
		const sha = await commitFilesToBare(repo, {
			branch,
			message,
			author,
			files,
		});
		await repackIfNeededUnlocked(ownerKey, repoName);
		return sha;
	});
}

export async function deleteFile(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
	message: string,
	author: CommitAuthorInput,
): Promise<{ sha: string; message: string }> {
	assertSafeBranchName(branchName);
	const authorInfo = authorNow(author.name, author.email);

	// Remove from the tree and commit straight to R2 — no worktree.
	const sha = await withRepositoryLock(ownerKey, repoName, async () => {
		const repo = getBareRepoOptions(ownerKey, repoName);
		const commitSha = await deleteFileFromBare(repo, {
			branch: branchName,
			filePath,
			message,
			author: authorInfo,
		});
		await repackIfNeededUnlocked(ownerKey, repoName);
		return commitSha;
	});
	return { sha, message };
}
