import type { repositories } from "#/db/app-schema";

type OwnerLike = {
	id: string;
	username: string | null;
	email: string;
};

type RepoLike = Pick<typeof repositories.$inferSelect, "ownerId" | "name"> & {
	owner?: OwnerLike | null;
};

// Replacing slashes with "-" defeats a multi-segment traversal (e.g.
// "../../etc"), but a segment that is *exactly* "." or ".." contains no slash
// to replace and would otherwise pass through unchanged — and every consumer
// of this value (getRepoPath in git-manager-iso.ts) joins it into a real
// filesystem path via path.join, which does resolve ".." components. Collapse
// those to a literal placeholder so a stored value can never traverse.
export function sanitizeStorageSegment(value: string): string {
	const cleaned = value
		.trim()
		.replace(/[\\/]+/g, "-")
		.replace(/\s+/g, "-");
	return cleaned === "." || cleaned === ".." ? "_" : cleaned;
}

export function getStorageOwnerKey(owner: OwnerLike): string {
	const fallbackUsername = owner.email.split("@")[0] || owner.id;
	return sanitizeStorageSegment(owner.username || fallbackUsername || owner.id);
}

export function getRepoStorageCoordinates(repo: RepoLike) {
	if (!repo.owner) {
		throw new Error(`Repository owner metadata missing for ${repo.name}`);
	}

	return {
		ownerKey: getStorageOwnerKey(repo.owner),
		repoKey: sanitizeStorageSegment(repo.name),
	};
}

export function getRepoStorageRoot(ownerKey: string, repoName: string): string {
	return `repos/${sanitizeStorageSegment(ownerKey)}/${sanitizeStorageSegment(repoName)}`;
}

export function getRepoGitStorageRoot(
	ownerKey: string,
	repoName: string,
): string {
	return `${getRepoStorageRoot(ownerKey, repoName)}/git`;
}

export function getRepoGitStoragePrefix(
	ownerKey: string,
	repoName: string,
): string {
	return `${getRepoGitStorageRoot(ownerKey, repoName)}/`;
}

/** A storage key inside some repo's gitdir, split along the key layout. */
export interface RepoGitStorageKey {
	ownerKey: string;
	repoName: string;
	/** Path relative to the gitdir; listing prefixes keep their trailing `/`. */
	gitdirPath: string;
}

/**
 * Inverse of {@link getRepoGitStoragePrefix}: split a key (or listing
 * prefix) of the form `repos/{ownerKey}/{repoName}/git/{gitdirPath}`. `null`
 * for keys outside that layout.
 */
export function parseRepoGitStorageKey(key: string): RepoGitStorageKey | null {
	const [root, ownerKey, repoName, git, ...rest] = key.split("/");
	if (
		root !== "repos" ||
		!ownerKey ||
		!repoName ||
		git !== "git" ||
		rest.length === 0
	) {
		return null;
	}
	return { ownerKey, repoName, gitdirPath: rest.join("/") };
}
