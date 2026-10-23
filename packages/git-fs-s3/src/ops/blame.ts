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
/** Tree reads are prefetched in parallel windows, like file history. */
const PREFETCH_WINDOW = 24;

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
	/** Commits (first-parent chain) to walk at most. Default HISTORY_WALK_DEPTH. */
	maxDepth?: number;
	maxFileBytes?: number;
	maxLines?: number;
	maxBytes?: number;
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
 * `null` when the edit script exceeds its budget (treat every line as new).
 */
function mapUnchangedLines(
	oldLines: string[],
	newLines: string[],
): Int32Array | null {
	const parts = diffArrays(oldLines, newLines, {
		maxEditLength: MAX_EDIT_LENGTH,
	});
	if (!parts) return null;
	const map = new Int32Array(newLines.length).fill(-1);
	let oldIdx = 0;
	let newIdx = 0;
	for (const part of parts) {
		const count = part.count ?? part.value.length;
		if (part.added) newIdx += count;
		else if (part.removed) oldIdx += count;
		else {
			for (let k = 0; k < count; k++) map[newIdx + k] = oldIdx + k;
			oldIdx += count;
			newIdx += count;
		}
	}
	return map;
}

/**
 * Line-level blame for one file at a ref, following the first-parent chain:
 * each line is attributed to the newest commit that introduced it. Lines that
 * entered through a merge are attributed to the merge commit, and renames are
 * not followed (the file's first appearance at this path is the origin).
 *
 * Work is bounded: the file's size and line count, the bytes read across all
 * compared revisions, the edit script per revision pair, and the commit depth
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
	const cacheKey = `blame:${repo.gitdir}:${headSha}:${filePath}:${maxDepth}:${maxFileBytes}:${maxLines}:${maxBytes}`;
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

	// The first-parent chain, newest first.
	const chain: CommitInfo[] = [];
	for (
		let cursor: CommitInfo | undefined = head;
		cursor;
		cursor = byOid.get(cursor.commit.parent[0] ?? "")
	) {
		chain.push(cursor);
	}

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
	async function readLines(oid: string): Promise<string[]> {
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
		return lines;
	}

	const headOid = await blobOidAt(head);
	if (!headOid) throw new GitPathNotFoundError(`File not found: ${filePath}`);
	let currentOid: string = headOid;
	const headLines = await readLines(headOid);
	let currentLines = headLines;

	const origin: (string | undefined)[] = new Array(headLines.length);
	const boundaryLines = new Set<number>();
	// Pending lines: final line index -> its index in the version being compared.
	let pending: { final: number; at: number }[] = headLines.map((_, i) => ({
		final: i,
		at: i,
	}));

	const attribute = (commit: CommitInfo, boundary = false) => {
		for (const { final } of pending) {
			origin[final] = commit.oid;
			if (boundary) boundaryLines.add(final);
		}
		pending = [];
	};

	for (let i = 0; i < chain.length && pending.length > 0; i++) {
		const commit = chain[i];
		if (!commit) break;
		const parent = chain[i + 1];
		if (commit.commit.parent.length === 0) {
			attribute(commit);
			break;
		}
		if (!parent) {
			// The parent lies beyond the depth budget: this is as far as we see.
			attribute(commit, true);
			break;
		}
		if (i % PREFETCH_WINDOW === 0) {
			await Promise.all(
				chain.slice(i + 1, i + 1 + PREFETCH_WINDOW).map((c) => blobOidAt(c)),
			);
		}
		const parentOid = await blobOidAt(parent);
		if (parentOid === null) {
			attribute(commit);
			break;
		}
		if (parentOid === currentOid) continue;

		const parentLines = await readLines(parentOid);
		const unchanged = mapUnchangedLines(parentLines, currentLines);
		const next: typeof pending = [];
		for (const line of pending) {
			const oldIdx = unchanged ? (unchanged[line.at] ?? -1) : -1;
			if (oldIdx < 0) origin[line.final] = commit.oid;
			else next.push({ final: line.final, at: oldIdx });
		}
		pending = next;
		currentOid = parentOid;
		currentLines = parentLines;
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
