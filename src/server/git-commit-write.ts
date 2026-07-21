import fs from "node:fs";
import path from "node:path";
import {
	authorNow,
	commitFilesToBare,
	deleteFileFromBare,
} from "git-fs-s3/ops";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { getBareRepoOptions, getDefaultAuthor } from "./git-manager-iso";
import { isSafeBranchName } from "./git-ref-name";
import { withRepositoryLock, withRepositoryWorktree } from "./git-repo-storage";

// Defense in depth: files.ts's zod schemas already reject malformed branch
// names before they reach here, but git.commit doesn't validate its `ref`
// internally the way git.branch/git.writeRef do (see isSafeBranchName's
// comment in git-ref-name.ts) — guard at the point it's actually called.
function assertSafeBranchName(name: string): void {
	if (!isSafeBranchName(name)) {
		throw new Error(`Invalid branch name: ${name}`);
	}
}

export async function createCommit(
	ownerKey: string,
	repoName: string,
	message: string,
	files: Array<{ path: string; content: string | Buffer }>,
	authorName?: string,
	authorEmail?: string,
	branch: string = "main",
	ownerDbId?: string,
): Promise<string> {
	assertSafeBranchName(branch);
	const author =
		authorName && authorEmail
			? authorNow(authorName, authorEmail)
			: getDefaultAuthor();

	if (isR2Configured()) {
		// ponytail: write blobs + tree + commit directly to R2 — no worktree, no disk I/O
		return withRepositoryLock(ownerKey, repoName, () => {
			const repo = getBareRepoOptions(ownerKey, repoName);
			return commitFilesToBare(repo, { branch, message, author, files });
		});
	}

	return withRepositoryWorktree(
		ownerKey,
		repoName,
		branch,
		async ({ worktreePath, gitdir }) => {
			for (const file of files) {
				const filePath = path.join(worktreePath, file.path);
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				fs.writeFileSync(filePath, file.content);
			}

			for (const file of files) {
				await git.add({ fs, dir: worktreePath, gitdir, filepath: file.path });
			}

			// No setConfig needed: author/committer are passed explicitly below, and
			// `ref` targets the branch directly — parent is derived from that ref's
			// current tip automatically (or `[]` for a brand new branch/repo).
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
		"main",
		ownerDbId,
	);
}

export async function deleteFile(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
	message: string,
	author: { name: string; email: string },
	ownerDbId?: string,
): Promise<{ sha: string; message: string }> {
	assertSafeBranchName(branchName);
	const authorInfo = authorNow(author.name, author.email);

	if (isR2Configured()) {
		// ponytail: remove from tree + commit directly to R2 — no worktree
		const repo = getBareRepoOptions(ownerKey, repoName);
		const sha = await deleteFileFromBare(repo, {
			branch: branchName,
			filePath,
			message,
			author: authorInfo,
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
		"main",
		ownerDbId,
	);

	return { sha, message };
}
