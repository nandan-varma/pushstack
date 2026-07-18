import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { getCachedObject, setCachedObject } from "./git-cache";
import { GitObjectNotFoundError, GitPathNotFoundError } from "./git-errors";
import { prefetchAllPacks } from "./git-fs";
import { getRepoOptions, qualifyBranchRef } from "./git-repo-storage";
import { findTreeEntry, listTreeEntries, type TreeEntry } from "./git-tree-ops";
import { perfNote, perfStep } from "./perf-log";

// Below this depth, prefetching every pack up front is more bandwidth than it's
// worth (e.g. getCommits' limit=1 "latest commit" lookup only ever needs the tip
// commit, almost always already in the most recently pushed pack).
const PREFETCH_PACKS_MIN_DEPTH = 5;

// A resolved ref (branch/commit) not existing is a normal, expected condition (empty
// repo, unborn branch) and is handled by each caller. An object that fails to resolve
// *underneath* an already-resolved ref (a tree/blob the stored pack doesn't actually
// contain) means the repo's git storage is inconsistent — surface that distinctly so
// callers don't render it as "empty" and the client doesn't see a raw isomorphic-git
// NotFoundError.
function wrapMissingObject<T>(
	promise: Promise<T>,
	context: string,
): Promise<T> {
	return promise.catch((err: unknown) => {
		if ((err as { code?: string })?.code === "NotFoundError") {
			throw new GitObjectNotFoundError(
				`Git data for ${context} is missing from storage. The repository may need to be re-pushed to repair it.`,
			);
		}
		throw err;
	});
}

export interface CommitInfo {
	oid: string;
	commit: {
		message: string;
		tree: string;
		parent: string[];
		author: {
			name: string;
			email: string;
			timestamp: number;
			timezoneOffset: number;
		};
		committer: {
			name: string;
			email: string;
			timestamp: number;
			timezoneOffset: number;
		};
	};
	payload: string;
}

export async function resolveCommit(
	ownerKey: string,
	repoName: string,
	ref: string,
) {
	const repo = await getRepoOptions(ownerKey, repoName);
	const oid = await git.resolveRef({ ...repo, ref: qualifyBranchRef(ref) });
	const result = await git.readCommit({ ...repo, oid });

	return {
		repo,
		oid,
		commit: result.commit,
	};
}

export async function getBlob(
	ownerKey: string,
	repoName: string,
	sha: string,
): Promise<Buffer> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const { blob } = await wrapMissingObject(
		git.readBlob({ ...repo, oid: sha }),
		`${ownerKey}/${repoName} blob ${sha}`,
	);
	return Buffer.from(blob);
}

export async function getFileContent(
	ownerKey: string,
	repoName: string,
	filePath: string,
	ref: string = "main",
): Promise<Buffer> {
	const { repo, commit } = await resolveCommit(ownerKey, repoName, ref);
	const entry = await wrapMissingObject(
		findTreeEntry(repo, commit.tree, filePath),
		`${ownerKey}/${repoName}@${ref}:${filePath}`,
	);

	if (entry?.type !== "blob") {
		throw new Error(`File not found: ${filePath}`);
	}

	const { blob } = await wrapMissingObject(
		git.readBlob({ ...repo, oid: entry.oid }),
		`${ownerKey}/${repoName}@${ref}:${filePath}`,
	);
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
	const result = await wrapMissingObject(
		git.readCommit({ ...repo, oid: sha }),
		`${ownerKey}/${repoName} commit ${sha}`,
	);

	return {
		oid: result.oid,
		commit: result.commit,
		payload: result.payload,
	};
}

function isFullyWalked(commits: CommitInfo[]): boolean {
	const last = commits[commits.length - 1];
	return !!last && last.commit.parent.length === 0;
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

	let headSha: string;
	if (knownHeadSha) {
		headSha = knownHeadSha;
	} else {
		try {
			headSha = await git.resolveRef({ ...repo, ref: qualifyBranchRef(ref) });
		} catch (err: unknown) {
			if ((err as { code?: string }).code === "NotFoundError") return [];
			throw err;
		}
	}

	// ponytail: walking the commit chain is inherently sequential (each commit's
	// oid is only discoverable by reading its child first) and dominated by
	// per-object network round trips — measured at ~150ms/commit against R2.
	// Different callers on the same page load (and a user browsing between
	// directories) frequently re-request the same head at different depths, so
	// cache the deepest walk seen for this head and reuse/slice it instead of
	// re-walking from scratch every time.
	const cacheKey = `result:commitlog:${ownerKey}/${repoName}/${headSha}`;
	const cached = getCachedObject<CommitInfo[]>(cacheKey);
	if (cached && (cached.length >= depth || isFullyWalked(cached))) {
		perfNote(`getCommitLog: result-cache HIT for ${cacheKey} (depth=${depth})`);
		return cached.slice(0, depth);
	}
	perfNote(`getCommitLog: result-cache MISS for ${cacheKey} (depth=${depth})`);

	if (depth >= PREFETCH_PACKS_MIN_DEPTH && isR2Configured()) {
		await perfStep("prefetchAllPacks", () =>
			prefetchAllPacks(ownerKey, repoName),
		);
	}

	try {
		const commits = await perfStep(`git.log ${ref} depth=${depth}`, () =>
			git.log({ ...repo, ref: headSha, depth }),
		);
		const result = commits.map((commit) => ({
			oid: commit.oid,
			commit: commit.commit,
			payload: commit.payload || "",
		}));
		if (!cached || result.length > cached.length) {
			setCachedObject(cacheKey, result);
		}
		return result;
	} catch (err: unknown) {
		if ((err as { code?: string }).code === "NotFoundError") return [];
		throw err;
	}
}

