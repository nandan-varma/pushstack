/**
 * A comparison of two revisions, as GitHub's compare page and
 * `/compare/{spec}.diff|.patch` show it: the commits `head` has that `base`
 * doesn't (oldest first, capped like the API), how far each side is ahead,
 * and the three-dot diff against the merge base.
 */
import { MAX_HISTORY_WALK } from "#/lib/limits";
import {
	getBranchDiff,
	getCommit,
	getCommitInfosBetween,
	getCommitsBetween,
} from "./git-read";

/** GitHub lists at most 250 commits in a comparison. */
export const COMPARE_COMMITS_LIMIT = 250;

export type CompareStatus = "identical" | "ahead" | "behind" | "diverged";

export async function compareRevisions(
	ownerKey: string,
	repoName: string,
	base: string,
	head: string,
) {
	const [baseInfo, headInfo] = await Promise.all([
		getCommit(ownerKey, repoName, base),
		getCommit(ownerKey, repoName, head),
	]);
	const [ahead, behind, diff] = await Promise.all([
		getCommitInfosBetween(
			ownerKey,
			repoName,
			baseInfo.oid,
			headInfo.oid,
			MAX_HISTORY_WALK,
		),
		getCommitsBetween(
			ownerKey,
			repoName,
			headInfo.oid,
			baseInfo.oid,
			MAX_HISTORY_WALK,
		),
		getBranchDiff(ownerKey, repoName, baseInfo.oid, headInfo.oid),
	]);
	const aheadBy = ahead.commits.length;
	const behindBy = behind.commits.length;
	const status: CompareStatus =
		aheadBy === 0 && behindBy === 0
			? "identical"
			: behindBy === 0
				? "ahead"
				: aheadBy === 0
					? "behind"
					: "diverged";
	return {
		baseSha: baseInfo.oid,
		headSha: headInfo.oid,
		mergeBaseSha: diff.oldRef ?? baseInfo.oid,
		status,
		aheadBy,
		behindBy,
		/** Full commits, oldest first (the page sends `summarizeCommit`s). */
		commits: ahead.commits.slice(0, COMPARE_COMMITS_LIMIT),
		diff,
	};
}
