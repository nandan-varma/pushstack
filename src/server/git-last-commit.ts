import { getCachedObject, setCachedObject } from "./git-cache";
import { type CommitInfo, getCommitLog } from "./git-history-ops";
import { getRepoOptions } from "./git-repo-storage";
import { findTreeEntry, listTreeEntries } from "./git-tree-ops";

export interface LastCommitInfo {
	sha: string;
	message: string;
	authorName: string;
	authorEmail: string;
	createdAt: string;
}

// Bounds how far back we walk history to resolve "last commit touching this
// path" for a directory listing. Entries whose last change is older than
// this window simply show no last-commit info rather than an expensive
// unbounded history scan.
const HISTORY_WALK_DEPTH = 400;

function toLastCommitInfo(commit: CommitInfo): LastCommitInfo {
	return {
		sha: commit.oid,
		message: commit.commit.message.trim(),
		authorName: commit.commit.author.name,
		authorEmail: commit.commit.author.email,
		createdAt: new Date(commit.commit.author.timestamp * 1000).toISOString(),
	};
}

/**
 * For each direct child of `treePath` (at the tip of `branchName`), find the
 * most recent commit that changed it — same idea as GitHub's tree view
 * "last commit" column. Walks history newest-to-oldest, comparing the
 * directory's tree oid commit-to-commit and only descending one level to
 * diff child oids when something under the directory actually changed.
 */
export async function getLastCommitsForTree(
	ownerKey: string,
	repoName: string,
	branchName: string,
	treePath: string,
): Promise<Record<string, LastCommitInfo>> {
	const commits = await getCommitLog(
		ownerKey,
		repoName,
		branchName,
		HISTORY_WALK_DEPTH,
	);
	if (commits.length === 0) return {};

	const headSha = commits[0].oid;
	const cacheKey = `result:last-commits:${ownerKey}/${repoName}/${headSha}:${treePath}`;
	const cached = getCachedObject<Record<string, LastCommitInfo>>(cacheKey);
	if (cached) return cached;

	const repo = await getRepoOptions(ownerKey, repoName);
	const byOid = new Map(commits.map((commit) => [commit.oid, commit]));

	const headDirEntry = await findTreeEntry(
		repo,
		commits[0].commit.tree,
		treePath,
	);
	if (headDirEntry?.type !== "tree") return {};

	// listTreeEntries is prefixed with treePath so result keys match the full
	// paths (`file.path`) that callers key their file listing by.
	const headChildren = await listTreeEntries(repo, headDirEntry.oid, treePath);
	const remaining = new Set(headChildren.map((entry) => entry.path));
	const result: Record<string, LastCommitInfo> = {};

	for (const commit of commits) {
		if (remaining.size === 0) break;

		const parentSha = commit.commit.parent[0];
		const parentCommit = parentSha ? byOid.get(parentSha) : undefined;
		if (parentSha && !parentCommit) break; // walked past our depth cap

		const dirEntry = await findTreeEntry(repo, commit.commit.tree, treePath);
		const dirOid = dirEntry?.type === "tree" ? dirEntry.oid : null;

		const parentDirEntry = parentCommit
			? await findTreeEntry(repo, parentCommit.commit.tree, treePath)
			: null;
		const parentDirOid =
			parentDirEntry?.type === "tree" ? parentDirEntry.oid : null;

		if (dirOid === parentDirOid) continue;

		const [children, parentChildren] = await Promise.all([
			dirOid ? listTreeEntries(repo, dirOid, treePath) : Promise.resolve([]),
			parentDirOid
				? listTreeEntries(repo, parentDirOid, treePath)
				: Promise.resolve([]),
		]);
		const childByName = new Map(
			children.map((entry) => [entry.path, entry.oid]),
		);
		const parentChildByName = new Map(
			parentChildren.map((entry) => [entry.path, entry.oid]),
		);

		for (const name of remaining) {
			if (childByName.get(name) !== parentChildByName.get(name)) {
				result[name] = toLastCommitInfo(commit);
			}
		}
		for (const name of Object.keys(result)) {
			remaining.delete(name);
		}
	}

	setCachedObject(cacheKey, result);
	return result;
}