export async function getFileFromBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
): Promise<{ content: string; size: number; isBinary: boolean }> {
	const buffer = await getFileContent(ownerKey, repoName, filePath, branchName);
	const isBinary = buffer.includes(0);

	return {
		content: isBinary ? buffer.toString("base64") : buffer.toString("utf-8"),
		size: buffer.length,
		isBinary,
	};
}

export async function getTreeFromBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	treePath: string = "",
): Promise<TreeEntry[]> {
	let repo: Awaited<ReturnType<typeof getRepoOptions>>;
	let commit: Awaited<ReturnType<typeof resolveCommit>>["commit"];
	let headSha: string | null = null;
	try {
		const resolved = await resolveCommit(ownerKey, repoName, branchName);
		repo = resolved.repo;
		commit = resolved.commit;
		headSha = resolved.oid;
	} catch (err: unknown) {
		// ponytail: empty repo or branch not yet created — return empty tree
		if ((err as { code?: string }).code === "NotFoundError") return [];
		throw err;
	}

	// ponytail: keyed by HEAD sha so cache auto-invalidates on push
	const cacheKey = `result:tree:${ownerKey}/${repoName}/${headSha}:${treePath}`;
	const cached = getCachedObject<TreeEntry[]>(cacheKey);
	if (cached) {
		perfNote(`getTreeFromBranch: result-cache HIT for ${cacheKey}`);
		return cached;
	}
	perfNote(`getTreeFromBranch: result-cache MISS for ${cacheKey}`);

	const context = `${ownerKey}/${repoName}@${branchName}:${treePath || "/"}`;
	let result: TreeEntry[];
	if (!treePath) {
		result = await wrapMissingObject(
			perfStep("listTreeEntries (root)", () =>
				listTreeEntries(repo, commit.tree),
			),
			context,
		);
	} else {
		const entry = await wrapMissingObject(
			perfStep(`findTreeEntry ${treePath}`, () =>
				findTreeEntry(repo, commit.tree, treePath),
			),
			context,
		);
		if (!entry) {
			throw new GitPathNotFoundError(
				`Path "${treePath}" does not exist in ${repoName}@${branchName}`,
			);
		}
		result =
			entry.type !== "tree"
				? []
				: await wrapMissingObject(
						perfStep(`listTreeEntries ${treePath}`, () =>
							listTreeEntries(repo, entry.oid, entry.path),
						),
						context,
					);
	}

	setCachedObject(cacheKey, result);
	return result;
}

export async function getCommitHistory(
	ownerKey: string,
	repoName: string,
	branchName: string,
	limit: number = 50,
	skip: number = 0,
): Promise<CommitInfo[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const headSha = await git
		.resolveRef({ ...repo, ref: `refs/heads/${branchName}` })
		.catch(() => null);

	// ponytail: keyed by HEAD sha so cache auto-invalidates on push
	const cacheKey = headSha
		? `result:commits:${ownerKey}/${repoName}/${headSha}:${limit}:${skip}`
		: null;
	if (cacheKey) {
		const cached = getCachedObject<CommitInfo[]>(cacheKey);
		if (cached) {
			perfNote(`getCommitHistory: result-cache HIT for ${cacheKey}`);
			return cached;
		}
	}
	perfNote(
		`getCommitHistory: result-cache MISS for ${cacheKey ?? "(no head)"}`,
	);
	if (!headSha) return [];

	const all = await getCommitLog(
		ownerKey,
		repoName,
		branchName,
		limit + skip,
		headSha,
	);
	const result = all.slice(skip, skip + limit);

	if (cacheKey) setCachedObject(cacheKey, result);
	return result;
}
