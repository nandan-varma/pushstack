/**
 * Object-level three-way merge for isomorphic-git.
 *
 * Merges two commits by walking their trees directly — no worktree, no disk.
 * Returns the merged commit OID, or throws GitMergeConflictError with the
 * list of conflicting paths.
 *
 * Edge-compatible: no node: imports, uses only isomorphic-git object APIs.
 */

import { createSemaphore } from "git-fs-s3";
import { type Repo, withPackedWrites } from "git-fs-s3/ops";
import git, { type CommitObject } from "isomorphic-git";
import { merge as diff3Merge } from "node-diff3";
import { GitEdgeError, GitMergeConflictError } from "./errors.js";

export type { Repo };

/**
 * How many object reads/writes a merge may have in flight at once. Each
 * `readBlob` materialises a whole blob, so an unbounded fan-out over a wide
 * directory holds as many object-store round trips (and bytes) open as the
 * directory has entries — enough to exhaust a serverless function's sockets
 * and trip storage rate limits. One shared pool keeps that flat regardless of
 * tree width or recursion depth, while staying wide enough to overlap enough
 * round trips to hide object-store latency.
 */
export const MAX_CONCURRENT_READS = 16;

export interface MergeOpts {
	/** Merge commit message (default: "Merge <source> into <target>"). */
	message?: string;
	/** Author name (default: "Git Edge"). */
	authorName?: string;
	/** Author email (default: "git-edge@local"). */
	authorEmail?: string;
	/** Committer name (default: the author's): the merging user, when the author is someone else. */
	committerName?: string;
	/** Committer email (default: the author's). */
	committerEmail?: string;
	/**
	 * `threeWayMerge`: when the source contains the target, still record a merge
	 * commit instead of moving the target ref to the source (git's `--no-ff`,
	 * which is what GitHub's merge button does).
	 */
	noFastForward?: boolean;
}

/** Result of a successful merge (or of a no-op: target already up to date). */
export interface MergeResult {
	commitOid: string;
}

interface Entry {
	mode: string;
	oid: string;
	type: "blob" | "tree" | "commit";
}

const isTree = (entry: Entry | undefined): entry is Entry =>
	entry?.type === "tree";
const isFile = (entry: Entry | undefined): entry is Entry =>
	entry?.type === "blob";

function same(a: Entry | undefined, b: Entry | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.oid === b.oid && a.mode === b.mode;
}

/**
 * Where a tree merge reads its trees and blobs from and stores the ones it
 * builds. The repository is the real one; a merge check swaps in a store that
 * keeps its results in memory, so it writes nothing.
 */
interface MergeIO {
	/** The entries of `treeOid` (an empty map for a missing base tree). */
	readTree(treeOid: string | undefined): Promise<Map<string, Entry>>;
	readBlob(oid: string): Promise<Uint8Array>;
	writeTree(entries: Array<Entry & { path: string }>): Promise<string>;
	writeBlob(content: Uint8Array): Promise<string>;
}

/** The repository itself, with every object call bounded by one shared pool. */
function repoIO(repo: Repo): MergeIO {
	const reads = createSemaphore(MAX_CONCURRENT_READS);
	return {
		async readTree(treeOid) {
			if (treeOid === undefined) return new Map();
			const { tree } = await reads.run(() =>
				git.readTree({ ...repo, oid: treeOid }),
			);
			return new Map(tree.map((entry) => [entry.path, entry]));
		},
		async readBlob(oid) {
			const { blob } = await reads.run(() => git.readBlob({ ...repo, oid }));
			return blob;
		},
		writeTree: (tree) => reads.run(() => git.writeTree({ ...repo, tree })),
		writeBlob: (blob) => reads.run(() => git.writeBlob({ ...repo, blob })),
	};
}

/**
 * A store that keeps what it writes to itself: an object built by a merge
 * check gets a local label, never a real oid, because the only reader is the
 * next step of the same check.
 */
function dryRunIO(reads: MergeIO): MergeIO {
	const trees = new Map<string, Map<string, Entry>>();
	const blobs = new Map<string, Uint8Array>();
	let written = 0;
	return {
		readTree: async (treeOid) =>
			treeOid === undefined
				? new Map()
				: (trees.get(treeOid) ?? reads.readTree(treeOid)),
		readBlob: async (oid) => blobs.get(oid) ?? reads.readBlob(oid),
		writeTree: async (tree) => {
			const oid = `dry-run-tree-${written++}`;
			trees.set(oid, new Map(tree.map(({ path, ...entry }) => [path, entry])));
			return oid;
		},
		writeBlob: async (content) => {
			const oid = `dry-run-blob-${written++}`;
			blobs.set(oid, content);
			return oid;
		},
	};
}

