/**
 * Git reads for the web UI: (ownerKey, repoName) → git-fs-s3/ops with the
 * app's result cache, perf hooks and pack prefetch wired in.
 */
import { GitPathNotFoundError, getObjectSize } from "git-fs-s3";
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
	listTags,
	type OpsHooks,
	analyzeMerge as opsAnalyzeMerge,
	getCommit as opsGetCommit,
	getCommitDiff as opsGetCommitDiff,
	getCommitHistory as opsGetCommitHistory,
	getCommitLog as opsGetCommitLog,
	getFileContent as opsGetFileContent,
	getFileHistory as opsGetFileHistory,
	getLastCommitsForTree as opsGetLastCommitsForTree,
	type Repo,
	resolveCommit,
	summarizeCommit,
	type TreeEntry,
} from "git-fs-s3/ops";
import { type FileView, MAX_INLINE_TEXT_BYTES } from "#/lib/file-view";
import { MAX_HISTORY_WALK, MAX_RAW_BYTES } from "#/lib/limits";
import { opsHooksFor } from "./git-cache";
import { isGitNotFoundError } from "./git-errors";
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

/**
 * The tree entry for `filePath` at `ref`, or undefined when the path isn't
 * there. Shared by the two readers below so they resolve a path identically.
 */
async function findFileEntry(
	repo: Repo,
	ref: string,
	filePath: string,
	hooks: OpsHooks,
): Promise<{ entry: TreeEntry | undefined; commitOid: string }> {
	const { oid: commitOid } = await resolveCommit(repo, ref);
	const slash = filePath.lastIndexOf("/");
	const parentPath = slash === -1 ? "" : filePath.slice(0, slash);
	const entries = await getTreeFromRef(
		repo,
		{ ref: commitOid, treePath: parentPath },
		hooks,
	);
	return { entry: entries.find((entry) => entry.path === filePath), commitOid };
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
	const { entry, commitOid } = await findFileEntry(repo, ref, filePath, hooks);
	if (entry?.type === "commit") {
		const modules = await getSubmodules(repo, commitOid);
		return {
			kind: "submodule",
			oid: entry.oid,
			url: modules.find((m) => m.path === filePath)?.url ?? null,
		};
	}
	if (entry?.type !== "blob")
		throw new GitPathNotFoundError(`File not found: ${filePath}`);
	// Ask the object's pack entry for its size first: a blob over the inline
	// limit is never inflated just to be rejected. `null` means the size isn't
	// available (a loose object, or a store without range reads), in which case
	// the read below decides and its own check still applies.
	const packedSize = await getObjectSize(repo, entry.oid);
	if (packedSize !== null && packedSize > MAX_INLINE_TEXT_BYTES) {
		return { kind: "too-large", size: packedSize };
	}
	const bytes = await getBlob(repo, entry.oid);
	const size = bytes.byteLength;
	// git's own heuristic: a NUL byte means binary.
	if (bytes.includes(0)) return { kind: "binary", size };
	if (size > MAX_INLINE_TEXT_BYTES) return { kind: "too-large", size };
	return { kind: "text", size, content: new TextDecoder().decode(bytes) };
}

/** A file's bytes at a revision, or the fact that it is too big to buffer. */
export type RawFileResult =
	| { kind: "bytes"; bytes: Uint8Array }
	| { kind: "too-large"; size: number };

/**
 * A file's exact bytes at a revision — or the fact that it exceeds
 * {@link MAX_RAW_BYTES}. The size is read from the object's pack entry *before*
 * anything is inflated, so an oversized file is refused without ever being
 * materialised; `/api/raw` streams from memory, so whatever reaches it is held
 * in the function's heap.
 *
 * A `null` size (a loose object, or a store without range reads) falls through
 * to reading, which is what every object did before this existed.
 */
export async function getRawFileContent(
	ownerKey: string,
	repoName: string,
	ref: string,
	filePath: string,
): Promise<RawFileResult> {
	const repo = repoFor(ownerKey, repoName);
	const hooks = opsHooksFor(ownerKey, repoName);
	const { entry } = await findFileEntry(repo, ref, filePath, hooks);
	if (entry?.type !== "blob") {
		throw new GitPathNotFoundError(`File not found: ${filePath}`);
	}
	const knownSize = await getObjectSize(repo, entry.oid);
	if (knownSize !== null && knownSize > MAX_RAW_BYTES) {
		return { kind: "too-large", size: knownSize };
	}
	return { kind: "bytes", bytes: await getBlob(repo, entry.oid) };
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
	// git-fs-s3 reads `limit + skip` commits for one page, so `skip` is what
	// makes this walk cost grow with input. The server functions already bound
	// it (git-ref-name.ts's callers); clamping here too keeps the walk bounded
	// for any future caller that doesn't.
	const boundedSkip = Math.max(0, Math.min(skip, MAX_HISTORY_WALK - limit));
	return opsGetCommitHistory(
		repoFor(ownerKey, repoName),
		{ ref, limit, skip: boundedSkip },
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
	const [branches, page] = await Promise.all([
		listBranches(repo),
		Promise.all([
			getTreeFromRef(repo, { ref, treePath }, hooks),
			opsGetCommitHistory(repo, { ref, limit: 1 }, hooks),
		]).then(
			([files, commits]) => ({ ok: true as const, files, commits }),
			(error: unknown) => ({ ok: false as const, error }),
		),
	]);
	if (page.ok) {
		return { branches, files: page.files, latestCommit: page.commits[0] };
	}
	// A repository nobody has pushed to yet has no branch to read: an empty
	// page (the UI shows setup instructions), not a 404 for the default branch.
	if (branches.length === 0 && isGitNotFoundError(page.error)) {
		const files: Awaited<ReturnType<typeof getTreeFromRef>> = [];
		return { branches, files, latestCommit: undefined };
	}
	throw page.error;
}

export function getBranches(ownerKey: string, repoName: string) {
	return listBranches(repoFor(ownerKey, repoName));
}

/** Tags with the commits they name (annotated tags peeled), in version order. */
export function getTags(ownerKey: string, repoName: string) {
	return listTags(repoFor(ownerKey, repoName));
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

/** The commits `head` has that `base` doesn't, newest first. */
export type CommitsBetween = {
	commits: CommitSummary[];
	/** More commits exist than were returned, or the bounded walk ended before reaching base's history. */
	truncated: boolean;
};

/**
 * `log base..head`, composed from two memoized bounded walks: head's history
 * minus every commit in base's. Each side is bounded by `HISTORY_WALK_DEPTH`
 * (Vercel time limits); `truncated` says when the answer may be partial. A
 * missing ref has an empty history, so the result is empty.
 */
export async function getCommitsBetween(
	ownerKey: string,
	repoName: string,
	base: string,
	head: string,
	limit: number,
): Promise<CommitsBetween> {
	const [baseLog, headLog] = await Promise.all([
		getCommitLog(ownerKey, repoName, base, HISTORY_WALK_DEPTH),
		getCommitLog(ownerKey, repoName, head, HISTORY_WALK_DEPTH),
	]);
	const onBase = new Set(baseLog.map((commit) => commit.oid));
	const exclusive = headLog.filter((commit) => !onBase.has(commit.oid));
	const neverMetBase =
		headLog.length >= HISTORY_WALK_DEPTH && exclusive.length === headLog.length;
	return {
		commits: exclusive.slice(0, limit).map(summarizeCommit),
		truncated: exclusive.length > limit || neverMetBase,
	};
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
