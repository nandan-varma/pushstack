/**
 * Git reads for the web UI: (ownerKey, repoName) → git-fs-s3/ops with the
 * app's result cache, perf hooks and pack prefetch wired in.
 */
import { GitPathNotFoundError } from "git-fs-s3";
import {
	BANNER_WALK_DEPTH,
	type CommitInfo,
	type CommitSummary,
	type DiffResult,
	type FileHistoryResult,
	getBlob,
	getDiffBetweenRefs,
	getSubmodules,
	getTreeFromRef,
	HISTORY_WALK_DEPTH,
	listBranches,
	analyzeMerge as opsAnalyzeMerge,
	getCommit as opsGetCommit,
	getCommitDiff as opsGetCommitDiff,
	getCommitHistory as opsGetCommitHistory,
	getCommitLog as opsGetCommitLog,
	getFileContent as opsGetFileContent,
	getFileHistory as opsGetFileHistory,
	getLastCommitsForTree as opsGetLastCommitsForTree,
	resolveCommit,
	type TreeEntry,
} from "git-fs-s3/ops";
import { type FileView, MAX_INLINE_TEXT_BYTES } from "#/lib/file-view";
import { opsHooksFor } from "./git-cache";
import { repoFor } from "./git-repo";

export { BANNER_WALK_DEPTH };

export function getFileContent(
	ownerKey: string,
	repoName: string,
	filePath: string,
	ref: string,
): Promise<Uint8Array> {
	return opsGetFileContent(
		repoFor(ownerKey, repoName),
		filePath,
		ref,
		opsHooksFor(ownerKey, repoName),
	);
}

/** A blob or submodule at a revision; only small text blobs travel inline. */
export async function getFileView(
	ownerKey: string,
	repoName: string,
	ref: string,
	filePath: string,
): Promise<FileView> {
	const repo = repoFor(ownerKey, repoName);
	const hooks = opsHooksFor(ownerKey, repoName);
	if (hooks.prefetch) await hooks.prefetch();
	const { oid } = await resolveCommit(repo, ref);
	const slash = filePath.lastIndexOf("/");
	const parentPath = slash === -1 ? "" : filePath.slice(0, slash);
	const entries = await getTreeFromRef(
		repo,
		{ ref: oid, treePath: parentPath },
		hooks,
	);
	const entry = entries.find((entry) => entry.path === filePath);
	if (entry?.type === "commit") {
		const modules = await getSubmodules(repo, oid);
		return {
			kind: "submodule",
			oid: entry.oid,
			url: modules.find((m) => m.path === filePath)?.url ?? null,
		};
	}
	if (entry?.type !== "blob")
		throw new GitPathNotFoundError(`File not found: ${filePath}`);
	const bytes = await getBlob(repo, entry.oid);
	const size = bytes.byteLength;
	// git's own heuristic: a NUL byte means binary.
	if (bytes.includes(0)) return { kind: "binary", size };
	if (size > MAX_INLINE_TEXT_BYTES) return { kind: "too-large", size };
	return { kind: "text", size, content: new TextDecoder().decode(bytes) };
}

export function getCommit(
	ownerKey: string,
	repoName: string,
	sha: string,
): Promise<CommitInfo> {
	return opsGetCommit(repoFor(ownerKey, repoName), sha);
}

export function getCommitLog(
	ownerKey: string,
	repoName: string,
	ref: string,
	depth = 50,
): Promise<CommitInfo[]> {
	return opsGetCommitLog(
		repoFor(ownerKey, repoName),
		{ ref, depth },
		opsHooksFor(ownerKey, repoName),
	);
}

export function getCommitHistory(
	ownerKey: string,
	repoName: string,
	ref: string,
	limit = 50,
	skip = 0,
): Promise<CommitInfo[]> {
	return opsGetCommitHistory(
		repoFor(ownerKey, repoName),
		{ ref, limit, skip },
		opsHooksFor(ownerKey, repoName),
	);
}

export function getTree(
	ownerKey: string,
	repoName: string,
	ref: string,
	treePath = "",
): Promise<TreeEntry[]> {
	return getTreeFromRef(
		repoFor(ownerKey, repoName),
		{ ref, treePath },
		opsHooksFor(ownerKey, repoName),
	);
}

/** Everything a directory page renders, read in parallel through one repo handle. */
export async function getRepositoryTreeData(
	ownerKey: string,
	repoName: string,
	ref: string,
	treePath = "",
) {
	const repo = repoFor(ownerKey, repoName);
	const hooks = opsHooksFor(ownerKey, repoName);
	const [branches, files, commits] = await Promise.all([
		listBranches(repo),
		getTreeFromRef(repo, { ref, treePath }, hooks),
		opsGetCommitHistory(repo, { ref, limit: 1 }, hooks),
	]);
	return { branches, files, latestCommit: commits[0] };
}

export function getBranches(ownerKey: string, repoName: string) {
	return listBranches(repoFor(ownerKey, repoName));
}

/** For each entry of a directory, the last commit (within the walk depth) that changed it. */
export function getLastCommitsForTree(
	ownerKey: string,
	repoName: string,
	ref: string,
	treePath: string,
): Promise<Record<string, CommitSummary>> {
	return opsGetLastCommitsForTree(
		repoFor(ownerKey, repoName),
		{ ref, treePath, depth: HISTORY_WALK_DEPTH },
		opsHooksFor(ownerKey, repoName),
	);
}

/**
 * The commits that changed one file, newest first. A shallow walk that found
 * nothing only means the last change is older than `maxDepth` (say, a README
 * untouched for months), so it escalates once to the full history depth.
 */
export async function getFileHistory(
	ownerKey: string,
	repoName: string,
	ref: string,
	filePath: string,
	limit = 30,
	maxDepth = HISTORY_WALK_DEPTH,
): Promise<FileHistoryResult> {
	const repo = repoFor(ownerKey, repoName);
	const hooks = opsHooksFor(ownerKey, repoName);
	const result = await opsGetFileHistory(
		repo,
		{ ref, filePath, limit, maxDepth },
		hooks,
	);
	if (
		result.entries.length > 0 ||
		!result.truncated ||
		maxDepth >= HISTORY_WALK_DEPTH
	) {
		return result;
	}
	return opsGetFileHistory(
		repo,
		{ ref, filePath, limit, maxDepth: HISTORY_WALK_DEPTH },
		hooks,
	);
}

export function getCommitDiff(
	ownerKey: string,
	repoName: string,
	commitSha: string,
): Promise<DiffResult> {
	return opsGetCommitDiff(repoFor(ownerKey, repoName), commitSha);
}

/** A pull request's diff: what `compareRef` changed since branching from `baseRef`. */
export function getBranchDiff(
	ownerKey: string,
	repoName: string,
	baseRef: string,
	compareRef: string,
): Promise<DiffResult> {
	return getDiffBetweenRefs(repoFor(ownerKey, repoName), baseRef, compareRef);
}

/** Whether both branches exist and whether merging would be a fast-forward. */
export function analyzeMerge(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
) {
	return opsAnalyzeMerge(
		repoFor(ownerKey, repoName),
		sourceBranch,
		targetBranch,
	);
}