/**
 * Line-level 3-way merge, via node-diff3's LCS-based diff3 algorithm — the
 * same approach GNU diffutils' `diff3` (and git's own default merge driver)
 * use. `conflict` reports whether any hunk couldn't be merged.
 */
function mergeText(
	base: Uint8Array,
	ours: Uint8Array,
	theirs: Uint8Array,
): { content: Uint8Array; conflict: boolean } {
	const { conflict, result } = diff3Merge(
		decodeLines(ours),
		decodeLines(base),
		decodeLines(theirs),
		{ label: { a: "ours", b: "theirs" } },
	);
	return { content: new TextEncoder().encode(result.join("\n")), conflict };
}

function decodeLines(data: Uint8Array): string[] {
	const text = new TextDecoder().decode(data);
	return text === "" ? [] : text.split("\n");
}

/** Git's own heuristic: a NUL byte means binary, which is never line-merged. */
const isBinary = (data: Uint8Array) => data.includes(0);

/**
 * The merged mode when both sides changed a file: a mode only one side
 * changed wins; both changing it differently is a conflict (null).
 */
function mergeMode(
	base: Entry | undefined,
	ours: Entry,
	theirs: Entry,
): string | null {
	if (ours.mode === theirs.mode) return ours.mode;
	if (base?.mode === ours.mode) return theirs.mode;
	if (base?.mode === theirs.mode) return ours.mode;
	return null;
}

/**
 * Merge one path whose two sides both changed it differently. Returns the
 * merged entry, or null for a conflict (pushed onto `conflicts`).
 */
async function mergeChangedEntry(
	io: MergeIO,
	path: string,
	base: Entry | undefined,
	ours: Entry | undefined,
	theirs: Entry | undefined,
	conflicts: string[],
): Promise<Entry | null> {
	if (isTree(ours) && isTree(theirs)) {
		const oid = await mergeTrees(
			io,
			path,
			isTree(base) ? base.oid : undefined,
			ours.oid,
			theirs.oid,
			conflicts,
		);
		return oid === null ? null : { mode: "040000", oid, type: "tree" };
	}
	// Anything else — modify/delete, file/directory, submodule changes — is a
	// conflict unless both sides are regular files with mergeable content.
	if (!isFile(ours) || !isFile(theirs) || ours.mode === "120000") {
		conflicts.push(path);
		return null;
	}
	const mode = mergeMode(base, ours, theirs);
	if (mode === null) {
		conflicts.push(path);
		return null;
	}
	if (ours.oid === theirs.oid) return { mode, oid: ours.oid, type: "blob" };
	const [baseContent, oursContent, theirsContent] = await Promise.all([
		isFile(base) ? io.readBlob(base.oid) : new Uint8Array(),
		io.readBlob(ours.oid),
		io.readBlob(theirs.oid),
	]);
	if (
		isBinary(baseContent) ||
		isBinary(oursContent) ||
		isBinary(theirsContent)
	) {
		conflicts.push(path);
		return null;
	}
	const { content, conflict } = mergeText(
		baseContent,
		oursContent,
		theirsContent,
	);
	if (conflict) {
		conflicts.push(path);
		return null;
	}
	const oid = await io.writeBlob(content);
	return { mode, oid, type: "blob" };
}

/**
 * Three-way merge of trees, recursing only into subtrees both sides changed
 * — an untouched or one-sided subtree is taken by oid without being read.
 * Returns the merged tree's oid, or null when any path conflicted.
 */
async function mergeTrees(
	io: MergeIO,
	prefix: string,
	baseOid: string | undefined,
	oursOid: string,
	theirsOid: string,
	conflicts: string[],
): Promise<string | null> {
	const [base, ours, theirs] = await Promise.all([
		io.readTree(baseOid),
		io.readTree(oursOid),
		io.readTree(theirsOid),
	]);
	const names = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]);
	const merged: Array<Entry & { path: string }> = [];
	const before = conflicts.length;

	await Promise.all(
		[...names].map(async (name) => {
			const path = prefix ? `${prefix}/${name}` : name;
			const b = base.get(name);
			const o = ours.get(name);
			const t = theirs.get(name);
			let result: Entry | undefined | null;
			if (same(o, t)) result = o;
			else if (same(b, o)) result = t;
			else if (same(b, t)) result = o;
			else result = await mergeChangedEntry(io, path, b, o, t, conflicts);
			if (result) merged.push({ ...result, path: name });
		}),
	);

	if (conflicts.length > before) return null;
	return io.writeTree(merged);
}

