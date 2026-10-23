import { diffArrays } from "diff";
import { decodeUtf8, hasNullByte } from "../edge-utils.js";
import { GitError, GitPathNotFoundError } from "../git-errors.js";
import {
	type CommitInfo,
	type CommitSummary,
	getBlob,
	getCommitLog,
	HISTORY_WALK_DEPTH,
	resolveCommitOid,
	summarizeCommit,
} from "./history.js";
import { findTreeEntry } from "./tree.js";
import type { OpsHooks, Repo } from "./types.js";
import { runStep } from "./types.js";

/** Files larger than this are not blamed (refused with {@link BlameLimitError}). */
export const MAX_BLAME_FILE_BYTES = 1024 * 1024;
/** Files with more lines than this are not blamed. */
export const MAX_BLAME_LINES = 20000;
/** Blob bytes one blame may read across every revision it compares. */
export const MAX_BLAME_BYTES = 16 * 1024 * 1024;
/** Largest line-diff edit script computed per revision pair. */
const MAX_EDIT_LENGTH = 4000;
/**
 * Line-diff work one blame may spend across all revision pairs, in
 * (old + new lines) x edit-script-length units. A diff that would exceed what
 * is left is not run; its lines come back `boundary` rather than an error.
 */
export const MAX_BLAME_DIFF_WORK = 100_000_000;

export type BlameLimitMetric = "bytes" | "lines" | "binary";

/**
 * A refused blame is distinguishable from an empty or truncated one: the file
 * is too large (or binary) to blame within the work budget (406).
 */
export class BlameLimitError extends GitError {
	constructor(
		readonly metric: BlameLimitMetric,
		readonly limit: number,
	) {
		super(
			metric === "binary"
				? "Cannot blame a binary file"
				: `File exceeds the blame limit of ${limit} ${metric}; clone the repository to blame locally`,
			406,
		);
	}
}

export interface BlameCommit extends CommitSummary {
	/** First parent, for "blame prior to this change"; absent for a root commit. */
	parentSha?: string;
}

export interface BlameRange {
	/** 1-based, inclusive. */
	startLine: number;
	endLine: number;
	/** Key into {@link BlameResult.commits}. */
	sha: string;
	/**
	 * True when the walk stopped here (history depth budget) rather than at the
	 * commit that introduced these lines — the real origin may be older.
	 */
	boundary?: boolean;
}

export interface BlameResult {
	/** Resolved head commit the blame was computed at. */
	headSha: string;
	lines: string[];
	ranges: BlameRange[];
	commits: Record<string, BlameCommit>;
	/** True when some ranges are `boundary` ranges. */
	truncated: boolean;
}

export interface BlameOptions {
	ref: string;
	filePath: string;
	/** Commits (all parents) to walk at most. Default HISTORY_WALK_DEPTH. */
	maxDepth?: number;
	maxFileBytes?: number;
	maxLines?: number;
	maxBytes?: number;
	/** Cumulative line-diff work, see {@link MAX_BLAME_DIFF_WORK}. */
	maxDiffWork?: number;
}

