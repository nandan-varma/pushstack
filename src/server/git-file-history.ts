/**
 * Per-file commit history — thin wrapper around git-fs-s3/ops's
 * getFileHistory (extracted from an earlier version of this exact file,
 * including its prefetch-windowed walk). What stays here: resolving
 * `(ownerKey, repoName)` to a `Repo` and wiring pushstack's result
 * cache/perf hooks.
 */
import {
	BANNER_WALK_DEPTH,
	type FileHistoryEntry,
	type FileHistoryResult,
	HISTORY_WALK_DEPTH,
	getFileHistory as opsGetFileHistory,
} from "git-fs-s3/ops";
import { opsHooksFor } from "./git-cache";
import { getRepoOptions } from "./git-repo-storage";

export type { FileHistoryEntry, FileHistoryResult };
export { BANNER_WALK_DEPTH, HISTORY_WALK_DEPTH };

/**
 * All commits (newest first) that changed a single file's blob oid, walking
 * the first-parent chain — same approach as getLastCommitsForTree but for one
 * path and collecting every match instead of stopping at the first.
 */
export async function getFileHistory(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
	limit: number = 30,
	maxDepth: number = HISTORY_WALK_DEPTH,
): Promise<FileHistoryResult> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const hooks = opsHooksFor(ownerKey, repoName);
	const result = await opsGetFileHistory(
		repo,
		{ ref: branchName, filePath, limit, maxDepth },
		hooks,
	);
	// A shallow (banner) walk that hit its depth cap without finding a match
	// doesn't mean the file has no history — just that the commit that last
	// touched it is older than the shallow window (e.g. a README nobody's
	// edited in months). Escalate once to the full history depth so the
	// "latest commit" banner doesn't silently disappear for such files.
	if (
		result.entries.length === 0 &&
		result.truncated &&
		maxDepth < HISTORY_WALK_DEPTH
	) {
		return opsGetFileHistory(
			repo,
			{ ref: branchName, filePath, limit, maxDepth: HISTORY_WALK_DEPTH },
			hooks,
		);
	}
	return result;
}