/** A commit a squash or rebase replays, with what it needs to be rewritten. */
interface RangeCommit {
	oid: string;
	parents: string[];
	tree: string;
	message: string;
	author: CommitObject["author"];
	timestamp: number;
}

/** Commit identity for commits PushStack writes on a merge. */
function identityOf(opts?: Pick<MergeOpts, "authorName" | "authorEmail">) {
	return {
		name: opts?.authorName || "Git Edge",
		email: opts?.authorEmail || "git-edge@local",
		timestamp: Math.floor(Date.now() / 1000),
		timezoneOffset: 0,
	};
}

/** The committer of a merge commit: the merging user when given, else the author. */
function committerOf(
	author: ReturnType<typeof identityOf>,
	opts?: Pick<MergeOpts, "committerName" | "committerEmail">,
) {
	return opts?.committerName
		? {
				...author,
				name: opts.committerName,
				email: opts.committerEmail || author.email,
			}
		: author;
}

/** Three-way merge of trees; a conflict throws `GitMergeConflictError`. */
async function mergeTreesOrThrow(
	io: MergeIO,
	baseTree: string,
	oursTree: string,
	theirsTree: string,
): Promise<string> {
	const conflicts: string[] = [];
	const treeOid = await mergeTrees(
		io,
		"",
		baseTree,
		oursTree,
		theirsTree,
		conflicts,
	);
	if (treeOid === null) throw new GitMergeConflictError(conflicts.sort());
	return treeOid;
}

interface MergeTips {
	sourceOid: string;
	targetOid: string;
}

async function resolveTips(
	repo: Repo,
	sourceRef: string,
	targetRef: string,
): Promise<MergeTips> {
	const [sourceOid, targetOid] = await Promise.all([
		git.resolveRef({ ...repo, ref: sourceRef }),
		git.resolveRef({ ...repo, ref: targetRef }),
	]);
	return { sourceOid, targetOid };
}

/** True when the target already contains the source: nothing to merge. */
async function targetContainsSource(
	repo: Repo,
	{ sourceOid, targetOid }: MergeTips,
): Promise<boolean> {
	return (
		sourceOid === targetOid ||
		(await git.isDescendent({ ...repo, oid: targetOid, ancestor: sourceOid }))
	);
}

/** True when the source contains the target: the target can fast-forward. */
async function sourceContainsTarget(
	repo: Repo,
	{ sourceOid, targetOid }: MergeTips,
): Promise<boolean> {
	return git.isDescendent({ ...repo, oid: sourceOid, ancestor: targetOid });
}

async function mergeBaseOf(
	repo: Repo,
	{ sourceOid, targetOid }: MergeTips,
	sourceRef: string,
	targetRef: string,
): Promise<string> {
	const baseOids = await git.findMergeBase({
		...repo,
		oids: [sourceOid, targetOid],
	});
	const baseOid = baseOids?.[0];
	if (baseOid === undefined) {
		throw new GitEdgeError(
			`Refusing to merge unrelated histories (${sourceRef} and ${targetRef} share no commit)`,
		);
	}
	return baseOid;
}

/**
 * The most commits a squash or rebase replays or lists. Beyond it a rebase is
 * refused and a squash lists only this many commits (`truncated`).
 */
export const MAX_RANGE_COMMITS = 250;

/**
 * The most commits of the base's own history a squash or rebase reads. The
 * range walk stops at the merge base without reading it; it needs the base's
 * ancestry only when the head reaches below the base (a branch that merged a
 * side branch forked before it), and then this bounds that read — past it the
 * range is refused, rather than read in full under the repository lock.
 */
export const MAX_BASE_HISTORY_COMMITS = MAX_RANGE_COMMITS * 4;

