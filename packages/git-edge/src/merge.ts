/**
 * Object-level three-way merge for isomorphic-git.
 *
 * Merges two commits by walking their trees directly — no worktree, no disk.
 * Returns the merged commit OID, or throws GitMergeConflictError with the
 * list of conflicting paths.
 *
 * Edge-compatible: no node: imports, uses only isomorphic-git object APIs.
 */

import { createSemaphore, type Semaphore } from "git-fs-s3";
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

async function readEntries(
	repo: Repo,
	reads: Semaphore,
	treeOid: string | undefined,
): Promise<Map<string, Entry>> {
	if (treeOid === undefined) return new Map();
	const { tree } = await reads.run(() =>
		git.readTree({ ...repo, oid: treeOid }),
	);
	return new Map(tree.map((entry) => [entry.path, entry]));
}

async function readBlob(
	repo: Repo,
	reads: Semaphore,
	oid: string,
): Promise<Uint8Array> {
	const { blob } = await reads.run(() => git.readBlob({ ...repo, oid }));
	return blob;
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
	repo: Repo,
	reads: Semaphore,
	path: string,
	base: Entry | undefined,
	ours: Entry | undefined,
	theirs: Entry | undefined,
	conflicts: string[],
): Promise<Entry | null> {
	if (isTree(ours) && isTree(theirs)) {
		const oid = await mergeTrees(
			repo,
			reads,
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
		isFile(base) ? readBlob(repo, reads, base.oid) : new Uint8Array(),
		readBlob(repo, reads, ours.oid),
		readBlob(repo, reads, theirs.oid),
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
	const oid = await reads.run(() => git.writeBlob({ ...repo, blob: content }));
	return { mode, oid, type: "blob" };
}

/**
 * Three-way merge of trees, recursing only into subtrees both sides changed
 * — an untouched or one-sided subtree is taken by oid without being read.
 * Returns the merged tree's oid, or null when any path conflicted.
 */
async function mergeTrees(
	repo: Repo,
	reads: Semaphore,
	prefix: string,
	baseOid: string | undefined,
	oursOid: string,
	theirsOid: string,
	conflicts: string[],
): Promise<string | null> {
	const [base, ours, theirs] = await Promise.all([
		readEntries(repo, reads, baseOid),
		readEntries(repo, reads, oursOid),
		readEntries(repo, reads, theirsOid),
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
			else
				result = await mergeChangedEntry(repo, reads, path, b, o, t, conflicts);
			if (result) merged.push({ ...result, path: name });
		}),
	);

	if (conflicts.length > before) return null;
	return reads.run(() => git.writeTree({ ...repo, tree: merged }));
}

/** A commit a squash or rebase replays, with what it needs to be rewritten. */
interface RangeCommit {
	oid: string;
	parents: string[];
	tree: string;
	message: string;
	author: CommitObject["author"];
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

/** Three-way merge of trees; a conflict throws `GitMergeConflictError`. */
async function mergeTreesOrThrow(
	repo: Repo,
	reads: Semaphore,
	baseTree: string,
	oursTree: string,
	theirsTree: string,
): Promise<string> {
	const conflicts: string[] = [];
	const treeOid = await mergeTrees(
		repo,
		reads,
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
 * The commits from `baseOid` (exclusive) down to `headOid`, following first
 * parents, oldest first. Stops at any commit reachable from the base.
 */
async function commitsAboveBase(
	repo: Repo,
	baseOid: string,
	headOid: string,
): Promise<RangeCommit[]> {
	const belowBase = new Set(
		(await git.log({ ...repo, ref: baseOid })).map((entry) => entry.oid),
	);
	const commits: RangeCommit[] = [];
	let oid: string | undefined = headOid;
	while (oid !== undefined && !belowBase.has(oid)) {
		const { commit } = await git.readCommit({ ...repo, oid });
		commits.push({
			oid,
			parents: commit.parent,
			tree: commit.tree,
			message: commit.message,
			author: commit.author,
		});
		oid = commit.parent[0];
	}
	return commits.reverse();
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
	if (await sourceContainsTarget(repo, tips)) {
		await git.writeRef({
			...repo,
			ref: targetRef,
			value: sourceOid,
			force: true,
		});
		return { commitOid: sourceOid };
	}

	const baseOid = await mergeBaseOf(repo, tips, sourceRef, targetRef);
	const [baseCommit, sourceCommit, targetCommit] = await Promise.all([
		git.readCommit({ ...repo, oid: baseOid }),
		git.readCommit({ ...repo, oid: sourceOid }),
		git.readCommit({ ...repo, oid: targetOid }),
	]);

	// One pool per merge: concurrent merges in the same process must not share
	// (or leak) each other's limit.
	const reads = createSemaphore(MAX_CONCURRENT_READS);
	return withPackedWrites(repo, async (packed) => {
		const treeOid = await mergeTreesOrThrow(
			packed,
			reads,
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
				committer: author,
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
	 * squashed (oldest first, merge commits left out) — for the default body
	 * GitHub derives from them. Read under the same lock as the merge.
	 */
	message: string | ((commitMessages: string[]) => string);
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
	if (await targetContainsSource(repo, tips)) {
		return { commitOid: targetOid };
	}

	const baseOid = await mergeBaseOf(repo, tips, sourceRef, targetRef);
	const [baseCommit, sourceCommit, targetCommit] = await Promise.all([
		git.readCommit({ ...repo, oid: baseOid }),
		git.readCommit({ ...repo, oid: sourceOid }),
		git.readCommit({ ...repo, oid: targetOid }),
	]);
	const reads = createSemaphore(MAX_CONCURRENT_READS);
	return withPackedWrites(repo, async (packed) => {
		const treeOid = await mergeTreesOrThrow(
			packed,
			reads,
			baseCommit.commit.tree,
			targetCommit.commit.tree,
			sourceCommit.commit.tree,
		);
		const squashed = (
			await commitsAboveBase(packed, baseOid, sourceOid)
		).filter((commit) => commit.parents.length === 1);
		const message =
			typeof opts.message === "function"
				? opts.message(squashed.map((commit) => commit.message))
				: opts.message;
		const author = identityOf(opts);
		const commitOid = await git.writeCommit({
			...packed,
			commit: {
				message,
				tree: treeOid,
				parent: [targetOid],
				author,
				committer: author,
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
	if (await targetContainsSource(repo, tips)) {
		return { commitOid: targetOid };
	}
	if (await sourceContainsTarget(repo, tips)) {
		// Already based on the target (its merge base is the target): nothing to replay.
		await git.writeRef({
			...repo,
			ref: targetRef,
			value: sourceOid,
			force: true,
		});
		return { commitOid: sourceOid };
	}

	const baseOid = await mergeBaseOf(repo, tips, sourceRef, targetRef);
	const commits = await commitsAboveBase(repo, baseOid, sourceOid);
	if (commits.some((commit) => commit.parents.length !== 1)) {
		throw new GitEdgeError(
			`Refusing to rebase ${sourceRef}: it contains a merge commit`,
		);
	}
	const targetCommit = await git.readCommit({ ...repo, oid: targetOid });
	const author = identityOf(opts);
	const reads = createSemaphore(MAX_CONCURRENT_READS);
	return withPackedWrites(repo, async (packed) => {
		let parent = targetOid;
		let tree = targetCommit.commit.tree;
		for (const commit of commits) {
			const { commit: base } = await git.readCommit({
				...packed,
				oid: commit.parents[0] as string,
			});
			tree = await mergeTreesOrThrow(
				packed,
				reads,
				base.tree,
				tree,
				commit.tree,
			);
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
