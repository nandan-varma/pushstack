import fs from "node:fs";
import path from "node:path";
import {
	fastForwardMerge,
	analyzeMerge as opsAnalyzeMerge,
} from "@nandan-varma/git-fs-s3/ops";
import git, { Errors } from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { createCommit } from "./git-commit-write";
import { getBareRepoOptions, getDefaultAuthor } from "./git-manager-iso";
import { isSafeBranchName } from "./git-ref-name";
import {
	getRepoOptions,
	qualifyBranchRef,
	withRepositoryLock,
	withRepositoryWorktree,
} from "./git-repo-storage";
import { logError } from "./perf-log";

// Defense in depth: pull-requests.ts's zod schema already rejects malformed
// branch names before a PR can even be created, but git.merge/git.commit
// don't validate their ref args internally the way git.branch/git.writeRef
// do (see isSafeBranchName's comment in git-ref-name.ts) — guard here too,
// since a PR's source/target branch is stored once at creation time and
// reused (unvalidated at read time) by every later merge attempt.
function assertSafeBranchName(name: string): void {
	if (!isSafeBranchName(name)) {
		throw new Error(`Invalid branch name: ${name}`);
	}
}

export interface MergeAnalysis {
	canMerge: boolean;
	hasConflicts: boolean;
	conflictingFiles: string[];
	fastForward: boolean;
}

export interface MergeOptions {
	strategy?: "merge" | "ours" | "theirs";
	message?: string;
	authorName?: string;
	authorEmail?: string;
}

/**
 * Cheap pre-merge check: do both branches exist, and is this a fast-forward?
 * `canMerge`/`fastForward` are the only fields this actually determines —
 * `hasConflicts`/`conflictingFiles` are NOT a real content-conflict check
 * (isomorphic-git's `git.merge` doesn't expose a dry-run), they only ever
 * reflect "one of the branches couldn't be resolved" (`canMerge: false`).
 * Real merge conflicts are only discoverable by actually attempting the
 * merge — see `mergeBranches`'s `MergeConflictError` handling below, which
 * is the sole source of truth for whether content conflicts exist.
 */
export async function analyzeMerge(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
): Promise<MergeAnalysis> {
	assertSafeBranchName(sourceBranch);
	assertSafeBranchName(targetBranch);
	const repo = await getRepoOptions(ownerKey, repoName);

	// Delegates to @nandan-varma/git-fs-s3/ops's analyzeMerge, which already
	// returns this exact MergeAnalysis shape (canMerge/hasConflicts/
	// conflictingFiles/fastForward) and gets the NotFoundError-vs-everything
	// -else distinction right (only a genuinely missing ref reports
	// canMerge: false; any other failure — a corrupted object, a storage
	// error — propagates instead of being misreported the same way).
	return opsAnalyzeMerge(repo, sourceBranch, targetBranch);
}

export async function mergeBranches(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
	options: MergeOptions = {},
	ownerDbId?: string,
): Promise<{ success: boolean; commitSha?: string; conflicts?: string[] }> {
	assertSafeBranchName(sourceBranch);
	assertSafeBranchName(targetBranch);
	if (isR2Configured()) {
		// ponytail: FF merge = just update the ref, no worktree needed; non-FF falls through
		const ffResult = await withRepositoryLock(ownerKey, repoName, () => {
			const repo = getBareRepoOptions(ownerKey, repoName);
			return fastForwardMerge(repo, sourceBranch, targetBranch);
		});
		if (ffResult) {
			return ffResult;
		}
		// Non-FF: fall through to worktree path below
	}

	try {
		const commitOid = await withRepositoryWorktree(
			ownerKey,
			repoName,
			targetBranch,
			async ({ worktreePath, gitdir }) => {
				// Both branches are real local refs in the same gitdir now — no
				// remote-tracking indirection needed. Pre-qualified to
				// refs/heads/<name>: git.merge's own ref expansion (GitRefManager.expand)
				// does the identical bare-name candidate scan internally — passing an
				// already-fully-qualified ref makes its first candidate the hit.
				await git.merge({
					fs,
					dir: worktreePath,
					gitdir,
					ours: qualifyBranchRef(targetBranch),
					theirs: qualifyBranchRef(sourceBranch),
					author:
						options.authorName && options.authorEmail
							? {
									name: options.authorName,
									email: options.authorEmail,
									timestamp: Math.floor(Date.now() / 1000),
									timezoneOffset: 0,
								}
							: getDefaultAuthor(),
					message:
						options.message || `Merge ${sourceBranch} into ${targetBranch}`,
				});

				// git.merge already updated refs/heads/<targetBranch> in gitdir directly
				return git.resolveRef({
					fs,
					gitdir,
					ref: qualifyBranchRef(targetBranch),
				});
			},
			"main",
			ownerDbId,
		);

		return {
			success: true,
			commitSha: commitOid,
		};
	} catch (error) {
		if (error instanceof Errors.MergeConflictError) {
			return {
				success: false,
				conflicts: error.data.filepaths.length
					? error.data.filepaths
					: ["Merge conflicts detected"],
			};
		}
		// Anything other than a real MergeConflictError (R2/network failure,
		// corrupted object, an internal bug) used to be relabeled as "merge
		// conflicts detected" too — which hid the actual failure from both the
		// user (misleading message) and the logs (nothing printed at all). Log
		// it and let it propagate as a real error instead of a fake conflict.
		logError("git-merge", "mergeBranches failed unexpectedly", error);
		throw error;
	}
}

export async function resolveConflicts(
	ownerKey: string,
	repoName: string,
	resolutions: Array<{ path: string; content: string }>,
	ownerDbId?: string,
): Promise<void> {
	if (isR2Configured()) {
		// ponytail: resolveConflicts = createCommit with conflict resolutions
		await createCommit(
			ownerKey,
			repoName,
			"Resolve merge conflicts",
			resolutions,
			undefined,
			undefined,
			"main",
			ownerDbId,
		);
		return;
	}

	await withRepositoryWorktree(
		ownerKey,
		repoName,
		"main",
		async ({ worktreePath, gitdir }) => {
			for (const resolution of resolutions) {
				const filePath = path.join(worktreePath, resolution.path);
				fs.writeFileSync(filePath, resolution.content);
				await git.add({
					fs,
					dir: worktreePath,
					gitdir,
					filepath: resolution.path,
				});
			}

			await git.commit({
				fs,
				dir: worktreePath,
				gitdir,
				ref: "refs/heads/main",
				message: "Resolve merge conflicts",
				author: getDefaultAuthor(),
			});
		},
		"main",
		ownerDbId,
	);
}