/** `baseOid` and every ancestor of it, or a refusal past its bound. */
async function ancestryOfBase(
	repo: Repo,
	baseOid: string,
): Promise<Set<string>> {
	const below = new Set<string>();
	const queue = [baseOid];
	while (queue.length > 0) {
		if (below.size === MAX_BASE_HISTORY_COMMITS) {
			throw new GitEdgeError(
				`Refusing to walk the range: the base's history is longer than ${MAX_BASE_HISTORY_COMMITS} commits`,
			);
		}
		const oid = queue.pop() as string;
		if (below.has(oid)) continue;
		below.add(oid);
		const { commit } = await git.readCommit({ ...repo, oid });
		queue.push(...commit.parent);
	}
	return below;
}

/**
 * The commits reachable from `headOid` but not from `baseOid`, walking every
 * parent (so commits merged in through a second parent are included), in
 * breadth-first order from the head, which stops at the base. Stops once
 * `MAX_RANGE_COMMITS` commits are found, reporting `truncated`.
 *
 * The base's own history is not read: a commit of `headOid` that is older than
 * the base's commit may be an ancestor of the base (only a head that merged a
 * side branch forked before the base reaches one), so those are the only ones
 * checked against the base's ancestry — a set built on first need and bounded
 * by `MAX_BASE_HISTORY_COMMITS`. Without that bound, every squash and rebase
 * would read a large repository's whole history.
 */
async function commitsAboveBase(
	repo: Repo,
	baseOid: string,
	headOid: string,
): Promise<{ commits: RangeCommit[]; truncated: boolean }> {
	const { commit: baseCommit } = await git.readCommit({
		...repo,
		oid: baseOid,
	});
	let belowBase: Set<string> | undefined;
	const queued = new Set<string>();
	const queue: string[] = [];
	const enqueue = (oid: string) => {
		if (belowBase?.has(oid) || queued.has(oid)) return;
		queued.add(oid);
		queue.push(oid);
	};
	enqueue(headOid);
	const commits: RangeCommit[] = [];
	for (let next = 0; next < queue.length; next++) {
		if (commits.length === MAX_RANGE_COMMITS) {
			return { commits, truncated: true };
		}
		const oid = queue[next] as string;
		if (oid === baseOid) continue;
		const { commit } = await git.readCommit({ ...repo, oid });
		if (commit.committer.timestamp < baseCommit.committer.timestamp) {
			belowBase ??= await ancestryOfBase(repo, baseOid);
			if (belowBase.has(oid)) continue;
		}
		commits.push({
			oid,
			parents: commit.parent,
			tree: commit.tree,
			message: commit.message,
			author: commit.author,
			timestamp: commit.committer.timestamp,
		});
		for (const parent of commit.parent) enqueue(parent);
	}
	return { commits, truncated: false };
}

/**
 * Orders a linear range oldest first by following first parents from the
 * head. Throws when a commit has no single parent path covering the range.
 */
function linearOrder(headOid: string, commits: RangeCommit[]): RangeCommit[] {
	const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
	const chain: RangeCommit[] = [];
	let oid: string | undefined = headOid;
	while (oid !== undefined && byOid.has(oid)) {
		const commit = byOid.get(oid) as RangeCommit;
		chain.push(commit);
		oid = commit.parents[0];
	}
	if (chain.length !== commits.length) {
		throw new GitEdgeError("Refusing to rebase a non-linear branch");
	}
	return chain.reverse();
}

/**
 * Merge `sourceRef` into `targetRef`, entirely at the object level.
 *
 * - Target already contains source (same commit, or source is an ancestor):
 *   nothing to do — returns the target's commit, refs untouched.
 * - Source contains target: fast-forward the target ref to source.
 * - Otherwise: a real three-way merge against the merge base. Paths only one
 *   side changed take that side (deletions included); paths both changed are
 *   merged — subtrees recursively, text files line by line (diff3), modes
 *   kept unless both sides changed them differently. Binary files, symlinks,
 *   submodules, modify/delete and file/directory clashes that both sides
 *   touched are conflicts. Any conflict throws `GitMergeConflictError`
 *   without writing anything.
 *
 * New objects are stored as one pack, written before the target ref moves.
 * Serialize concurrent writers to the same repository externally.
 */
