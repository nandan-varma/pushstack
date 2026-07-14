import { getCachedObject, setCachedObject } from "./git-cache";
import { type CommitInfo, getCommitLog } from "./git-history-ops";
import { getRepoOptions } from "./git-repo-storage";
import { findTreeEntry } from "./git-tree-ops";
import { perfNote, perfStep } from "./perf-log";

export interface FileHistoryEntry {
	sha: string;
	message: string;
	authorName: string;
	authorEmail: string;
	createdAt: string;
}

export interface FileHistoryResult {
	entries: FileHistoryEntry[];
	// True when the walk hit its depth budget (or the requested `limit`) before
	// exhausting the branch's full commit chain — there may be older commits
	// touching this file that a deeper walk (bigger `limit`) would surface.
	truncated: boolean;
}

// Same bound as getLastCommitsForTree (git-last-commit.ts) — walking the full
// commit chain is R2-round-trip-bound, so cap how far back a single request
// will look rather than walking unbounded history.
const HISTORY_WALK_DEPTH = 400;

// Tree-object reads only depend on each commit's (already-known) tree oid, so
// they're prefetched in parallel windows same as getLastCommitsForTree — the
// walk that consumes them is still sequential (needs the previous commit's
// resolved oid to know whether the current one is a change).
const PREFETCH_WINDOW = 24;

function toEntry(commit: CommitInfo): FileHistoryEntry {
	return {
		sha: commit.oid,
		message: commit.commit.message.trim(),
		authorName: commit.commit.author.name,
		authorEmail: commit.commit.author.email,
		createdAt: new Date(commit.commit.author.timestamp * 1000).toISOString(),
	};
}

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
): Promise<FileHistoryResult> {
	const walkDepth = Math.max(HISTORY_WALK_DEPTH, limit);
	const commits = await perfStep(`getCommitLog depth=${walkDepth}`, () =>
		getCommitLog(ownerKey, repoName, branchName, walkDepth),
	);
	if (commits.length === 0) return { entries: [], truncated: false };

	const headSha = commits[0].oid;
	const cacheKey = `result:file-history:${ownerKey}/${repoName}/${headSha}:${filePath}:${limit}`;
	const cached = getCachedObject<FileHistoryResult>(cacheKey);
	if (cached) {
		perfNote("getFileHistory: result-cache HIT, skipping history walk");
		return cached;
	}
	perfNote("getFileHistory: result-cache MISS, walking history");

	const repo = await getRepoOptions(ownerKey, repoName);
	const byOid = new Map(commits.map((commit) => [commit.oid, commit]));

	const oidByCommitTree = new Map<string, string | null>();
	async function resolveOid(commitTreeOid: string): Promise<string | null> {
		const cached = oidByCommitTree.get(commitTreeOid);
		if (cached !== undefined) return cached;
		const entry = await findTreeEntry(repo, commitTreeOid, filePath);
		const oid = entry?.type === "blob" ? entry.oid : null;
		oidByCommitTree.set(commitTreeOid, oid);
		return oid;
	}

	const entries: FileHistoryEntry[] = [];
	let truncated = false;

	outer: for (
		let windowStart = 0;
		windowStart < commits.length;
		windowStart += PREFETCH_WINDOW
	) {
		const windowEnd = Math.min(windowStart + PREFETCH_WINDOW, commits.length);
		// +1 lookahead so the last entry's parent tree is already warm too.
		const prefetchEnd = Math.min(windowEnd + 1, commits.length);

		await Promise.all(
			commits
				.slice(windowStart, prefetchEnd)
				.map((commit) => resolveOid(commit.commit.tree)),
		);

		for (let i = windowStart; i < windowEnd; i++) {
			const commit = commits[i];

			const parentSha = commit.commit.parent[0];
			const parentCommit = parentSha ? byOid.get(parentSha) : undefined;
			if (parentSha && !parentCommit) {
				// Walked past our depth cap without reaching this commit's parent —
				// can't tell whether it changed the file, so stop and report truncated.
				truncated = true;
				break outer;
			}

			const [oid, parentOid] = await Promise.all([
				resolveOid(commit.commit.tree),
				parentCommit
					? resolveOid(parentCommit.commit.tree)
					: Promise.resolve(null),
			]);

			if (oid !== parentOid) {
				entries.push(toEntry(commit));
				if (entries.length >= limit) {
					truncated = i < commits.length - 1;
					break outer;
				}
			}
		}
	}

	const result = { entries, truncated };
	setCachedObject(cacheKey, result);
	return result;
}
