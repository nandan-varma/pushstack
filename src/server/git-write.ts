/**
 * Git writes from the web UI — commits, branch changes, merges — each under
 * the repository lock, straight to storage. Objects are written as packs
 * (git-fs-s3's packed writes) before any ref moves; commits and merges then
 * consolidate packs once enough have accumulated.
 */
import { GitEdgeError, GitMergeConflictError, threeWayMerge } from "git-edge";
import { GitInvalidRequestError, qualifyBranchRef } from "git-fs-s3";
import {
	assertBranchExists,
	assertSafeBranchName,
	authorNow,
	commitFilesToBare,
	createBranchFrom,
	deleteBranchByName,
	deleteFileFromBare,
	fastForwardMerge,
	listBranches,
	type Repo,
	resolveCommit,
} from "git-fs-s3/ops";
import git from "isomorphic-git";
import { repackIfNeededUnlocked, repoFor } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { logError } from "./perf-log";

export interface CommitAuthorInput {
	name: string;
	email: string;
}

/**
 * Commits go onto an existing branch — or, as the first commit, into an
 * empty repository; new branches come only from createBranch, from a chosen
 * start point, never as a side effect of committing to a typo.
 */
async function assertCommitTarget(repo: Repo, branch: string): Promise<void> {
	const branches = await listBranches(repo);
	if (branches.length > 0 && !branches.some((b) => b.name === branch)) {
		throw new GitInvalidRequestError(`Branch ${branch} does not exist`);
	}
}

/** Run a write under the repo lock, then consolidate packs if due. */
function writeUnderLock<T>(
	ownerKey: string,
	repoName: string,
	fn: (repo: Repo) => Promise<T>,
): Promise<T> {
	return withRepositoryLock(ownerKey, repoName, async () => {
		const result = await fn(repoFor(ownerKey, repoName));
		await repackIfNeededUnlocked(ownerKey, repoName);
		return result;
	});
}

export function createCommit(
	ownerKey: string,
	repoName: string,
	commit: {
		branch: string;
		message: string;
		files: Array<{ path: string; content: string | Uint8Array }>;
		author: CommitAuthorInput;
	},
): Promise<string> {
	assertSafeBranchName(commit.branch);
	return writeUnderLock(ownerKey, repoName, async (repo) => {
		await assertCommitTarget(repo, commit.branch);
		return commitFilesToBare(repo, {
			branch: commit.branch,
			message: commit.message,
			author: authorNow(commit.author.name, commit.author.email),
			files: commit.files,
		});
	});
}

/**
 * A new repository's first commit, for callers already holding its lock
 * (createRepository, in the same span as storage init — the lock is not
 * reentrant). One packed write; nothing to repack yet.
 */
export function createInitialCommitUnlocked(
	ownerKey: string,
	repoName: string,
	commit: {
		branch: string;
		message: string;
		files: Array<{ path: string; content: string }>;
		author: CommitAuthorInput;
	},
): Promise<string> {
	assertSafeBranchName(commit.branch);
	return commitFilesToBare(repoFor(ownerKey, repoName), {
		branch: commit.branch,
		message: commit.message,
		author: authorNow(commit.author.name, commit.author.email),
		files: commit.files,
	});
}

export function deleteFile(
	ownerKey: string,
	repoName: string,
	options: {
		branch: string;
		filePath: string;
		message: string;
		author: CommitAuthorInput;
	},
): Promise<string> {
	assertSafeBranchName(options.branch);
	return writeUnderLock(ownerKey, repoName, (repo) =>
		deleteFileFromBare(repo, {
			branch: options.branch,
			filePath: options.filePath,
			message: options.message,
			author: authorNow(options.author.name, options.author.email),
		}),
	);
}

export function createBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	startPoint: string,
): Promise<void> {
	return withRepositoryLock(ownerKey, repoName, () =>
		createBranchFrom(repoFor(ownerKey, repoName), branchName, startPoint),
	);
}

export function deleteBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
): Promise<void> {
	return withRepositoryLock(ownerKey, repoName, () =>
		deleteBranchByName(repoFor(ownerKey, repoName), branchName),
	);
}

/**
 * Point HEAD — what clone/fetch advertise as the default branch — at an
 * existing branch. Keep `repositories.defaultBranch` in step.
 */
export function setDefaultBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
): Promise<void> {
	assertSafeBranchName(branchName);
	return withRepositoryLock(ownerKey, repoName, async () => {
		const repo = repoFor(ownerKey, repoName);
		await assertBranchExists(repo, branchName);
		await git.writeRef({
			...repo,
			ref: "HEAD",
			value: `refs/heads/${branchName}`,
			symbolic: true,
			force: true,
		});
	});
}

export interface MergeOptions {
	message?: string;
	authorName?: string;
	authorEmail?: string;
}

export type MergeOutcome =
	| { success: true; commitSha: string; baseSha: string; headSha: string }
	| { success: false; conflicts: string[] };

/**
 * Merge `sourceBranch` into `targetBranch`: a fast-forward when possible,
 * otherwise git-edge's object-level three-way merge — both in one lock span,
 * so the fast-forward check can't go stale before the merge runs. Conflicts
 * and unrelated histories come back as `{ success: false }`.
 */
export async function mergeBranches(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
	options: MergeOptions = {},
): Promise<MergeOutcome> {
	assertSafeBranchName(sourceBranch);
	assertSafeBranchName(targetBranch);
	try {
		return await writeUnderLock(ownerKey, repoName, async (repo) => {
			// The tips being merged, resolved under the lock: the exact range a
			// pull request merged.
			const baseSha = (await resolveCommit(repo, targetBranch)).oid;
			const headSha = (await resolveCommit(repo, sourceBranch)).oid;
			const fastForward = await fastForwardMerge(
				repo,
				sourceBranch,
				targetBranch,
			);
			if (fastForward) return { ...fastForward, baseSha, headSha };
			const { commitOid } = await threeWayMerge(
				repo,
				qualifyBranchRef(sourceBranch),
				qualifyBranchRef(targetBranch),
				{
					message:
						options.message || `Merge ${sourceBranch} into ${targetBranch}`,
					authorName: options.authorName,
					authorEmail: options.authorEmail,
				},
			);
			return {
				success: true as const,
				commitSha: commitOid,
				baseSha,
				headSha,
			};
		});
	} catch (error) {
		if (error instanceof GitMergeConflictError) {
			return { success: false, conflicts: error.conflictingPaths };
		}
		// e.g. unrelated histories: a refusal to show, not a server error.
		if (error instanceof GitEdgeError) {
			return { success: false, conflicts: [error.message] };
		}
		logError("git-write", "mergeBranches failed unexpectedly", error);
		throw error;
	}
}