export async function threeWayMerge(
	repo: Repo,
	sourceRef: string,
	targetRef: string,
	opts?: MergeOpts,
): Promise<MergeResult> {
	const tips = await resolveTips(repo, sourceRef, targetRef);
	const { sourceOid, targetOid } = tips;

	if (await targetContainsSource(repo, tips)) {
		return { commitOid: targetOid };
	}
	const fastForward = await sourceContainsTarget(repo, tips);
	if (fastForward && !opts?.noFastForward) {
		await git.writeRef({
			...repo,
			ref: targetRef,
			value: sourceOid,
			force: true,
		});
		return { commitOid: sourceOid };
	}

	// With no fast-forward the source holds the target, so it is its own merge base.
	const baseOid = fastForward
		? targetOid
		: await mergeBaseOf(repo, tips, sourceRef, targetRef);
	const [baseCommit, sourceCommit, targetCommit] = await Promise.all([
		git.readCommit({ ...repo, oid: baseOid }),
		git.readCommit({ ...repo, oid: sourceOid }),
		git.readCommit({ ...repo, oid: targetOid }),
	]);

	return withPackedWrites(repo, async (packed) => {
		// One pool per merge: concurrent merges in the same process must not
		// share (or leak) each other's limit.
		const treeOid = await mergeTreesOrThrow(
			repoIO(packed),
			baseCommit.commit.tree,
			targetCommit.commit.tree,
			sourceCommit.commit.tree,
		);
		const author = identityOf(opts);
		// writeCommit, not git.commit: git.commit also advances whatever
		// branch HEAD names, which may not be the target.
		const commitOid = await git.writeCommit({
			...packed,
			commit: {
				message: opts?.message || `Merge ${sourceRef} into ${targetRef}`,
				tree: treeOid,
				parent: [targetOid, sourceOid],
				author,
				committer: committerOf(author, opts),
			},
		});
		await git.writeRef({
			...packed,
			ref: targetRef,
			value: commitOid,
			force: true,
		});
		return { commitOid };
	});
}

/** Options for `squashMerge`. `message` is required: the squash commit's text. */
export interface SquashOpts extends Omit<MergeOpts, "message"> {
	/**
	 * The squash commit's message, or a function of the commit messages being
	 * squashed (oldest first, merge commits left out; `truncated` when the
	 * range held more than `MAX_RANGE_COMMITS`, so only the first were given) —
	 * for the default body GitHub derives from them. Read under the same lock
	 * as the merge.
	 */
	message: string | ((commitMessages: string[], truncated: boolean) => string);
}

/**
 * Squash `sourceRef` into one new commit on `targetRef`: the target's tree
 * plus the source's changes since the merge base, as a single commit with
 * the target as its only parent (GitHub's squash merge). Same conflict rules
 * as `threeWayMerge`; the source's history is not kept.
 *
 * Unlike a merge, a fast-forwardable source still gets the squash commit.
 * When the target already contains the source there is nothing to squash:
 * the target is returned, refs untouched.
 */
export async function squashMerge(
	repo: Repo,
	sourceRef: string,
	targetRef: string,
	opts: SquashOpts,
): Promise<MergeResult> {
	const tips = await resolveTips(repo, sourceRef, targetRef);
	const { sourceOid, targetOid } = tips;
	// The merge base answers "already merged" too, and walks only as far as the
	// two histories diverge; an ancestry check from the target would read the
	// base's whole history to say no.
	const baseOid = await mergeBaseOf(repo, tips, sourceRef, targetRef);
	if (baseOid === sourceOid) {
		return { commitOid: targetOid };
	}
	const [baseCommit, sourceCommit, targetCommit] = await Promise.all([
		git.readCommit({ ...repo, oid: baseOid }),
		git.readCommit({ ...repo, oid: sourceOid }),
		git.readCommit({ ...repo, oid: targetOid }),
	]);
	return withPackedWrites(repo, async (packed) => {
		const treeOid = await mergeTreesOrThrow(
			repoIO(packed),
			baseCommit.commit.tree,
			targetCommit.commit.tree,
			sourceCommit.commit.tree,
		);
		const range = await commitsAboveBase(packed, baseOid, sourceOid);
		const commits = range.commits;
		// Oldest first: reversed breadth-first order breaks committer-time ties.
		// Merge commits are not listed.
		const squashed = commits
			.reverse()
			.filter((commit) => commit.parents.length === 1)
			.sort((a, b) => a.timestamp - b.timestamp);
		const message =
			typeof opts.message === "function"
				? opts.message(
						squashed.map((commit) => commit.message),
						range.truncated,
					)
				: opts.message;
		const author = identityOf(opts);
		const commitOid = await git.writeCommit({
			...packed,
			commit: {
				message,
				tree: treeOid,
				parent: [targetOid],
				author,
				committer: committerOf(author, opts),
			},
		});
		await git.writeRef({
			...packed,
			ref: targetRef,
			value: commitOid,
			force: true,
		});
		return { commitOid };
	});
}

