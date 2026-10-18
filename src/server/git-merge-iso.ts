import { GitEdgeError, GitMergeConflictError, threeWayMerge } from "git-edge";
import {
	fastForwardMerge,
	analyzeMerge as opsAnalyzeMerge,
} from "git-fs-s3/ops";
import { repackIfNeededUnlocked } from "./git-http-iso";
import { getBareRepoOptions } from "./git-manager-iso";
import { isSafeBranchName } from "./git-ref-name";
import {
	getRepoOptions,
	qualifyBranchRef,
	withRepositoryLock,
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
 * merge — see `mergeBranches`'s `GitMergeConflictError` handling below, which
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
	const repo = getRepoOptions(ownerKey, repoName);

	// Delegates to git-fs-s3/ops's analyzeMerge, which already
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
): Promise<{ success: boolean; commitSha?: string; conflicts?: string[] }> {
	assertSafeBranchName(sourceBranch);
	assertSafeBranchName(targetBranch);

	// FF merge = just update the ref; a real (non-FF) merge uses git-edge's
	// threeWayMerge, which works directly on the object graph (trees, blobs,
	// commits) with no worktree — a bare repo living entirely in R2 has no
	// disk to check one out onto. Both cases run under one lock acquisition
	// spanning the FF check through the merge itself, so a concurrent write
	// can't land in between and make the "is this a fast-forward"
	// determination stale by the time the non-FF merge runs.
	try {
		return await withRepositoryLock(ownerKey, repoName, async () => {
			const repo = getBareRepoOptions(ownerKey, repoName);
			const ffResult = await fastForwardMerge(repo, sourceBranch, targetBranch);
			if (ffResult) return ffResult;

			const merged = await threeWayMerge(
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
			await repackIfNeededUnlocked(ownerKey, repoName);
			return { success: true as const, commitSha: merged.commitOid };
		});
	} catch (error) {
		if (error instanceof GitMergeConflictError) {
			return {
				success: false,
				conflicts: error.conflictingPaths.length
					? error.conflictingPaths
					: ["Merge conflicts detected"],
			};
		}
		// No common ancestor: nothing to merge against — a user-facing
		// refusal, like git's "refusing to merge unrelated histories".
		if (error instanceof GitEdgeError) {
			return { success: false, conflicts: [error.message] };
		}
		// Anything other than a real conflict (R2/network failure, corrupted
		// object, an internal bug) propagates as a real error instead of
		// being relabeled as a fake conflict.
		logError("git-merge", "mergeBranches failed unexpectedly", error);
		throw error;
	}
}
