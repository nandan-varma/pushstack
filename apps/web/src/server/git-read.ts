import {
	GitObjectNotFoundError,
	GitPathNotFoundError,
	getObjectSize,
	getObjectSizes,
	isNotFoundError,
} from "git-fs-s3";
import {
	BANNER_WALK_DEPTH,
	type CommitInfo,
	type CommitSummary,
	type DiffResult,
	type FileHistoryResult,
	getBlob,
	getDiffBetweenRefs,
	getDirectDiffBetweenRefs,
	getMergeBaseOid,
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
	resolveCommitOid,
	summarizeCommit,
	type TreeEntry,
} from "git-fs-s3/ops";
import git from "isomorphic-git";
import { type FileView, MAX_INLINE_TEXT_BYTES } from "#/lib/file-view";
import { MAX_HISTORY_WALK, MAX_RAW_BYTES } from "#/lib/limits";
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

export async function getEntryOid(
	ownerKey: string,
	repoName: string,
	ref: string,
	filePath: string,
): Promise<string | null> {
	const { entry } = await findFileEntry(
		repoFor(ownerKey, repoName),
		ref,
		filePath,
		opsHooksFor(ownerKey, repoName),
	);
	return entry?.oid ?? null;
}

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

export type RawFileResult =
	| { kind: "bytes"; bytes: Uint8Array }
	| { kind: "too-large"; size: number };

/**
 * A file's exact bytes at a revision — or the fact that it exceeds
 * {@link MAX_RAW_BYTES}. The size is read from the object's pack entry *before*
 * anything is inflated, so an oversized file is refused without ever being
 * materialised; the raw file route streams from memory, so whatever reaches it is held
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

/**
 * One commit by sha, branch, tag, `HEAD` or abbreviated sha. The revision is
 * resolved to an oid first and the commit read by that oid, so a moving
 * branch tip is never cached as if it were the commit.
 */
export async function getCommit(
	ownerKey: string,
	repoName: string,
	rev: string,
): Promise<CommitInfo> {
	const repo = repoFor(ownerKey, repoName);
	return opsGetCommit(repo, await resolveCommitOid(repo, rev));
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
	if (branches.length === 0 && isNotFoundError(page.error)) {
		const files: Awaited<ReturnType<typeof getTreeFromRef>> = [];
		return { branches, files, latestCommit: undefined };
	}
	throw page.error;
}

export function getBranches(ownerKey: string, repoName: string) {
	return listBranches(repoFor(ownerKey, repoName));
}

export function getTags(ownerKey: string, repoName: string) {
	return listTags(repoFor(ownerKey, repoName));
}

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

export function getBranchDiff(
	ownerKey: string,
	repoName: string,
	baseRef: string,
	compareRef: string,
): Promise<DiffResult> {
	return getDiffBetweenRefs(repoFor(ownerKey, repoName), baseRef, compareRef);
}

/** Two-dot `base..head`: the two commits' trees compared directly. */
export function getDirectDiff(
	ownerKey: string,
	repoName: string,
	baseRef: string,
	compareRef: string,
): Promise<DiffResult> {
	return getDirectDiffBetweenRefs(
		repoFor(ownerKey, repoName),
		baseRef,
		compareRef,
	);
}

export function getMergeBase(
	ownerKey: string,
	repoName: string,
	refA: string,
	refB: string,
): Promise<string | undefined> {
	return getMergeBaseOid(repoFor(ownerKey, repoName), refA, refB);
}

/** The commits `head` has that `base` doesn't, oldest first (as GitHub lists them). */
export type CommitsBetween = {
	commits: CommitSummary[];
	/** More commits exist than `limit`; the newest are left out. */
	truncated: boolean;
	/**
	 * The bounded walk ended before reaching base's history (base moved far
	 * past the branch point), so the list may include commits that are on base.
	 */
	incomplete: boolean;
};

/**
 * `log base..head`, composed from two memoized bounded walks: head's history
 * minus every commit in base's. Each side is bounded by `HISTORY_WALK_DEPTH`
 * (Vercel time limits). A missing ref has an empty history, so the result is
 * empty. `base` and `head` may be branch names or commit shas.
 */
export async function getCommitsBetween(
	ownerKey: string,
	repoName: string,
	base: string,
	head: string,
	limit: number,
): Promise<CommitsBetween> {
	const { commits, ...rest } = await getCommitInfosBetween(
		ownerKey,
		repoName,
		base,
		head,
		limit,
	);
	return { commits: commits.map(summarizeCommit), ...rest };
}

/** `getCommitsBetween` with the full parsed commits (for patches). */
export async function getCommitInfosBetween(
	ownerKey: string,
	repoName: string,
	base: string,
	head: string,
	limit: number,
): Promise<Omit<CommitsBetween, "commits"> & { commits: CommitInfo[] }> {
	const [baseLog, headLog] = await Promise.all([
		getCommitLog(ownerKey, repoName, base, HISTORY_WALK_DEPTH),
		getCommitLog(ownerKey, repoName, head, HISTORY_WALK_DEPTH),
	]);
	const onBase = new Set(baseLog.map((commit) => commit.oid));
	const exclusive = headLog.filter((commit) => !onBase.has(commit.oid));
	const oldestFirst = exclusive.reverse();
	return {
		commits: oldestFirst.slice(0, limit),
		truncated: oldestFirst.length > limit,
		incomplete:
			headLog.length >= HISTORY_WALK_DEPTH &&
			oldestFirst.length === headLog.length,
	};
}

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