/**
 * Rebase `sourceRef`'s commits onto `targetRef` and move the target to the
 * last of them (GitHub's rebase merge): each commit is replayed as a
 * three-way merge onto the rebased history, keeping its author, message and
 * tree changes, with the merger as committer. No merge commit is made.
 *
 * A source the target already contains is a no-op. A source that is already
 * based on the target fast-forwards. Only a linear branch rebases: a merge
 * commit in the branch throws `GitEdgeError` (its side history is not
 * replayed), and a conflict throws `GitMergeConflictError`. Nothing is
 * written on either.
 */
export async function rebaseMerge(
	repo: Repo,
	sourceRef: string,
	targetRef: string,
	opts?: MergeOpts,
): Promise<MergeResult> {
	const tips = await resolveTips(repo, sourceRef, targetRef);
	const { sourceOid, targetOid } = tips;
	const baseOid = await mergeBaseOf(repo, tips, sourceRef, targetRef);
	if (baseOid === sourceOid) {
		return { commitOid: targetOid };
	}
	if (baseOid === targetOid) {
		// Already based on the target: nothing to replay.
		await git.writeRef({
			...repo,
			ref: targetRef,
			value: sourceOid,
			force: true,
		});
		return { commitOid: sourceOid };
	}

	const range = await commitsAboveBase(repo, baseOid, sourceOid);
	if (range.truncated) {
		throw new GitEdgeError(
			`Refusing to rebase ${sourceRef}: it has more than ${MAX_RANGE_COMMITS} commits`,
		);
	}
	if (range.commits.some((commit) => commit.parents.length !== 1)) {
		throw new GitEdgeError(
			`Refusing to rebase ${sourceRef}: it contains a merge commit`,
		);
	}
	const commits = linearOrder(sourceOid, range.commits);
	const targetCommit = await git.readCommit({ ...repo, oid: targetOid });
	const author = identityOf(opts);
	return withPackedWrites(repo, async (packed) => {
		const io = repoIO(packed);
		let parent = targetOid;
		let tree = targetCommit.commit.tree;
		for (const commit of commits) {
			const { commit: base } = await git.readCommit({
				...packed,
				oid: commit.parents[0] as string,
			});
			tree = await mergeTreesOrThrow(io, base.tree, tree, commit.tree);
			parent = await git.writeCommit({
				...packed,
				commit: {
					message: commit.message,
					tree,
					parent: [parent],
					author: commit.author,
					committer: author,
				},
			});
		}
		await git.writeRef({
			...packed,
			ref: targetRef,
			value: parent,
			force: true,
		});
		return { commitOid: parent };
	});
}

/**
 * Whether a rebase merge of `sourceRef` onto `targetRef` would succeed, which
 * is what GitHub's `rebaseable` reports. The same preconditions as
 * `rebaseMerge` — nothing to replay when the target already contains the
 * source or the source is based on it, no rebase past `MAX_RANGE_COMMITS`
 * commits or of a branch with a merge commit — and then every commit is
 * replayed against a merge kept in memory, so the check writes nothing and a
 * conflict (or a refusal) is `false`.
 */
export async function rebaseable(
	repo: Repo,
	sourceRef: string,
	targetRef: string,
): Promise<boolean> {
	const tips = await resolveTips(repo, sourceRef, targetRef);
	const { sourceOid, targetOid } = tips;
	const baseOid = await mergeBaseOf(repo, tips, sourceRef, targetRef);
	// Nothing to replay: already merged, or already based on the target.
	if (baseOid === sourceOid || baseOid === targetOid) return true;
	const range = await commitsAboveBase(repo, baseOid, sourceOid);
	if (range.truncated) return false;
	if (range.commits.some((commit) => commit.parents.length !== 1)) return false;
	const commits = linearOrder(sourceOid, range.commits);
	const targetCommit = await git.readCommit({ ...repo, oid: targetOid });
	const io = dryRunIO(repoIO(repo));
	let tree = targetCommit.commit.tree;
	for (const commit of commits) {
		const { commit: base } = await git.readCommit({
			...repo,
			oid: commit.parents[0] as string,
		});
		try {
			tree = await mergeTreesOrThrow(io, base.tree, tree, commit.tree);
		} catch (error) {
			if (error instanceof GitMergeConflictError) return false;
			throw error;
		}
	}
	return true;
}