function splitLines(content: string): string[] {
	if (content.length === 0) return [];
	const lines = content.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

/**
 * Line map from the new side of a diff to the old side: `map[i]` is the old
 * index of unchanged new line `i`, or -1 when the line was added/changed.
 * `null` when the diff would exceed the per-pair edit-script cap or what is
 * left of the cumulative `budget` (the caller marks those lines `boundary`).
 */
function mapUnchangedLines(
	oldLines: string[],
	newLines: string[],
	budget: { remaining: number },
): Int32Array | null {
	const size = Math.max(1, oldLines.length + newLines.length);
	const maxEditLength = Math.min(
		MAX_EDIT_LENGTH,
		Math.floor(budget.remaining / size),
	);
	if (maxEditLength < 1) return null;
	const parts = diffArrays(oldLines, newLines, { maxEditLength });
	if (!parts) {
		// Ran to the cap: the work was spent even though no map came out.
		budget.remaining -= maxEditLength * size;
		return null;
	}
	const map = new Int32Array(newLines.length).fill(-1);
	let oldIdx = 0;
	let newIdx = 0;
	let edits = 0;
	for (const part of parts) {
		const count = part.count ?? part.value.length;
		if (part.added) {
			newIdx += count;
			edits += count;
		} else if (part.removed) {
			oldIdx += count;
			edits += count;
		} else {
			for (let k = 0; k < count; k++) map[newIdx + k] = oldIdx + k;
			oldIdx += count;
			newIdx += count;
		}
	}
	budget.remaining -= size * (edits + 1);
	return map;
}

/**
 * Line-level blame for one file at a ref: each line is attributed to the
 * commit that introduced it. Unchanged lines are passed to every parent in
 * order (as the reference implementation does), so lines merged in from a side
 * branch keep their real author; renames are not followed (the file's first
 * appearance at this path is the origin).
 *
 * Work is bounded: the file's size and line count, the bytes read across all
 * compared revisions, the edit script per revision pair, the cumulative diff work, and the commit depth
 * (ranges the walk could not resolve come back as `boundary`). Results are
 * memoized per head commit and path in `hooks.resultCache`.
 */
export async function getBlame(
	repo: Repo,
	options: BlameOptions,
	hooks?: OpsHooks,
): Promise<BlameResult> {
	const { ref, filePath } = options;
	const maxDepth = options.maxDepth ?? HISTORY_WALK_DEPTH;
	const maxFileBytes = options.maxFileBytes ?? MAX_BLAME_FILE_BYTES;
	const maxLines = options.maxLines ?? MAX_BLAME_LINES;
	const maxBytes = options.maxBytes ?? MAX_BLAME_BYTES;

	if (hooks?.prefetch) await runStep(hooks, "prefetch", hooks.prefetch);
	const headSha = await resolveCommitOid(repo, ref);
	const maxDiffWork = options.maxDiffWork ?? MAX_BLAME_DIFF_WORK;
	const cacheKey = `blame:${repo.gitdir}:${headSha}:${filePath}:${maxDepth}:${maxFileBytes}:${maxLines}:${maxBytes}:${maxDiffWork}`;
	const diffBudget = { remaining: maxDiffWork };
	const cached = hooks?.resultCache?.get<BlameResult>(cacheKey);
	if (cached) {
		hooks?.onNote?.("getBlame: result-cache HIT");
		return cached;
	}
	hooks?.onNote?.("getBlame: result-cache MISS, walking history");

	const commits = await runStep(hooks, `getCommitLog depth=${maxDepth}`, () =>
		getCommitLog(repo, { ref, depth: maxDepth, knownHeadSha: headSha }, hooks),
	);
	const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
	const head = byOid.get(headSha);
	if (!head) throw new GitPathNotFoundError(`File not found: ${filePath}`);

	// Commits reachable from the head within the walk budget, parents after
	// children, so every child has passed its lines down before a commit runs.
	const order: CommitInfo[] = [];
	const seen = new Set<string>();
	const visit = (commit: CommitInfo) => {
		if (seen.has(commit.oid)) return;
		seen.add(commit.oid);
		for (const sha of commit.commit.parent) {
			const parent = byOid.get(sha);
			if (parent) visit(parent);
		}
		order.push(commit);
	};
	visit(head);
	order.reverse();

	const oidByTree = new Map<string, string | null>();
	async function blobOidAt(commit: CommitInfo): Promise<string | null> {
		const treeOid = commit.commit.tree;
		const known = oidByTree.get(treeOid);
		if (known !== undefined) return known;
		const entry = await findTreeEntry(repo, treeOid, filePath);
		const oid = entry && entry.type === "blob" ? entry.oid : null;
		oidByTree.set(treeOid, oid);
		return oid;
	}

	let bytesRead = 0;
	const linesByOid = new Map<string, string[]>();
	async function readLines(oid: string): Promise<string[]> {
		const cachedLines = linesByOid.get(oid);
		if (cachedLines) return cachedLines;
		const blob = await getBlob(repo, oid);
		bytesRead += blob.byteLength;
		if (blob.byteLength > maxFileBytes || bytesRead > maxBytes) {
			throw new BlameLimitError(
				"bytes",
				blob.byteLength > maxFileBytes ? maxFileBytes : maxBytes,
			);
		}
		if (hasNullByte(blob)) throw new BlameLimitError("binary", 0);
		const lines = splitLines(decodeUtf8(blob));
		if (lines.length > maxLines) throw new BlameLimitError("lines", maxLines);
		linesByOid.set(oid, lines);
		return lines;
	}

	const headOid = await blobOidAt(head);
	if (!headOid) throw new GitPathNotFoundError(`File not found: ${filePath}`);
	const headLines = await readLines(headOid);

	type Pending = { final: number; at: number };
	const origin: (string | undefined)[] = new Array(headLines.length);
	const boundaryLines = new Set<number>();
	// Lines still to place, per commit, indexed into that commit's version.
	const pendingBy = new Map<string, Pending[]>([
		[head.oid, headLines.map((_, i) => ({ final: i, at: i }))],
	]);
	let remaining = headLines.length;

	const attribute = (
		lines: Pending[],
		commit: CommitInfo,
		boundary = false,
	) => {
		for (const { final } of lines) {
			origin[final] = commit.oid;
			if (boundary) boundaryLines.add(final);
		}
		remaining -= lines.length;
	};
	const passDown = (parent: CommitInfo, lines: Pending[]) => {
		const queue = pendingBy.get(parent.oid);
		if (queue) queue.push(...lines);
		else pendingBy.set(parent.oid, lines);
	};

	for (const commit of order) {
		if (remaining === 0) break;
		const pend = pendingBy.get(commit.oid);
		if (!pend || pend.length === 0) continue;
		pendingBy.delete(commit.oid);

		const parentShas = commit.commit.parent;
		if (parentShas.length === 0) {
			attribute(pend, commit);
			continue;
		}
		const parents = parentShas.map((sha) => byOid.get(sha));
		// A parent beyond the depth budget can't be compared: what no visible
		// parent explains stops here, flagged as possibly older.
		const hasMissing = parents.some((p) => !p);
		const [commitOid, ...parentOids] = await Promise.all([
			blobOidAt(commit),
			...parents.map((p) => (p ? blobOidAt(p) : null)),
		]);
		// A parent with the identical file owns every line (git prefers it).
		const same = parentOids.findIndex((oid) => oid === commitOid);
		const sameParent = same >= 0 ? parents[same] : undefined;
		if (sameParent) {
			passDown(sameParent, pend);
			continue;
		}
		// Lines unchanged against a parent go to the first parent that has
		// them; the rest were introduced by this commit.
		let rest = pend;
		let unresolved = false;
		const currentLines = await readLines(commitOid as string);
		for (const [i, parent] of parents.entries()) {
			const parentOid = parentOids[i];
			if (!parent || !parentOid || rest.length === 0) continue;
			const unchanged = mapUnchangedLines(
				await readLines(parentOid),
				currentLines,
				diffBudget,
			);
			if (!unchanged) {
				// Too costly to compare: what is left stops here, flagged.
				unresolved = true;
				break;
			}
			const next: Pending[] = [];
			const passed: Pending[] = [];
			for (const line of rest) {
				const oldIdx = unchanged[line.at] ?? -1;
				if (oldIdx < 0) next.push(line);
				else passed.push({ final: line.final, at: oldIdx });
			}
			if (passed.length > 0) passDown(parent, passed);
			rest = next;
		}
		if (rest.length > 0) attribute(rest, commit, hasMissing || unresolved);
	}

	const ranges: BlameRange[] = [];
	for (let i = 0; i < origin.length; i++) {
		const sha = origin[i] as string;
		const boundary = boundaryLines.has(i);
		const prev = ranges.at(-1);
		if (prev && prev.sha === sha && Boolean(prev.boundary) === boundary) {
			prev.endLine = i + 1;
		} else {
			ranges.push({
				startLine: i + 1,
				endLine: i + 1,
				sha,
				...(boundary ? { boundary: true } : {}),
			});
		}
	}

	const commitMap: Record<string, BlameCommit> = {};
	for (const range of ranges) {
		if (commitMap[range.sha]) continue;
		const info = byOid.get(range.sha);
		if (!info) continue;
		const parentSha = info.commit.parent[0];
		commitMap[range.sha] = {
			...summarizeCommit(info),
			...(parentSha ? { parentSha } : {}),
		};
	}

	const result: BlameResult = {
		headSha,
		lines: headLines,
		ranges,
		commits: commitMap,
		truncated: boundaryLines.size > 0,
	};
	hooks?.resultCache?.set(cacheKey, result);
	return result;
}
