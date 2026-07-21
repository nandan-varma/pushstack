/**
 * Per-directory "last commit touched this" resolution — thin wrapper around
 * git-fs-s3/ops's getLastCommitsForTree (extracted from an
 * earlier version of this exact file, including its two-phase
 * prefetch-then-resolve walk). What stays here: resolving
 * `(ownerKey, repoName)` to a `Repo` and wiring pushstack's result
 * cache/perf hooks — the library implements the same result-cache-keyed-by
 * -head-sha pattern this file used to hand-roll.
 */
import {
	type LastCommitInfo,
	getLastCommitsForTree as opsGetLastCommitsForTree,
} from "git-fs-s3/ops";
import { isR2Configured } from "#/lib/r2";
import { resultCache } from "./git-cache";
import { prefetchAllPacks } from "./git-fs";
import { getRepoOptions } from "./git-repo-storage";
import { perfNote, perfStep } from "./perf-log";

export type { LastCommitInfo };

// Bounds how far back we walk history to resolve "last commit touching this
// path" for a directory listing. Entries whose last change is older than
// this window simply show no last-commit info rather than an expensive
// unbounded history scan. Matches the library's own default; passed
// explicitly so a future default change there doesn't silently change
// behavior here.
const HISTORY_WALK_DEPTH = 400;

export async function getLastCommitsForTree(
	ownerKey: string,
	repoName: string,
	branchName: string,
	treePath: string,
): Promise<Record<string, LastCommitInfo>> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return opsGetLastCommitsForTree(
		repo,
		{ ref: branchName, treePath, depth: HISTORY_WALK_DEPTH },
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
