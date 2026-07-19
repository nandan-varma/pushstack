/**
 * Commit/blob/tree history reads — thin wrapper around
 * @nandan-varma/git-fs-s3/ops's history functions (extracted from an earlier
 * version of this exact file). What stays here: resolving
 * `(ownerKey, repoName)` to a `Repo`, converting the library's `Uint8Array`
 * returns to the `Buffer` this file's own callers expect, and wiring
 * pushstack's own result cache (git-cache.ts) / perf hooks (perf-log.ts) /
 * pack-prefetch (git-fs.ts) into the library's `OpsHooks` — the library
 * implements the exact same result-cache-keyed-by-head-sha pattern this file
 * used to hand-roll, it just needs the store handed to it.
 */
import {
	type CommitInfo,
	getFileFromRef,
	getTreeFromRef,
	type OpsHooks,
	getBlob as opsGetBlob,
	getCommit as opsGetCommit,
	getCommitHistory as opsGetCommitHistory,
	getCommitLog as opsGetCommitLog,
	getFileContent as opsGetFileContent,
	resolveCommit as opsResolveCommit,
} from "@nandan-varma/git-fs-s3/ops";
import { isR2Configured } from "#/lib/r2";
import { resultCache } from "./git-cache";
import { prefetchAllPacks } from "./git-fs";
import { getRepoOptions } from "./git-repo-storage";
import type { TreeEntry } from "./git-tree-ops";
import { perfNote, perfStep } from "./perf-log";

export type { CommitInfo };

// Previously 5, on the theory that a shallow walk (e.g. getCommits' limit=1
// "latest commit" lookup) only ever needs the tip commit, almost always
// already in the most recently pushed pack — so prefetching every pack up
// front would be more bandwidth than it's worth. Production perf logs showed
// that assumption doesn't hold here: with the gate at 5, a depth=1 "latest
// commit" query was consistently the slowest of the tree page's parallel
// queries (4-5s), same shape of problem getTreeFromRef had before it always
// prefetched on a cache miss (git-fs-s3 0.3.3). 1 effectively removes the
// gate — every cache-miss walk prefetches, matching that fix.
const PREFETCH_PACKS_MIN_DEPTH = 1;

function opsHooksFor(ownerKey: string, repoName: string): OpsHooks {
	return {
		resultCache,
		step: perfStep,
		onNote: perfNote,
		prefetch: isR2Configured()
			? () => prefetchAllPacks(ownerKey, repoName)
			: undefined,
		prefetchMinDepth: PREFETCH_PACKS_MIN_DEPTH,
	};
}

export async function resolveCommit(
	ownerKey: string,
	repoName: string,
	ref: string,
) {
	const repo = await getRepoOptions(ownerKey, repoName);
	const { oid, commit } = await opsResolveCommit(repo, ref);
	return { repo, oid, commit };
}

export async function getBlob(
	ownerKey: string,
	repoName: string,
	sha: string,
): Promise<Buffer> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const blob = await opsGetBlob(repo, sha);
	return Buffer.from(blob);
}

export async function getFileContent(
	ownerKey: string,
	repoName: string,
	filePath: string,
	ref: string = "main",
): Promise<Buffer> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const blob = await opsGetFileContent(repo, filePath, ref);
	return Buffer.from(blob);
}

export async function getTree(
	ownerKey: string,
	repoName: string,
	ref: string = "main",
	treePath: string = "",
): Promise<TreeEntry[]> {
	return getTreeFromBranch(ownerKey, repoName, ref, treePath);
}

export async function getCommit(
	ownerKey: string,
	repoName: string,
	sha: string,
): Promise<CommitInfo> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return opsGetCommit(repo, sha);
}

export async function getCommitLog(
	ownerKey: string,
	repoName: string,
	ref: string = "main",
	depth: number = 50,
	// Callers that already resolved `ref` to a sha (e.g. getCommitHistory, via a
	// direct refs/heads/<branch> lookup) should pass it here — isomorphic-git's
	// own resolveRef tries several candidate paths in sequence (bare ref, refs/,
	// refs/tags/, refs/heads/) and 404s the first three every time for a normal
	// branch name, which is pure waste when the sha is already known.
	knownHeadSha?: string,
): Promise<CommitInfo[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return opsGetCommitLog(
		repo,
		{ ref, depth, knownHeadSha },
		opsHooksFor(ownerKey, repoName),
	);
}

export async function getFileFromBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
): Promise<{ content: string; size: number; isBinary: boolean }> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return getFileFromRef(repo, filePath, branchName);
}

export async function getTreeFromBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	treePath: string = "",
): Promise<TreeEntry[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return getTreeFromRef(
		repo,
		{ ref: branchName, treePath },
		opsHooksFor(ownerKey, repoName),
	);
}

export async function getCommitHistory(
	ownerKey: string,
	repoName: string,
	branchName: string,
	limit: number = 50,
	skip: number = 0,
): Promise<CommitInfo[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return opsGetCommitHistory(
		repo,
		{ ref: branchName, limit, skip },
		opsHooksFor(ownerKey, repoName),
	);
}
