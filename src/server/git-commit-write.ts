import fs from "node:fs";
import path from "node:path";
import {
	assertSafeBranchName,
	authorNow,
	commitFilesToBare,
	deleteFileFromBare,
	listBranches,
	type Repo,
} from "git-fs-s3/ops";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { GitInvalidRequestError } from "./git-errors";
import { getBareRepoOptions } from "./git-manager-iso";
import { withRepositoryLock, withRepositoryWorktree } from "./git-repo-storage";

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
		files: Array<{ path: string; content: string | Buffer }>;
		author: CommitAuthorInput;
	},
	ownerDbId?: string,
): Promise<string> {
	const { branch, message, files } = commit;
	assertSafeBranchName(branch);
	const author = authorNow(commit.author.name, commit.author.email);

	if (isR2Configured()) {
		// Blobs, tree and commit straight to R2 — no worktree, no disk I/O.
		return withRepositoryLock(ownerKey, repoName, async () => {
			const repo = getBareRepoOptions(ownerKey, repoName);
			await assertCommitTarget(repo, branch);
			return commitFilesToBare(repo, { branch, message, author, files });
		});
	}

	return withRepositoryWorktree(
		ownerKey,
		repoName,
		branch,
		async ({ worktreePath, gitdir }) => {
			await assertCommitTarget({ fs, gitdir }, branch);
			for (const file of files) {
				const filePath = path.join(worktreePath, file.path);
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				fs.writeFileSync(filePath, file.content);
			}

			for (const file of files) {
				await git.add({ fs, dir: worktreePath, gitdir, filepath: file.path });
			}

			// `ref` targets the branch directly — the parent is that ref's
			// current tip (or none, for the first commit of an empty repo).
			return git.commit({
				fs,
				dir: worktreePath,
				gitdir,
				ref: `refs/heads/${branch}`,
				message,
				author,
				committer: author,
			});
		},
		ownerDbId,
	);
}

export async function deleteFile(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
	message: string,
	author: CommitAuthorInput,
	ownerDbId?: string,
): Promise<{ sha: string; message: string }> {
	assertSafeBranchName(branchName);
	const authorInfo = authorNow(author.name, author.email);

	if (isR2Configured()) {
		// Remove from the tree and commit straight to R2 — no worktree.
		const sha = await withRepositoryLock(ownerKey, repoName, () => {
			const repo = getBareRepoOptions(ownerKey, repoName);
			return deleteFileFromBare(repo, {
				branch: branchName,
				filePath,
				message,
				author: authorInfo,
			});
		});
		return { sha, message };
	}

	const sha = await withRepositoryWorktree(
		ownerKey,
		repoName,
		branchName,
		async ({ worktreePath, gitdir }) => {
			const fullPath = path.join(worktreePath, filePath);
			fs.rmSync(fullPath, { force: true });
			await git.remove({ fs, dir: worktreePath, gitdir, filepath: filePath });

			return git.commit({
				fs,
				dir: worktreePath,
				gitdir,
				ref: `refs/heads/${branchName}`,
				message,
				author: authorInfo,
				committer: authorInfo,
			});
		},
		ownerDbId,
	);

	return { sha, message };
}
