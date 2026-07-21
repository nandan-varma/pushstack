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
import { isR2Configured } from "#/lib/r2";
import { resultCache } from "./git-cache";
import { prefetchAllPacks } from "./git-fs";
import { getRepoOptions } from "./git-repo-storage";
import { perfNote, perfStep } from "./perf-log";

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
	return opsGetFileHistory(
		repo,
		{ ref: branchName, filePath, limit, maxDepth },
		{
			resultCache,
			step: perfStep,
			onNote: perfNote,
			prefetch: isR2Configured()
				? () => prefetchAllPacks(ownerKey, repoName)
				: undefined,
		},
	);
}