/**
 * The entry at `filePath` in `ref` (`undefined` when absent); the root (`""`)
 * is the commit's tree. Used by the REST contents endpoint.
 */
export async function getPathEntry(
	ownerKey: string,
	repoName: string,
	ref: string,
	filePath: string,
): Promise<{ entry: TreeEntry | undefined; commitOid: string }> {
	const repo = repoFor(ownerKey, repoName);
	const hooks = opsHooksFor(ownerKey, repoName);
	if (filePath === "") {
		const { oid, commit } = await resolveCommit(repo, ref);
		return {
			commitOid: oid,
			entry: { path: "", mode: "040000", type: "tree", oid: commit.tree },
		};
	}
	return findFileEntry(repo, ref, filePath, hooks);
}

export function getBlobByOid(
	ownerKey: string,
	repoName: string,
	oid: string,
): Promise<Uint8Array> {
	return getBlob(repoFor(ownerKey, repoName), oid);
}

export async function getBlobSize(
	ownerKey: string,
	repoName: string,
	oid: string,
): Promise<number> {
	const repo = repoFor(ownerKey, repoName);
	const known = await getObjectSize(repo, oid);
	return known ?? (await getBlob(repo, oid)).byteLength;
}

/**
 * Many blobs' sizes in few range reads (the library batches entries that sit
 * near each other in a pack). A size the pack can't answer (a loose object, a
 * store without range reads) is read, at most `concurrency` at a time.
 */
export async function getBlobSizes(
	ownerKey: string,
	repoName: string,
	oids: readonly string[],
	concurrency = 8,
): Promise<Map<string, number>> {
	const repo = repoFor(ownerKey, repoName);
	const known = await getObjectSizes(repo, oids);
	const sizes = new Map<string, number>();
	const unknown: string[] = [];
	for (const [oid, size] of known) {
		if (size === null) unknown.push(oid);
		else sizes.set(oid, size);
	}
	for (let at = 0; at < unknown.length; at += concurrency) {
		await Promise.all(
			unknown.slice(at, at + concurrency).map(async (oid) => {
				sizes.set(oid, (await getBlob(repo, oid)).byteLength);
			}),
		);
	}
	return sizes;
}

export async function getSubmoduleUrls(
	ownerKey: string,
	repoName: string,
	commitOid: string,
): Promise<Map<string, string>> {
	const modules = await getSubmodules(repoFor(ownerKey, repoName), commitOid);
	return new Map(modules.map((module) => [module.path, module.url]));
}

export interface TreeListing {
	sha: string;
	entries: TreeEntry[];
	truncated: boolean;
}

/**
 * A tree by oid (a commit oid names its tree), optionally flattened with full
 * paths. At most `limit` entries; `truncated` says more exist.
 */
export async function getTreeByOid(
	ownerKey: string,
	repoName: string,
	oid: string,
	{ recursive = false, limit = 10_000 } = {},
): Promise<TreeListing> {
	const repo = repoFor(ownerKey, repoName);
	const read = async (treeOid: string) => {
		try {
			return await git.readTree({ ...repo, oid: treeOid });
		} catch (error) {
			const code = (error as { code?: string })?.code;
			if (
				isNotFoundError(error) ||
				code === "ObjectTypeError" ||
				code === "NotFoundError"
			) {
				throw new GitObjectNotFoundError(`Tree ${treeOid} not found`);
			}
			throw error;
		}
	};
	const root = await read(oid);
	const entries: TreeEntry[] = [];
	let truncated = false;
	const queue = [{ prefix: "", tree: root.tree }];
	for (let next = queue.shift(); next && !truncated; next = queue.shift()) {
		for (const item of next.tree) {
			if (entries.length >= limit) {
				truncated = true;
				break;
			}
			const path = next.prefix ? `${next.prefix}/${item.path}` : item.path;
			entries.push({ path, mode: item.mode, type: item.type, oid: item.oid });
			if (recursive && item.type === "tree") {
				queue.push({ prefix: path, tree: (await read(item.oid)).tree });
			}
		}
	}
	if (recursive) {
		entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	}
	return { sha: root.oid, entries, truncated };
}

/** A ref and the object it points at, unpeeled (an annotated tag is its tag object). */
export interface RefTarget {
	ref: string;
	sha: string;
	type: "commit" | "tag";
}

export async function getAllRefs(
	ownerKey: string,
	repoName: string,
): Promise<RefTarget[]> {
	const repo = repoFor(ownerKey, repoName);
	const [branches, tags] = await Promise.all([
		listBranches(repo),
		listTags(repo),
	]);
	const refs: RefTarget[] = [
		...branches.map((branch) => ({
			ref: `refs/heads/${branch.name}`,
			sha: branch.commit,
			type: "commit" as const,
		})),
		...tags.map((tag) => ({
			ref: `refs/tags/${tag.name}`,
			sha: tag.tagObject ?? tag.commit,
			type: tag.tagObject ? ("tag" as const) : ("commit" as const),
		})),
	];
	return refs.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/** The annotated tag object `oid`, or null when `oid` isn't a tag (NotFoundError when absent). */
export async function getTagObject(
	ownerKey: string,
	repoName: string,
	oid: string,
) {
	const { type, object } = await git.readObject({
		...repoFor(ownerKey, repoName),
		oid,
		format: "parsed",
	});
	if (type !== "tag") return null;
	return object as {
		object: string;
		type: "commit" | "tree" | "blob" | "tag";
		tag: string;
		tagger: {
			name: string;
			email: string;
			timestamp: number;
			timezoneOffset: number;
		};
		message: string;
	};
}
